package store

import (
	"context"
	"time"
)

// ownsTask reports whether ownerID owns the given task.
func (s *Store) ownsTask(ctx context.Context, ownerID, taskID int64) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tasks WHERE id = ? AND owner_id = ?`, taskID, ownerID,
	).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// AddCompletion logs that a task was done at completedAt with an optional note.
// Returns ErrNotFound if the task does not exist or isn't owned by ownerID.
func (s *Store) AddCompletion(ctx context.Context, ownerID, taskID int64, completedAt time.Time, note string) (Completion, error) {
	owns, err := s.ownsTask(ctx, ownerID, taskID)
	if err != nil {
		return Completion{}, err
	}
	if !owns {
		return Completion{}, ErrNotFound
	}

	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO completions (task_id, completed_at, note, created_at) VALUES (?, ?, ?, ?)`,
		taskID, completedAt.UTC().Format(timeLayout), note, now.Format(timeLayout),
	)
	if err != nil {
		return Completion{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Completion{}, err
	}
	return Completion{
		ID:          id,
		TaskID:      taskID,
		CompletedAt: completedAt.UTC(),
		Note:        note,
		CreatedAt:   now,
	}, nil
}

// ListCompletions returns a task's completions (most recent first), scoped to
// the owner so one user can't read another's history.
func (s *Store) ListCompletions(ctx context.Context, ownerID, taskID int64) ([]Completion, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT c.id, c.task_id, c.completed_at, c.note, c.created_at
		 FROM completions c
		 JOIN tasks t ON t.id = c.task_id
		 WHERE c.task_id = ? AND t.owner_id = ?
		 ORDER BY c.completed_at DESC, c.id DESC`, taskID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Completion, 0)
	for rows.Next() {
		var (
			c         Completion
			completed string
			created   string
		)
		if err := rows.Scan(&c.ID, &c.TaskID, &completed, &c.Note, &created); err != nil {
			return nil, err
		}
		c.CompletedAt = parseTime(completed)
		c.CreatedAt = parseTime(created)
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListActivity returns every completion (across the owner's tasks) whose
// completed_at falls within [from, to), joined with the task name. This is the
// flat feed the calendar renders.
func (s *Store) ListActivity(ctx context.Context, ownerID int64, from, to time.Time) ([]Activity, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT c.id, c.task_id, t.name, c.completed_at, c.note
		 FROM completions c
		 JOIN tasks t ON t.id = c.task_id
		 WHERE t.owner_id = ? AND c.completed_at >= ? AND c.completed_at < ?
		 ORDER BY c.completed_at DESC, c.id DESC`,
		ownerID, from.UTC().Format(timeLayout), to.UTC().Format(timeLayout),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Activity, 0)
	for rows.Next() {
		var (
			a         Activity
			completed string
		)
		if err := rows.Scan(&a.CompletionID, &a.TaskID, &a.TaskName, &completed, &a.Note); err != nil {
			return nil, err
		}
		a.CompletedAt = parseTime(completed)
		out = append(out, a)
	}
	return out, rows.Err()
}

// UpdateCompletion edits a single completion's time and/or note (owner-scoped).
func (s *Store) UpdateCompletion(ctx context.Context, ownerID, id int64, completedAt time.Time, note string) (Completion, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE completions SET completed_at = ?, note = ?
		 WHERE id = ? AND task_id IN (SELECT id FROM tasks WHERE owner_id = ?)`,
		completedAt.UTC().Format(timeLayout), note, id, ownerID,
	)
	if err != nil {
		return Completion{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Completion{}, ErrNotFound
	}
	var (
		c         Completion
		completed string
		created   string
	)
	if err := s.db.QueryRowContext(ctx,
		`SELECT id, task_id, completed_at, note, created_at FROM completions WHERE id = ?`, id,
	).Scan(&c.ID, &c.TaskID, &completed, &c.Note, &created); err != nil {
		return Completion{}, err
	}
	c.CompletedAt = parseTime(completed)
	c.CreatedAt = parseTime(created)
	return c, nil
}

// DeleteCompletion removes a single completion entry (an "undo"), owner-scoped.
func (s *Store) DeleteCompletion(ctx context.Context, ownerID, id int64) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM completions WHERE id = ? AND task_id IN (SELECT id FROM tasks WHERE owner_id = ?)`,
		id, ownerID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
