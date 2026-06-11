package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// User is an account. PasswordHash is nil for OIDC-only accounts; OIDCSubject is
// nil for local accounts. Neither secret field is ever serialised to JSON — only
// the derived booleans (PasswordSet / OIDCLinked) are, so the UI can tell a
// claimed account from one waiting for its owner to set a password.
type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	Role         string    `json:"role"` // "admin" | "user"
	PasswordHash *string   `json:"-"`
	OIDCSubject  *string   `json:"-"`
	PasswordSet  bool      `json:"passwordSet"`
	OIDCLinked   bool      `json:"oidcLinked"`
	Approved     bool      `json:"approved"`
	// Protected is set by the API layer (not the DB) for the bootstrap admin, so
	// the UI can disable controls other admins aren't allowed to use.
	Protected bool      `json:"protected"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// UserInput carries the fields needed to create a user. Approved defaults to
// true (a nil pointer); only self-registration under "require approval" sets it
// false.
type UserInput struct {
	Username     string
	PasswordHash *string
	Role         string
	OIDCSubject  *string
	Approved     *bool
}

const userSelect = `SELECT id, username, password_hash, role, oidc_subject, approved, created_at, updated_at FROM users`

func scanUser(sc scanner) (User, error) {
	var (
		u        User
		hash     sql.NullString
		subject  sql.NullString
		approved int
		created  string
		updated  string
	)
	if err := sc.Scan(&u.ID, &u.Username, &hash, &u.Role, &subject, &approved, &created, &updated); err != nil {
		return User{}, err
	}
	u.Approved = approved != 0
	if hash.Valid {
		u.PasswordHash = &hash.String
	}
	if subject.Valid {
		u.OIDCSubject = &subject.String
	}
	u.PasswordSet = hash.Valid
	u.OIDCLinked = subject.Valid
	u.CreatedAt = parseTime(created)
	u.UpdatedAt = parseTime(updated)
	return u, nil
}

// CreateUser inserts a new user and returns it.
func (s *Store) CreateUser(ctx context.Context, in UserInput) (User, error) {
	role := in.Role
	if role == "" {
		role = "user"
	}
	approved := 1
	if in.Approved != nil && !*in.Approved {
		approved = 0
	}
	now := time.Now().UTC().Format(timeLayout)
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (username, password_hash, role, oidc_subject, approved, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		in.Username, in.PasswordHash, role, in.OIDCSubject, approved, now, now,
	)
	if err != nil {
		return User{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return User{}, err
	}
	return s.GetUserByID(ctx, id)
}

func (s *Store) GetUserByID(ctx context.Context, id int64) (User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx, userSelect+` WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx, userSelect+` WHERE username = ? COLLATE NOCASE`, username))
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) GetUserByOIDCSubject(ctx context.Context, subject string) (User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx, userSelect+` WHERE oidc_subject = ?`, subject))
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, userSelect+` ORDER BY username COLLATE NOCASE ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]User, 0)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (s *Store) CountAdmins(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&n)
	return n, err
}

func (s *Store) UpdateUserRole(ctx context.Context, id int64, role string) error {
	return s.touchUser(ctx, `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`, role, time.Now().UTC().Format(timeLayout), id)
}

// UpdateUsername renames a user. The UNIQUE (COLLATE NOCASE) index surfaces a
// taken name as an error; callers should check availability first for a clean
// message.
func (s *Store) UpdateUsername(ctx context.Context, id int64, username string) error {
	return s.touchUser(ctx, `UPDATE users SET username = ?, updated_at = ? WHERE id = ?`, username, time.Now().UTC().Format(timeLayout), id)
}

// SetUserApproved approves (or un-approves) an account.
func (s *Store) SetUserApproved(ctx context.Context, id int64, approved bool) error {
	v := 0
	if approved {
		v = 1
	}
	return s.touchUser(ctx, `UPDATE users SET approved = ?, updated_at = ? WHERE id = ?`, v, time.Now().UTC().Format(timeLayout), id)
}

// ListPendingUsers returns accounts awaiting approval (oldest first).
func (s *Store) ListPendingUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, userSelect+` WHERE approved = 0 ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]User, 0)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// SetUserPassword updates (or clears, with nil) a user's password hash.
func (s *Store) SetUserPassword(ctx context.Context, id int64, hash *string) error {
	return s.touchUser(ctx, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, hash, time.Now().UTC().Format(timeLayout), id)
}

// LinkOIDCSubject attaches an OIDC subject to an existing local account.
func (s *Store) LinkOIDCSubject(ctx context.Context, id int64, subject string) error {
	return s.touchUser(ctx, `UPDATE users SET oidc_subject = ?, updated_at = ? WHERE id = ?`, subject, time.Now().UTC().Format(timeLayout), id)
}

// UnlinkOIDCSubject removes a user's OIDC link.
func (s *Store) UnlinkOIDCSubject(ctx context.Context, id int64) error {
	return s.touchUser(ctx, `UPDATE users SET oidc_subject = NULL, updated_at = ? WHERE id = ?`, time.Now().UTC().Format(timeLayout), id)
}

func (s *Store) touchUser(ctx context.Context, query string, args ...any) error {
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUser removes a user (cascading their tasks, completions, and sessions).
func (s *Store) DeleteUser(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- destructive admin operations -------------------------------------------

// WipeAllTasks deletes every task (and, by cascade, every completion) for all
// users. The accounts themselves are left untouched.
func (s *Store) WipeAllTasks(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM tasks`)
	return err
}

// DeleteTasksByOwner deletes all of one user's tasks (and, by cascade, their
// completions), keeping the account and its preferences. Returns the count.
func (s *Store) DeleteTasksByOwner(ctx context.Context, ownerID int64) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tasks WHERE owner_id = ?`, ownerID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// DeleteNonAdminUsers deletes every non-admin account and, by cascade, all of
// their tasks, completions, sessions, and preferences. Admins are kept (so the
// caller isn't locked out). Returns how many users were removed.
func (s *Store) DeleteNonAdminUsers(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE role != 'admin'`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// MergeUsers folds sourceID into targetID in one transaction: optionally moves
// the source's tasks to the target, transfers the source's OIDC link (when the
// target has none), deletes the source (cascading anything left), and optionally
// renames the target. When the target already has its own OIDC link, the
// source's is dropped with the source — that identity can no longer sign in
// (an account can carry only one OIDC subject).
func (s *Store) MergeUsers(ctx context.Context, sourceID, targetID int64, moveData bool, newUsername string) error {
	if sourceID == targetID {
		return errors.New("cannot merge an account into itself")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Both must exist; capture the OIDC subjects so we can transfer the link.
	var srcSubject, tgtSubject sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT oidc_subject FROM users WHERE id = ?`, sourceID).Scan(&srcSubject); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT oidc_subject FROM users WHERE id = ?`, targetID).Scan(&tgtSubject); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	now := time.Now().UTC().Format(timeLayout)
	if moveData {
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET owner_id = ? WHERE owner_id = ?`, targetID, sourceID); err != nil {
			return err
		}
	}
	// Delete the source first — this frees its username and OIDC subject (and
	// cascades sessions, preferences, and any tasks not moved).
	if _, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, sourceID); err != nil {
		return err
	}
	if srcSubject.Valid && !tgtSubject.Valid {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET oidc_subject = ?, updated_at = ? WHERE id = ?`, srcSubject.String, now, targetID); err != nil {
			return err
		}
	}
	if newUsername != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET username = ?, updated_at = ? WHERE id = ?`, newUsername, now, targetID); err != nil {
			return err // a UNIQUE violation surfaces here
		}
	}
	return tx.Commit()
}

// --- sessions ---------------------------------------------------------------

// CreateSession stores a session keyed by the token's hash.
func (s *Store) CreateSession(ctx context.Context, tokenHash string, userID int64, expiresAt time.Time) error {
	now := time.Now().UTC().Format(timeLayout)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)`,
		tokenHash, userID, now, expiresAt.UTC().Format(timeLayout), now,
	)
	return err
}

// sessionTouchInterval throttles last_seen writes: a session's activity time is
// refreshed at most once per this window, so an authenticated request doesn't
// write to the DB every time (the guarded UPDATE below is a no-op in between).
const sessionTouchInterval = time.Minute

// TouchSession refreshes a session's last_seen to now, but only if it's older
// than sessionTouchInterval — keeping the "last online" time current without a
// write on every request. Best-effort: callers ignore the error.
func (s *Store) TouchSession(ctx context.Context, tokenHash string) error {
	now := time.Now().UTC()
	cutoff := now.Add(-sessionTouchInterval).Format(timeLayout)
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET last_seen = ? WHERE token_hash = ? AND (last_seen IS NULL OR last_seen < ?)`,
		now.Format(timeLayout), tokenHash, cutoff,
	)
	return err
}

// RenewSession extends a session to expiresAt, but only when its current expiry
// is before onlyIfBefore — the sliding-renewal guard, so a page load extends a
// session past half its TTL instead of rewriting the row on every visit.
// Reports whether the session was actually extended.
func (s *Store) RenewSession(ctx context.Context, tokenHash string, expiresAt, onlyIfBefore time.Time) (bool, error) {
	res, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at < ?`,
		expiresAt.UTC().Format(timeLayout), tokenHash, onlyIfBefore.UTC().Format(timeLayout),
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// SessionUser returns the user for a (non-expired) session token hash.
func (s *Store) SessionUser(ctx context.Context, tokenHash string) (User, error) {
	var expires string
	row := s.db.QueryRowContext(ctx, `SELECT expires_at FROM sessions WHERE token_hash = ?`, tokenHash)
	if err := row.Scan(&expires); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, err
	}
	if parseTime(expires).Before(time.Now().UTC()) {
		_ = s.DeleteSession(ctx, tokenHash)
		return User{}, ErrNotFound
	}
	u, err := scanUser(s.db.QueryRowContext(ctx,
		userSelect+` WHERE id = (SELECT user_id FROM sessions WHERE token_hash = ?)`, tokenHash))
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

func (s *Store) DeleteExpiredSessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, time.Now().UTC().Format(timeLayout))
	return err
}

// UserSessionSummary is one row of the admin "who's signed in" view: a user with
// at least one live session, how many they have, and when they were last active.
type UserSessionSummary struct {
	UserID   int64     `json:"userId"`
	Username string    `json:"username"`
	Role     string    `json:"role"`
	Sessions int       `json:"sessions"`
	LastSeen time.Time `json:"lastSeen"`
	// Protected is set by the API layer (not the DB) for the bootstrap admin, so
	// the UI can disable "terminate" for other admins.
	Protected bool `json:"protected"`
}

// ListUserSessions returns, per user with a live (non-expired) session, the
// number of sessions and the most recent activity, newest-active first.
func (s *Store) ListUserSessions(ctx context.Context) ([]UserSessionSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.username, u.role, COUNT(s.token_hash), MAX(s.last_seen)
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.expires_at > ?
		GROUP BY u.id
		ORDER BY MAX(s.last_seen) DESC`,
		time.Now().UTC().Format(timeLayout),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]UserSessionSummary, 0)
	for rows.Next() {
		var r UserSessionSummary
		var lastSeen sql.NullString
		if err := rows.Scan(&r.UserID, &r.Username, &r.Role, &r.Sessions, &lastSeen); err != nil {
			return nil, err
		}
		if lastSeen.Valid {
			r.LastSeen = parseTime(lastSeen.String)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// --- settings ---------------------------------------------------------------

func (s *Store) GetSetting(ctx context.Context, key string) (string, bool, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value,
	)
	return err
}

// --- per-user preferences ---------------------------------------------------

// GetUserPreferences returns the opaque JSON preferences blob for a user (theme,
// layout, etc.). An empty string means the user has none saved yet.
func (s *Store) GetUserPreferences(ctx context.Context, userID int64) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT data FROM user_preferences WHERE user_id = ?`, userID).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return v, nil
}

// SetUserPreferences upserts a user's preferences blob.
func (s *Store) SetUserPreferences(ctx context.Context, userID int64, data string) error {
	now := time.Now().UTC().Format(timeLayout)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		userID, data, now,
	)
	return err
}

func (s *Store) AllSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// --- bootstrap --------------------------------------------------------------

// EnsureAdmin creates the bootstrap admin (with the given password hash) if no
// account with that username exists yet, and assigns any pre-auth orphan tasks
// (owner_id IS NULL) to it. Returns the admin user. Idempotent across restarts.
func (s *Store) EnsureAdmin(ctx context.Context, username string, passwordHash *string) (User, error) {
	admin, err := s.GetUserByUsername(ctx, username)
	if errors.Is(err, ErrNotFound) {
		admin, err = s.CreateUser(ctx, UserInput{Username: username, PasswordHash: passwordHash, Role: "admin"})
	}
	if err != nil {
		return User{}, err
	}
	// Re-assert the bootstrap admin's role. The primary admin must always be an
	// admin; if it was demoted (e.g. an OIDC group sync before that was guarded),
	// promote it back so a restart is a reliable recovery — other admins can't
	// edit it, and it can't edit itself once demoted, so this is the way back.
	if admin.Role != "admin" {
		if err := s.UpdateUserRole(ctx, admin.ID, "admin"); err != nil {
			return User{}, err
		}
		admin.Role = "admin"
	}
	// Adopt any tasks that predate authentication.
	if _, err := s.db.ExecContext(ctx, `UPDATE tasks SET owner_id = ? WHERE owner_id IS NULL`, admin.ID); err != nil {
		return User{}, err
	}
	return admin, nil
}
