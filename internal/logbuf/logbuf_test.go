package logbuf

import (
	"fmt"
	"testing"
)

func TestBufferCapturesAndTails(t *testing.T) {
	b := New(3)

	// Each Write (one log record) becomes one entry with an incrementing seq.
	for i := 1; i <= 2; i++ {
		if _, err := b.Write([]byte(fmt.Sprintf("line %d\n", i))); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}
	all := b.Since(0)
	if len(all) != 2 || all[0].Text != "line 1" || all[1].Seq != 2 {
		t.Fatalf("unexpected entries: %+v", all)
	}

	// Since(after) returns only newer lines.
	if got := b.Since(1); len(got) != 1 || got[0].Text != "line 2" {
		t.Fatalf("Since(1) = %+v, want only line 2", got)
	}
}

func TestBufferRingDropsOldest(t *testing.T) {
	b := New(3)
	for i := 1; i <= 5; i++ {
		_, _ = b.Write([]byte(fmt.Sprintf("line %d\n", i)))
	}
	all := b.Since(0)
	if len(all) != 3 {
		t.Fatalf("buffer should retain only 3 lines, got %d", len(all))
	}
	// The oldest two are dropped; seqs keep counting up.
	if all[0].Text != "line 3" || all[2].Text != "line 5" || all[2].Seq != 5 {
		t.Fatalf("unexpected retained window: %+v", all)
	}
	// A cursor at the newest seq yields nothing.
	if got := b.Since(5); len(got) != 0 {
		t.Fatalf("Since(5) = %+v, want empty", got)
	}
}
