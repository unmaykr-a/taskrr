package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// folderShareSetup builds alice (with a "Home" folder) and bob, with sharing
// switched on for the instance.
func folderShareSetup(t *testing.T) (*store.Store, *Server, http.Handler, store.User, store.User, store.Task) {
	t.Helper()
	ctx := context.Background()
	st := openStore(t)
	alice, _ := st.CreateUser(ctx, store.UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	task, err := st.CreateTask(ctx, alice.ID, store.TaskInput{Name: "water plants", Folder: "Home"})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if err := st.SetSetting(ctx, keyTasksShareable, "true"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	s := NewServer(st, Options{})
	return st, s, s.Handler(), alice, bob, task
}

func folderPath(folder, suffix string) string {
	return "/api/folders/" + url.PathEscape(folder) + suffix
}

func TestShareFolderLifecycleOverHTTP(t *testing.T) {
	ctx := context.Background()
	st, s, h, alice, bob, task := folderShareSetup(t)
	aliceCookie := signIn(t, st, s.opts.SessionTTL, alice)
	bobCookie := signIn(t, st, s.opts.SessionTTL, bob)

	// Invite.
	rec := post(t, h, folderPath("Home", "/share"), aliceCookie, `{"username":"bob"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("share: got %d, body %s", rec.Code, rec.Body.String())
	}

	// Bob sees an invitation that describes what he's accepting.
	rec = getWithCookie(t, h, "/api/me/folder-invites", bobCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("invites: got %d", rec.Code)
	}
	var invites []store.FolderShareRequest
	if err := json.Unmarshal(rec.Body.Bytes(), &invites); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(invites) != 1 || invites[0].Folder != "Home" || invites[0].OwnerName != "alice" || invites[0].TaskCount != 1 {
		t.Fatalf("invites = %+v", invites)
	}

	// Nothing is visible until he accepts.
	if tasks, _ := st.ListTasks(ctx, bob.ID); len(tasks) != 0 {
		t.Fatalf("pending invite granted access to %d task(s)", len(tasks))
	}

	// Accept.
	rec = post(t, h, folderPath("Home", "/share/respond"), bobCookie,
		fmt.Sprintf(`{"ownerId":%d,"accept":true}`, alice.ID))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("respond: got %d, body %s", rec.Code, rec.Body.String())
	}
	if tasks, _ := st.ListTasks(ctx, bob.ID); len(tasks) != 1 || tasks[0].ID != task.ID {
		t.Fatalf("bob should see the shared task, got %+v", tasks)
	}

	// Alice can see who is on the folder.
	rec = getWithCookie(t, h, folderPath("Home", "/members"), aliceCookie)
	var members []store.TaskMember
	if err := json.Unmarshal(rec.Body.Bytes(), &members); err != nil {
		t.Fatalf("decode members: %v", err)
	}
	if len(members) != 1 || members[0].Username != "bob" || members[0].Status != "accepted" {
		t.Fatalf("members = %+v", members)
	}

	// And remove him again.
	req := httptest.NewRequest(http.MethodDelete,
		folderPath("Home", fmt.Sprintf("/members/%d", bob.ID)), nil)
	req.AddCookie(aliceCookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unshare: got %d, body %s", rec.Code, rec.Body.String())
	}
	if tasks, _ := st.ListTasks(ctx, bob.ID); len(tasks) != 0 {
		t.Fatalf("bob kept access after removal: %d task(s)", len(tasks))
	}
}

// A folder name is a user-chosen string, so it has to survive the round trip
// through the URL — including spaces and characters that mean something in a path.
func TestFolderNamesWithAwkwardCharacters(t *testing.T) {
	ctx := context.Background()
	st, s, h, alice, bob, _ := folderShareSetup(t)
	aliceCookie := signIn(t, st, s.opts.SessionTTL, alice)

	for _, folder := range []string{"Home & Garden", "a/b", "100% done", "with space"} {
		t.Run(folder, func(t *testing.T) {
			if _, err := st.CreateTask(ctx, alice.ID, store.TaskInput{Name: "task in " + folder, Folder: folder}); err != nil {
				t.Fatalf("CreateTask: %v", err)
			}
			rec := post(t, h, folderPath(folder, "/share"), aliceCookie, `{"username":"bob"}`)
			if rec.Code != http.StatusCreated {
				t.Fatalf("share %q: got %d, body %s", folder, rec.Code, rec.Body.String())
			}
			var got store.FolderShare
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got.Folder != folder {
				t.Errorf("folder round-tripped as %q, want %q", got.Folder, folder)
			}
			_ = bob
		})
	}
}

func TestShareFolderRequiresTheInstanceSetting(t *testing.T) {
	ctx := context.Background()
	st, s, h, alice, _, _ := folderShareSetup(t)
	if err := st.SetSetting(ctx, keyTasksShareable, "false"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	rec := post(t, h, folderPath("Home", "/share"), signIn(t, st, s.opts.SessionTTL, alice), `{"username":"bob"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when sharing is disabled, got %d", rec.Code)
	}
}

// You can only share a folder of your own, and only one you actually use.
func TestShareFolderIsOwnerScoped(t *testing.T) {
	st, s, h, alice, bob, _ := folderShareSetup(t)
	bobCookie := signIn(t, st, s.opts.SessionTTL, bob)

	// Bob has no "Home" folder, so sharing one is a 404 rather than a way to
	// reach into alice's.
	rec := post(t, h, folderPath("Home", "/share"), bobCookie, `{"username":"alice"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d (%s)", rec.Code, rec.Body.String())
	}
	// And listing members of "Home" answers about bob's account, where there is
	// no such folder — a 404, the same as asking about a task that isn't yours,
	// never a window into alice's.
	rec = getWithCookie(t, h, folderPath("Home", "/members"), bobCookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 listing another account's folder, got %d (%s)", rec.Code, rec.Body.String())
	}
	_ = alice
}

func TestFolderShareRejectsBadInput(t *testing.T) {
	st, s, h, alice, _, _ := folderShareSetup(t)
	cookie := signIn(t, st, s.opts.SessionTTL, alice)

	for name, tc := range map[string]struct {
		path, body string
		want       int
	}{
		"no username":    {folderPath("Home", "/share"), `{"username":"  "}`, http.StatusBadRequest},
		"unknown user":   {folderPath("Home", "/share"), `{"username":"nobody"}`, http.StatusNotFound},
		"unknown folder": {folderPath("Nope", "/share"), `{"username":"bob"}`, http.StatusNotFound},
		"self":           {folderPath("Home", "/share"), `{"username":"alice"}`, http.StatusBadRequest},
		"blank folder":   {"/api/folders/%20/share", `{"username":"bob"}`, http.StatusBadRequest},
	} {
		t.Run(name, func(t *testing.T) {
			if rec := post(t, h, tc.path, cookie, tc.body); rec.Code != tc.want {
				t.Errorf("got %d, want %d (%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

// Folder endpoints change who can see data, so an automation token must not
// reach them — the allowlist covers /api/tasks and /api/completions only.
func TestFolderShareIsNotReachableByAPIToken(t *testing.T) {
	st, s, h, alice, _, _ := folderShareSetup(t)
	cookie := signIn(t, st, s.opts.SessionTTL, alice)
	token, _ := mintToken(t, h, cookie, "automation")

	for _, path := range []string{
		folderPath("Home", "/share"),
		"/api/me/folder-invites",
		"/api/me/folder-shares",
	} {
		rec := bearer(t, h, http.MethodGet, path, token, "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s: expected 403 for a token, got %d", path, rec.Code)
		}
	}
}

func TestMemberCanLeaveASharedFolder(t *testing.T) {
	ctx := context.Background()
	st, s, h, alice, bob, _ := folderShareSetup(t)
	if _, err := st.ShareFolder(ctx, alice.ID, "Home", bob.ID); err != nil {
		t.Fatalf("ShareFolder: %v", err)
	}
	if err := st.RespondToFolderShare(ctx, bob.ID, alice.ID, "Home", true); err != nil {
		t.Fatalf("respond: %v", err)
	}

	bobCookie := signIn(t, st, s.opts.SessionTTL, bob)
	rec := post(t, h, folderPath("Home", "/leave"), bobCookie, fmt.Sprintf(`{"ownerId":%d}`, alice.ID))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("leave: got %d, body %s", rec.Code, rec.Body.String())
	}
	if tasks, _ := st.ListTasks(ctx, bob.ID); len(tasks) != 0 {
		t.Fatalf("bob kept access after leaving: %d task(s)", len(tasks))
	}
	// Alice's own view is untouched.
	if tasks, _ := st.ListTasks(ctx, alice.ID); len(tasks) != 1 {
		t.Fatalf("alice's tasks were disturbed: %d", len(tasks))
	}
}
