<div align="center">

<img src="public/favicon.svg" width="96" height="96" alt="orca-web logo" />

# orca-web

**Self-hosted web client for the [Orca](https://github.com/stablyai/orca) agent runtime.**
Monitor and steer your fleet of parallel coding agents from any browser — no desktop app required.

[![License: MIT](https://img.shields.io/badge/license-MIT-08C.svg?style=flat)](./LICENSE)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](./.github/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](#-docker)

A community companion for [Orca — the ADE for working with a fleet of parallel agents](https://onOrca.dev), speaking the same encrypted protocol as the official mobile app.

</div>

---

## Why

Orca ships desktop and mobile companions, but teams often want a **zero-install, self-hostable web view**: pinned on a wall dashboard, opened on a locked-down machine, or served from the same box that runs `orca serve`. orca-web is exactly that — it connects straight to your Orca runtime over the same E2EE WebSocket the mobile app uses, and stores nothing server-side.

| | orca-web | Orca desktop | Orca mobile |
|---|---|---|---|
| Install | none (browser) | desktop app | store/TestFlight |
| Hosting | your infra (Docker) | — | — |
| Credentials stored | your browser only | app profile | app profile |
| Transport | E2EE WebSocket (same wire protocol) | local | E2EE (direct or relay) |

> **Not affiliated** with Stably AI. Orca is a trademark of its owners. This project only speaks its public runtime protocol.

## Features

- 🔐 **Native pairing** — paste the `orca://pair?code=…` URL from Settings → Mobile (desktop) or from `orca serve` startup output; orca-web performs the same Curve25519 ECDH + XSalsa20-Poly1305 handshake as the mobile app. Your device token never leaves your browser.
- 🗂 **Worktree fleet dashboard** — all worktrees across your repos, grouped by repo with agent status, live terminal counts, linked PRs/Linear issues, unread state, and 5s auto-refresh.
- 🖥 **Live terminal viewer** — xterm.js rendering of `terminal.subscribe` scrollback + stream, with keyboard input forwarded to the host PTY via `terminal.send`.
- 🧭 **Protocol-safe** — version negotiation (`status.get` + compat window) hard-blocks instead of silently misbehaving, mirroring upstream's compatibility rules.
- 🎭 **Bundled mock runtime** — a faithful port of upstream's mobile mock server, so you can develop and demo without a paired Orca host.
- 🐳 **One-command deploy** — multi-stage Docker image, published to GHCR by CI on every tag.

## Quick start

### Use the released image

```bash
docker run -d --name orca-web -p 3013:3000 ghcr.io/JuanmanDev/orca-web:latest
# open http://localhost:3013
```

Or with docker compose:

```bash
curl -O https://raw.githubusercontent.com/JuanmanDev/orca-web/main/docker-compose.yml
docker compose up -d
```

### Develop locally

Requirements: Node 20.19+ (22 recommended), pnpm 10+ (`corepack enable`).

```bash
pnpm install
pnpm dev            # app on http://localhost:3013 (LAN: 0.0.0.0 exposed)
```

With the bundled mock runtime (recommended first run):

```bash
pnpm dev:mock       # mock Orca runtime on :6768 + app on :3013
```

The mock prints a ready-made pairing URL — open the app, paste it on the Connect page, and you have a full demo: 2 repos, N worktrees, a streaming agent terminal.

**Connect to real Orca:**

1. Start Orca desktop (WebSocket transport is on `:6768`) or a headless `orca serve --port 6768 --pairing-address <host>`.
2. Copy the pairing code — desktop: Settings → Mobile; headless: the `Pairing URL:` line in startup output.
3. Open orca-web → **Add host** → paste → **Pair and connect**.

For remote/HTTPS deployments see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## How it works

```
┌────────────┐  orca://pair?code=…   ┌──────────────────┐
│ Orca host  │◄──────────────────────│     orca-web      │
│ (desktop / │   E2EE WebSocket      │  static SPA +     │
│  serve)    │   ws(s)://host:6768   │  thin Node server │
└────────────┘                       └────────┬─────────┘
                                     localStorage holds
                                     host list + device token
                                     (never sent anywhere else)
```

1. **Pair** — the QR/paste code is a capability: runtime endpoint + device token + host Curve25519 public key. orca-web decodes it, pins the key, and stores the host in your browser's localStorage only.
2. **Connect** — browser dials the runtime, sends `e2ee_hello` (plaintext X25519 public key), derives the shared key, authenticates with `e2ee_auth`, and negotiates protocol versions via `status.get`.
3. **Use** — `worktree.ps` / `repo.list` render the dashboard; `terminal.subscribe` streams into xterm.js; keystrokes go back through `terminal.send`.

The full wire contract — E2EE framing, RPC shapes, protocol compat window — is shared code between the client and the bundled mock runtime ([shared/](shared/)), so they can never drift.

## Project layout

```
app/                     Nuxt 4 app (Nuxt UI v4)
├── components/         cards, badges
├── composables/runtime/ OrcaRuntimeClient — the ported transport
├── layouts/, pages/    dashboard, connect, session
└── stores/hosts.ts      paired-host catalog (localStorage)
shared/                  wire contract shared by client + mock
├── protocol.ts          RPC names/shapes, version window
├── e2ee.ts              X25519 + XSalsa20-Poly1305 framing
└── pairing.ts           orca://pair?code= codec
scripts/
├── mock-server.ts       mock runtime (port 6768)
└── mock-server-runtime.ts RPC handlers + terminal fixtures
tests/                   unit + protocol E2E + client E2E
docs/                    deployment guide
.github/workflows/       CI (verify) + release (GHCR)
```

## Docker & CI/CD

- **CI** ([ci.yml](.github/workflows/ci.yml)): lint → typecheck → unit tests → protocol E2E → build → Docker build + container smoke test on every push/PR.
- **Release** ([release.yml](.github/workflows/release.yml)): on a `v*.*.*` tag, re-runs CI then builds and pushes the multi-cached image to `ghcr.io/<owner>/<repo>` with semver tags + `latest`. No extra secrets needed — `GITHUB_TOKEN` is all it takes.

Releasing is:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Verification

```bash
pnpm lint          # eslint
pnpm typecheck     # vue-tsc via nuxt
pnpm test          # unit: pairing codec, e2ee framing, protocol window
pnpm test:e2e      # raw-socket protocol E2E against the mock runtime
pnpm test:client-e2e # the REAL OrcaRuntimeClient class against the mock runtime
pnpm build         # production build
```

## Security

- Pairing credentials (device tokens, host keys) live **only** in your browser's localStorage; the orca-web server proxies nothing and logs nothing about them.
- All runtime traffic is end-to-end encrypted between your browser and your Orca host — orca-web's server never sees it.
- Serve over HTTPS in production (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)); browsers require a secure context for some APIs on non-localhost origins.
- A pairing code is a **capability**. Share it only with the client you intend to pair, and never paste it in proxy access logs.
- Report vulnerabilities in the orca-web codebase via a GitHub security advisory. Orca host vulnerabilities go to upstream.

## Roadmap

- [ ] Structured agent sessions (agentSession.*) — journal-backed chat transcripts
- [ ] Native chat — prompts + follow-ups without a PTY
- [ ] GitHub/Linear linked-item drilldowns
- [ ] Multi-host simultaneous dashboard
- [ ] Terminal resize (needs upstream terminal.resize capability)

## Contributing

PRs welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first. The repo follows conventional commits and requires green CI (lint, typecheck, tests, protocol E2E) on every change.

## 💖 Support this project

If you found this project helpful, please consider supporting it!

[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-JuanmanDev-ea4aaa?style=for-the-badge&logo=github)](https://github.com/sponsors/JuanmanDev) [![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/juanmandev) [![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/juanmandev)

## Acknowledgements

- [Stably AI](https://stably.ai) and every [orca contributor](https://github.com/stablyai/orca/graphs/contributors) — the runtime, the protocol, and the mobile app that made this possible.
- This project is a thin, admiring client over their work.

## License

[MIT](LICENSE) © orca-web contributors. Not affiliated with Stably AI.
