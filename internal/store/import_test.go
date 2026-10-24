package store

import (
	"context"
	"testing"
	"time"
)

// Atomicity here rests on everything happening inside one transaction: the
// clearing out and every insert, or none of it. These pin the behaviour that
// depends on that, and the one judgement the method makes on its own — a snooze
// is only worth restoring while it is still ahead of us.

func importFixture(t *testing.T) (*Store, User) {
	t.Helper()
	s := newTestStore(t)
	u, err := s.CreateUser(context.Background(), UserInput{Username: "u", Role: "user"})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return s, u
}

func TestImportTasksReplacesAtomically(t *testing.T) {
	ctx := context.Background()
	s, u := importFixture(t)
	if _, err := s.CreateTask(ctx, u.ID, TaskInput{Name: "old one"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTask(ctx, u.ID, TaskInput{Name: "old two"}); err != nil {
		t.Fatal(err)
	}

	when := time.Now().UTC().Add(-48 * time.Hour)
	counts, err := s.ImportTasks(ctx, u.ID, []ImportTask{
		{Input: TaskInput{Name: "new one"}, Completions: []ImportCompletion{
			{CompletedAt: when, Note: "a"},
			{CompletedAt: when.Add(time.Hour), Note: "b"},
		}},
		{Input: TaskInput{Name: "new two"}},
	}, true)
	if err != nil {
		t.Fatalf("ImportTasks: %v", err)
	}
	if counts.TasksDeleted != 2 || counts.TasksCreated != 2 || counts.CompletionsAdded != 2 {
		t.Fatalf("counts = %+v, want 2 deleted / 2 created / 2 completions", counts)
	}

	tasks, err := s.ListTasks(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 2 {
		t.Fatalf("%d tasks after replace, want 2", len(tasks))
	}
	for _, task := range tasks {
		if task.Name == "old one" || task.Name == "old two" {
			t.Fatalf("replace left %q behind", task.Name)
		}
		if task.OwnerID != u.ID {
			t.Fatalf("imported task owned by %d, want %d", task.OwnerID, u.ID)
		}
	}
}

func TestImportTasksMergeKeepsWhatIsThere(t *testing.T) {
	ctx := context.Background()
	s, u := importFixture(t)
	if _, err := s.CreateTask(ctx, u.ID, TaskInput{Name: "kept"}); err != nil {
		t.Fatal(err)
	}
	counts, err := s.ImportTasks(ctx, u.ID, []ImportTask{{Input: TaskInput{Name: "added"}}}, false)
	if err != nil {
		t.Fatalf("ImportTasks: %v", err)
	}
	if counts.TasksDeleted != 0 {
		t.Fatalf("merge deleted %d tasks", counts.TasksDeleted)
	}
	tasks, _ := s.ListTasks(ctx, u.ID)
	if len(tasks) != 2 {
		t.Fatalf("%d tasks after merge, want 2", len(tasks))
	}
}

// A backup taken months ago should not restore a task into a hold that expired
// long before the restore.
func TestImportTasksOnlyKeepsALiveSnooze(t *testing.T) {
	ctx := context.Background()
	s, u := importFixture(t)
	past := time.Now().UTC().Add(-72 * time.Hour)
	future := time.Now().UTC().Add(72 * time.Hour)

	if _, err := s.ImportTasks(ctx, u.ID, []ImportTask{
		{Input: TaskInput{Name: "lapsed"}, SnoozedUntil: &past},
		{Input: TaskInput{Name: "still held"}, SnoozedUntil: &future},
		{Input: TaskInput{Name: "never held"}},
	}, false); err != nil {
		t.Fatalf("ImportTasks: %v", err)
	}

	tasks, _ := s.ListTasks(ctx, u.ID)
	got := map[string]bool{}
	for _, task := range tasks {
		got[task.Name] = task.SnoozedUntil != nil
	}
	if got["lapsed"] {
		t.Error("restored a snooze that had already run out")
	}
	if !got["still held"] {
		t.Error("dropped a snooze that was still in the future")
	}
	if got["never held"] {
		t.Error("invented a snooze")
	}
}

// Nothing is written when the import cannot complete — the whole point of doing
// it in one transaction, and what stops a failed replace from taking the old
// tasks with it.
func TestImportTasksWritesNothingOnFailure(t *testing.T) {
	ctx := context.Background()
	s, u := importFixture(t)
	if _, err := s.CreateTask(ctx, u.ID, TaskInput{Name: "mine"}); err != nil {
		t.Fatal(err)
	}

	const noSuchUser = 999999
	if _, err := s.ImportTasks(ctx, noSuchUser, []ImportTask{
		{Input: TaskInput{Name: "orphan"}, Completions: []ImportCompletion{{CompletedAt: time.Now().UTC()}}},
	}, true); err == nil {
		t.Fatal("importing for an account that does not exist should fail")
	}

	var tasks, completions int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM tasks`).Scan(&tasks); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM completions`).Scan(&completions); err != nil {
		t.Fatal(err)
	}
	if tasks != 1 || completions != 0 {
		t.Fatalf("a failed import left %d tasks and %d completions behind, want 1 and 0", tasks, completions)
	}
}
