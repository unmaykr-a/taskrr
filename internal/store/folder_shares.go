package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Folder sharing.
//
// A folder share is an agreement about a *name* inside one owner's account:
// every task that owner keeps in that folder is visible to the recipient,
// including ones created or moved there later. It is resolved at read time
// (visibleTaskCond) rather than expanded into per-task rows, so moving a task
// between folders changes who can see it immediately and correctly, with no
// reconciliation step to get wrong.

// ErrFolderEmpty is returned when a share names no folder. Sharing "" would
// mean sharing every ungrouped task, which is not something to do by accident.
var ErrFolderEmpty = errors.New("choose a folder to share")

// FolderShare is one folder-level membership row.
type FolderShare struct {
	OwnerID   int64     `json:"ownerId"`
	Folder    string    `json:"folder"`
	UserID    int64     `json:"userId"`
	Status    string    `json:"status"` // "pending" | "accepted"
	CreatedAt time.Time `json:"createdAt"`
}

// FolderShareRequest is a pending incoming folder share, named for the
// recipient's Requests view.
type FolderShareRequest struct {
	OwnerID   int64     `json:"ownerId"`
	OwnerName string    `json:"ownerName"`
	Folder    string    `json:"folder"`
	TaskCount int       `json:"taskCount"`
	CreatedAt time.Time `json:"createdAt"`
}

// ShareFolder invites a user to everything the owner keeps in a folder.
func (s *Store) ShareFolder(ctx context.Context, ownerID int64, folder string, recipientID int64) (FolderShare, error) {
	folder = strings.TrimSpace(folder)
	if folder == "" {
		return FolderShare{}, ErrFolderEmpty
	}
	if recipientID == ownerID {
		return FolderShare{}, ErrShareSelf
	}

	// The recipient must exist and accept shares — the same opt-out that governs
	// per-task shares, since this is a bigger ask, not a smaller one.
	allow, err := s.GetUserAllowShares(ctx, recipientID)
	if err != nil {
		return FolderShare{}, err
	}
	if !allow {
		return FolderShare{}, ErrShareNotAllowed
	}

	// The folder has to be one the owner actually uses; otherwise a typo shares
	// a name that will never match anything and looks broken.
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND folder = ?`, ownerID, folder).Scan(&n); err != nil {
		return FolderShare{}, err
	}
	if n == 0 {
		return FolderShare{}, ErrNotFound
	}

	var existing int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM folder_shares WHERE owner_id = ? AND folder = ? AND user_id = ?`,
		ownerID, folder, recipientID).Scan(&existing); err != nil {
		return FolderShare{}, err
	}
	if existing > 0 {
		return FolderShare{}, ErrAlreadyShared
	}

	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO folder_shares (owner_id, folder, user_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
		ownerID, folder, recipientID, now.Format(timeLayout)); err != nil {
		return FolderShare{}, err
	}
	return FolderShare{OwnerID: ownerID, Folder: folder, UserID: recipientID, Status: "pending", CreatedAt: now}, nil
}

// RespondToFolderShare accepts or declines a pending folder invite. Declining
// removes the row, so the owner can invite again later.
func (s *Store) RespondToFolderShare(ctx context.Context, userID, ownerID int64, folder string, accept bool) error {
	var res sql.Result
	var err error
	if accept {
		res, err = s.db.ExecContext(ctx,
			`UPDATE folder_shares SET status = 'accepted'
			  WHERE owner_id = ? AND folder = ? AND user_id = ? AND status = 'pending'`,
			ownerID, folder, userID)
	} else {
		res, err = s.db.ExecContext(ctx,
			`DELETE FROM folder_shares WHERE owner_id = ? AND folder = ? AND user_id = ? AND status = 'pending'`,
			ownerID, folder, userID)
	}
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// LeaveFolder drops the caller's own membership of a shared folder.
func (s *Store) LeaveFolder(ctx context.Context, userID, ownerID int64, folder string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM folder_shares WHERE owner_id = ? AND folder = ? AND user_id = ?`, ownerID, folder, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UnshareFolder removes a member the owner had invited.
func (s *Store) UnshareFolder(ctx context.Context, ownerID int64, folder string, memberID int64) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM folder_shares WHERE owner_id = ? AND folder = ? AND user_id = ?`, ownerID, folder, memberID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListFolderMembers returns everyone on one of an owner's folders, pending and
// accepted, with their usernames.
//
// A folder the caller doesn't have is ErrNotFound rather than an empty list, so
// asking about someone else's folder answers the same way as asking about a
// task that isn't yours. A folder that has been emptied but still has members
// still lists them — that's the state you'd want to see to clean it up.
func (s *Store) ListFolderMembers(ctx context.Context, ownerID int64, folder string) ([]TaskMember, error) {
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT (SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND folder = ?)
		      + (SELECT COUNT(*) FROM folder_shares WHERE owner_id = ? AND folder = ?)`,
		ownerID, folder, ownerID, folder).Scan(&n); err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrNotFound
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT fs.user_id, u.username, fs.status
		   FROM folder_shares fs JOIN users u ON u.id = fs.user_id
		  WHERE fs.owner_id = ? AND fs.folder = ?
		  ORDER BY fs.created_at ASC, fs.user_id ASC`, ownerID, folder)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TaskMember, 0)
	for rows.Next() {
		var m TaskMember
		if err := rows.Scan(&m.UserID, &m.Username, &m.Status); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListFolderSharesByOwner returns every folder the owner has shared, so the UI
// can show which folders already have people on them.
func (s *Store) ListFolderSharesByOwner(ctx context.Context, ownerID int64) ([]FolderShare, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT owner_id, folder, user_id, status, created_at
		   FROM folder_shares WHERE owner_id = ? ORDER BY folder, created_at`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]FolderShare, 0)
	for rows.Next() {
		var f FolderShare
		var created string
		if err := rows.Scan(&f.OwnerID, &f.Folder, &f.UserID, &f.Status, &created); err != nil {
			return nil, err
		}
		f.CreatedAt = parseTime(created)
		out = append(out, f)
	}
	return out, rows.Err()
}

// ListIncomingFolderShares returns a user's pending folder invitations, with the
// owner's name and how many tasks are currently in the folder — so "Home (12
// tasks) from alice" is answerable before accepting.
func (s *Store) ListIncomingFolderShares(ctx context.Context, userID int64) ([]FolderShareRequest, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT fs.owner_id, u.username, fs.folder, fs.created_at,
		        (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = fs.owner_id AND t.folder = fs.folder) AS task_count
		   FROM folder_shares fs JOIN users u ON u.id = fs.owner_id
		  WHERE fs.user_id = ? AND fs.status = 'pending'
		  ORDER BY fs.created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]FolderShareRequest, 0)
	for rows.Next() {
		var r FolderShareRequest
		var created string
		if err := rows.Scan(&r.OwnerID, &r.OwnerName, &r.Folder, &created, &r.TaskCount); err != nil {
			return nil, err
		}
		r.CreatedAt = parseTime(created)
		out = append(out, r)
	}
	return out, rows.Err()
}
