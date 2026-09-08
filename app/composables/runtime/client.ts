// Orca runtime WebSocket client (browser) — ported from stablyai/orca
// mobile/src/transport/direct-rpc-client.ts. Speaks the same wire contract:
//   1. plaintext e2ee_hello  → e2ee_ready
//   2. encrypted e2ee_auth    → e2ee_authenticated
//   3. encrypted RpcRequest  → encrypted RpcResponse(s), streaming supported
import {
  evaluateProtocolCompat,
  RUNTIME_PROTOCOL_VERSION,
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
  Rpc,
  type RpcRequest,
  type RpcResponse,
  type RuntimeAccount,
  type RuntimeRepo,
  type RuntimeStatus,
  type RuntimeSystemMetrics,
  type RuntimeTerminal,
  type RuntimeTerminalSummary,
  type RuntimeWorktreePsSummary,
  type TerminalProfile,
  type TerminalStreamEvent,
} from '@shared/protocol'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64,
} from '@shared/e2ee'

export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'authenticating'
  | 'connected'
  | 'closed'
  | 'error'

export type OrcaConnectionLog = { at: number; message: string }

export type RuntimeClientOptions = {
  endpoint: string
  deviceToken: string
  serverPublicKeyB64: string
  /** Overall pairing/connect budget (default 25s, like the mobile app). */
  timeoutMs?: number
  onLog?: (message: string) => void
  onPhase?: (phase: ConnectionPhase) => void
  /** Extra protocol versions this client must declare (reserved). */
  clientCapabilities?: string[]
  /**
   * Test seam: inject a WebSocket constructor. The browser path never sets
   * this — it always uses the global WebSocket.
   */
  WebSocketCtor?: new (url: string) => WebSocket
}

type PendingEntry = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  /** Called for every streaming frame after the first. */
  onFrame?: (frame: unknown) => void
  method: string
  /** Cleared when the final (non-streaming) response lands. */
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * A single paired-host connection. Create one per host; call `dispose()`
 * when the host is removed. Reconnecting is the caller's policy — like the
 * mobile app, orca-web reconnects on user action, not silently in the
 * background.
 */
export class OrcaRuntimeClient {
  private ws: WebSocket | null = null
  private keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null
  private sharedKey: Uint8Array | null = null
  private pending = new Map<string, PendingEntry>()
  private seq = 0
  private phase: ConnectionPhase = 'idle'
  private logs: OrcaConnectionLog[] = []
  private options: RuntimeClientOptions
  private status: RuntimeStatus | null = null
  private disposed = false
  private connectTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(options: RuntimeClientOptions) {
    this.options = options
  }

  get runtimeStatus(): RuntimeStatus | null {
    return this.status
  }

  private setPhase(phase: ConnectionPhase): void {
    if (this.phase === phase || this.disposed) {
      return
    }
    this.phase = phase
    this.options.onPhase?.(phase)
  }

  private log(message: string): void {
    const entry = { at: Date.now(), message }
    this.logs.push(entry)
    this.options.onLog?.(message)
  }

  get connectionLogs(): OrcaConnectionLog[] {
    return this.logs
  }

  /** Open the socket and run the E2EE handshake + auth. Resolves with the
   *  runtime status (from `status.get`). */
  async connect(): Promise<RuntimeStatus> {
    if (this.disposed) {
      throw new Error('Client disposed')
    }
    this.setPhase('connecting')
    this.log(`Dialing ${this.options.endpoint}`)

    return new Promise<RuntimeStatus>((resolve, reject) => {
      let settled = false
      const finish = (err: Error | null, status?: RuntimeStatus) => {
        if (settled) {
          return
        }
        settled = true
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout)
          this.connectTimeout = null
        }
        if (err) {
          this.setPhase('error')
          reject(err)
        } else if (status) {
          this.setPhase('connected')
          resolve(status)
        }
      }

      const budgetMs = this.options.timeoutMs ?? 25_000
      this.connectTimeout = setTimeout(() => {
        this.log('Connect budget expired')
        this.ws?.close()
        finish(new Error(`Could not connect within ${Math.round(budgetMs / 1000)}s — see log for where it stalled`))
      }, budgetMs)

      let ws: WebSocket
      try {
        const SocketCtor = this.options.WebSocketCtor ?? WebSocket
        ws = new SocketCtor(this.options.endpoint)
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)))
        return
      }
      this.ws = ws

      ws.onopen = () => {
        this.setPhase('handshaking')
        this.log('Socket open — sending e2ee_hello')
        const keyPair = generateKeyPair()
        this.keyPair = keyPair
        ws.send(
          JSON.stringify({
            type: 'e2ee_hello',
            publicKeyB64: publicKeyToBase64(keyPair.publicKey),
          }),
        )
      }

      ws.onmessage = (event: MessageEvent) => {
        const data = typeof event.data === 'string' ? event.data : ''
        if (this.phase === 'handshaking') {
          this.handleHandshakeMessage(data, finish)
          return
        }
        if (this.phase === 'authenticating') {
          this.handleAuthMessage(data, finish)
          return
        }
        this.handleRpcFrame(data)
      }

      ws.onerror = () => {
        this.log('Socket error')
        finish(new Error(`Could not reach ${this.options.endpoint}`))
      }

      ws.onclose = () => {
        if (this.phase !== 'connected') {
          finish(new Error('Connection closed before handshake completed'))
          return
        }
        this.setPhase('closed')
        this.rejectAllPending(new Error('Connection closed'))
      }
    })
  }

  private handleHandshakeMessage(data: string, finish: (err: Error | null, status?: RuntimeStatus) => void): void {
    let msg: { type?: string; message?: string }
    try {
      msg = JSON.parse(data)
    } catch {
      finish(new Error('Handshake sent invalid JSON'))
      return
    }
    if (msg.type === 'e2ee_error') {
      finish(new Error(msg.message ?? 'Host refused the E2EE handshake'))
      return
    }
    if (msg.type !== 'e2ee_ready') {
      finish(new Error(`Unexpected handshake frame: ${msg.type ?? 'unknown'}`))
      return
    }
    if (!this.keyPair || !this.options.serverPublicKeyB64) {
      finish(new Error('Handshake missing key material'))
      return
    }

    const serverPublic = publicKeyFromBase64(this.options.serverPublicKeyB64)
    this.sharedKey = deriveSharedKey(this.keyPair.secretKey, serverPublic)
    this.setPhase('authenticating')
    this.log('E2EE key exchange complete — sending encrypted auth')
    this.ws!.send(
      encrypt(
        JSON.stringify({ type: 'e2ee_auth', deviceToken: this.options.deviceToken }),
        this.sharedKey,
      ),
    )
  }

  private handleAuthMessage(data: string, finish: (err: Error | null, status?: RuntimeStatus) => void): void {
    if (!this.sharedKey) {
      finish(new Error('Auth frame without shared key'))
      return
    }
    const plaintext = decrypt(data, this.sharedKey)
    if (plaintext === null) {
      finish(new Error('Auth reply failed to decrypt — wrong device token or host key'))
      return
    }
    let msg: { type?: string; error?: { code?: string } }
    try {
      msg = JSON.parse(plaintext)
    } catch {
      finish(new Error('Auth reply was not valid JSON'))
      return
    }
    if (msg.type === 'e2ee_error') {
      finish(new Error(`Authentication refused: ${msg.error?.code ?? 'unauthorized'}`))
      return
    }
    if (msg.type !== 'e2ee_authenticated') {
      finish(new Error(`Unexpected auth frame: ${msg.type ?? 'unknown'}`))
      return
    }

    // Auth is done — promote the phase before the protocol negotiation RPC
    // so its reply routes through handleRpcFrame, not back into auth.
    this.setPhase('connected')
    this.log('Authenticated — negotiating protocol')
    // Protocol negotiation, exactly like the mobile app: status.get first,
    // then hard-block on incompatible ranges rather than misbehaving.
    this.callInternal(Rpc.statusGet, {})
      .then((result) => {
        const status = result as RuntimeStatus
        const verdict = evaluateProtocolCompat({
          serverProtocolVersion: status.protocolVersion,
          minCompatibleClientVersion: status.minCompatibleMobileVersion,
          clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
          minCompatibleServerVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
        })
        if (verdict.kind === 'blocked') {
          const which = verdict.reason === 'client-too-old' ? 'orca-web is too old for this runtime' : 'this Orca runtime is too old for orca-web'
          throw new Error(
            `Protocol incompatible — ${which}. Update and try again.`,
          )
        }
        this.status = status
        this.log(`Connected to runtime ${status.runtimeId} (protocol ${status.protocolVersion})`)
        finish(null, status)
      })
      .catch((err: unknown) => {
        finish(err instanceof Error ? err : new Error(String(err)))
      })
  }

  private handleRpcFrame(data: string): void {
    if (!this.sharedKey) {
      return
    }
    const plaintext = decrypt(data, this.sharedKey)
    if (plaintext === null) {
      this.log('Decryption failed — dropping frame')
      return
    }
    let response: RpcResponse
    try {
      response = JSON.parse(plaintext) as RpcResponse
    } catch {
      return
    }
    const entry = this.pending.get(response.id)
    if (!entry) {
      return
    }
    if (!response.ok) {
      this.pending.delete(response.id)
      if (entry.timer) {
        clearTimeout(entry.timer)
      }
      entry.reject(new Error(response.error?.message ?? `RPC ${entry.method} failed`))
      return
    }
    if (response.streaming) {
      entry.onFrame?.(response.result)
      return
    }
    this.pending.delete(response.id)
    if (entry.timer) {
      clearTimeout(entry.timer)
    }
    entry.resolve(response.result)
  }

  private rejectAllPending(reason: Error): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) {
        clearTimeout(entry.timer)
      }
      entry.reject(reason)
    }
    this.pending.clear()
  }

  private callInternal(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.call(method, params, { timeoutMs: this.options.timeoutMs ?? 25_000 })
  }

  /**
   * Send one RPC. When the response streams (terminal.subscribe), `onFrame`
   * receives every frame after the first, and the promise resolves with the
   * first frame's result.
   */
  call(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number; onFrame?: (frame: unknown) => void },
  ): Promise<unknown> {
    if (this.phase !== 'connected' && this.phase !== 'authenticating') {
      return Promise.reject(new Error(`Cannot call ${method}: not connected (phase ${this.phase})`))
    }
    if (!this.sharedKey || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot call ${method}: socket not open`))
    }

    const id = `w${++this.seq}`
    const request: RpcRequest = { id, method, params }
    if (method !== 'status.get' && this.options.deviceToken) {
      request.deviceToken = this.options.deviceToken
    }

    return new Promise((resolve, reject) => {
      const entry: PendingEntry = {
        resolve,
        reject,
        onFrame: opts?.onFrame,
        method,
        timer: null,
      }
      const timeoutMs = opts?.timeoutMs ?? 25_000
      entry.timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC ${method} timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.pending.set(id, entry)
      this.ws!.send(encrypt(JSON.stringify(request), this.sharedKey!))
    })
  }

  // -----------------------------------------------------------------------
  // Typed convenience API
  // -----------------------------------------------------------------------

  async getStatus(): Promise<RuntimeStatus> {
    return (await this.call(Rpc.statusGet, {})) as RuntimeStatus
  }

  async listWorktrees(): Promise<{ worktrees: RuntimeWorktreePsSummary[] }> {
    return (await this.call(Rpc.worktreePs, {})) as { worktrees: RuntimeWorktreePsSummary[] }
  }

  /** Per-terminal live state for a worktree (session tabs). */
  async listTerminalSummaries(
    worktreeSelector: string,
  ): Promise<{ terminals: RuntimeTerminalSummary[] }> {
    const ps = await this.listWorktrees()
    const selector = worktreeSelector.startsWith('id:') ? worktreeSelector.slice(3) : worktreeSelector
    const worktree = ps.worktrees.find((w) => w.worktreeId === selector)
    return { terminals: worktree?.terminals ?? [] }
  }

  async listRepos(): Promise<{ repos: RuntimeRepo[] }> {
    return (await this.call(Rpc.repoList, {})) as { repos: RuntimeRepo[] }
  }

  async listTerminals(worktreeSelector: string): Promise<{ terminals: RuntimeTerminal[] }> {
    return (await this.call(Rpc.terminalList, { worktree: worktreeSelector })) as {
      terminals: RuntimeTerminal[]
    }
  }

  /** List the host's terminal profiles (PowerShell, Git Bash, agents…). */
  async listTerminalProfiles(): Promise<{ profiles: TerminalProfile[] }> {
    return (await this.call(Rpc.terminalListProfiles, {})) as { profiles: TerminalProfile[] }
  }

  /**
   * Create a terminal from a profile. Uses an idempotent clientMutationId
   * so a lost reply can be retried without spawning duplicates (mirrors
   * upstream's terminal.create idempotency capability).
   */
  async createTerminal(
    worktreeSelector: string,
    profileId: string,
    clientMutationId: string,
  ): Promise<{ handle: string }> {
    const result = (await this.call(Rpc.terminalCreate, {
      worktree: worktreeSelector,
      profileId,
      clientMutationId,
    })) as { handle: string }
    return result
  }

  /** Close (kill) a terminal pane on the host. */
  async closeTerminal(handle: string): Promise<void> {
    await this.call(Rpc.terminalClose, { terminal: handle })
  }

  /** Resize the host PTY to match the client viewport. */
  async resizeTerminal(handle: string, cols: number, rows: number): Promise<void> {
    await this.call(Rpc.terminalResize, { terminal: handle, cols, rows })
  }

  /** Accounts + rate limits for the bottom bar (Orca desktop style). */
  async getAccounts(): Promise<{ accounts: RuntimeAccount[] }> {
    return (await this.call(Rpc.accountsGet, {})) as { accounts: RuntimeAccount[] }
  }

  /** Host system metrics (CPU/RAM/agents) for the bottom bar. */
  async getSystemMetrics(): Promise<RuntimeSystemMetrics> {
    return (await this.call(Rpc.systemGetMetrics, {})) as RuntimeSystemMetrics
  }

  /** Subscribe to a terminal stream. Returns an unsubscribe function. */
  subscribeTerminal(
    terminal: string,
    viewport: { cols: number; rows: number },
    handlers: {
      onScrollback: (event: TerminalStreamEvent & { type: 'scrollback' }) => void
      onData: (chunk: string) => void
      onEnd?: () => void
    },
  ): { unsubscribe: () => void; firstFrame: Promise<TerminalStreamEvent> } {
    let firstResolve: (value: TerminalStreamEvent) => void
    let firstReject: (reason: Error) => void
    const firstFrame = new Promise<TerminalStreamEvent>((resolve, reject) => {
      firstResolve = resolve
      firstReject = reject
    })

    let settled = false
    const onFrame = (frame: unknown) => {
      const event = frame as TerminalStreamEvent
      if (event?.type === 'scrollback' && !settled) {
        settled = true
        firstResolve(event)
      }
      if (event?.type === 'scrollback') {
        handlers.onScrollback(event)
      } else if (event?.type === 'data') {
        handlers.onData(event.chunk)
      } else if (event?.type === 'end') {
        handlers.onEnd?.()
      }
    }

    void this.call(Rpc.terminalSubscribe, { terminal, viewport }, { onFrame })
      .then((first) => {
        const event = first as TerminalStreamEvent
        if (event?.type === 'scrollback' && !settled) {
          settled = true
          firstResolve(event)
          handlers.onScrollback(event)
        }
      })
      .catch((err: unknown) => {
        firstReject(err instanceof Error ? err : new Error(String(err)))
      })

    return {
      unsubscribe: () => {
        void this.call(Rpc.terminalUnsubscribe, { terminal }).catch(() => {})
      },
      firstFrame,
    }
  }

  async sendTerminalInput(terminal: string, text: string): Promise<void> {
    await this.call(Rpc.terminalSend, { terminal, text })
  }

  async activateWorktree(worktreeSelector: string): Promise<void> {
    await this.call(Rpc.worktreeActivate, { worktree: worktreeSelector })
  }

  dispose(): void {
    this.disposed = true
    this.setPhase('closed')
    this.rejectAllPending(new Error('Client disposed'))
    this.ws?.close()
    this.ws = null
    this.sharedKey = null
    this.keyPair = null
  }
}
