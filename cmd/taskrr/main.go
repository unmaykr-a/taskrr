// Command taskrr is the Taskrr server: a lightweight, self-hostable task
// tracker that records when you last did things.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/unmaykr-a/taskrr/internal/api"
	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/config"
	"github.com/unmaykr-a/taskrr/internal/logbuf"
	"github.com/unmaykr-a/taskrr/internal/reminder"
	"github.com/unmaykr-a/taskrr/internal/store"
)

func main() {
	hashPw := flag.String("hash-password", "", "print a password hash for TASKRR_ADMIN_PASSWORD_HASH and exit")
	health := flag.Bool("health", false, "probe the local /api/health endpoint and exit 0/1 (for container healthchecks)")
	flag.Parse()

	// Utility mode: hash a password for the env file, then exit.
	if *hashPw != "" {
		h, err := auth.HashPassword(*hashPw)
		if err != nil {
			fmt.Fprintln(os.Stderr, "hash error:", err)
			os.Exit(1)
		}
		fmt.Println(h)
		return
	}

	// Healthcheck mode: hit /api/health and exit. Lets the distroless image (no
	// shell/curl) be health-checked via `taskrr -health`.
	if *health {
		os.Exit(healthProbe(config.Load().Addr))
	}

	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("taskrr: ")

	// Tee logs into an in-memory ring so the admin UI can tail them; stderr still
	// gets everything (so `docker logs` is unchanged).
	logs := logbuf.New(2000)
	log.SetOutput(io.MultiWriter(os.Stderr, logs))

	cfg := config.Load()

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("failed to open database at %s: %v", cfg.DBPath, err)
	}
	defer st.Close()

	adminID, err := bootstrap(st, cfg)
	if err != nil {
		log.Fatalf("bootstrap failed: %v", err)
	}

	// Cipher for at-rest secrets (OIDC client secret). No-op when no key is set.
	secrets, err := auth.NewSecretCipher(cfg.SecretKey)
	if err != nil {
		log.Fatalf("invalid TASKRR_SECRET_KEY: %v", err)
	}
	if secrets.Enabled() {
		log.Printf("at-rest secret encryption enabled (TASKRR_SECRET_KEY set)")
	}

	// A restore stages a new DB then asks for a restart; we trigger a graceful
	// shutdown (the container's restart policy brings the process back, and the
	// staged DB is swapped in at startup). stop is buffered so the non-blocking
	// send never blocks the request handler.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	requestRestart := func() {
		select {
		case stop <- syscall.SIGTERM:
		default:
		}
	}

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: api.NewServer(st, api.Options{
			SessionTTL:            cfg.SessionTTL,
			CookieSecure:          cfg.CookieSecure,
			ProtectedUserID:       adminID,
			OnRestart:             requestRestart,
			Logs:                  logs,
			Lite:                  cfg.Lite,
			TrustProxyHeaders:     cfg.TrustProxyHeaders,
			Secrets:               secrets,
			SafetyBackupOnRestore: cfg.SafetyBackupOnRestore,
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	if !cfg.CookieSecure {
		log.Printf("note: session cookies are not marked Secure (TASKRR_COOKIE_SECURE=false) — set it to true if Taskrr is served over HTTPS")
	}

	go func() {
		log.Printf("listening on %s (db: %s)", cfg.Addr, cfg.DBPath)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Background reminder loop: delivers webhook reminders for due tasks. Tied to
	// its own context so it stops cleanly on shutdown, before the DB is closed.
	remCtx, remCancel := context.WithCancel(context.Background())
	go reminder.New(st).Run(remCtx, cfg.ReminderInterval)

	// Hourly sweep of expired sessions. They're already invisible to queries, but
	// without this they'd only ever be removed at startup (or when the exact token
	// is presented again), so a long-running container accumulates dead rows.
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-remCtx.Done():
				return
			case <-t.C:
				if err := st.DeleteExpiredSessions(remCtx); err != nil {
					log.Printf("session sweep: %v", err)
				}
			}
		}
	}()

	// Wait for an interrupt (or a restore-triggered restart), then shut down.
	<-stop
	remCancel()

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

// healthProbe makes a short request to the local /api/health endpoint and
// returns a process exit code (0 = healthy). Used by container healthchecks.
func healthProbe(addr string) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		port = "8787"
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, "health:", err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "health: status %d\n", resp.StatusCode)
		return 1
	}
	return 0
}

// bootstrap prepares the database for serving: clears expired sessions and
// ensures the admin account exists (adopting any pre-auth tasks). Returns the
// bootstrap admin's id (protected from edits by other admins).
func bootstrap(st *store.Store, cfg config.Config) (int64, error) {
	ctx := context.Background()
	_ = st.DeleteExpiredSessions(ctx)

	// Resolve the admin password: a pre-computed hash wins over plaintext.
	var pwHash *string
	switch {
	case cfg.AdminPasswordHash != "":
		if !auth.ValidHash(cfg.AdminPasswordHash) {
			log.Printf("warning: TASKRR_ADMIN_PASSWORD_HASH is not a valid pbkdf2-sha256 hash. " +
				"If you set it via a Docker Compose .env, double every '$' to '$$' — Compose " +
				"treats '$' as variable interpolation and silently corrupts the hash otherwise.")
		}
		h := cfg.AdminPasswordHash
		pwHash = &h
	case cfg.AdminPassword != "":
		h, err := auth.HashPassword(cfg.AdminPassword)
		if err != nil {
			return 0, err
		}
		pwHash = &h
	}

	admin, err := st.EnsureAdmin(ctx, cfg.AdminUsername, pwHash)
	if err != nil {
		return 0, err
	}
	// Recovery: if the admin predates having a password and the env now supplies
	// one, set it (so a locked-out admin can be reset via the env).
	if admin.PasswordHash == nil && pwHash != nil {
		if err := st.SetUserPassword(ctx, admin.ID, pwHash); err != nil {
			return 0, err
		}
	}
	if admin.PasswordHash == nil && pwHash == nil {
		log.Printf("warning: admin %q has no password set (set TASKRR_ADMIN_PASSWORD or _HASH)", cfg.AdminUsername)
	} else {
		log.Printf("admin account %q ready", cfg.AdminUsername)
	}

	// Seed OIDC settings from the env on first run; the admin UI can override
	// them later (we only write a key if it's both provided and currently unset).
	// The client secret is encrypted at rest when TASKRR_SECRET_KEY is set.
	cipher, err := auth.NewSecretCipher(cfg.SecretKey)
	if err != nil {
		return 0, err
	}
	seed := func(key, val string, secret bool) error {
		if val == "" {
			return nil
		}
		if _, ok, err := st.GetSetting(ctx, key); err != nil || ok {
			return err
		}
		if secret {
			if val, err = cipher.Encrypt(val); err != nil {
				return err
			}
		}
		return st.SetSetting(ctx, key, val)
	}
	for _, kv := range []struct {
		key, val string
		secret   bool
	}{
		{"oidc_issuer", cfg.OIDCIssuer, false},
		{"oidc_client_id", cfg.OIDCClientID, false},
		{"oidc_client_secret", cfg.OIDCClientSecret, true},
		{"oidc_redirect_url", cfg.OIDCRedirectURL, false},
	} {
		if err := seed(kv.key, kv.val, kv.secret); err != nil {
			return 0, err
		}
	}
	return admin.ID, nil
}
