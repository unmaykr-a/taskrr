package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// encodeTags serialises a tag slice to the JSON text stored on the row, always
// emitting a valid array ("[]" for none).
func encodeTags(tags []string) string {
	if len(tags) == 0 {
		return "[]"
	}
	b, err := json.Marshal(tags)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("not found")

// taskSelect is the shared projection for reading tasks together with their
// derived completion stats via correlated subqueries. Keeping it in one place
// means ListTasks and GetTask always return identically-shaped rows.
const taskSelect = `
	SELECT
		t.id, t.name, t.description, t.interval_seconds,
		t.color_fresh, t.color_overdue, t.freeze_color, t.tags, t.folder, t.archived_at,
		t.snoozed_until, t.pinned, t.rotate, t.reminder_lead_seconds, t.created_at, t.updated_at, t.owner_id,
		(SELECT MAX(completed_at) FROM completions c WHERE c.task_id = t.id) AS last_completed_at,
		(SELECT COUNT(*)          FROM completions c WHERE c.task_id = t.id) AS completion_count,
		` + sharedFlagExpr + ` AS shared,
		(SELECT u.username FROM completions c JOIN users u ON u.id = c.user_id
		 WHERE c.task_id = t.id ORDER BY c.completed_at DESC, c.id DESC LIMIT 1) AS last_completed_by
	FROM tasks t`

// visibleTaskCond is a WHERE fragment matching tasks the given user may see:
// the ones they own, those shared with them directly and accepted, and those
// sitting in a folder of someone else's that they've accepted a share of.
//
// Relies on the alias `t` for the tasks table. It takes the user id several
// times, so never hand-write the arguments — use visibleArgs(), which keeps the
// count in one place. Getting that count wrong would not be a compile error
// (every parameter is an int64), it would silently shift which rows a query
// returns, which is the worst possible failure mode for a visibility rule.
const visibleTaskCond = `(t.owner_id = ?
		OR EXISTS (
			SELECT 1 FROM task_shares sh
			WHERE sh.task_id = t.id AND sh.user_id = ? AND sh.status = 'accepted')
		OR (t.folder <> '' AND EXISTS (
			SELECT 1 FROM folder_shares fs
			WHERE fs.user_id = ? AND fs.status = 'accepted'
			  AND fs.owner_id = t.owner_id AND fs.folder = t.folder)))`

// visibleArgs returns the bind arguments visibleTaskCond expects, in order.
// Call sites splice it in with append(), so adding a clause to the condition is
// a one-place change.
func visibleArgs(userID int64) []any {
	return []any{userID, userID, userID}
}

// sharedFlagExpr reports whether a task has anyone else on it — through a
// direct share or through a share of its folder. Used for the `shared` column
// and for the Shared view; the union matters because a task can be reachable
// both ways at once.
const sharedFlagExpr = `(EXISTS (SELECT 1 FROM task_shares sh WHERE sh.task_id = t.id AND sh.status = 'accepted')
		OR (t.folder <> '' AND EXISTS (
			SELECT 1 FROM folder_shares fs
			WHERE fs.owner_id = t.owner_id AND fs.folder = t.folder AND fs.status = 'accepted')))`

// ListTasks returns all tasks. Ordering surfaces the most "actionable" first:
// never-completed tasks, then those whose last completion is furthest in the
// past, then alphabetically.
//
// Note: this orders by *absolute* recency, not cadence. The frontend does the
// cadence-aware sorting/colouring because that logic is cheap, lives next to the
// UI, and is the part most likely to be tweaked.
func (s *Store) ListTasks(ctx context.Context, ownerID int64) ([]Task, error) {
	rows, err := s.db.QueryContext(ctx, taskSelect+`
		WHERE `+visibleTaskCond+`
		ORDER BY last_completed_at IS NOT NULL, last_completed_at ASC, t.name COLLATE NOCASE ASC`,
		visibleArgs(ownerID)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := make([]Task, 0)
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

// GetTask returns a single task visible to ownerID (owned or shared+accepted),
// or ErrNotFound.
func (s *Store) GetTask(ctx context.Context, ownerID, id int64) (Task, error) {
	row := s.db.QueryRowContext(ctx, taskSelect+` WHERE t.id = ? AND `+visibleTaskCond,
		append([]any{id}, visibleArgs(ownerID)...)...)
	t, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	return t, err
}

// CreateTask inserts a new task owned by ownerID and returns it.
func (s *Store) CreateTask(ctx context.Context, ownerID int64, in TaskInput) (Task, error) {
	now := time.Now().UTC().Format(timeLayout)
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO tasks (name, description, interval_seconds, color_fresh, color_overdue, freeze_color, tags, folder, pinned, rotate, reminder_lead_seconds, owner_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.Name, in.Description, in.IntervalSeconds, in.ColorFresh, in.ColorOverdue, boolToInt(in.FreezeColor), encodeTags(in.Tags), in.Folder,
		boolToInt(in.Pinned), boolToInt(in.Rotate), in.ReminderLeadSeconds, ownerID, now, now,
	)
	if err != nil {
		return Task{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Task{}, err
	}
	return s.GetTask(ctx, ownerID, id)
}

// UpdateTask replaces a task's editable fields with the given input and returns
// the updated row. This is a full replace of the editable fields (name,
// description, cadence) — the edit dialog always submits the complete set, which
// keeps the contract simple and avoids "was this field omitted or cleared?"
// ambiguity.
func (s *Store) UpdateTask(ctx context.Context, ownerID, id int64, in TaskInput) (Task, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks
		 SET name = ?, description = ?, interval_seconds = ?, color_fresh = ?, color_overdue = ?, freeze_color = ?, tags = ?, folder = ?,
		     pinned = ?, rotate = ?, reminder_lead_seconds = ?, updated_at = ?
		 WHERE id = ? AND owner_id = ?`,
		in.Name, in.Description, in.IntervalSeconds, in.ColorFresh, in.ColorOverdue, boolToInt(in.FreezeColor), encodeTags(in.Tags), in.Folder,
		boolToInt(in.Pinned), boolToInt(in.Rotate), in.ReminderLeadSeconds,
		time.Now().UTC().Format(timeLayout), id, ownerID,
	)
	if err != nil {
		return Task{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Task{}, ErrNotFound
	}
	return s.GetTask(ctx, ownerID, id)
}

// SetTaskSnoozed holds a task back from being due until `until`, or clears the
// hold when `until` is nil.
//
// One timestamp serves both product ideas. "Snooze until Friday" sets it
// directly; "skip this cycle" is the caller computing the current due time plus
// one interval and setting that. Keeping it to a single column means the rest of
// the app — staleness, filters, the calendar, reminders — only has to learn one
// rule rather than two.
//
// Scoped by owner: a shared task's schedule belongs to whoever owns it, so a
// member can't quietly push everyone else's due date around.
func (s *Store) SetTaskSnoozed(ctx context.Context, ownerID, id int64, until *time.Time) (Task, error) {
	var value any // NULL clears the snooze
	if until != nil {
		value = until.UTC().Format(timeLayout)
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks SET snoozed_until = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
		value, time.Now().UTC().Format(timeLayout), id, ownerID,
	)
	if err != nil {
		return Task{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Task{}, ErrNotFound
	}
	return s.GetTask(ctx, ownerID, id)
}

// SetTaskPinned pins or unpins a task, keeping it at the top of the list.
func (s *Store) SetTaskPinned(ctx context.Context, ownerID, id int64, pinned bool) (Task, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks SET pinned = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
		boolToInt(pinned), time.Now().UTC().Format(timeLayout), id, ownerID,
	)
	if err != nil {
		return Task{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Task{}, ErrNotFound
	}
	return s.GetTask(ctx, ownerID, id)
}

// DuplicateTask copies a task's definition into a new task owned by the caller.
//
// Deliberately the definition only: no history, no shares, no snooze, and never
// archived. Duplicating is for "another one like this" — a second plant, a
// second filter — and copying the completions would start the new task with a
// past it never had, which is exactly the thing this app is supposed to get
// right. `name` is the caller's chosen name for the copy.
func (s *Store) DuplicateTask(ctx context.Context, ownerID, id int64, name string) (Task, error) {
	src, err := s.GetTask(ctx, ownerID, id)
	if err != nil {
		return Task{}, err
	}
	// Only the owner may duplicate: GetTask also matches accepted shares, and
	// copying somebody else's task into your own list is a different feature.
	if src.OwnerID != ownerID {
		return Task{}, ErrNotFound
	}
	return s.CreateTask(ctx, ownerID, TaskInput{
		Name:                name,
		Description:         src.Description,
		IntervalSeconds:     src.IntervalSeconds,
		ColorFresh:          src.ColorFresh,
		ColorOverdue:        src.ColorOverdue,
		FreezeColor:         src.FreezeColor,
		Tags:                src.Tags,
		Folder:              src.Folder,
		Pinned:              src.Pinned,
		Rotate:              src.Rotate,
		ReminderLeadSeconds: src.ReminderLeadSeconds,
	})
}

// SetTaskArchived soft-archives (or restores) a task by setting/clearing
// archived_at. The task and its completion history are preserved either way.
func (s *Store) SetTaskArchived(ctx context.Context, ownerID, id int64, archived bool) (Task, error) {
	var archivedAt any // NULL when restoring
	if archived {
		archivedAt = time.Now().UTC().Format(timeLayout)
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
		archivedAt, time.Now().UTC().Format(timeLayout), id, ownerID,
	)
	if err != nil {
		return Task{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Task{}, ErrNotFound
	}
	return s.GetTask(ctx, ownerID, id)
}

// DeleteTask removes a user's access to a task, with shared-task-aware
// semantics so that "delete" never destroys data another member still relies on:
//
//   - A non-owner (accepted or pending member) "deleting" the task simply leaves
//     it — their share row is removed; the task and its history persist.
//   - The owner deleting a task that still has accepted members transfers
//     ownership to the earliest such member (dropping the original owner's
//     access) rather than removing the task.
//   - Only when the owner deletes a task with no accepted members is the row
//     truly removed (cascading its completions and any pending invitations).
//
// userID is the acting user; ErrNotFound if they neither own nor are a member.
func (s *Store) DeleteTask(ctx context.Context, userID, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var ownerID int64
	switch err := tx.QueryRowContext(ctx, `SELECT owner_id FROM tasks WHERE id = ?`, id).Scan(&ownerID); {
	case errors.Is(err, sql.ErrNoRows):
		return ErrNotFound
	case err != nil:
		return err
	}

	// A member leaving: drop only their share row.
	if ownerID != userID {
		res, err := tx.ExecContext(ctx, `DELETE FROM task_shares WHERE task_id = ? AND user_id = ?`, id, userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound // not the owner and not a member
		}
		return tx.Commit()
	}

	// Owner: transfer to the earliest accepted member if any, else delete.
	var newOwner int64
	switch err := tx.QueryRowContext(ctx,
		`SELECT user_id FROM task_shares
		 WHERE task_id = ? AND status = 'accepted'
		 ORDER BY created_at ASC, user_id ASC LIMIT 1`, id).Scan(&newOwner); {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE id = ?`, id); err != nil {
			return err
		}
	case err != nil:
		return err
	default:
		now := time.Now().UTC().Format(timeLayout)
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET owner_id = ?, updated_at = ? WHERE id = ?`, newOwner, now, id); err != nil {
			return err
		}
		// The promoted member is now the owner, not a member.
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_shares WHERE task_id = ? AND user_id = ?`, id, newOwner); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// scanner is satisfied by both *sql.Row and *sql.Rows, so scanTask works for
// single-row and multi-row queries alike.
type scanner interface {
	Scan(dest ...any) error
}

func scanTask(sc scanner) (Task, error) {
	var (
		t            Task
		interval     sql.NullInt64
		colorFresh   sql.NullString
		colorOverdue sql.NullString
		freezeColor  int
		tags         string
		archivedAt   sql.NullString
		snoozedUntil sql.NullString
		pinned       int
		rotate       int
		reminderLead sql.NullInt64
		created      string
		updated      string
		lastDone     sql.NullString
		shared       int
		lastBy       sql.NullString
	)
	if err := sc.Scan(
		&t.ID, &t.Name, &t.Description, &interval,
		&colorFresh, &colorOverdue, &freezeColor, &tags, &t.Folder, &archivedAt,
		&snoozedUntil, &pinned, &rotate, &reminderLead, &created, &updated, &t.OwnerID,
		&lastDone, &t.CompletionCount, &shared, &lastBy,
	); err != nil {
		return Task{}, err
	}
	t.FreezeColor = freezeColor != 0
	t.Tags = []string{}
	if tags != "" {
		_ = json.Unmarshal([]byte(tags), &t.Tags)
	}
	t.Shared = shared != 0
	if lastBy.Valid {
		t.LastCompletedBy = &lastBy.String
	}
	if interval.Valid {
		t.IntervalSeconds = &interval.Int64
	}
	if colorFresh.Valid {
		t.ColorFresh = &colorFresh.String
	}
	if colorOverdue.Valid {
		t.ColorOverdue = &colorOverdue.String
	}
	if archivedAt.Valid {
		when := parseTime(archivedAt.String)
		t.ArchivedAt = &when
	}
	if snoozedUntil.Valid && snoozedUntil.String != "" {
		when := parseTime(snoozedUntil.String)
		t.SnoozedUntil = &when
	}
	t.Pinned = pinned != 0
	t.Rotate = rotate != 0
	if reminderLead.Valid {
		t.ReminderLeadSeconds = &reminderLead.Int64
	}
	t.CreatedAt = parseTime(created)
	t.UpdatedAt = parseTime(updated)
	if lastDone.Valid {
		when := parseTime(lastDone.String)
		t.LastCompletedAt = &when
	}
	return t, nil
}
