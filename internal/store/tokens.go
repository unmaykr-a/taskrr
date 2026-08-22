package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// APIToken is a long-lived bearer credential belonging to one user. The token
// itself is never stored — only its digest — so this struct is safe to return
// from the API and render in the UI.
type APIToken struct {
	ID     int64  `json:"id"`
	UserID int64  `json:"userId"`
	Name   string `json:"name"`
	// LastUsedAt is nil until the token authenticates a request, which is what
	// makes an unused (and therefore safely revocable) token identifiable.
	LastUsedAt *time.Time `json:"lastUsedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

// CreateAPIToken records a new token for a user. The caller generates the token
// and passes only its hash, exactly as sessions work.
func (s *Store) CreateAPIToken(ctx context.Context, userID int64, name, tokenHash string) (APIToken, error) {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)`,
		userID, name, tokenHash, now.Format(timeLayout),
	)
	if err != nil {
		return APIToken{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return APIToken{}, err
	}
	return APIToken{ID: id, UserID: userID, Name: name, CreatedAt: now}, nil
}

// ListAPITokens returns a user's tokens, newest first.
func (s *Store) ListAPITokens(ctx context.Context, userID int64) ([]APIToken, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, name, last_used_at, created_at
		   FROM api_tokens WHERE user_id = ?
		  ORDER BY created_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []APIToken{}
	for rows.Next() {
		var t APIToken
		var lastUsed sql.NullString
		var created string
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &lastUsed, &created); err != nil {
			return nil, err
		}
		t.CreatedAt = parseTime(created)
		if lastUsed.Valid && lastUsed.String != "" {
			when := parseTime(lastUsed.String)
			t.LastUsedAt = &when
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteAPIToken revokes one of a user's tokens. Scoped by userID so one
// account can never revoke another's.
func (s *Store) DeleteAPIToken(ctx context.Context, userID, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM api_tokens WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// apiTokenTouchInterval throttles last_used_at writes the same way sessions
// throttle last_seen: an automation polling every minute shouldn't mean a write
// on every request.
const apiTokenTouchInterval = time.Minute

// APITokenUser resolves a token digest to its owner, recording use as it goes.
// Unlike sessions, tokens don't expire — they're revoked explicitly — so there
// is no expiry check here.
func (s *Store) APITokenUser(ctx context.Context, tokenHash string) (User, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT user_id FROM api_tokens WHERE token_hash = ?`, tokenHash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	u, err := scanUser(s.db.QueryRowContext(ctx, userSelect+` WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// TouchAPIToken records that a token was just used (throttled, best-effort).
func (s *Store) TouchAPIToken(ctx context.Context, tokenHash string) error {
	cutoff := time.Now().UTC().Add(-apiTokenTouchInterval).Format(timeLayout)
	_, err := s.db.ExecContext(ctx,
		`UPDATE api_tokens SET last_used_at = ?
		  WHERE token_hash = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
		time.Now().UTC().Format(timeLayout), tokenHash, cutoff)
	return err
}
