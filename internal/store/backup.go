package store

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

// BackupInfo describes a backup file on disk.
type BackupInfo struct {
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// backupName matches the filenames we create, used to reject path traversal.
// The optional `-N` disambiguates backups made within the same second.
var backupName = regexp.MustCompile(`^taskrr-\d{8}-\d{6}(-\d+)?\.db$`)

// BackupsDir is where backups live: a `backups/` folder next to the database.
func (s *Store) BackupsDir() string {
	return filepath.Join(filepath.Dir(s.path), "backups")
}

// Backup writes a consistent, complete copy of the database (via SQLite's
// `VACUUM INTO`) into the backups directory and returns the new file's name.
func (s *Store) Backup(ctx context.Context) (string, error) {
	dir := s.BackupsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	// Find a free filename — VACUUM INTO fails if the target already exists, and
	// two backups in the same second would otherwise collide (e.g. a safety
	// backup taken right before a restore).
	base := time.Now().UTC().Format("20060102-150405")
	name := fmt.Sprintf("taskrr-%s.db", base)
	for i := 1; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
			break
		}
		name = fmt.Sprintf("taskrr-%s-%d.db", base, i)
	}
	dest := filepath.Join(dir, name)
	// Run the snapshot on its own read-only connection: the pool is capped at one
	// connection, so doing it there would block every request for the duration.
	// Under WAL a reader doesn't block the writer, so the app stays responsive.
	ro, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro&_pragma=busy_timeout(5000)", s.path))
	if err != nil {
		return "", err
	}
	defer ro.Close()
	// dest is fully server-controlled (timestamped), so quoting it inline is safe.
	if _, err := ro.ExecContext(ctx, fmt.Sprintf("VACUUM INTO '%s'", dest)); err != nil {
		return "", err
	}
	return name, nil
}

// ListBackups returns the backups on disk, newest first.
func (s *Store) ListBackups() ([]BackupInfo, error) {
	dir := s.BackupsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupInfo{}, nil
		}
		return nil, err
	}
	out := make([]BackupInfo, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !backupName.MatchString(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, BackupInfo{Name: e.Name(), Size: info.Size(), ModTime: info.ModTime().UTC()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	return out, nil
}

// BackupFilePath validates a backup name and returns its absolute path. It
// rejects anything that isn't one of our generated filenames (no traversal).
func (s *Store) BackupFilePath(name string) (string, bool) {
	if !backupName.MatchString(name) {
		return "", false
	}
	return filepath.Join(s.BackupsDir(), name), true
}

// DeleteBackup removes a backup file by name (name-validated, no traversal).
// Returns ErrNotFound for an unknown/invalid name or a missing file.
func (s *Store) DeleteBackup(name string) error {
	path, ok := s.BackupFilePath(name)
	if !ok {
		return ErrNotFound
	}
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// --- restore ----------------------------------------------------------------
//
// Restore is a two-phase, crash-safe swap: a chosen database is *staged* next to
// the live file (path+".restore"); on the next startup applyPendingRestore swaps
// it in while nothing has the database open. The caller validates + takes a
// safety backup first, then triggers a restart.

// restorePath is the staging filename for a pending restore.
func (s *Store) restorePath() string { return s.path + ".restore" }

// applyPendingRestore swaps a staged restore file into place if one exists. It
// runs at startup, before the database is opened. Best-effort: on failure it
// logs and leaves the existing database untouched.
func applyPendingRestore(path string) {
	staged := path + ".restore"
	if _, err := os.Stat(staged); err != nil {
		return // nothing staged
	}
	// Drop the live DB and its WAL sidecars, then move the staged file into place.
	for _, p := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			log.Printf("restore: could not remove %s: %v (leaving database as-is)", p, err)
			return
		}
	}
	if err := os.Rename(staged, path); err != nil {
		log.Printf("restore: could not apply staged backup: %v", err)
		return
	}
	log.Printf("restore: applied a staged backup over %s", path)
}

// ValidateDBFile opens a file read-only and checks it looks like a Taskrr
// database (a valid SQLite file with a schema_migrations table), so a bad upload
// can't be staged and brick the app on restart.
func (s *Store) ValidateDBFile(path string) error {
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro&_pragma=busy_timeout(2000)", path))
	if err != nil {
		return err
	}
	defer db.Close()
	var n int
	if err := db.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&n); err != nil {
		return fmt.Errorf("not a valid Taskrr database: %w", err)
	}
	return nil
}

// StageRestoreFromBackup validates an existing backup and stages it for restore.
func (s *Store) StageRestoreFromBackup(name string) error {
	path, ok := s.BackupFilePath(name)
	if !ok {
		return ErrNotFound
	}
	if _, err := os.Stat(path); err != nil {
		return ErrNotFound
	}
	if err := s.ValidateDBFile(path); err != nil {
		return err
	}
	return copyFile(path, s.restorePath())
}

// StageRestoreFromReader writes an uploaded database to a temp file, validates
// it, and stages it for restore.
func (s *Store) StageRestoreFromReader(src io.Reader) error {
	dir := filepath.Dir(s.path)
	tmp, err := os.CreateTemp(dir, "taskrr-upload-*.db")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := s.ValidateDBFile(tmpPath); err != nil {
		return err
	}
	return copyFile(tmpPath, s.restorePath())
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
