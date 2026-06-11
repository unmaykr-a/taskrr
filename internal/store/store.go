// Package store is the data access layer for Taskrr. It owns the SQLite
// connection and exposes typed methods for tasks and completions.
//
// We use modernc.org/sqlite (a pure-Go SQLite) so the binary builds with
// CGO_ENABLED=0 and cross-compiles trivially to arm64 for the Raspberry Pi.
package store

import (
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// timeLayout is the canonical on-disk timestamp format.
const timeLayout = time.RFC3339

// Store wraps the database connection.
type Store struct {
	db   *sql.DB
	path string // on-disk DB path (for backups)
}

// Open opens (creating if needed) the SQLite database at path and applies any
// pending migrations. WAL mode plus a busy timeout keeps the single-writer
// SQLite happy under the light concurrency this app sees.
func Open(path string) (*Store, error) {
	// Ensure the parent directory exists (e.g. ./data). This makes the default
	// ./data/taskrr.db work on a fresh checkout and inside a bind-mounted
	// volume without any manual setup.
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create data directory %s: %w", dir, err)
		}
	}

	// If a restore was staged (path+".restore") before the last shutdown, swap it
	// in now — while nothing has the database open yet, which is the only safe
	// moment to replace the file.
	applyPendingRestore(path)

	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)",
		path,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	// SQLite serialises writes; a single connection avoids "database is locked"
	// errors entirely and is plenty for a self-hosted task tracker.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	s := &Store{db: db, path: path}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return s, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error { return s.db.Close() }

// migrate applies every embedded *.sql migration that has not yet been
// recorded in the schema_migrations table, in filename order.
func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version    TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return err
	}

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var count int
		if err := s.db.QueryRow(
			`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, name,
		).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			continue // already applied
		}

		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}

		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
			name, time.Now().UTC().Format(timeLayout),
		); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// parseTime converts a stored timestamp string back into a time.Time, tolerating
// the couple of formats SQLite might hand back. A zero Time is returned if the
// value cannot be parsed.
func parseTime(s string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}
