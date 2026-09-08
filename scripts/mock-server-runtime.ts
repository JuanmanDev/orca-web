// Mock runtime RPC handlers — a faithful port of
// stablyai/orca mobile/scripts/mock-server-rpc-handlers.ts +
// mock-server-terminal-stream.ts, sharing orca-web's protocol types so the
// web client and mock server can never drift on the wire contract.
// Extended with the terminal-registry/profiles/accounts/metrics surfaces
// orca-web needs (all additive to the upstream contract).
import type { WebSocket } from 'ws'
import os from 'node:os'
import {
  RUNTIME_PROTOCOL_VERSION,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  Rpc,
  type RpcRequest,
  type RpcResponse,
  type RpcSend,
  type RuntimeRepo,
  type RuntimeTerminal,
  type RuntimeTerminalSummary,
  type TerminalActivityState,
  type TerminalProfile,
  type RuntimeWorktreePsSummary,
} from '../shared/protocol'
import { readScenarioNumber } from './mock-server-scenario'

const MOCK_REPO_COUNT = readScenarioNumber('MOCK_REPO_COUNT', 2)
const MOCK_WORKTREE_COUNT = readScenarioNumber('MOCK_WORKTREE_COUNT', 3)
const MOCK_RPC_DELAY_MS = readScenarioNumber('MOCK_RPC_DELAY_MS', 0)

const REPO_COLORS = ['#f97316', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b', '#6366f1']
const REPO_NAMES = ['orca', 'dashboard', 'mobile', 'runtime', 'docs', 'api', 'desktop', 'site']
const WORKTREE_NAMES = ['manta', 'narwhal', 'otter', 'squid', 'turtle', 'beluga', 'marlin', 'orca']

const FAKE_REPOS: RuntimeRepo[] = Array.from({ length: MOCK_REPO_COUNT }, (_, index) => {
  const repoName = REPO_NAMES[index % REPO_NAMES.length]!
  const suffix = index < REPO_NAMES.length ? '' : `-${Math.floor(index / REPO_NAMES.length) + 1}`
  const displayName = `${repoName}${suffix}`
  return {
    id: `repo-${index + 1}`,
    displayName,
    path: `/tmp/orca-mobile-repro/${displayName}`,
    badgeColor: REPO_COLORS[index % REPO_COLORS.length]!,
    connectionId: null,
  }
})

function createMockWorktrees(
  repos: readonly RuntimeRepo[],
  count: number,
  now = Date.now(),
): RuntimeWorktreePsSummary[] {
  if (repos.length === 0) {
    return []
  }

  return Array.from({ length: count }, (_, index) => {
    const repo = repos[index % repos.length]!
    const name = `${WORKTREE_NAMES[index % WORKTREE_NAMES.length]}-${index + 1}`
    const status = index % 17 === 0 ? 'working' : index % 11 === 0 ? 'done' : 'active'
    const agents =
      index % 4 === 0
        ? [
            {
              paneKey: `agent-${index}`,
              parentPaneKey: null,
              state: index % 12 === 0 ? 'waiting' : 'working',
              agentType: index % 3 === 0 ? 'claude' : 'codex',
              prompt: `Investigate mobile lag scenario ${index + 1}`,
              taskTitle: `Investigate mobile lag scenario ${index + 1}`,
              displayName: `Mobile lag ${index + 1}`,
              lastAssistantMessage: index % 6 === 0 ? 'Running focused checks' : null,
              toolName: null,
              toolInput: null,
              interrupted: false,
              stateStartedAt: now - index * 17_000,
              updatedAt: now - index * 11_000,
            },
          ]
        : []

    return {
      worktreeId: `${repo.id}::${repo.path}/worktrees/${name}`,
      repoId: repo.id,
      repo: repo.displayName,
      path: `${repo.path}/worktrees/${name}`,
      branch: index % 6 === 0 ? 'main' : `feature/mobile-lag-${index + 1}`,
      isArchived: false,
      isMainWorktree: false,
      hasHostSidebarActivity: index % 5 !== 0,
      parentWorktreeId: null,
      childWorktreeIds: [],
      displayName: name,
      workspaceStatus: index % 9 === 0 ? 'in-review' : 'in-progress',
      sortOrder: now - index * 1000,
      linkedIssue: index % 7 === 0 ? 200 + index : null,
      linkedPR:
        index % 9 === 0 ? { number: 1000 + index, state: index % 18 === 0 ? 'draft' : 'open' } : null,
      linkedLinearIssue: index % 13 === 0 ? `ORC-${index + 1}` : null,
      linkedGitLabMR: null,
      linkedGitLabIssue: null,
      comment: index % 10 === 0 ? `Mock workspace note ${index + 1}` : '',
      isPinned: index % 19 === 0,
      isActive: index === 0,
      unread: index % 8 === 0,
      liveTerminalCount: index % 5 === 0 ? 0 : 1 + (index % 3),
      hasAttachedPty: index % 5 !== 0,
      lastOutputAt: now - index * 23_000,
      preview: `$ pnpm test --filter mobile-${index + 1}`,
      status,
      agents,
    }
  })
}

let fakeWorktrees: RuntimeWorktreePsSummary[] = createMockWorktrees(FAKE_REPOS, MOCK_WORKTREE_COUNT)

// Enrich each worktree row with its terminal summaries after seeding.
function attachTerminalSummaries(): void {
  fakeWorktrees = fakeWorktrees.map((w) => ({
    ...w,
    terminals: worktreeTerminalSummaries(w.worktreeId),
  }))
}

export const defaultMockScenario = {
  repoCount: FAKE_REPOS.length,
  worktreeCount: fakeWorktrees.length,
  rpcDelayMs: MOCK_RPC_DELAY_MS,
}

export type MockScenario = typeof defaultMockScenario

const FAKE_SCROLLBACK = [
  '$ claude "refactor the auth module to use JWT tokens"',
  '',
  '⏳ Working on it...',
  '',
  "I'll refactor the auth module. Here's my plan:",
  '1. Replace session-based auth with JWT',
  '2. Add token refresh endpoint',
  '3. Update middleware',
  '',
  'Let me start by reading the current auth module...',
  '',
]
  .join('\n')
  .replace(/\n/g, '\r\n')

const STREAMING_CHUNKS = [
  'Reading src/auth/middleware.ts...\r\n',
  'Reading src/auth/session.ts...\r\n',
  '\r\nI see the current implementation uses express-session.\r\n',
  "I'll replace it with jsonwebtoken.\r\n",
  '\r\nUpdating src/auth/middleware.ts...\r\n',
]

// ---------------------------------------------------------------------------
// Terminal registry — per-worktree live terminals with activity states,
// mirroring how the desktop session view badges each PTY.
// ---------------------------------------------------------------------------

type MockTerminal = {
  handle: string
  worktreeId: string
  title: string
  agentType: string | null
  activity: TerminalActivityState
  hasRunningProcess: boolean
  profileId: string
  createdAt: number
  updatedAt: number
}

const TERMINAL_PROFILES: TerminalProfile[] = [
  { id: 'powershell', label: 'PowerShell', icon: 'i-simple-icons-powershell', kind: 'shell', command: 'pwsh' },
  { id: 'gitbash', label: 'Git Bash', icon: 'i-simple-icons-git', kind: 'shell', command: 'bash' },
  { id: 'zsh', label: 'zsh', icon: 'i-lucide-terminal', kind: 'shell', command: 'zsh' },
  { id: 'claude', label: 'Claude Code', icon: 'i-simple-icons-anthropic', kind: 'agent', command: 'claude' },
  { id: 'codex', label: 'Codex', icon: 'i-simple-icons-openai', kind: 'agent', command: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', icon: 'i-simple-icons-google-gemini', kind: 'agent', command: 'gemini' },
  { id: 'antigravity', label: 'Antigravity', icon: 'i-lucide-rocket', kind: 'agent', command: 'antigravity' },
  { id: 'opencode', label: 'OpenCode', icon: 'i-lucide-code', kind: 'agent', command: 'opencode' },
]

function seedTerminals(): MockTerminal[] {
  const out: MockTerminal[] = []
  const now = Date.now()
  fakeWorktrees.forEach((worktree, wi) => {
    out.push({
      handle: `wt${wi}-claude`,
      worktreeId: worktree.worktreeId,
      title: 'Claude — auth refactor',
      agentType: 'claude',
      activity: wi % 3 === 0 ? 'asking' : 'processing',
      hasRunningProcess: true,
      profileId: 'claude',
      createdAt: now - 60_000,
      updatedAt: now - wi * 5_000,
    })
    out.push({
      handle: `wt${wi}-shell`,
      worktreeId: worktree.worktreeId,
      title: 'PowerShell',
      agentType: null,
      activity: 'running',
      hasRunningProcess: wi % 2 === 0,
      profileId: 'powershell',
      createdAt: now - 120_000,
      updatedAt: now - wi * 3_000,
    })
  })
  return out
}

// Registry keyed by handle; seeded per worktree so terminal.list and the
// worktree terminal summaries stay consistent.
let terminalRegistry: MockTerminal[] = seedTerminals()
// Derive worktree terminal summaries now that the registry is seeded.
attachTerminalSummaries()
let terminalSeq = 0

function terminalsFor(worktreeId: string): MockTerminal[] {
  return terminalRegistry.filter((t) => t.worktreeId === worktreeId)
}

function toRuntimeTerminal(t: MockTerminal): RuntimeTerminal {
  return {
    handle: t.handle,
    worktreeId: t.worktreeId,
    title: t.title,
    isActive: t.activity !== 'idle',
    hasRunningProcess: t.hasRunningProcess,
  }
}

function toTerminalSummary(t: MockTerminal): RuntimeTerminalSummary {
  return {
    handle: t.handle,
    title: t.title,
    agentType: t.agentType,
    activity: t.activity,
    hasRunningProcess: t.hasRunningProcess,
    updatedAt: t.updatedAt,
  }
}

// Accounts + metrics drift slightly per poll so the bottom bar feels alive.
function mockAccounts(now: number) {
  const cycle = Math.floor(now / 30_000)
  const claudeLimited = cycle % 4 === 3
  const codexLow = cycle % 3 === 0
  return [
    {
      provider: 'claude',
      accountLabel: 'Pro (juanman@…)',
      rateLimitReset: claudeLimited ? 'resets in 1h 12m' : codexLow ? 'resets in 20m' : '5h 20m left',
      usage: claudeLimited ? '71% weekly cap' : '42% weekly cap',
      limitedUntil: claudeLimited ? 'rate limited' : null,
    },
    {
      provider: 'codex',
      accountLabel: 'Plus (juanman@…)',
      rateLimitReset: codexLow ? 'resets in 8m' : 'resets in 4h',
      usage: codexLow ? '91% daily cap' : '63% daily cap',
      limitedUntil: null,
    },
  ]
}

function mockSystemMetrics() {
  const load = os.loadavg()[0] ?? 0.6
  const cpuPercent = Math.min(100, Math.round((load / (os.cpus().length || 1)) * 100 + (Math.random() * 8 - 4)))
  const totalMb = Math.round(os.totalmem() / 1024 / 1024)
  const usedMb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024)
  return {
    cpuPercent: Math.max(0, cpuPercent),
    memoryPercent: Math.round((usedMb / totalMb) * 100),
    memoryUsedMb: usedMb,
    memoryTotalMb: totalMb,
    activeAgents: terminalRegistry.filter((t) => t.agentType && t.activity !== 'idle').length,
    runningProcesses: terminalRegistry.filter((t) => t.hasRunningProcess).length,
    terminalCount: terminalRegistry.length,
  }
}

function responseDelayFor(method: string): number {
  const methodOverride =
    process.env[`MOCK_RPC_DELAY_${method.replace(/\W/g, '_').toUpperCase()}_MS`]
  if (!methodOverride) {
    return MOCK_RPC_DELAY_MS
  }
  const parsed = Number(methodOverride)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : MOCK_RPC_DELAY_MS
}

function terminalListWorktreeId(worktreeSelector: unknown): string | undefined {
  if (typeof worktreeSelector === 'string' && worktreeSelector.length > 0) {
    return worktreeSelector.startsWith('id:') ? worktreeSelector.slice(3) : worktreeSelector
  }
  return fakeWorktrees.find((worktree) => worktree.isActive)?.worktreeId
}

function success(id: string, result: unknown, streaming?: boolean): RpcResponse {
  const resp: RpcResponse = { id, ok: true, result, _meta: { runtimeId: 'mock-runtime' } }
  if (streaming) {
    resp.streaming = true
  }
  return resp
}

function error(id: string, code: string, message: string): RpcResponse {
  return { id, ok: false, error: { code, message }, _meta: { runtimeId: 'mock-runtime' } }
}

// The client resubscribes on every viewport change; without cancellation each
// resubscribe would stack another interval streaming under a dead request.
type TerminalStream = { interval: ReturnType<typeof setInterval> | null }
const terminalStreams = new WeakMap<WebSocket, Map<string, TerminalStream>>()

function clearTerminalStream(ws: WebSocket, terminal: string): void {
  const perTerminal = terminalStreams.get(ws)
  const stream = perTerminal?.get(terminal)
  if (stream) {
    stopTerminalStreamInterval(stream)
    perTerminal?.delete(terminal)
  }
}

function beginTerminalStream(ws: WebSocket, terminal: string): TerminalStream {
  clearTerminalStream(ws, terminal)
  let perTerminal = terminalStreams.get(ws)
  if (!perTerminal) {
    perTerminal = new Map()
    terminalStreams.set(ws, perTerminal)
  }
  const stream = { interval: null }
  perTerminal.set(terminal, stream)
  return stream
}

function isCurrentTerminalStream(ws: WebSocket, terminal: string, stream: TerminalStream): boolean {
  return terminalStreams.get(ws)?.get(terminal) === stream && ws.readyState === ws.OPEN
}

function stopTerminalStreamInterval(stream: TerminalStream): void {
  if (stream.interval !== null) {
    clearInterval(stream.interval)
    stream.interval = null
  }
}

export function createMockRuntimeHandlers() {
  return {
    onClose(ws: WebSocket) {
      for (const terminal of terminalStreams.get(ws)?.keys() ?? []) {
        clearTerminalStream(ws, terminal)
      }
    },

    handleRequest(request: RpcRequest, send: RpcSend, ws: WebSocket): void {
      const respond = (response: RpcResponse, shouldSend?: () => boolean) => {
        const deliver = () => {
          if (shouldSend?.() !== false) {
            send(response)
          }
        }
        const delay = responseDelayFor(request.method)
        if (delay > 0) {
          setTimeout(deliver, delay)
          return
        }
        deliver()
      }

      switch (request.method) {
        case Rpc.statusGet:
          respond(
            success(request.id, {
              runtimeId: 'mock-runtime',
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              minCompatibleMobileVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
              capabilities: [
                'accounts.codex-reset-credit.v1',
                'terminal.binary-stream.v1',
                'terminal.multiplex.v1',
                'mobile.tasks.v1',
                'terminal.profiles.v1',
                'accounts.get.v1',
                'system.metrics.v1',
              ],
              graphStatus: 'ready',
              windowCount: 1,
              tabCount: fakeWorktrees.length,
              terminalCount: terminalRegistry.length,
            }),
          )
          break

        case Rpc.worktreePs:
          respond(
            success(request.id, {
              worktrees: fakeWorktrees,
              totalCount: fakeWorktrees.length,
              truncated: false,
            }),
          )
          break

        case Rpc.repoList:
          respond(success(request.id, { repos: FAKE_REPOS }))
          break

        case Rpc.worktreeActivate: {
          const selector = String(request.params?.worktree ?? '')
          const id = selector.startsWith('id:') ? selector.slice(3) : selector
          fakeWorktrees = fakeWorktrees.map((w) => ({ ...w, isActive: w.worktreeId === id }))
          respond(success(request.id, { ok: true }))
          break
        }

        case Rpc.terminalList: {
          const worktreeId = terminalListWorktreeId(request.params?.worktree) ?? ''
          const terminals = terminalsFor(worktreeId).map(toRuntimeTerminal)
          respond(success(request.id, { terminals, totalCount: terminals.length, truncated: false }))
          break
        }

        case Rpc.terminalListProfiles:
          respond(success(request.id, { profiles: TERMINAL_PROFILES }))
          break

        case Rpc.terminalCreate: {
          // Mirrors upstream's idempotent create: the client may replay after
          // a lost reply; a repeated clientMutationId returns the same handle.
          const worktreeId = terminalListWorktreeId(request.params?.worktree) ?? ''
          const profileId = String(request.params?.profileId ?? 'zsh')
          const profile = TERMINAL_PROFILES.find((p) => p.id === profileId)
          if (!profile) {
            respond(error(request.id, 'invalid_argument', `Unknown terminal profile: ${profileId}`))
            break
          }
          const mutationId = typeof request.params?.clientMutationId === 'string'
            ? request.params.clientMutationId
            : null
          const existing = mutationId
            ? terminalRegistry.find((t) => t.title === `created:${mutationId}`)
            : undefined
          if (existing) {
            respond(success(request.id, { handle: existing.handle, reused: true }))
            break
          }
          const handle = `wt-term-${++terminalSeq}`
          const now = Date.now()
          const created: MockTerminal = {
            handle,
            worktreeId,
            title: profile.label,
            agentType: profile.kind === 'agent' ? profileId : null,
            activity: profile.kind === 'agent' ? 'processing' : 'idle',
            hasRunningProcess: profile.kind === 'agent',
            profileId,
            createdAt: now,
            updatedAt: now,
          }
          if (mutationId) {
            created.title = `created:${mutationId}`
          }
          terminalRegistry = [created, ...terminalRegistry]
          attachTerminalSummaries()
          respond(success(request.id, { handle, terminal: toTerminalSummary(created) }))
          break
        }

        case Rpc.terminalClose: {
          const handle = String(request.params?.terminal ?? '')
          const before = terminalRegistry.length
          terminalRegistry = terminalRegistry.filter((t) => t.handle !== handle)
          attachTerminalSummaries()
          respond(success(request.id, { ok: before !== terminalRegistry.length }))
          break
        }

        case Rpc.terminalResize:
          // The mock accepts any resize; a real host resizes its PTY.
          respond(success(request.id, { ok: true }))
          break

        case Rpc.accountsGet:
          respond(success(request.id, { accounts: mockAccounts(Date.now()) }))
          break

        case Rpc.systemGetMetrics:
          respond(success(request.id, mockSystemMetrics()))
          break

        case Rpc.terminalSubscribe: {
          const terminal = String(request.params?.terminal ?? 'term-1')
          const stream = beginTerminalStream(ws, terminal)
          const isCurrent = () => isCurrentTerminalStream(ws, terminal, stream)
          // The client resubscribes until scrollback echoes its viewport dims;
          // the legacy `lines` shape left the session screen in that loop forever.
          const viewport = request.params?.viewport as { cols?: number; rows?: number } | undefined
          respond(
            success(
              request.id,
              {
                type: 'scrollback',
                cols: viewport?.cols ?? 80,
                rows: viewport?.rows ?? 24,
                serialized: scrollbackFor(terminal),
                truncated: false,
              },
              isCurrent,
            ),
          )

          let chunkIndex = 0
          stream.interval = setInterval(() => {
            if (!isCurrent()) {
              stopTerminalStreamInterval(stream)
              return
            }
            if (chunkIndex >= STREAMING_CHUNKS.length) {
              // No `end` event — a live terminal stream stays open, and `end`
              // makes the client tear the subscription down and blank the pane.
              stopTerminalStreamInterval(stream)
              return
            }
            respond(success(request.id, { type: 'data', chunk: STREAMING_CHUNKS[chunkIndex] }, true), isCurrent)
            chunkIndex++
          }, 500)
          break
        }

        case Rpc.terminalSend: {
          // Input-routing repros assert on the exact bytes reaching the host.
          const handle = String(request.params?.terminal)
          const text = String(request.params?.text ?? '')
          console.log(`[SEND] terminal=${handle} text=${JSON.stringify(text)}`)
          // A typed line flips a shell terminal to running; Enter marks it idle.
          const target = terminalRegistry.find((t) => t.handle === handle)
          if (target && !target.agentType) {
            target.hasRunningProcess = !text.endsWith('\r') && !text.endsWith('\n')
            target.activity = target.hasRunningProcess ? 'running' : 'idle'
            target.updatedAt = Date.now()
          }
          respond(success(request.id, { send: { handle, ok: true } }))
          break
        }

        case Rpc.terminalUnsubscribe:
          clearTerminalStream(ws, String(request.params?.terminal ?? 'term-1'))
          respond(success(request.id, { unsubscribed: true }))
          break

        case 'settings.get':
          respond(
            success(request.id, {
              settings: { defaultTuiAgent: 'codex', disabledTuiAgents: [], agentCmdOverrides: {} },
            }),
          )
          break

        case 'ui.get':
          respond(
            success(request.id, {
              ui: {
                groupBy: 'repo',
                sortBy: 'recent',
                hideSleepingWorkspaces: false,
                hideDefaultBranchWorkspace: false,
                filterRepoIds: [],
                collapsedGroups: [],
                trustedOrcaHooks: {},
              },
            }),
          )
          break

        case 'preflight.detectAgents':
        case 'preflight.detectRemoteAgents':
          respond(success(request.id, ['claude', 'codex', 'gemini']))
          break

        default:
          respond(error(request.id, 'method_not_found', `Unknown method: ${request.method}`))
      }
    },
  }
}

// Scrollback echoes the terminal's own title so each tab streams its own pane.
function scrollbackFor(handle: string): string {
  const term = terminalRegistry.find((t) => t.handle === handle)
  if (!term) {
    return FAKE_SCROLLBACK
  }
  const header = `\x1b[1m${term.title}\x1b[0m\r\n${term.agentType ? `$ ${term.profileId}\r\n` : ''}`
  return header + FAKE_SCROLLBACK
}

// Worktree summaries are derived, not stored — keeps list + detail coherent.
export function worktreeTerminalSummaries(worktreeId: string): RuntimeTerminalSummary[] {
  return terminalsFor(worktreeId).map(toTerminalSummary)
}

export { TERMINAL_PROFILES }
