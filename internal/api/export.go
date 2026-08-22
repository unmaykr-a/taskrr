package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// Data export.
//
// Admin backups are whole-database and admin-only, which leaves an ordinary
// user on a shared instance with no way to take their own data with them. These
// two formats cover the two reasons people ask for it: JSON to move an account
// somewhere else without losing structure, and CSV to open the history in a
// spreadsheet.
//
// Both are owner-scoped through the same store methods the rest of the API
// uses, so an export can never reach another account's tasks.

// exportTask is one task plus its full history, as it appears in the JSON file.
type exportTask struct {
	store.Task
	Completions []store.Completion `json:"completions"`
}

type exportDocument struct {
	// Format is a version marker so a future importer can tell what it's reading.
	Format     string       `json:"format"`
	ExportedAt time.Time    `json:"exportedAt"`
	Username   string       `json:"username"`
	Tasks      []exportTask `json:"tasks"`
}

const exportFormat = "taskrr-export-v1"

// collectExport gathers every task the user owns or shares, each with its
// history. N+1 queries by design: this runs once, by hand, against a personal
// instance with tens of tasks — a bespoke join would be more code to maintain
// than the round trips are worth.
func (s *Server) collectExport(r *http.Request, u store.User) (exportDocument, error) {
	ctx := r.Context()
	tasks, err := s.store.ListTasks(ctx, u.ID)
	if err != nil {
		return exportDocument{}, err
	}
	out := exportDocument{
		Format:     exportFormat,
		ExportedAt: time.Now().UTC(),
		Username:   u.Username,
		Tasks:      make([]exportTask, 0, len(tasks)),
	}
	for _, t := range tasks {
		completions, err := s.store.ListCompletions(ctx, u.ID, t.ID)
		if err != nil {
			return exportDocument{}, err
		}
		if completions == nil {
			completions = []store.Completion{}
		}
		out.Tasks = append(out.Tasks, exportTask{Task: t, Completions: completions})
	}
	return out, nil
}

// handleExport writes the caller's own data as JSON (default) or CSV.
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	doc, err := s.collectExport(r, u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not build export")
		return
	}

	// A filename with the date on it, since these pile up in a downloads folder.
	stamp := doc.ExportedAt.Format("2006-01-02")
	safeUser := sanitizeFilename(u.Username)

	if strings.EqualFold(r.URL.Query().Get("format"), "csv") {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=%q", fmt.Sprintf("taskrr-%s-%s.csv", safeUser, stamp)))
		writeExportCSV(w, doc)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename=%q", fmt.Sprintf("taskrr-%s-%s.json", safeUser, stamp)))
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(doc)
}

// writeExportCSV emits one row per completion — the shape a spreadsheet wants.
// A task that has never been logged still gets a row (with empty completion
// columns) so nothing silently vanishes from the export.
func writeExportCSV(w http.ResponseWriter, doc exportDocument) {
	cw := csv.NewWriter(w)
	defer cw.Flush()

	_ = cw.Write([]string{
		"task", "description", "folder", "tags", "routine_seconds", "archived",
		"completed_at", "note",
	})
	for _, t := range doc.Tasks {
		routine := ""
		if t.IntervalSeconds != nil {
			routine = strconv.FormatInt(*t.IntervalSeconds, 10)
		}
		archived := "false"
		if t.ArchivedAt != nil {
			archived = "true"
		}
		base := []string{t.Name, t.Description, t.Folder, strings.Join(t.Tags, " "), routine, archived}
		if len(t.Completions) == 0 {
			_ = cw.Write(append(base, "", ""))
			continue
		}
		for _, c := range t.Completions {
			_ = cw.Write(append(append([]string{}, base...),
				c.CompletedAt.UTC().Format(time.RFC3339), c.Note))
		}
	}
}

// sanitizeFilename reduces a username to something safe to interpolate into a
// Content-Disposition filename, so an exotic account name can't smuggle quotes
// or path separators into the header.
func sanitizeFilename(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	// Collapse the runs a stripped-out sequence leaves behind, so a username
	// full of punctuation yields "a-rm-rf" rather than "a---rm--rf".
	out := b.String()
	for strings.Contains(out, "--") {
		out = strings.ReplaceAll(out, "--", "-")
	}
	out = strings.Trim(out, "-")
	if out == "" {
		return "export"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}
