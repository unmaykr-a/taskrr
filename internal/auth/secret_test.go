package auth

import (
	"strings"
	"testing"
)

func TestSecretCipherRoundTrip(t *testing.T) {
	c, err := NewSecretCipher("a-test-key")
	if err != nil {
		t.Fatalf("NewSecretCipher: %v", err)
	}
	if !c.Enabled() {
		t.Fatal("cipher with a key should be enabled")
	}
	const secret = "oidc-client-secret-value"
	enc, err := c.Encrypt(secret)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if !strings.HasPrefix(enc, secretPrefix) {
		t.Fatalf("ciphertext missing prefix: %q", enc)
	}
	if strings.Contains(enc, secret) {
		t.Fatal("ciphertext must not contain the plaintext")
	}
	got, err := c.Decrypt(enc)
	if err != nil || got != secret {
		t.Fatalf("Decrypt = (%q, %v), want (%q, nil)", got, err, secret)
	}
	// Two encryptions of the same value differ (random nonce).
	enc2, _ := c.Encrypt(secret)
	if enc == enc2 {
		t.Fatal("expected a random nonce to make ciphertexts differ")
	}
}

func TestSecretCipherNoKeyIsPassthrough(t *testing.T) {
	c, _ := NewSecretCipher("")
	if c.Enabled() {
		t.Fatal("no key should be a no-op cipher")
	}
	enc, _ := c.Encrypt("plain")
	if enc != "plain" {
		t.Fatalf("no-key Encrypt should pass through, got %q", enc)
	}
	dec, _ := c.Decrypt("plain")
	if dec != "plain" {
		t.Fatalf("no-key Decrypt should pass through, got %q", dec)
	}
}

func TestSecretCipherDecryptsLegacyPlaintext(t *testing.T) {
	// A key is configured, but the stored value predates encryption.
	c, _ := NewSecretCipher("k")
	got, err := c.Decrypt("legacy-plaintext")
	if err != nil || got != "legacy-plaintext" {
		t.Fatalf("legacy plaintext should pass through: (%q, %v)", got, err)
	}
}

func TestSecretCipherWrongKeyFails(t *testing.T) {
	a, _ := NewSecretCipher("key-a")
	b, _ := NewSecretCipher("key-b")
	enc, _ := a.Encrypt("secret")
	if _, err := b.Decrypt(enc); err == nil {
		t.Fatal("decrypting with the wrong key should fail")
	}
	// Ciphertext with no key configured is a clear error, not silent plaintext.
	none, _ := NewSecretCipher("")
	if _, err := none.Decrypt(enc); err == nil {
		t.Fatal("ciphertext with no key should error")
	}
}

func TestEmptyStringNeverEncrypted(t *testing.T) {
	c, _ := NewSecretCipher("k")
	enc, _ := c.Encrypt("")
	if enc != "" {
		t.Fatalf("empty input should stay empty, got %q", enc)
	}
}
