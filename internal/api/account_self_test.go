package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andri1305/taskrr/internal/store"
)

// authed returns a request with the given user injected into the context, as the
// withUser middleware would do for a valid session.
func authed(method, body string, u store.User) *http.Request {
	r := httptest.NewRequest(method, "/api/me", bytes.NewReader([]byte(body)))
	return r.WithContext(context.WithValue(r.Context(), userCtxKey{}, u))
}

func TestHandleDeleteAccountGuards(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	primary, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	other, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: primary.ID})

	call := func(u store.User, confirm string) int {
		body, _ := json.Marshal(map[string]string{"confirm": confirm})
		w := httptest.NewRecorder()
		s.handleDeleteAccount(w, authed("DELETE", string(body), u))
		return w.Code
	}

	// The protected primary admin can't be deleted, even with a correct confirm.
	if code := call(primary, "admin"); code != http.StatusForbidden {
		t.Fatalf("protected admin delete = %d, want 403", code)
	}
	// A mismatched confirmation is rejected.
	if code := call(other, "nope"); code != http.StatusBadRequest {
		t.Fatalf("bad confirm = %d, want 400", code)
	}
	// A normal account with the right confirm (case-insensitive) is deleted.
	if code := call(other, "BOB"); code != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204", code)
	}
	if _, err := st.GetUserByID(ctx, other.ID); err == nil {
		t.Fatal("account should be gone after delete")
	}
}

func TestHandleDeleteAccountLastAdmin(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	// No protected admin here; "solo" is the only admin.
	solo, _ := st.CreateUser(ctx, store.UserInput{Username: "solo", Role: "admin", PasswordHash: ptr("h")})
	_, _ = st.CreateUser(ctx, store.UserInput{Username: "regular", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})

	body, _ := json.Marshal(map[string]string{"confirm": "solo"})
	w := httptest.NewRecorder()
	s.handleDeleteAccount(w, authed("DELETE", string(body), solo))
	if w.Code != http.StatusConflict {
		t.Fatalf("last admin self-delete = %d, want 409", w.Code)
	}
	if _, err := st.GetUserByID(ctx, solo.ID); err != nil {
		t.Fatalf("the only admin must not be deleted: %v", err)
	}
}

func TestHandleWipeMyData(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	if _, err := st.CreateTask(ctx, u.ID, store.TaskInput{Name: "t1"}); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	s := NewServer(st, Options{})

	// Wrong confirm: rejected, tasks untouched.
	w := httptest.NewRecorder()
	s.handleWipeMyData(w, authed("POST", `{"confirm":"wrong"}`, u))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad confirm = %d, want 400", w.Code)
	}
	if tasks, _ := st.ListTasks(ctx, u.ID); len(tasks) != 1 {
		t.Fatalf("tasks wiped on a bad confirm: %d", len(tasks))
	}

	// Correct confirm: tasks deleted, account kept.
	w = httptest.NewRecorder()
	s.handleWipeMyData(w, authed("POST", `{"confirm":"alice"}`, u))
	if w.Code != http.StatusOK {
		t.Fatalf("wipe = %d, want 200", w.Code)
	}
	if tasks, _ := st.ListTasks(ctx, u.ID); len(tasks) != 0 {
		t.Fatalf("tasks not wiped: %d", len(tasks))
	}
	if _, err := st.GetUserByID(ctx, u.ID); err != nil {
		t.Fatalf("account should survive a data wipe: %v", err)
	}
}
