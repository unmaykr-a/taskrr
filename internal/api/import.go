package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Data import — the other half of the export.
//
// This is the one endpoint that takes a whole document of user-authored data
// and writes it to the database, so it is deliberately paranoid:
//
//   - Nothing structural is trusted from the file. Ids, owners and share state
//     are ignored entirely; every task is created fresh under the calling
//     account. A file cannot name an owner, resurrect an id, or reach another
//     user's data.
//   - Every task goes through exactly the same validation as one created by
//     hand (taskRequest.toInput), so an import can't smuggle in a name or a
//     colour the API would otherwise reject.
//   - Counts and body size are capped, so a malformed or hostile file fails
//     fast instead of filling the disk.
//   - The format marker is checked rather than guessed at.

const (
	// maxImportTasks / maxImportCompletions bound one import. Generous for a
	// personal tracker, small enough that a bad file can't run away with the
	// database.
	maxImportTasks       = 5_000
	maxImportCompletions = 200_000
	// maxImportBytes is larger than the 1 MiB cap on ordinary API calls: a real
	// export of years of history is a document, not a command. Still bounded, so
	// an oversized upload is refused rather than buffered.
	maxImportBytes = 16 << 20
)

// decodeImportDocument reads an uploaded export.
//
// Unlike every other endpoint this one does *not* reject unknown fields. An
// export legitimately carries things the importer has no use for — ids, owner
// ids, derived counts, the export timestamp — and a file written by a different
// version of Taskrr should still restore what it can rather than being refused
// wholesale. Ignoring those fields is exactly the intent: nothing structural is
// read from the file, so there is nothing to be strict about.
func decodeImportDocument(w http.ResponseWriter, r *http.Request, dst *importDocument) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxImportBytes))
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "could not read that file as JSON")
		return false
	}
	return true
}

// importTask is one task in the uploaded document. Only the fields worth
// restoring are read; anything else in the file (ids, ownerId, derived counts)
// is ignored by omission rather than by explicit stripping.
type importTask struct {
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	IntervalSeconds *int64   `json:"intervalSeconds"`
	ColorFresh      *string  `json:"colorFresh"`
	ColorOverdue    *string  `json:"colorOverdue"`
	FreezeColor     bool     `json:"freezeColor"`
	Tags            []string `json:"tags"`
	Folder          string   `json:"folder"`
	Pinned          bool     `json:"pinned"`
	// Scheduling state that is genuine user intent, so a restore keeps it:
	// "don't bother me until Friday" should survive moving instances.
	SnoozedUntil        *time.Time `json:"snoozedUntil"`
	ReminderLeadSeconds *int64     `json:"reminderLeadSeconds"`

	Completions []importCompletion `json:"completions"`
}

type importCompletion struct {
	CompletedAt time.Time `json:"completedAt"`
	Note        string    `json:"note"`
}

type importDocument struct {
	Format string       `json:"format"`
	Tasks  []importTask `json:"tasks"`
}

// importMode decides what happens to what is already there.
type importMode string

const (
	// importMerge adds the file's tasks alongside the existing ones.
	importMerge importMode = "merge"
	// importReplace deletes the caller's tasks first. Guarded in the UI by the
	// same re-type-your-username confirmation as the other destructive actions.
	importReplace importMode = "replace"
)

type importResult struct {
	Mode             string `json:"mode"`
	TasksCreated     int    `json:"tasksCreated"`
	CompletionsAdded int    `json:"completionsAdded"`
	TasksDeleted     int64  `json:"tasksDeleted"`
	// Skipped explains anything that couldn't be restored, so a partial import
	// is visible rather than silent.
	Skipped []string `json:"skipped"`
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}

	mode := importMerge
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mode"))) {
	case "", string(importMerge):
		mode = importMerge
	case string(importReplace):
		mode = importReplace
	default:
		writeError(w, http.StatusBadRequest, `mode must be "merge" or "replace"`)
		return
	}

	var doc importDocument
	if !decodeImportDocument(w, r, &doc) {
		return
	}
	// Check the marker rather than guessing: a file we don't understand should
	// be refused, not half-imported.
	if doc.Format != exportFormat {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("unrecognised file (expected a %s export)", exportFormat))
		return
	}
	if len(doc.Tasks) == 0 {
		writeError(w, http.StatusBadRequest, "the file contains no tasks")
		return
	}
	if len(doc.Tasks) > maxImportTasks {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("too many tasks in one import (limit %d)", maxImportTasks))
		return
	}
	total := 0
	for _, t := range doc.Tasks {
		total += len(t.Completions)
	}
	if total > maxImportCompletions {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("too many completions in one import (limit %d)", maxImportCompletions))
		return
	}

	ctx := r.Context()
	result := importResult{Mode: string(mode), Skipped: []string{}}

	if mode == importReplace {
		deleted, err := s.store.DeleteTasksByOwner(ctx, u.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not clear existing tasks")
			return
		}
		result.TasksDeleted = deleted
	}

	for i, in := range doc.Tasks {
		// Reuse the ordinary create-task validation verbatim, so imported data
		// is held to exactly the same standard as typed-in data.
		input, msg := taskRequest{
			Name:                in.Name,
			Description:         in.Description,
			IntervalSeconds:     in.IntervalSeconds,
			ColorFresh:          in.ColorFresh,
			ColorOverdue:        in.ColorOverdue,
			FreezeColor:         in.FreezeColor,
			Tags:                in.Tags,
			Folder:              in.Folder,
			Pinned:              in.Pinned,
			ReminderLeadSeconds: in.ReminderLeadSeconds,
		}.toInput()
		if msg != "" {
			result.Skipped = append(result.Skipped, fmt.Sprintf("task %d (%s): %s", i+1, short(in.Name), msg))
			continue
		}

		task, err := s.store.CreateTask(ctx, u.ID, input)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not create an imported task")
			return
		}
		result.TasksCreated++

		// Carry a snooze over, but only if it is still in the future — an old
		// backup shouldn't restore a task into a hold that expired months ago.
		if in.SnoozedUntil != nil && in.SnoozedUntil.After(time.Now().UTC()) {
			until := in.SnoozedUntil.UTC()
			if _, err := s.store.SetTaskSnoozed(ctx, u.ID, task.ID, &until); err != nil {
				result.Skipped = append(result.Skipped,
					fmt.Sprintf("could not restore the snooze on %s", short(in.Name)))
			}
		}

		for _, c := range in.Completions {
			if c.CompletedAt.IsZero() {
				result.Skipped = append(result.Skipped,
					fmt.Sprintf("a completion of %s had no timestamp", short(in.Name)))
				continue
			}
			note := c.Note
			if len([]rune(note)) > maxTextLen {
				note = string([]rune(note)[:maxTextLen])
			}
			if _, err := s.store.AddCompletion(ctx, u.ID, task.ID, c.CompletedAt.UTC(), note); err != nil {
				writeError(w, http.StatusInternalServerError, "could not restore a completion")
				return
			}
			result.CompletionsAdded++
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// short trims a name for an error message, so a pathological one can't dominate
// the response.
func short(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "(unnamed)"
	}
	r := []rune(name)
	if len(r) > 40 {
		return string(r[:40]) + "…"
	}
	return name
}
