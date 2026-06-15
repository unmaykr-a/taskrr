package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Share-specific sentinel errors. The API layer maps these to user-facing
// messages (and an appropriate status code) in a later phase.
var (
	// ErrShareNotAllowed is returned when the recipient has opted out of shares.
	ErrShareNotAllowed = errors.New("recipient does not accept shared tasks")
	// ErrAlreadyShared is returned when a share to that user already exists.
	ErrAlreadyShared = errors.New("task is already shared with that user")
	// ErrShareSelf is returned when a user tries to share a task with themselves.
	ErrShareSelf = errors.New("cannot share a task with yourself")
)

// reassignSharedTasks transfers every task owned by userID that still has an
// accepted member to the earliest such member (dropping that member's share
// row), within the caller's transaction. So removing a user — account deletion,
// wipe-my-data, or a non-moving merge — never destroys a task other members
// rely on; only their solo tasks are left for the caller's delete/cascade.
// Mirrors the owner-delete transfer in DeleteTask.
func reassignSharedTasks(ctx context.Context, tx *sql.Tx, userID int64) error {
	// Materialise the transfers first: SQLite on a single connection can't run
	// the UPDATEs while this query's rows are still open.
	rows, err := tx.QueryContext(ctx,
		`SELECT t.id,
		        (SELECT s.user_id FROM task_shares s
		          WHERE s.task_id = t.id AND s.status = 'accepted'
		          ORDER BY s.created_at ASC, s.user_id ASC LIMIT 1)
		   FROM tasks t
		  WHERE t.owner_id = ?
		    AND EXISTS (SELECT 1 FROM task_shares s
		                 WHERE s.task_id = t.id AND s.status = 'accepted')`, userID)
	if err != nil {
		return err
	}
	type transfer struct{ taskID, newOwner int64 }
	var transfers []transfer
	for rows.Next() {
		var tr transfer
		if err := rows.Scan(&tr.taskID, &tr.newOwner); err != nil {
			_ = rows.Close()
			return err
		}
		transfers = append(transfers, tr)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()

	now := time.Now().UTC().Format(timeLayout)
	for _, tr := range transfers {
		if _, err := tx.ExecContext(ctx,
			`UPDATE tasks SET owner_id = ?, updated_at = ? WHERE id = ?`, tr.newOwner, now, tr.taskID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM task_shares WHERE task_id = ? AND user_id = ?`, tr.taskID, tr.newOwner); err != nil {
			return err
		}
	}
	return nil
}

type TaskShare struct {
	TaskID    int64     `json:"taskId"`
	UserID    int64     `json:"userId"`
	Status    string    `json:"status"` // "pending" | "accepted"
	CreatedAt time.Time `json:"createdAt"`
}

// ShareRequest is a pending incoming share, with the task and owner named, as
// shown in the recipient's Requests view.
type ShareRequest struct {
	TaskID    int64     `json:"taskId"`
	TaskName  string    `json:"taskName"`
	OwnerID   int64     `json:"ownerId"`
	OwnerName string    `json:"ownerName"`
	CreatedAt time.Time `json:"createdAt"`
}

// TaskMember is one participant in a task: the owner, or a shared member with
// their status. Used to badge shared tasks with their collaborators.
type TaskMember struct {
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
	// Status is "owner" for the task's owner, else the share status
	// ("pending" | "accepted").
	Status string `json:"status"`
}

// ShareTask invites recipientID to a task owned by ownerID, creating a pending
// share. Only the owner may share. Errors: ErrNotFound (no such task owned by
// ownerID, or no such recipient), ErrShareSelf, ErrShareNotAllowed (recipient
// opted out), ErrAlreadyShared.
func (s *Store) ShareTask(ctx context.Context, ownerID, taskID, recipientID int64) (TaskShare, error) {
	if recipientID == ownerID {
		return TaskShare{}, ErrShareSelf
	}

	// The task must exist and be owned by the sharer.
	var owner int64
	switch err := s.db.QueryRowContext(ctx, `SELECT owner_id FROM tasks WHERE id = ?`, taskID).Scan(&owner); {
	case errors.Is(err, sql.ErrNoRows):
		return TaskShare{}, ErrNotFound
	case err != nil:
		return TaskShare{}, err
	}
	if owner != ownerID {
		return TaskShare{}, ErrNotFound // a non-owner can't share
	}

	// The recipient must exist and accept shares.
	allow, err := s.GetUserAllowShares(ctx, recipientID)
	if err != nil {
		return TaskShare{}, err // ErrNotFound for a missing user
	}
	if !allow {
		return TaskShare{}, ErrShareNotAllowed
	}

	// Reject a duplicate up front (the (task_id, user_id) primary key would also
	// reject it, but this yields the typed ErrAlreadyShared the API wants).
	var existing int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM task_shares WHERE task_id = ? AND user_id = ?`,
		taskID, recipientID).Scan(&existing); err != nil {
		return TaskShare{}, err
	}
	if existing > 0 {
		return TaskShare{}, ErrAlreadyShared
	}

	now := time.Now().UTC()
	if _, err = s.db.ExecContext(ctx,
		`INSERT INTO task_shares (task_id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)`,
		taskID, recipientID, now.Format(timeLayout),
	); err != nil {
		return TaskShare{}, err
	}
	return TaskShare{TaskID: taskID, UserID: recipientID, Status: "pending", CreatedAt: now}, nil
}

// RespondToShare accepts or declines a pending incoming share for userID.
// Accepting flips it to 'accepted'; declining removes the row (leaving the task
// solely the owner's). ErrNotFound if there is no pending share for that user.
func (s *Store) RespondToShare(ctx context.Context, userID, taskID int64, accept bool) error {
	var (
		res sql.Result
		err error
	)
	if accept {
		res, err = s.db.ExecContext(ctx,
			`UPDATE task_shares SET status = 'accepted' WHERE task_id = ? AND user_id = ? AND status = 'pending'`,
			taskID, userID)
	} else {
		res, err = s.db.ExecContext(ctx,
			`DELETE FROM task_shares WHERE task_id = ? AND user_id = ? AND status = 'pending'`,
			taskID, userID)
	}
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// LeaveTask removes userID's membership of a task (accepted or still pending).
// The task and its history persist for the owner and any other members.
// ErrNotFound if the user isn't a member.
func (s *Store) LeaveTask(ctx context.Context, userID, taskID int64) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM task_shares WHERE task_id = ? AND user_id = ?`, taskID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListIncomingShares returns userID's pending incoming shares (their Requests),
// newest first, with the task and owner named.
func (s *Store) ListIncomingShares(ctx context.Context, userID int64) ([]ShareRequest, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.task_id, t.name, t.owner_id, u.username, s.created_at
		 FROM task_shares s
		 JOIN tasks t ON t.id = s.task_id
		 JOIN users u ON u.id = t.owner_id
		 WHERE s.user_id = ? AND s.status = 'pending'
		 ORDER BY s.created_at DESC, s.task_id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]ShareRequest, 0)
	for rows.Next() {
		var (
			r       ShareRequest
			created string
		)
		if err := rows.Scan(&r.TaskID, &r.TaskName, &r.OwnerID, &r.OwnerName, &created); err != nil {
			return nil, err
		}
		r.CreatedAt = parseTime(created)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListTaskMembers returns everyone attached to a task: the owner first (status
// "owner"), then shared members in invite order with their status. ErrNotFound
// if the task does not exist.
func (s *Store) ListTaskMembers(ctx context.Context, taskID int64) ([]TaskMember, error) {
	owner := TaskMember{Status: "owner"}
	switch err := s.db.QueryRowContext(ctx,
		`SELECT u.id, u.username FROM tasks t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`,
		taskID).Scan(&owner.UserID, &owner.Username); {
	case errors.Is(err, sql.ErrNoRows):
		return nil, ErrNotFound
	case err != nil:
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT u.id, u.username, s.status
		 FROM task_shares s JOIN users u ON u.id = s.user_id
		 WHERE s.task_id = ?
		 ORDER BY s.created_at ASC, s.user_id ASC`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []TaskMember{owner}
	for rows.Next() {
		var m TaskMember
		if err := rows.Scan(&m.UserID, &m.Username, &m.Status); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}
