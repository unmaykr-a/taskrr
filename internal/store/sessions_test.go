package store

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

func TestListUserSessions(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	a, _ := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user"})
	b, _ := st.CreateUser(ctx, UserInput{Username: "bob", Role: "admin"})

	future := time.Now().Add(time.Hour)
	past := time.Now().Add(-time.Hour)
	// alice: two live sessions; bob: one live + one expired (excluded).
	for _, tok := range []string{"a1", "a2"} {
		if err := st.CreateSession(ctx, tok, a.ID, future); err != nil {
			t.Fatalf("CreateSession: %v", err)
		}
	}
	_ = st.CreateSession(ctx, "b1", b.ID, future)
	_ = st.CreateSession(ctx, "b-expired", b.ID, past)

	list, err := st.ListUserSessions(ctx)
	if err != nil {
		t.Fatalf("ListUserSessions: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 users with live sessions, got %d", len(list))
	}
	by := map[int64]UserSessionSummary{}
	for _, s := range list {
		by[s.UserID] = s
	}
	if by[a.ID].Sessions != 2 {
		t.Fatalf("alice sessions = %d, want 2", by[a.ID].Sessions)
	}
	if by[b.ID].Sessions != 1 {
		t.Fatalf("bob live sessions = %d, want 1 (expired excluded)", by[b.ID].Sessions)
	}
	if by[a.ID].LastSeen.IsZero() {
		t.Fatal("CreateSession should seed last_seen")
	}

	// Terminating bob's sessions drops him from the list.
	if err := st.DeleteUserSessions(ctx, b.ID); err != nil {
		t.Fatalf("DeleteUserSessions: %v", err)
	}
	list, _ = st.ListUserSessions(ctx)
	if len(list) != 1 || list[0].UserID != a.ID {
		t.Fatalf("after terminating bob, want only alice, got %+v", list)
	}
}

func TestRenewSession(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	u, _ := st.CreateUser(ctx, UserInput{Username: "u", Role: "user"})

	now := time.Now().UTC()
	if err := st.CreateSession(ctx, "tok", u.ID, now.Add(10*time.Hour)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	expiry := func() string {
		var e string
		_ = st.db.QueryRowContext(ctx, `SELECT expires_at FROM sessions WHERE token_hash = ?`, "tok").Scan(&e)
		return e
	}
	before := expiry()

	// Plenty of life left (expiry is NOT before the half-TTL guard): no renewal.
	renewed, err := st.RenewSession(ctx, "tok", now.Add(20*time.Hour), now.Add(5*time.Hour))
	if err != nil {
		t.Fatalf("RenewSession: %v", err)
	}
	if renewed || expiry() != before {
		t.Fatal("a fresh session should not be renewed")
	}

	// Past the guard (expiry before onlyIfBefore): renewed to the new expiry.
	renewed, err = st.RenewSession(ctx, "tok", now.Add(20*time.Hour), now.Add(15*time.Hour))
	if err != nil {
		t.Fatalf("RenewSession: %v", err)
	}
	if !renewed {
		t.Fatal("an aging session should be renewed")
	}
	if got, want := expiry(), now.Add(20*time.Hour).Format(timeLayout); got != want {
		t.Fatalf("expires_at = %q, want %q", got, want)
	}

	// Unknown token: no-op, no error.
	if renewed, err := st.RenewSession(ctx, "nope", now.Add(time.Hour), now.Add(time.Hour)); err != nil || renewed {
		t.Fatalf("unknown token renewal = (%v, %v), want (false, nil)", renewed, err)
	}
}

func TestTouchSessionThrottle(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	u, _ := st.CreateUser(ctx, UserInput{Username: "u", Role: "user"})
	if err := st.CreateSession(ctx, "tok", u.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	lastSeen := func() string {
		var ls sql.NullString
		_ = st.db.QueryRowContext(ctx, `SELECT last_seen FROM sessions WHERE token_hash = ?`, "tok").Scan(&ls)
		return ls.String
	}

	// Force the session stale, then a touch refreshes it.
	stale := time.Now().Add(-2 * time.Minute).UTC().Format(timeLayout)
	if _, err := st.db.ExecContext(ctx, `UPDATE sessions SET last_seen = ? WHERE token_hash = ?`, stale, "tok"); err != nil {
		t.Fatalf("seed stale: %v", err)
	}
	if err := st.TouchSession(ctx, "tok"); err != nil {
		t.Fatalf("TouchSession: %v", err)
	}
	refreshed := lastSeen()
	if refreshed == stale {
		t.Fatal("stale session last_seen was not refreshed")
	}

	// A second touch within the throttle window is a no-op.
	if err := st.TouchSession(ctx, "tok"); err != nil {
		t.Fatalf("TouchSession: %v", err)
	}
	if lastSeen() != refreshed {
		t.Fatal("last_seen should not change within the throttle window")
	}
}
