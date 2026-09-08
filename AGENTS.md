# AGENTS.md

Guidance for coding agents working in this repo.

## Commands

```bash
pnpm dev              # Nuxt dev server → http://localhost:3013 (LAN exposed)
pnpm dev:mock         # mock runtime :6768 + dev app :3013 (kills both on Ctrl+C)
pnpm mock-server      # mock runtime alone
pnpm lint             # eslint (must pass)
pnpm typecheck        # vue-tsc (must pass)
pnpm test             # vitest unit
pnpm test:e2e         # raw-socket protocol E2E vs the mock runtime
pnpm test:client-e2e  # real OrcaRuntimeClient vs the mock runtime
pnpm build            # production build
pnpm docker:build     # local docker image
```

**Never run `pnpm dev` bare in a shell you can't Ctrl+C.** For scripted
verification use `pnpm build` and start `.output/server/index.mjs` with an
explicit `NITRO_PORT` instead, or use `Start-Process`-style background
launches with recorded PIDs, and always kill them afterward.

## Architecture (read before changing)

- `shared/` is the wire contract with the Orca runtime, ported from
  stablyai/orca. It is imported by BOTH the browser client
  (`app/composables/runtime/`) and the mock runtime (`scripts/`). Changes
  here are protocol changes — mirror upstream, never invent. Additive
  methods (terminal.create/resize/close/listProfiles, accounts.get,
  system.getMetrics) are capability-gated on the client and degrade
  gracefully (method_not_found → feature hidden).
- `scripts/mock-server-runtime.ts` is a faithful port of upstream's mobile
  mock server plus the additive surfaces; when adding RPC surface, add it
  here and in `shared/protocol.ts` together, plus a test in `tests/` and
  coverage in `tests/client-e2e.ts`.
- `app/composables/runtime/client.ts` is the ported transport
  (direct-rpc-client.ts upstream). One client per host; the Pinia store
  `app/stores/hosts.ts` owns lifecycles. `app/stores/theme.ts` holds UI
  preferences only (never credentials — guard-tested).
- Pages are client-only (SPA). No host data is ever available server-side.
- Terminal states: `processing | asking | running | idle`
  (TerminalActivityIcon maps them to badges like Orca desktop).
- Theme accent swaps override `--ui-primary` on `<html>` — do NOT use
  dynamic Tailwind classes (`bg-${color}-500`); they get purged. Use static
  classes or inline styles.

## Conventions

- Port notes at the top of a file (`// … ported from …`) are load-bearing
  documentation — keep them accurate.
- Code comments explain WHY (usually a protocol or upstream-behavior
  reason), never WHAT. Upstream convention, kept deliberately.
- No emoji in code. `Omit<>` spread instead of `delete` for reactive Pinia
  state (see `omitKey` in the hosts store).
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.

## Protocol rules (from upstream)

- `RUNTIME_PROTOCOL_VERSION` bumps ONLY on breaking wire changes (removed
  method/param, changed field meaning, changed framing/auth). Never for
  additive changes.
- Terminal streams: a `scrollback` frame first (client resubscribes on
  viewport change), then `data` frames. No `end` event on live terminals —
  `end` tears the client's subscription down.
- `id:` selectors: worktree selectors may be `id:<worktreeId>` or the bare
  id; strip the prefix before comparing.
- `terminal.create` is idempotent via `clientMutationId` — replaying a
  lost reply must return the same handle, never duplicate panes.

## Security invariants

- Never log device tokens, pairing codes, or key material.
- Never send localStorage contents anywhere except the paired host itself
  (E2EE channel).

## CI gates

`.github/workflows/ci.yml` runs lint → typecheck → unit tests → mock smoke →
build → docker build/smoke. All must pass. Release workflow publishes to
GHCR on `v*.*.*` tags.
