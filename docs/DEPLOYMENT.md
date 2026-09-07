# Deploying orca-web

orca-web is a static SPA plus a thin Node server. Nothing sensitive ever
transits it — the browser talks E2EE directly to your Orca runtime — so
deployment is simple but has one hard requirement: **the browser must reach
the Orca runtime's WebSocket endpoint.**

## Quick deploy (Docker)

```bash
docker run -d --name orca-web -p 3013:3000 ghcr.io/YOUR_USERNAME/orca-web:latest
```

Behind a reverse proxy, terminate TLS at the proxy:

```nginx
server {
  listen 443 ssl;
  server_name orca.example.com;

  location / {
    proxy_pass http://127.0.0.1:3013;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;   # not required for orca-web
    proxy_set_header Connection "upgrade";   # itself, but harmless
  }
}
```

> orca-web's own server never upgrades — WebSockets go browser → Orca host
> directly. Keep the headers if you also proxy the Orca runtime itself.

## Reaching the Orca runtime from user browsers

The common topologies:

1. **Same LAN / Tailscale (recommended).** Run `orca serve --port 6768
   --pairing-address <lan-or-tailscale-host>`. The pairing URL advertised
   to clients then works from any browser on that network.
2. **Public host via reverse proxy.** Put the runtime behind
   `wss://orca.example.com/runtime` (TLS at the proxy), and pass
   `--pairing-address https://orca.example.com/runtime` — Orca normalizes
   `http(s)` to `ws(s)`. The proxy must support WebSocket upgrades.
3. **Relay (beta).** Orca's cloud relay can pair clients without direct
   reachability; orca-web does not speak the relay protocol yet.

Constraints from the Orca runtime (they apply to any client):

- `--pairing-address` is only the *advertised* address; it does not change
  the bind. Wildcards (`0.0.0.0`, `*`, `::`) cannot be advertised.
- Reverse proxies must support WebSocket upgrade and route the advertised
  path; `ws://` through an HTTPS-only endpoint fails.
- Browsers on non-localhost origins need HTTPS for a secure context; mixed
  content (`https://` page dialing `ws://`) is blocked.

## Environment

The container needs no configuration. Optional runtime knobs:

| Variable | Default | Purpose |
|---|---|---|
| `NITRO_PORT` | `3000` | Server listen port |
| `NITRO_HOST` | `0.0.0.0` | Server listen address |

## Health checks

The server answers `GET /` with the SPA shell (200). There is no
runtime-aware healthcheck by design — orca-web's server has no dependency on
any Orca host.

## Upgrading

```bash
docker pull ghcr.io/YOUR_USERNAME/orca-web:latest
docker compose up -d   # or restart the container
```

Paired hosts live in each user's browser localStorage, so server upgrades
never lose pairings.
