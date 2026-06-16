# Reverse Proxy and HTTPS

For anything beyond your own LAN, run Taskrr behind a TLS-terminating reverse
proxy. Taskrr itself speaks plain HTTP; the proxy handles certificates and
forwards requests to it.

## The two settings that matter

- **`TASKRR_COOKIE_SECURE=true`** - set this whenever users reach Taskrr over
  HTTPS, so the session cookie is marked `Secure`.
- **`TASKRR_TRUST_PROXY_HEADERS`** - leave it `true` behind a proxy so the real
  client IP is read from `X-Forwarded-For` / `CF-Connecting-IP` for rate
  limiting and logs. Set it to `false` only if Taskrr is exposed directly to the
  internet, where those headers could be spoofed.

When the connection is HTTPS - either directly (`TASKRR_COOKIE_SECURE=true`) or
via a trusted proxy that sends `X-Forwarded-Proto: https` - Taskrr emits an HSTS
header. Browsers ignore HSTS over plain HTTP, so it only takes effect on the
encrypted leg.

Taskrr also sets a strict Content-Security-Policy, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, and `Referrer-Policy: same-origin` on every
response. The app is same-origin only and embeds its own assets, so no extra CSP
tuning is needed for a standard deployment.

## Binding

If the proxy runs on the same host, bind Taskrr to loopback so nothing else can
reach it directly:

```
TASKRR_ADDR=127.0.0.1:8787
```

## Caddy

Caddy obtains and renews certificates automatically:

```caddyfile
taskrr.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Set in Taskrr's environment:

```
TASKRR_COOKIE_SECURE=true
TASKRR_TRUST_PROXY_HEADERS=true
```

Caddy forwards `X-Forwarded-Proto` and `X-Forwarded-For` by default.

## Nginx

```nginx
server {
    listen 443 ssl;
    server_name taskrr.example.com;

    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Traefik (Docker labels)

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.taskrr.rule=Host(`taskrr.example.com`)
  - traefik.http.routers.taskrr.entrypoints=websecure
  - traefik.http.routers.taskrr.tls.certresolver=le
  - traefik.http.services.taskrr.loadbalancer.server.port=8787
```

## Cloudflare Tunnel

A tunnel terminates TLS at Cloudflare and sends `CF-Connecting-IP`. Keep
`TASKRR_TRUST_PROXY_HEADERS=true` and `TASKRR_COOKIE_SECURE=true`. Point the
tunnel's service at `http://127.0.0.1:8787`.

## OIDC redirect URL behind a proxy

Set `TASKRR_OIDC_REDIRECT_URL` (or the admin UI's redirect URL) to your public
HTTPS origin plus the callback path, for example
`https://taskrr.example.com/api/auth/oidc/callback`. It must match exactly what
is registered with your identity provider. See
[OIDC Single Sign-On](OIDC-Single-Sign-On).
