package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// shareTestEnv spins up a server with two users (alice the owner, bob the
// recipient) and a task owned by alice, returning the handler + signed-in
// cookies. tasksShareable is enabled iff `enabled`.
type shareTestEnv struct {
	st     *store.Store
	h      http.Handler
	alice  store.User
	bob    store.User
	taskID int64
	cookie map[int64]*http.Cookie
}

func newShareEnv(t *testing.T, enabled bool) shareTestEnv {
	t.Helper()
	ctx := context.Background()
	st := openStore(t)
	if enabled {
		if err := st.SetSetting(ctx, "tasks_shareable", "true"); err != nil {
			t.Fatalf("SetSetting: %v", err)
		}
	}
	alice, _ := st.CreateUser(ctx, store.UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	task, err := st.CreateTask(ctx, alice.ID, store.TaskInput{Name: "Shared chore"})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	s := NewServer(st, Options{})
	h := s.Handler()
	return shareTestEnv{
		st:     st,
		h:      h,
		alice:  alice,
		bob:    bob,
		taskID: task.ID,
		cookie: map[int64]*http.Cookie{
			alice.ID: signIn(t, st, s.opts.SessionTTL, alice),
			bob.ID:   signIn(t, st, s.opts.SessionTTL, bob),
		},
	}
}

func (e shareTestEnv) do(t *testing.T, as store.User, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	req.AddCookie(e.cookie[as.ID])
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, req)
	return w
}

// taskIDs lists the task ids the given user sees via GET /api/tasks.
func (e shareTestEnv) taskIDs(t *testing.T, as store.User) []int64 {
	t.Helper()
	w := e.do(t, as, http.MethodGet, "/api/tasks", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/tasks = %d", w.Code)
	}
	var tasks []store.Task
	if err := json.Unmarshal(w.Body.Bytes(), &tasks); err != nil {
		t.Fatalf("decode tasks: %v", err)
	}
	ids := make([]int64, len(tasks))
	for i, tk := range tasks {
		ids[i] = tk.ID
	}
	return ids
}

func containsID(ids []int64, id int64) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

func TestShareFlowHTTP(t *testing.T) {
	e := newShareEnv(t, true)
	share := "/api/tasks/" + itoa(e.taskID)

	// Alice shares with bob.
	if w := e.do(t, e.alice, http.MethodPost, share+"/share", `{"username":"bob"}`); w.Code != http.StatusCreated {
		t.Fatalf("share = %d, want 201 (body: %s)", w.Code, w.Body.String())
	}
	// Pending: not yet in bob's task list, but present in his requests.
	if containsID(e.taskIDs(t, e.bob), e.taskID) {
		t.Fatal("pending share should not appear in bob's tasks")
	}
	w := e.do(t, e.bob, http.MethodGet, "/api/me/shares", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/me/shares = %d", w.Code)
	}
	var reqs []store.ShareRequest
	if err := json.Unmarshal(w.Body.Bytes(), &reqs); err != nil {
		t.Fatalf("decode requests: %v", err)
	}
	if len(reqs) != 1 || reqs[0].TaskID != e.taskID || reqs[0].OwnerName != "alice" {
		t.Fatalf("unexpected requests: %+v", reqs)
	}

	// Bob accepts; now it's in his task list and his requests are empty.
	if w := e.do(t, e.bob, http.MethodPost, share+"/share/respond", `{"accept":true}`); w.Code != http.StatusNoContent {
		t.Fatalf("respond accept = %d, want 204 (body: %s)", w.Code, w.Body.String())
	}
	if !containsID(e.taskIDs(t, e.bob), e.taskID) {
		t.Fatal("accepted share should appear in bob's tasks")
	}
	if w := e.do(t, e.bob, http.MethodGet, "/api/me/shares", ""); !strings.Contains(w.Body.String(), "[]") {
		t.Fatalf("requests should be empty after accept, got %s", w.Body.String())
	}

	// Members endpoint (visible to bob): owner alice + accepted bob.
	w = e.do(t, e.bob, http.MethodGet, share+"/members", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET members = %d", w.Code)
	}
	var members []store.TaskMember
	if err := json.Unmarshal(w.Body.Bytes(), &members); err != nil {
		t.Fatalf("decode members: %v", err)
	}
	if len(members) != 2 || members[0].Status != "owner" || members[0].Username != "alice" ||
		members[1].Username != "bob" || members[1].Status != "accepted" {
		t.Fatalf("unexpected members: %+v", members)
	}
}

func TestShareGateOff(t *testing.T) {
	e := newShareEnv(t, false) // tasks_shareable defaults off
	w := e.do(t, e.alice, http.MethodPost, "/api/tasks/"+itoa(e.taskID)+"/share", `{"username":"bob"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("share with feature off = %d, want 403", w.Code)
	}
}

func TestShareValidationHTTP(t *testing.T) {
	e := newShareEnv(t, true)
	share := "/api/tasks/" + itoa(e.taskID) + "/share"

	cases := []struct {
		name, body string
		actor      store.User
		want       int
	}{
		{"unknown user", `{"username":"nobody"}`, e.alice, http.StatusNotFound},
		{"self", `{"username":"alice"}`, e.alice, http.StatusBadRequest},
		{"non-owner", `{"username":"alice"}`, e.bob, http.StatusNotFound},
		{"empty username", `{"username":"  "}`, e.alice, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if w := e.do(t, tc.actor, http.MethodPost, share, tc.body); w.Code != tc.want {
				t.Fatalf("%s = %d, want %d (body: %s)", tc.name, w.Code, tc.want, w.Body.String())
			}
		})
	}

	// First share succeeds, a duplicate conflicts.
	if w := e.do(t, e.alice, http.MethodPost, share, `{"username":"bob"}`); w.Code != http.StatusCreated {
		t.Fatalf("first share = %d, want 201", w.Code)
	}
	if w := e.do(t, e.alice, http.MethodPost, share, `{"username":"bob"}`); w.Code != http.StatusConflict {
		t.Fatalf("duplicate share = %d, want 409", w.Code)
	}
}

func TestAllowSharesOptOutHTTP(t *testing.T) {
	e := newShareEnv(t, true)

	// Bob opts out; /api/auth/me reflects it.
	if w := e.do(t, e.bob, http.MethodPut, "/api/me/allow-shares", `{"allowShares":false}`); w.Code != http.StatusOK {
		t.Fatalf("set allow-shares = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	w := e.do(t, e.bob, http.MethodGet, "/api/auth/me", "")
	var me store.User
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode me: %v", err)
	}
	if me.AllowShares {
		t.Fatal("bob should read AllowShares=false after opting out")
	}

	// Alice can no longer share with bob.
	if w := e.do(t, e.alice, http.MethodPost, "/api/tasks/"+itoa(e.taskID)+"/share", `{"username":"bob"}`); w.Code != http.StatusForbidden {
		t.Fatalf("share to opted-out user = %d, want 403", w.Code)
	}
}

func TestLeaveHTTP(t *testing.T) {
	e := newShareEnv(t, true)
	base := "/api/tasks/" + itoa(e.taskID)
	if w := e.do(t, e.alice, http.MethodPost, base+"/share", `{"username":"bob"}`); w.Code != http.StatusCreated {
		t.Fatalf("share = %d", w.Code)
	}
	if w := e.do(t, e.bob, http.MethodPost, base+"/share/respond", `{"accept":true}`); w.Code != http.StatusNoContent {
		t.Fatalf("accept = %d", w.Code)
	}
	// Bob leaves; the task drops from his list but stays in alice's.
	if w := e.do(t, e.bob, http.MethodPost, base+"/leave", ""); w.Code != http.StatusNoContent {
		t.Fatalf("leave = %d, want 204 (body: %s)", w.Code, w.Body.String())
	}
	if containsID(e.taskIDs(t, e.bob), e.taskID) {
		t.Fatal("task should be gone from bob after leaving")
	}
	if !containsID(e.taskIDs(t, e.alice), e.taskID) {
		t.Fatal("task should remain with alice after bob leaves")
	}
	// Leaving again is a 404.
	if w := e.do(t, e.bob, http.MethodPost, base+"/leave", ""); w.Code != http.StatusNotFound {
		t.Fatalf("leave twice = %d, want 404", w.Code)
	}
}

// itoa is a tiny local int64->string to keep paths readable.
func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
