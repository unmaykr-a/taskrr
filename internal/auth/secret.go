package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// SecretCipher encrypts small at-rest secrets (the OIDC client secret) so they
// don't sit in plaintext inside the database — and therefore inside downloadable
// backups, which travel off-box. The key comes from TASKRR_SECRET_KEY and stays
// in the process environment, never in the database or a backup, so a leaked
// backup file yields only ciphertext.
//
// When no key is configured the cipher is a no-op: Encrypt returns its input and
// Decrypt passes values through unchanged, so behaviour is identical to before
// (plaintext) and enabling/disabling the key never breaks existing data.
type SecretCipher struct {
	aead cipher.AEAD // nil when no key is configured
}

// secretPrefix marks an encrypted value so we can tell ciphertext from a legacy
// plaintext value and migrate transparently on the next write.
const secretPrefix = "enc:v1:"

var secretB64 = base64.RawStdEncoding

// NewSecretCipher derives an AES-256-GCM cipher from the key string (any
// length — it's hashed to 32 bytes). An empty key yields a no-op cipher.
func NewSecretCipher(key string) (*SecretCipher, error) {
	if key == "" {
		return &SecretCipher{}, nil
	}
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &SecretCipher{aead: aead}, nil
}

// Enabled reports whether a key is configured.
func (c *SecretCipher) Enabled() bool { return c != nil && c.aead != nil }

// Encrypt returns a self-describing ciphertext for plaintext, or plaintext
// unchanged when no key is configured (and for an empty string either way).
func (c *SecretCipher) Encrypt(plaintext string) (string, error) {
	if !c.Enabled() || plaintext == "" {
		return plaintext, nil
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := c.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return secretPrefix + secretB64.EncodeToString(ct), nil
}

// Decrypt reverses Encrypt. A value without the prefix is returned as-is (a
// legacy plaintext secret, or any value when no key is set). A prefixed value
// with no key configured is an error (the key was removed after encrypting).
func (c *SecretCipher) Decrypt(value string) (string, error) {
	if !strings.HasPrefix(value, secretPrefix) {
		return value, nil // legacy plaintext, or nothing to do
	}
	if !c.Enabled() {
		return "", errors.New("value is encrypted but TASKRR_SECRET_KEY is not set")
	}
	raw, err := secretB64.DecodeString(strings.TrimPrefix(value, secretPrefix))
	if err != nil {
		return "", err
	}
	ns := c.aead.NonceSize()
	if len(raw) < ns {
		return "", errors.New("ciphertext too short")
	}
	pt, err := c.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", err // wrong key or tampered data
	}
	return string(pt), nil
}
