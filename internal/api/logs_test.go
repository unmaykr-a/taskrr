package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/logbuf"
	"github.com/unmaykr-a/taskrr/internal/store"
)

func TestHandleListLogs(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	user, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})

	logs := logbuf.New(10)
	_, _ = logs.Write([]byte("first\n"))
	_, _ = logs.Write([]byte("second\n"))
	s := NewServer(st, Options{Logs: logs})

	get := func(actor store.User, query string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/admin/logs"+query, nil)
		r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, actor))
		w := httptest.NewRecorder()
		s.handleListLogs(w, r)
		return w
	}

	// Non-admin is rejected.
	if w := get(user, ""); w.Code == http.StatusOK {
		t.Fatalf("non-admin got %d, want a rejection", w.Code)
	}

	// Admin gets all buffered lines.
	w := get(admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("admin list logs = %d, want 200", w.Code)
	}
	var entries []logbuf.Entry
	if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(entries) != 2 || entries[0].Text != "first" {
		t.Fatalf("unexpected entries: %+v", entries)
	}

	// The ?after cursor returns only newer lines.
	w = get(admin, "?after=1")
	_ = json.Unmarshal(w.Body.Bytes(), &entries)
	if len(entries) != 1 || entries[0].Text != "second" {
		t.Fatalf("after=1 = %+v, want only 'second'", entries)
	}
}

func TestHandleListLogsNilBuffer(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{}) // no Logs wired

	r := httptest.NewRequest("GET", "/api/admin/logs", nil)
	r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, admin))
	w := httptest.NewRecorder()
	s.handleListLogs(w, r)
	if w.Code != http.StatusOK || w.Body.String() != "[]\n" && w.Body.String() != "[]" {
		t.Fatalf("nil buffer: code=%d body=%q, want 200 []", w.Code, w.Body.String())
	}
}
