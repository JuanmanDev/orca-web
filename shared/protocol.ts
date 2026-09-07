// Orca runtime wire contract — mirrored from stablyai/orca
// (mobile/src/transport + src/shared/protocol-version.ts).
//
// Desktop, headless `orca serve`, and every client (mobile app, CLI, web)
// negotiate this protocol range before runtime RPCs are allowed.
// Bump RUNTIME_PROTOCOL_VERSION when: an RPC method or required parameter is
// removed; the meaning of an existing field changes; encrypted framing,
// terminal stream framing, or auth changes. Do NOT bump for additive changes
// (new methods, new optional fields, new ignorable event types).
export const RUNTIME_PROTOCOL_VERSION = 3
export const MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION = 2
export const MIN_COMPATIBLE_RUNTIME_SERVER_VERSION = 2

export type RpcRequest = {
  id: string
  method: string
  deviceToken?: string
  params?: Record<string, unknown>
}

export type RpcResponse = {
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
  /** Present (and true) when more frames for this request id will follow. */
  streaming?: true
  _meta?: { runtimeId: string }
}

export type RpcSend = (response: RpcResponse) => void

export type ProtocolVerdict =
  | { kind: 'ok' }
  | { kind: 'blocked'; reason: 'client-too-old' | 'server-too-old' }

/**
 * Evaluate protocol compatibility the same way the mobile app does: a verdict
 * is blocked only when one side falls below the other's declared minimum.
 */
export function evaluateProtocolCompat(input: {
  serverProtocolVersion: number
  minCompatibleClientVersion: number
  clientProtocolVersion: number
  minCompatibleServerVersion: number
}): ProtocolVerdict {
  if (input.serverProtocolVersion < input.minCompatibleClientVersion) {
    // Server is older than this client can talk to.
    if (input.serverProtocolVersion < input.clientProtocolVersion) {
      return { kind: 'blocked', reason: 'server-too-old' }
    }
  }
  if (input.clientProtocolVersion < input.minCompatibleServerVersion) {
    return { kind: 'blocked', reason: 'client-too-old' }
  }
  return { kind: 'ok' }
}

// ---------------------------------------------------------------------------
// Runtime data shapes (subset consumed by orca-web)
// ---------------------------------------------------------------------------

export type RuntimeRepo = {
  id: string
  displayName: string
  path: string
  badgeColor: string
  connectionId: string | null
}

export type RuntimeWorktreeAgentRow = {
  paneKey: string
  parentPaneKey: string | null
  state: 'working' | 'waiting' | 'done' | string
  agentType: string
  prompt: string | null
  taskTitle: string | null
  displayName: string | null
  lastAssistantMessage: string | null
  toolName: string | null
  toolInput: string | null
  interrupted: boolean
  stateStartedAt: number | null
  updatedAt: number | null
}

export type RuntimeWorktreePsSummary = {
  worktreeId: string
  repoId: string
  repo: string
  path: string
  branch: string
  isArchived: boolean
  isMainWorktree: boolean
  hasHostSidebarActivity: boolean
  parentWorktreeId: string | null
  childWorktreeIds: string[]
  displayName: string
  workspaceStatus: string
  sortOrder: number
  linkedIssue: number | null
  linkedPR: { number: number; state: string } | null
  linkedLinearIssue: string | null
  linkedGitLabMR: number | null
  linkedGitLabIssue: number | null
  comment: string
  isPinned: boolean
  isActive: boolean
  unread: boolean
  liveTerminalCount: number
  hasAttachedPty: boolean
  lastOutputAt: number | null
  preview: string | null
  status: 'active' | 'working' | 'done' | string
  agents: RuntimeWorktreeAgentRow[]
}

export type RuntimeTerminal = {
  handle: string
  worktreeId: string
  title: string
  isActive: boolean
  hasRunningProcess: boolean
}

export type RuntimeStatus = {
  runtimeId: string
  protocolVersion: number
  minCompatibleMobileVersion: number
  capabilities: string[]
  graphStatus: string
  windowCount: number
  tabCount: number
  terminalCount: number
}

export type TerminalStreamEvent =
  | { type: 'scrollback'; cols: number; rows: number; serialized: string; truncated: boolean }
  | { type: 'data'; chunk: string }
  | { type: 'end' }

// ---------------------------------------------------------------------------
// RPC method names (dot-namespace, as exposed by `orca serve`)
// ---------------------------------------------------------------------------

export const Rpc = {
  statusGet: 'status.get',
  worktreePs: 'worktree.ps',
  repoList: 'repo.list',
  terminalList: 'terminal.list',
  terminalSubscribe: 'terminal.subscribe',
  terminalUnsubscribe: 'terminal.unsubscribe',
  terminalSend: 'terminal.send',
  worktreeActivate: 'worktree.activate',
} as const
