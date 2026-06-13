package api

import (
	"net/http/httptest"
	"testing"
)

// TestSafetyBackupToggle verifies the pre-restore safety backup honours the
// SafetyBackupOnRestore option: a snapshot is taken when on, and skipped when off.
func TestSafetyBackupToggle(t *testing.T) {
	t.Run("on", func(t *testing.T) {
		st := openStore(t)
		s := NewServer(st, Options{SafetyBackupOnRestore: true})
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/admin/restore/x", nil)
		s.doRestore(w, r, func() error { return nil }) // stage is a no-op
		if w.Code != 200 {
			t.Fatalf("doRestore = %d, want 200 (%s)", w.Code, w.Body.String())
		}
		backups, err := st.ListBackups()
		if err != nil {
			t.Fatalf("ListBackups: %v", err)
		}
		if len(backups) != 1 {
			t.Fatalf("safety backup on: want 1 backup, got %d", len(backups))
		}
	})

	t.Run("off", func(t *testing.T) {
		st := openStore(t)
		s := NewServer(st, Options{SafetyBackupOnRestore: false})
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/admin/restore/x", nil)
		s.doRestore(w, r, func() error { return nil })
		if w.Code != 200 {
			t.Fatalf("doRestore = %d, want 200 (%s)", w.Code, w.Body.String())
		}
		backups, err := st.ListBackups()
		if err != nil {
			t.Fatalf("ListBackups: %v", err)
		}
		if len(backups) != 0 {
			t.Fatalf("safety backup off: want 0 backups, got %d", len(backups))
		}
	})
}
