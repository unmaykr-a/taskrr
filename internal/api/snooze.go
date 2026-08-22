package api

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// Snooze, skip, pin and duplicate — the four task actions that don't fit the
// edit form, and that the right-click menu reaches directly.

// maxSnoozeDuration bounds how far out a task can be pushed. A snooze is meant
// to be "I'll get to it", not a way to make a task vanish for a decade — and
// archiving is the right tool for that anyway.
const maxSnoozeDuration = 365 * 24 * time.Hour

type snoozeRequest struct {
	// Until is an RFC3339 timestamp. Empty (or omitted) clears the snooze.
	Until string `json:"until"`
}

func (s *Server) handleSnoozeTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req snoozeRequest
	if !decodeJSONAllowEmpty(w, r, &req) {
		return
	}

	var until *time.Time
	if raw := strings.TrimSpace(req.Until); raw != "" {
		when, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "until must be an RFC3339 timestamp, or empty to clear")
			return
		}
		now := time.Now().UTC()
		if when.After(now.Add(maxSnoozeDuration)) {
			writeError(w, http.StatusBadRequest, "a task can be snoozed at most a year ahead")
			return
		}
		// A snooze in the past is simply over, so treat it as clearing rather
		// than storing a value every read has to ignore.
		if when.After(now) {
			utc := when.UTC()
			until = &utc
		}
	}

	task, err := s.store.SetTaskSnoozed(r.Context(), u.ID, id, until)
	if err != nil {
		writeStoreError(w, err, "could not snooze task")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

// handleSkipTask pushes a task one whole cycle into the future without logging
// anything.
//
// Skipping must never write a completion. The card, the calendar, the activity
// chart and the per-task statistics are all built on completions meaning "you
// actually did this" — a synthetic one to represent a skip would make every one
// of them lie. So a skip is expressed the only honest way: the due time moves,
// the history doesn't.
func (s *Server) handleSkipTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	task, err := s.store.GetTask(r.Context(), u.ID, id)
	if err != nil {
		writeStoreError(w, err, "could not skip task")
		return
	}
	if task.IntervalSeconds == nil || *task.IntervalSeconds <= 0 {
		writeError(w, http.StatusBadRequest, "only a task with a routine has a cycle to skip")
		return
	}

	interval := time.Duration(*task.IntervalSeconds) * time.Second
	next := effectiveDue(task).Add(interval)
	// An overdue task's next cycle can still be in the past (skipping something
	// three cycles overdue). Keep adding until the skip actually lands ahead of
	// now, so one "skip" always means "not now".
	now := time.Now().UTC()
	for !next.After(now) {
		next = next.Add(interval)
	}
	if next.After(now.Add(maxSnoozeDuration)) {
		next = now.Add(maxSnoozeDuration)
	}

	updated, err := s.store.SetTaskSnoozed(r.Context(), u.ID, id, &next)
	if err != nil {
		writeStoreError(w, err, "could not skip task")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// effectiveDue is when a task next wants attention: its cadence due time, held
// back by any snooze. Mirrors nextDue() in web/src/lib/staleness.ts — the two
// have to agree or the UI and the reminder loop disagree about "due".
func effectiveDue(t store.Task) time.Time {
	var due time.Time
	if t.LastCompletedAt != nil && t.IntervalSeconds != nil {
		due = t.LastCompletedAt.Add(time.Duration(*t.IntervalSeconds) * time.Second)
	}
	if t.SnoozedUntil != nil && t.SnoozedUntil.After(due) {
		return *t.SnoozedUntil
	}
	if due.IsZero() {
		return time.Now().UTC()
	}
	return due
}

type pinRequest struct {
	Pinned bool `json:"pinned"`
}

func (s *Server) handlePinTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req pinRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	task, err := s.store.SetTaskPinned(r.Context(), u.ID, id, req.Pinned)
	if err != nil {
		writeStoreError(w, err, "could not pin task")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

type duplicateRequest struct {
	// Name for the copy. Empty falls back to "<original> (copy)".
	Name string `json:"name"`
}

func (s *Server) handleDuplicateTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req duplicateRequest
	if !decodeJSONAllowEmpty(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		src, err := s.store.GetTask(r.Context(), u.ID, id)
		if err != nil {
			writeStoreError(w, err, "could not duplicate task")
			return
		}
		name = src.Name + " (copy)"
	}
	// Truncate rather than reject: appending "(copy)" to a name already at the
	// limit shouldn't turn a one-click action into an error the user can't act on.
	if utf8.RuneCountInString(name) > maxNameLen {
		name = string([]rune(name)[:maxNameLen])
	}

	task, err := s.store.DuplicateTask(r.Context(), u.ID, id, name)
	if err != nil {
		writeStoreError(w, err, "could not duplicate task")
		return
	}
	writeJSON(w, http.StatusCreated, task)
}
