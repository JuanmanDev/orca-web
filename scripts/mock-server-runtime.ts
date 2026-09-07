// Mock runtime RPC handlers — a faithful port of
// stablyai/orca mobile/scripts/mock-server-rpc-handlers.ts +
// mock-server-terminal-stream.ts, sharing orca-web's protocol types so the
// web client and mock server can never drift on the wire contract.
import type { WebSocket } from 'ws'
import {
  RUNTIME_PROTOCOL_VERSION,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  Rpc,
  type RpcRequest,
  type RpcResponse,
  type RpcSend,
  type RuntimeRepo,
  type RuntimeTerminal,
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

let fakeWorktrees: RuntimeWorktreePsSummary[] = createMockWorktrees(FAKE_REPOS, MOCK_WORKTREE_COUNT)

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

function createMockTerminals(worktreeId: string): RuntimeTerminal[] {
  return [
    {
      handle: 'term-1',
      worktreeId,
      title: 'Claude — auth refactor',
      isActive: true,
      hasRunningProcess: true,
    },
    {
      handle: 'term-2',
      worktreeId,
      title: 'zsh',
      isActive: false,
      hasRunningProcess: false,
    },
  ]
}

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
              ],
              graphStatus: 'ready',
              windowCount: 1,
              tabCount: 2,
              terminalCount: 2,
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
          const terminals = createMockTerminals(terminalListWorktreeId(request.params?.worktree) ?? '')
          respond(success(request.id, { terminals, totalCount: terminals.length, truncated: false }))
          break
        }

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
                serialized: FAKE_SCROLLBACK,
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

        case Rpc.terminalSend:
          // Input-routing repros assert on the exact bytes reaching the host.
          console.log(
            `[SEND] terminal=${String(request.params?.terminal)} text=${JSON.stringify(request.params?.text)}`,
          )
          respond(success(request.id, { send: { handle: 'term-1', ok: true } }))
          break

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
