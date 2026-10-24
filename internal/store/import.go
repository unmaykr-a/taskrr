package store

import (
	"context"
	"time"
)

// Importing a whole document of tasks at once.
//
// The obvious way to write this is a loop calling CreateTask and AddCompletion,
// and that is what it used to be. Two problems with it, both of which this
// method exists to fix.
//
// It was not atomic. Every row was its own transaction, so a failure halfway
// through left half an import behind — and in replace mode the account's old
// tasks had already been deleted, so a failure meant losing the old data
// without gaining the new. Restoring a backup is exactly when a database is
// least able to afford that.
//
// And it was slow out of all proportion. SQLite commits each statement
// separately in autocommit, so an import paid a commit per row: measured at
// ~330µs each against ~8µs inside a transaction, which is the difference
// between a minute and two seconds for a large history — on a Pi's SD card,
// the difference between several minutes and a few seconds.

// ImportCompletion is one logged occurrence to restore.
type ImportCompletion struct {
	CompletedAt time.Time
	Note        string
}

// ImportTask is one validated task to create, with the history that belongs to
// it. The input has already been through the same validation as a task created
// by hand; nothing here is taken from the file untouched.
type ImportTask struct {
	Input        TaskInput
	SnoozedUntil *time.Time
	Completions  []ImportCompletion
}

// ImportCounts reports what an import did.
type ImportCounts struct {
	TasksCreated     int
	CompletionsAdded int
	TasksDeleted     int64
}

// ImportTasks writes an entire import — the clearing out, the tasks and all
// their history — as one transaction. Either the account ends up with the whole
// document or with exactly what it had before.
//
// Completions are inserted directly rather than through AddCompletion: these
// tasks were created moments ago in this transaction by this owner, so the
// per-row access check would be asking a question it already knows the answer
// to, once per completion.
func (s *Store) ImportTasks(ctx context.Context, ownerID int64, items []ImportTask, replace bool) (ImportCounts, error) {
	var out ImportCounts

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer func() { _ = tx.Rollback() }()

	if replace {
		// A shared task moves to one of its members rather than being destroyed,
		// the same as clearing out tasks anywhere else: the owner is leaving the
		// task, not deciding for everyone on it.
		if err := reassignSharedTasks(ctx, tx, ownerID); err != nil {
			return out, err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE owner_id = ?`, ownerID)
		if err != nil {
			return out, err
		}
		out.TasksDeleted, _ = res.RowsAffected()
	}

	insertTask, err := tx.PrepareContext(ctx,
		`INSERT INTO tasks (name, description, interval_seconds, color_fresh, color_overdue, freeze_color,
		                    tags, folder, pinned, rotate, reminder_lead_seconds, snoozed_until, owner_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return out, err
	}
	defer insertTask.Close()

	insertCompletion, err := tx.PrepareContext(ctx,
		`INSERT INTO completions (task_id, user_id, completed_at, note, created_at) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return out, err
	}
	defer insertCompletion.Close()

	now := time.Now().UTC()
	stamp := now.Format(timeLayout)

	for _, item := range items {
		in := item.Input
		// A snooze is only carried over while it is still ahead of us; an old
		// backup should not restore a task into a hold that lapsed months ago.
		var snoozed any
		if item.SnoozedUntil != nil && item.SnoozedUntil.After(now) {
			snoozed = item.SnoozedUntil.UTC().Format(timeLayout)
		}

		res, err := insertTask.ExecContext(ctx,
			in.Name, in.Description, in.IntervalSeconds, in.ColorFresh, in.ColorOverdue, boolToInt(in.FreezeColor),
			encodeTags(in.Tags), in.Folder, boolToInt(in.Pinned), boolToInt(in.Rotate), in.ReminderLeadSeconds,
			snoozed, ownerID, stamp, stamp)
		if err != nil {
			return out, err
		}
		taskID, err := res.LastInsertId()
		if err != nil {
			return out, err
		}
		out.TasksCreated++

		for _, c := range item.Completions {
			if _, err := insertCompletion.ExecContext(ctx,
				taskID, ownerID, c.CompletedAt.UTC().Format(timeLayout), c.Note, stamp); err != nil {
				return out, err
			}
			out.CompletionsAdded++
		}
	}

	if err := tx.Commit(); err != nil {
		return out, err
	}
	return out, nil
}
