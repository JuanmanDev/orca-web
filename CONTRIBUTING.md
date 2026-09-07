# Contributing to orca-web

Thanks for helping! Before opening a PR:

## Setup

```bash
corepack enable
pnpm install
```

## The rules

1. **Every PR must keep CI green** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`.
2. **The wire contract is shared.** Anything that changes `shared/` must be mirrored by the mock runtime in `scripts/mock-server-runtime.ts` and covered by a test in `tests/`. Client and mock must never drift.
3. **Follow upstream naming.** RPC methods, event shapes, and protocol-version rules mirror `stablyai/orca` (see `mobile/src/transport` and `src/shared/protocol-version.ts`). Additive changes only, unless you also add a compat gate.
4. **No comments unless they explain a *why*** (upstream convention, kept here on purpose — most files carry a port note at the top).
5. **Security**: never log device tokens, pairing codes, or derived keys. A pairing offer is a capability.

## Conventional commits

`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:` — see existing history.

## Releasing

Maintainers: tag `v*.*.*` on `main`. CI re-verifies, then publishes the Docker image to GHCR. Nothing else to do.

## Testing tiers

| Tier | Command | What it proves |
|---|---|---|
| Unit | `pnpm test` | pairing codec, E2EE framing round-trips, protocol window |
| Protocol E2E | `pnpm test:e2e` | raw socket: handshake → auth → RPC → terminal stream |
| Client E2E | `pnpm test:client-e2e` | the real `OrcaRuntimeClient` class end-to-end |
| Container | CI docker job | built image serves HTTP 200 |

When your change touches the terminal flow, also run the app against the mock:

```bash
pnpm dev:mock   # then pair with the printed URL and open a session
```
