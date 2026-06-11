// Package logbuf keeps a bounded, in-memory ring of recent log lines so the
// admin UI can tail the server/access logs without a shell or a log file on the
// (distroless) image. It implements io.Writer, so wiring it is just
// log.SetOutput(io.MultiWriter(os.Stderr, buf)) — every log.Printf is captured.
//
// The ring is in memory only: it holds the most recent lines since the process
// started and is cleared on restart (the container's stdout still has the full
// history). That's deliberate — no log file to rotate or fill the data volume.
package logbuf

import (
	"strings"
	"sync"
	"time"
)

// Entry is one captured log line.
type Entry struct {
	Seq  int64     `json:"seq"`
	Time time.Time `json:"time"`
	Text string    `json:"text"`
}

// Buffer is a fixed-capacity ring of recent log lines, safe for concurrent use.
type Buffer struct {
	mu      sync.Mutex
	entries []Entry
	max     int
	seq     int64
}

// New returns a Buffer that retains the most recent max lines.
func New(max int) *Buffer {
	if max <= 0 {
		max = 1000
	}
	return &Buffer{max: max, entries: make([]Entry, 0, max+1)}
}

// Write implements io.Writer. The standard logger calls it once per record with
// the full formatted line (trailing newline included), so one Write is one entry.
func (b *Buffer) Write(p []byte) (int, error) {
	text := strings.TrimRight(string(p), "\n")
	b.mu.Lock()
	b.seq++
	b.entries = append(b.entries, Entry{Seq: b.seq, Time: time.Now().UTC(), Text: text})
	if len(b.entries) > b.max {
		// Compact in place: shift the newest max entries to the front so the
		// backing array stays bounded instead of growing without end.
		n := copy(b.entries, b.entries[len(b.entries)-b.max:])
		b.entries = b.entries[:n]
	}
	b.mu.Unlock()
	return len(p), nil
}

// Since returns buffered entries with Seq greater than after (after = 0 returns
// everything still buffered), oldest first. Callers poll with the last Seq they
// saw to tail incrementally.
func (b *Buffer) Since(after int64) []Entry {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]Entry, 0, len(b.entries))
	for _, e := range b.entries {
		if e.Seq > after {
			out = append(out, e)
		}
	}
	return out
}
