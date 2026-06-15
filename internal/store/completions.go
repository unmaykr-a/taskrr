package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// canAccessTask reports whether userID may see/log the task — i.e. they own it
// or have an accepted share. (Replaces the old owner-only check now that tasks
// can be shared.)
func (s *Store) canAccessTask(ctx context.Context, userID, taskID int64) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tasks t WHERE t.id = ? AND `+visibleTaskCond,
		taskID, userID, userID,
	).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// AddCompletion logs that a task was done at completedAt with an optional note,
// recording userID as the actor ("who logged it"). Returns ErrNotFound if the
// task does not exist or isn't visible to userID (owner or accepted member).
func (s *Store) AddCompletion(ctx context.Context, userID, taskID int64, completedAt time.Time, note string) (Completion, error) {
	access, err := s.canAccessTask(ctx, userID, taskID)
	if err != nil {
		return Completion{}, err
	}
	if !access {
		return Completion{}, ErrNotFound
	}

	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO completions (task_id, user_id, completed_at, note, created_at) VALUES (?, ?, ?, ?, ?)`,
		taskID, userID, completedAt.UTC().Format(timeLayout), note, now.Format(timeLayout),
	)
	if err != nil {
		return Completion{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Completion{}, err
	}
	actor := userID
	return Completion{
		ID:          id,
		TaskID:      taskID,
		UserID:      &actor,
		CompletedAt: completedAt.UTC(),
		Note:        note,
		CreatedAt:   now,
	}, nil
}

// ListCompletions returns a task's completions (most recent first), visible to
// userID (owner or accepted member) so collaborators share one history.
func (s *Store) ListCompletions(ctx context.Context, userID, taskID int64) ([]Completion, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT c.id, c.task_id, c.user_id, c.completed_at, c.note, c.created_at
		 FROM completions c
		 JOIN tasks t ON t.id = c.task_id
		 WHERE c.task_id = ? AND `+visibleTaskCond+`
		 ORDER BY c.completed_at DESC, c.id DESC`, taskID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Completion, 0)
	for rows.Next() {
		c, err := scanCompletion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListActivity returns every completion across the tasks visible to userID
// (owned or shared+accepted) whose completed_at falls within [from, to), joined
// with the task name. This is the flat feed the calendar renders.
func (s *Store) ListActivity(ctx context.Context, userID int64, from, to time.Time) ([]Activity, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT c.id, c.task_id, t.name, c.completed_at, c.note
		 FROM completions c
		 JOIN tasks t ON t.id = c.task_id
		 WHERE `+visibleTaskCond+` AND c.completed_at >= ? AND c.completed_at < ?
		 ORDER BY c.completed_at DESC, c.id DESC`,
		userID, userID, from.UTC().Format(timeLayout), to.UTC().Format(timeLayout),
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

// UpdateCompletion edits a single completion's time and/or note. Permitted for
// the task's owner (any entry) or the entry's own author (while they still have
// access); otherwise ErrNotFound.
func (s *Store) UpdateCompletion(ctx context.Context, userID, id int64, completedAt time.Time, note string) (Completion, error) {
	allowed, err := s.canModifyCompletion(ctx, userID, id)
	if err != nil {
		return Completion{}, err
	}
	if !allowed {
		return Completion{}, ErrNotFound
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE completions SET completed_at = ?, note = ? WHERE id = ?`,
		completedAt.UTC().Format(timeLayout), note, id,
	); err != nil {
		return Completion{}, err
	}
	c, err := scanCompletion(s.db.QueryRowContext(ctx,
		`SELECT id, task_id, user_id, completed_at, note, created_at FROM completions WHERE id = ?`, id))
	if err != nil {
		return Completion{}, err
	}
	return c, nil
}

// DeleteCompletion removes a single completion entry (an "undo"). Permitted for
// the task's owner (any entry) or the entry's own author; otherwise ErrNotFound.
func (s *Store) DeleteCompletion(ctx context.Context, userID, id int64) error {
	allowed, err := s.canModifyCompletion(ctx, userID, id)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrNotFound
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM completions WHERE id = ?`, id)
	return err
}

// canModifyCompletion reports whether userID may edit/delete the given
// completion: true for the task owner, or for the entry's author while they
// still have access to the task. A missing completion yields (false, nil) so
// callers map it to ErrNotFound.
func (s *Store) canModifyCompletion(ctx context.Context, userID, completionID int64) (bool, error) {
	var (
		taskID int64
		author sql.NullInt64
		owner  int64
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT c.task_id, c.user_id, t.owner_id
		 FROM completions c JOIN tasks t ON t.id = c.task_id
		 WHERE c.id = ?`, completionID).Scan(&taskID, &author, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if owner == userID {
		return true, nil
	}
	if author.Valid && author.Int64 == userID {
		return s.canAccessTask(ctx, userID, taskID)
	}
	return false, nil
}

// scanCompletion reads a completion row in the (id, task_id, user_id,
// completed_at, note, created_at) projection.
func scanCompletion(sc scanner) (Completion, error) {
	var (
		c         Completion
		userID    sql.NullInt64
		completed string
		created   string
	)
	if err := sc.Scan(&c.ID, &c.TaskID, &userID, &completed, &c.Note, &created); err != nil {
		return Completion{}, err
	}
	if userID.Valid {
		c.UserID = &userID.Int64
	}
	c.CompletedAt = parseTime(completed)
	c.CreatedAt = parseTime(created)
	return c, nil
}
