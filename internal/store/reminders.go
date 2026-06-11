package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ReminderSettings is a user's webhook reminder configuration. The secret-ish
// webhook URL is only ever returned to its owner.
type ReminderSettings struct {
	Enabled     bool   `json:"enabled"`
	WebhookURL  string `json:"webhookUrl"`
	// LeadSeconds fires the reminder this long before the due time (0 = at the
	// due time / once overdue).
	LeadSeconds int64 `json:"leadSeconds"`
}

// GetReminderSettings returns a user's settings, or disabled defaults when they
// have never configured them.
func (s *Store) GetReminderSettings(ctx context.Context, userID int64) (ReminderSettings, error) {
	var (
		rs      ReminderSettings
		enabled int
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT enabled, webhook_url, lead_seconds FROM reminder_settings WHERE user_id = ?`, userID,
	).Scan(&enabled, &rs.WebhookURL, &rs.LeadSeconds)
	if errors.Is(err, sql.ErrNoRows) {
		return ReminderSettings{}, nil
	}
	if err != nil {
		return ReminderSettings{}, err
	}
	rs.Enabled = enabled != 0
	return rs, nil
}

// SetReminderSettings upserts a user's reminder settings.
func (s *Store) SetReminderSettings(ctx context.Context, userID int64, rs ReminderSettings) error {
	enabled := 0
	if rs.Enabled {
		enabled = 1
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO reminder_settings (user_id, enabled, webhook_url, lead_seconds, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   enabled = excluded.enabled, webhook_url = excluded.webhook_url,
		   lead_seconds = excluded.lead_seconds, updated_at = excluded.updated_at`,
		userID, enabled, rs.WebhookURL, rs.LeadSeconds, time.Now().UTC().Format(timeLayout),
	)
	return err
}

// ReminderCandidate is a due-eligible task joined with its owner's webhook config
// and the due-time it was last reminded for. Due-ness and once-per-cycle dedup
// are decided by the caller (in Go), mirroring the frontend's nextDue logic.
type ReminderCandidate struct {
	TaskID        int64
	OwnerID       int64
	TaskName      string
	IntervalSecs  int64
	WebhookURL    string
	LeadSeconds   int64
	LastCompleted time.Time
	// LastRemindedDue is the RFC3339 dueAt we last reminded for, or "" if never.
	LastRemindedDue string
}

// ListReminderCandidates returns every non-archived cadence task that has been
// completed at least once and whose owner has reminders enabled with a webhook.
func (s *Store) ListReminderCandidates(ctx context.Context) ([]ReminderCandidate, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.owner_id, t.name, t.interval_seconds, rs.webhook_url, rs.lead_seconds,
		       (SELECT MAX(completed_at) FROM completions c WHERE c.task_id = t.id) AS last_completed_at,
		       COALESCE((SELECT due_at FROM task_reminders tr WHERE tr.task_id = t.id), '') AS last_reminded_due
		FROM tasks t
		JOIN reminder_settings rs ON rs.user_id = t.owner_id
		WHERE rs.enabled = 1 AND TRIM(rs.webhook_url) <> ''
		  AND t.archived_at IS NULL
		  AND t.interval_seconds IS NOT NULL AND t.interval_seconds > 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ReminderCandidate, 0)
	for rows.Next() {
		var (
			c        ReminderCandidate
			lastComp sql.NullString
		)
		if err := rows.Scan(&c.TaskID, &c.OwnerID, &c.TaskName, &c.IntervalSecs,
			&c.WebhookURL, &c.LeadSeconds, &lastComp, &c.LastRemindedDue); err != nil {
			return nil, err
		}
		if !lastComp.Valid {
			continue // never completed → not due yet
		}
		c.LastCompleted = parseTime(lastComp.String)
		out = append(out, c)
	}
	return out, rows.Err()
}

// MarkReminded records that a task was reminded for a given due-time, so the
// same cycle won't fire again. Keyed by task, so it advances with each cycle.
func (s *Store) MarkReminded(ctx context.Context, taskID int64, dueAt time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO task_reminders (task_id, due_at, sent_at) VALUES (?, ?, ?)
		 ON CONFLICT(task_id) DO UPDATE SET due_at = excluded.due_at, sent_at = excluded.sent_at`,
		taskID, dueAt.UTC().Format(timeLayout), time.Now().UTC().Format(timeLayout),
	)
	return err
}
