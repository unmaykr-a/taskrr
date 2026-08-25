package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Background is one uploaded picture, without its bytes. Listings and the API
// both want the metadata far more often than the image itself, and a list of
// half-megabyte blobs is not something to serialise by accident — so the bytes
// only ever come out of GetBackgroundData.
type Background struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"userId"`
	Name      string    `json:"name"`
	Mime      string    `json:"mime"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

// CreateBackground stores an uploaded image against its owner.
func (s *Store) CreateBackground(ctx context.Context, userID int64, name, mime string, data []byte) (Background, error) {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO backgrounds (user_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		userID, name, mime, len(data), data, now.Format(timeLayout),
	)
	if err != nil {
		return Background{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Background{}, err
	}
	return Background{ID: id, UserID: userID, Name: name, Mime: mime, Size: int64(len(data)), CreatedAt: now}, nil
}

// ListBackgrounds returns a user's own images, newest first.
func (s *Store) ListBackgrounds(ctx context.Context, userID int64) ([]Background, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, name, mime, size, created_at
		   FROM backgrounds WHERE user_id = ?
		  ORDER BY created_at DESC, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Background{}
	for rows.Next() {
		var b Background
		var created string
		if err := rows.Scan(&b.ID, &b.UserID, &b.Name, &b.Mime, &b.Size, &created); err != nil {
			return nil, err
		}
		b.CreatedAt = parseTime(created)
		out = append(out, b)
	}
	return out, rows.Err()
}

// BackgroundBytesForUser returns how much an account is already storing, so an
// upload can be refused before it lands rather than after.
func (s *Store) BackgroundBytesForUser(ctx context.Context, userID int64) (int64, error) {
	var total sql.NullInt64
	err := s.db.QueryRowContext(ctx,
		`SELECT SUM(size) FROM backgrounds WHERE user_id = ?`, userID).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total.Int64, nil
}

// GetBackground returns one image's metadata, whoever owns it. Callers decide
// who may see it — the instance background is deliberately readable by anyone,
// including the signed-out login page.
func (s *Store) GetBackground(ctx context.Context, id int64) (Background, error) {
	var b Background
	var created string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id, name, mime, size, created_at FROM backgrounds WHERE id = ?`, id).
		Scan(&b.ID, &b.UserID, &b.Name, &b.Mime, &b.Size, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Background{}, ErrNotFound
	}
	if err != nil {
		return Background{}, err
	}
	b.CreatedAt = parseTime(created)
	return b, nil
}

// GetBackgroundData returns the image itself, with the mime type to serve it as.
func (s *Store) GetBackgroundData(ctx context.Context, id int64) ([]byte, string, error) {
	var (
		data []byte
		mime string
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT data, mime FROM backgrounds WHERE id = ?`, id).Scan(&data, &mime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return data, mime, nil
}

// DeleteBackground removes one of a user's own images. Scoped by userID so one
// account can never delete another's.
func (s *Store) DeleteBackground(ctx context.Context, userID, id int64) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM backgrounds WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
