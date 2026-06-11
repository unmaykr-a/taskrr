package auth

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	const pw = "correct horse battery"
	h, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !VerifyPassword(h, pw) {
		t.Fatal("VerifyPassword rejected the correct password")
	}
	if VerifyPassword(h, "wrong password") {
		t.Fatal("VerifyPassword accepted a wrong password")
	}
	if VerifyPassword("not-a-valid-hash", pw) {
		t.Fatal("VerifyPassword accepted a malformed hash")
	}
	// Two hashes of the same password must differ (random salt).
	h2, _ := HashPassword(pw)
	if h == h2 {
		t.Fatal("expected a random salt to produce different hashes")
	}
}

func TestValidHash(t *testing.T) {
	good, _ := HashPassword("pw")
	if !ValidHash(good) {
		t.Fatal("ValidHash rejected a freshly generated hash")
	}
	// The Docker-Compose-mangled form (a `$tNp...` salt segment eaten) and other
	// malformations must be flagged.
	bad := []string{
		"",
		"pbkdf2-sha256$600000/TVgT67wMqllwu3WaUQ$abc", // 3 parts — a `$salt` was dropped
		"pbkdf2-sha256$notanumber$c2FsdA$aGFzaA",      // bad iteration count
		"pbkdf2-sha256$600000$not_base64!$aGFzaA",     // bad salt encoding
		"argon2$600000$c2FsdA$aGFzaA",                 // wrong scheme
	}
	for _, b := range bad {
		if ValidHash(b) {
			t.Errorf("ValidHash accepted a malformed hash: %q", b)
		}
	}
}

func TestSessionTokens(t *testing.T) {
	tok, hash, err := NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken: %v", err)
	}
	if tok == "" || hash == "" {
		t.Fatal("empty token or hash")
	}
	if HashToken(tok) != hash {
		t.Fatal("HashToken did not match the token's stored hash")
	}
	if HashToken("a") == HashToken("b") {
		t.Fatal("different tokens hashed the same")
	}
}

func TestValidatePassword(t *testing.T) {
	if err := ValidatePassword("short"); err == nil {
		t.Fatal("expected short password to be rejected")
	}
	if err := ValidatePassword("longenough!"); err != nil {
		t.Fatalf("expected a valid password to pass: %v", err)
	}
}
