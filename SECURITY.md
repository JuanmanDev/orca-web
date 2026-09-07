# Security Policy

## Supported versions

The latest `main` and the most recent release tag receive security fixes.

## Reporting a vulnerability

Please use GitHub's **private security advisory** feature on this repository
(Report a vulnerability → Security tab). Do not open a public issue.

You should receive a response within 72 hours.

## Scope

- orca-web application code (this repo): report here.
- Orca runtime, desktop app, or mobile app: report to upstream
  (stablyai/orca) — this repo cannot fix their release process.

## Invariants we hold

- Pairing credentials (device tokens, host public keys) exist only in the
  pairing user's browser localStorage. They must never be sent to the
  orca-web server, logged, or included in error telemetry.
- All runtime traffic is E2EE between browser and the Orca host
  (X25519 ECDH + XSalsa20-Poly1305 via the shared protocol library).
  Any change that weakens that must be rejected.
- A pairing URL is a capability. Treat it like a password.

These are enforced, not just documented:

- **CSP** — the served pages ship `default-src 'self'` with
  `connect-src 'self' ws: wss:`: the browser itself blocks any outbound
  HTTP request from orca-web code to any origin. Credentials can only
  travel over the E2EE WebSocket to the paired host. `form-action 'none'`
  and `Referrer-Policy: no-referrer` close the remaining leak paths.
- **Static guard** — `tests/credential-guard.test.ts` fails CI if client
  code ever adds `fetch`/`XMLHttpRequest`/`sendBeacon`/`EventSource`,
  constructs a WebSocket outside the runtime client, touches
  localStorage outside the hosts store, or hardcodes a third-party
  origin. New outbound channels must go through review by design.
- **Mock runtime binds loopback only** — the dev mock mints a known
  device token, so it listens on 127.0.0.1 unless `MOCK_HOST` explicitly
  overrides it.
