package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// hexColor matches the "#rrggbb" form the colour inputs produce. We validate so
// a bad value can't reach the DB / CSS.
var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Length caps for user-supplied text. Without them the only bound is the 1 MiB
// JSON body cap, and an oversized task name would ride along in every ListTasks
// response forever.
const (
	maxNameLen = 200
	maxTextLen = 2000 // descriptions and completion notes
)

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- Tasks ---

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	tasks, err := s.store.ListTasks(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list tasks")
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

// taskRequest is the JSON body for creating or updating a task. IntervalSeconds
// is a pointer so we can tell "not provided / cleared" (null) from a real value.
type taskRequest struct {
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	IntervalSeconds *int64  `json:"intervalSeconds"`
	ColorFresh      *string `json:"colorFresh"`
	ColorOverdue    *string `json:"colorOverdue"`
	FreezeColor     bool    `json:"freezeColor"`
}

// toInput validates the request and converts it into a store.TaskInput.
func (req taskRequest) toInput() (store.TaskInput, string) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return store.TaskInput{}, "name is required"
	}
	if utf8.RuneCountInString(name) > maxNameLen {
		return store.TaskInput{}, fmt.Sprintf("name must be at most %d characters", maxNameLen)
	}
	if utf8.RuneCountInString(req.Description) > maxTextLen {
		return store.TaskInput{}, fmt.Sprintf("description must be at most %d characters", maxTextLen)
	}
	if req.IntervalSeconds != nil && *req.IntervalSeconds <= 0 {
		return store.TaskInput{}, "intervalSeconds must be a positive number of seconds, or null"
	}
	for _, c := range []*string{req.ColorFresh, req.ColorOverdue} {
		if c != nil && !hexColor.MatchString(*c) {
			return store.TaskInput{}, "colours must be in #rrggbb form, or null"
		}
	}
	return store.TaskInput{
		Name:            name,
		Description:     strings.TrimSpace(req.Description),
		IntervalSeconds: req.IntervalSeconds,
		ColorFresh:      req.ColorFresh,
		ColorOverdue:    req.ColorOverdue,
		FreezeColor:     req.FreezeColor,
	}, ""
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req taskRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	input, msg := req.toInput()
	if msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	task, err := s.store.CreateTask(r.Context(), u.ID, input)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create task")
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
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
		writeStoreError(w, err, "could not get task")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (s *Server) handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req taskRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	input, msg := req.toInput()
	if msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	task, err := s.store.UpdateTask(r.Context(), u.ID, id, input)
	if err != nil {
		writeStoreError(w, err, "could not update task")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (s *Server) handleArchiveTask(w http.ResponseWriter, r *http.Request) {
	s.setArchived(w, r, true)
}

func (s *Server) handleUnarchiveTask(w http.ResponseWriter, r *http.Request) {
	s.setArchived(w, r, false)
}

func (s *Server) setArchived(w http.ResponseWriter, r *http.Request, archived bool) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	task, err := s.store.SetTaskArchived(r.Context(), u.ID, id, archived)
	if err != nil {
		writeStoreError(w, err, "could not update task")
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (s *Server) handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteTask(r.Context(), u.ID, id); err != nil {
		writeStoreError(w, err, "could not delete task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Completions ---

// completeTaskRequest is the body for logging a completion. Both fields are
// optional: an empty body ({}) means "done right now, no note" — that is exactly
// what the Quick-log button sends.
type completeTaskRequest struct {
	Note        string `json:"note"`
	CompletedAt string `json:"completedAt"` // optional RFC3339; defaults to now
}

func (s *Server) handleCompleteTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// Allow a completely empty body for the quick-log case. Decoding (rather than
	// checking ContentLength) keeps that working for chunked requests too, where
	// ContentLength is -1 even when the body is empty.
	var req completeTaskRequest
	if !decodeJSONAllowEmpty(w, r, &req) {
		return
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > maxTextLen {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("note must be at most %d characters", maxTextLen))
		return
	}

	when := time.Now().UTC()
	if strings.TrimSpace(req.CompletedAt) != "" {
		parsed, err := time.Parse(time.RFC3339, req.CompletedAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "completedAt must be an RFC3339 timestamp")
			return
		}
		when = parsed
	}

	completion, err := s.store.AddCompletion(r.Context(), u.ID, id, when, note)
	if err != nil {
		writeStoreError(w, err, "could not log completion")
		return
	}
	writeJSON(w, http.StatusCreated, completion)
}

func (s *Server) handleListCompletions(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// Surface a 404 if the task itself is missing or not the user's.
	if _, err := s.store.GetTask(r.Context(), u.ID, id); err != nil {
		writeStoreError(w, err, "could not get task")
		return
	}
	completions, err := s.store.ListCompletions(r.Context(), u.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list completions")
		return
	}
	writeJSON(w, http.StatusOK, completions)
}

func (s *Server) handleUpdateCompletion(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req completeTaskRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.CompletedAt) == "" {
		writeError(w, http.StatusBadRequest, "completedAt is required")
		return
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > maxTextLen {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("note must be at most %d characters", maxTextLen))
		return
	}
	when, err := time.Parse(time.RFC3339, req.CompletedAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "completedAt must be an RFC3339 timestamp")
		return
	}
	completion, err := s.store.UpdateCompletion(r.Context(), u.ID, id, when, note)
	if err != nil {
		writeStoreError(w, err, "could not update completion")
		return
	}
	writeJSON(w, http.StatusOK, completion)
}

func (s *Server) handleDeleteCompletion(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteCompletion(r.Context(), u.ID, id); err != nil {
		writeStoreError(w, err, "could not delete completion")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Activity (calendar feed) ---

// handleListActivity returns completions across all tasks within a date range.
// `from` and `to` are optional RFC3339 query params; when omitted they default
// to the current calendar month [first-of-month, first-of-next-month).
func (s *Server) handleListActivity(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	now := time.Now().UTC()
	defaultFrom := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	defaultTo := defaultFrom.AddDate(0, 1, 0)

	from, err := parseTimeParam(r, "from", defaultFrom)
	if err != nil {
		writeError(w, http.StatusBadRequest, "from must be an RFC3339 timestamp")
		return
	}
	to, err := parseTimeParam(r, "to", defaultTo)
	if err != nil {
		writeError(w, http.StatusBadRequest, "to must be an RFC3339 timestamp")
		return
	}

	activity, err := s.store.ListActivity(r.Context(), u.ID, from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list activity")
		return
	}
	writeJSON(w, http.StatusOK, activity)
}

// --- helpers ---

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

// parseTimeParam reads an optional RFC3339 query parameter, returning def when
// it is absent.
func parseTimeParam(r *http.Request, name string, def time.Time) (time.Time, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return def, nil
	}
	return time.Parse(time.RFC3339, raw)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)) // 1 MiB cap
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

// decodeJSONAllowEmpty is decodeJSON, except a completely empty body is fine
// and leaves dst at its zero value (for endpoints where {} and "" are equal).
func decodeJSONAllowEmpty(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return true
		}
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeStoreError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeError(w, http.StatusInternalServerError, fallback)
}
