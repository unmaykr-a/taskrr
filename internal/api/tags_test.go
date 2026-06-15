package api

import (
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeTags(t *testing.T) {
	// Trims, drops empties, and de-duplicates case-insensitively (first wins).
	got, msg := normalizeTags([]string{" home ", "Home", "", "plants", "PLANTS"})
	if msg != "" {
		t.Fatalf("unexpected error: %s", msg)
	}
	if !reflect.DeepEqual(got, []string{"home", "plants"}) {
		t.Fatalf("normalizeTags = %#v", got)
	}

	if _, msg := normalizeTags([]string{strings.Repeat("a", maxTagLen+1)}); msg == "" {
		t.Fatal("expected an error for an over-long tag")
	}

	many := make([]string, maxTags+1)
	for i := range many {
		many[i] = string(rune('a' + i))
	}
	if _, msg := normalizeTags(many); msg == "" {
		t.Fatal("expected an error for too many tags")
	}
}
