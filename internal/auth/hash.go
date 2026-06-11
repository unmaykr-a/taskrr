// Package auth holds password hashing and session-token helpers for Taskrr.
//
// Password hashing uses the standard library's crypto/pbkdf2 (PBKDF2-HMAC-SHA256)
// so the binary keeps its CGO-free, single-binary, dependency-light shape — no
// golang.org/x/crypto needed. Hashes are stored in a self-describing string
// ("pbkdf2-sha256$iter$salt$hash") so the iteration count can be raised later
// without breaking existing hashes.
package auth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// iterations is the PBKDF2 work factor. 600k matches OWASP's 2023 guidance for
// PBKDF2-HMAC-SHA256 and stays comfortably fast on a Pi for interactive logins.
const iterations = 600_000

const keyLen = 32
const saltLen = 16

var b64 = base64.RawStdEncoding

// HashPassword returns a self-describing PBKDF2 hash for the given password.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	dk, err := pbkdf2.Key(sha256.New, password, salt, iterations, keyLen)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", iterations, b64.EncodeToString(salt), b64.EncodeToString(dk)), nil
}

// VerifyPassword reports whether password matches the stored hash, in constant
// time. It tolerates differing iteration counts so hashes stay valid if the work
// factor is later increased.
func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter <= 0 {
		return false
	}
	salt, err := b64.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := b64.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

// ValidHash reports whether encoded is a well-formed hash this package can
// verify. Handy for catching a mangled TASKRR_ADMIN_PASSWORD_HASH at startup —
// e.g. Docker Compose eating the `$` separators when they aren't escaped as `$$`.
func ValidHash(encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	if iter, err := strconv.Atoi(parts[1]); err != nil || iter <= 0 {
		return false
	}
	if _, err := b64.DecodeString(parts[2]); err != nil {
		return false
	}
	if _, err := b64.DecodeString(parts[3]); err != nil {
		return false
	}
	return true
}

// NewSessionToken returns a cryptographically-random opaque token (the value
// stored in the user's cookie) plus its SHA-256 hex digest (what we persist, so
// a database leak never exposes a usable token).
func NewSessionToken() (token string, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(raw)
	return token, HashToken(token), nil
}

// HashToken returns the SHA-256 hex digest of a session token.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// ErrEmptyPassword is returned when a password fails the minimum policy.
var ErrEmptyPassword = errors.New("password must be at least 8 characters")

// decoyHash is a real PBKDF2 hash of a throwaway password, computed once at
// startup. DummyVerify runs a verification against it so a login for a user that
// doesn't exist (or has no password) still pays the same PBKDF2 cost — closing
// the timing side-channel that otherwise reveals which usernames exist.
var decoyHash, _ = HashPassword("taskrr-decoy-password-§not-used-by-anyone")

// DummyVerify performs (and discards) a constant-cost password verification. Call
// it on the no-such-user / no-password login path so timing matches a real check.
func DummyVerify(password string) {
	_ = VerifyPassword(decoyHash, password)
}

// ErrPasswordTooLong is returned for absurdly long passwords; the cap is far
// above any passphrase but keeps request handling bounded.
var ErrPasswordTooLong = errors.New("password must be at most 1024 characters")

// ValidatePassword applies the minimal password policy (length bounds only).
func ValidatePassword(pw string) error {
	if len(pw) < 8 {
		return ErrEmptyPassword
	}
	if len(pw) > 1024 {
		return ErrPasswordTooLong
	}
	return nil
}
