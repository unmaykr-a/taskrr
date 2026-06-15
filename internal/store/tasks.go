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
		t.color_fresh, t.color_overdue, t.freeze_color, t.tags, t.folder, t.archived_at, t.created_at, t.updated_at, t.owner_id,
		(SELECT MAX(completed_at) FROM completions c WHERE c.task_id = t.id) AS last_completed_at,
		(SELECT COUNT(*)          FROM completions c WHERE c.task_id = t.id) AS completion_count,
		EXISTS (SELECT 1 FROM task_shares sh WHERE sh.task_id = t.id) AS shared,
		(SELECT u.username FROM completions c JOIN users u ON u.id = c.user_id
		 WHERE c.task_id = t.id ORDER BY c.completed_at DESC, c.id DESC LIMIT 1) AS last_completed_by
	FROM tasks t`

// visibleTaskCond is a WHERE fragment matching tasks the given user may see: the
// ones they own, plus those shared with them and accepted. Bind the user id
// twice (once per "?"). Relies on the alias `t` for the tasks table.
const visibleTaskCond = `(t.owner_id = ? OR EXISTS (
		SELECT 1 FROM task_shares sh
		WHERE sh.task_id = t.id AND sh.user_id = ? AND sh.status = 'accepted'))`

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
		ORDER BY last_completed_at IS NOT NULL, last_completed_at ASC, t.name COLLATE NOCASE ASC`, ownerID, ownerID)
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
	row := s.db.QueryRowContext(ctx, taskSelect+` WHERE t.id = ? AND `+visibleTaskCond, id, ownerID, ownerID)
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
		`INSERT INTO tasks (name, description, interval_seconds, color_fresh, color_overdue, freeze_color, tags, folder, owner_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.Name, in.Description, in.IntervalSeconds, in.ColorFresh, in.ColorOverdue, boolToInt(in.FreezeColor), encodeTags(in.Tags), in.Folder, ownerID, now, now,
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
		 SET name = ?, description = ?, interval_seconds = ?, color_fresh = ?, color_overdue = ?, freeze_color = ?, tags = ?, folder = ?, updated_at = ?
		 WHERE id = ? AND owner_id = ?`,
		in.Name, in.Description, in.IntervalSeconds, in.ColorFresh, in.ColorOverdue, boolToInt(in.FreezeColor), encodeTags(in.Tags), in.Folder,
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
		created      string
		updated      string
		lastDone     sql.NullString
		shared       int
		lastBy       sql.NullString
	)
	if err := sc.Scan(
		&t.ID, &t.Name, &t.Description, &interval,
		&colorFresh, &colorOverdue, &freezeColor, &tags, &t.Folder, &archivedAt, &created, &updated, &t.OwnerID,
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
	t.CreatedAt = parseTime(created)
	t.UpdatedAt = parseTime(updated)
	if lastDone.Valid {
		when := parseTime(lastDone.String)
		t.LastCompletedAt = &when
	}
	return t, nil
}
