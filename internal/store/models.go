package store

import "time"

// Task is a recurring thing the user wants to track. The "track" part lives in
// the derived fields (LastCompletedAt / CompletionCount), computed from the
// completions log rather than stored on the row.
type Task struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	// IntervalSeconds is the optional desired cadence — how long should ideally
	// pass between completions. nil means "no cadence" (just track). The UI uses
	// it to colour staleness and compute the next due date.
	IntervalSeconds *int64 `json:"intervalSeconds"`
	// Optional per-task overrides for the two ends of the staleness gradient
	// ("#rrggbb"), or nil to fall back to the app-wide defaults.
	ColorFresh   *string `json:"colorFresh"`
	ColorOverdue *string `json:"colorOverdue"`
	// FreezeColor pins the staleness colour to the "fresh" end (a purely visual
	// "stay green" preference; cadence/due/filters are unaffected).
	FreezeColor bool `json:"freezeColor"`
	// Tags are short user labels for filtering and grouping.
	Tags []string `json:"tags"`
	// Folder is an optional single group name; empty means ungrouped.
	Folder string `json:"folder"`
	// ArchivedAt is non-nil when the task has been soft-archived (hidden from the
	// normal views but kept, with its history, so it can be restored).
	ArchivedAt *time.Time `json:"archivedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	// OwnerID is the account that owns the task. With shared tasks a viewer may
	// be an accepted member rather than the owner, so the API/UI can compare this
	// to the current user to decide who may edit/archive the definition.
	OwnerID int64 `json:"ownerId"`
	// Derived fields (not stored on the row; computed from the completions log).
	LastCompletedAt *time.Time `json:"lastCompletedAt"`
	CompletionCount int        `json:"completionCount"`
	// Shared is true when the task has any members (shared by the owner, or
	// shared with the viewer). Lets the UI flag and group shared tasks.
	Shared bool `json:"shared"`
	// LastCompletedBy is the username of whoever logged the most recent
	// completion (nil if none, or that author's account was removed).
	LastCompletedBy *string `json:"lastCompletedBy"`
}

// TaskInput carries the user-editable fields of a task. It is shared by Create
// and Update so the two paths can never drift apart — add a field once here and
// both flows pick it up. (A small example of "make invalid states unlikely".)
type TaskInput struct {
	Name            string
	Description     string
	IntervalSeconds *int64  // nil clears the cadence
	ColorFresh      *string // nil clears the override (use the default)
	ColorOverdue    *string // nil clears the override (use the default)
	FreezeColor     bool    // pin the staleness colour to "fresh"
	Tags            []string
	Folder          string
}

// Completion is a single logged occurrence of a task being done.
type Completion struct {
	ID     int64 `json:"id"`
	TaskID int64 `json:"taskId"`
	// UserID is who logged this completion (nil only for orphaned history whose
	// author account was removed). On a shared task this drives "last logged by".
	UserID      *int64    `json:"userId"`
	CompletedAt time.Time `json:"completedAt"`
	Note        string    `json:"note"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Activity is a completion joined with its task's name. It powers the calendar,
// which needs a flat, cross-task feed of "what was done when" without making one
// request per task.
type Activity struct {
	CompletionID int64     `json:"completionId"`
	TaskID       int64     `json:"taskId"`
	TaskName     string    `json:"taskName"`
	CompletedAt  time.Time `json:"completedAt"`
	Note         string    `json:"note"`
}
