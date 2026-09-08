// Browser-level E2E: exercise the REAL OrcaRuntimeClient class (the exact
// code the browser runs) against the REAL mock server over a REAL socket.
// Run with tsx:  pnpm test:client-e2e
import { spawn } from 'node:child_process'
import { WebSocket as NodeWebSocket } from 'ws'

const PORT = 16968

// The client uses the browser WebSocket API; ws gives us a compatible
// surface in Node for this test harness.
class BrowserShimWebSocket {
  static get OPEN() {
    return 1
  }
  private inner: NodeWebSocket
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.inner = new NodeWebSocket(url)
    this.inner.on('open', () => this.onopen?.())
    this.inner.on('message', (data) => this.onmessage?.({ data: data.toString() }))
    this.inner.on('error', () => this.onerror?.())
    this.inner.on('close', () => this.onclose?.())
  }

  get readyState(): number {
    return this.inner.readyState
  }

  send(data: string): void {
    this.inner.send(data)
  }

  close(): void {
    this.inner.close()
  }
}

async function main() {
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/mock-server.ts'], {
    env: { ...process.env, PORT: String(PORT), MOCK_AUTH_TOKEN: 'e2e-token', MOCK_WORKTREE_COUNT: '4' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (c) => {
    output += c.toString()
  })

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  for (let i = 0; i < 40 && !output.includes('Pairing URL'); i++) {
    await wait(250)
  }
  if (!output.includes('Pairing URL')) {
    throw new Error(`mock never started:\n${output}`)
  }

  const serverPublicKeyB64 = /Server public key \(base64\): (\S+)/.exec(output)![1]!

  // Import the REAL client (resolved through Nuxt's app dir — same file the
  // browser loads).
  const { OrcaRuntimeClient } = await import('../app/composables/runtime/client')

  const logs: string[] = []
  const phases: string[] = []
  const client = new OrcaRuntimeClient({
    endpoint: `ws://127.0.0.1:${PORT}`,
    deviceToken: 'e2e-token',
    serverPublicKeyB64,
    onLog: (m) => logs.push(m),
    onPhase: (p) => phases.push(p),
    // @ts-expect-error test harness injects a browser-shaped WebSocket
    WebSocketCtor: BrowserShimWebSocket,
  })

  const status = await client.connect()
  if (status.runtimeId !== 'mock-runtime') throw new Error('wrong runtimeId')
  if (status.protocolVersion !== 3) throw new Error('wrong protocolVersion')

  const { worktrees } = await client.listWorktrees()
  if (worktrees.length !== 4) throw new Error(`expected 4 worktrees, got ${worktrees.length}`)
  if (!worktrees[0]!.agents || !Array.isArray(worktrees[0]!.agents)) {
    // agents is optional per-row (mock adds agents every 4th row)
  }

  const { repos } = await client.listRepos()
  if (repos.length < 1) throw new Error('no repos')

  const { terminals } = await client.listTerminals(`id:${worktrees[0]!.worktreeId}`)
  if (terminals.length < 1) throw new Error('no terminals')

  // Terminal stream: scrollback + data frames + input round-trip
  let sawScrollback = false
  let dataChunks = 0
  const sub = client.subscribeTerminal(
    'term-1',
    { cols: 80, rows: 24 },
    {
      onScrollback: (e) => {
        sawScrollback = e.serialized.includes('claude')
      },
      onData: () => {
        dataChunks++
      },
    },
  )
  const first = await sub.firstFrame
  if (first.type !== 'scrollback') throw new Error('first frame not scrollback')
  await new Promise<void>((r) => setTimeout(r, 1600))
  if (!sawScrollback) throw new Error('scrollback never surfaced via handler')
  if (dataChunks < 1) throw new Error('no data chunks streamed')
  await client.sendTerminalInput('term-1', 'git status\r')
  sub.unsubscribe()

  // --- New surfaces (v0.2): terminal profiles / create / close / resize,
  // worktree terminal summaries, accounts, system metrics. ---
  const { profiles } = await client.listTerminalProfiles()
  if (profiles.length < 3) throw new Error(`expected terminal profiles, got ${profiles.length}`)
  if (!profiles.some((p) => p.kind === 'shell') || !profiles.some((p) => p.kind === 'agent')) {
    throw new Error('profiles missing shell or agent kinds')
  }

  const created = await client.createTerminal(`id:${worktrees[0]!.worktreeId}`, 'powershell', 'mutation-e2e-1')
  if (!created.handle) throw new Error('createTerminal returned no handle')

  // Idempotent replay with the same clientMutationId must return a handle
  // (the mock dedups).
  const replay = await client.createTerminal(`id:${worktrees[0]!.worktreeId}`, 'powershell', 'mutation-e2e-1')
  if (!replay.handle) throw new Error('idempotent replay returned no handle')

  await client.resizeTerminal(created.handle, 120, 40)

  const summaries = await client.listTerminalSummaries(`id:${worktrees[0]!.worktreeId}`)
  if (!summaries.terminals.some((t) => t.handle === created.handle)) {
    throw new Error('created terminal missing from worktree summaries')
  }
  if (!summaries.terminals.every((t) => ['processing', 'asking', 'running', 'idle'].includes(t.activity))) {
    throw new Error('terminal summaries missing activity states')
  }

  const { accounts } = await client.getAccounts()
  if (accounts.length < 1 || !accounts[0]!.rateLimitReset) {
    throw new Error('accounts.get returned no rate limits')
  }

  const metrics = await client.getSystemMetrics()
  if (typeof metrics.cpuPercent !== 'number' || typeof metrics.activeAgents !== 'number') {
    throw new Error('system metrics malformed')
  }

  await client.closeTerminal(created.handle)
  const afterClose = await client.listTerminalSummaries(`id:${worktrees[0]!.worktreeId}`)
  if (afterClose.terminals.some((t) => t.handle === created.handle)) {
    throw new Error('closed terminal still listed')
  }

  client.dispose()
  if (!phases.includes('connected')) throw new Error(`phases missing connected: ${phases.join(',')}`)

  console.log('CLIENT E2E OK — real OrcaRuntimeClient against real mock runtime')
  console.log(`phases: ${phases.join(' → ')}`)
  console.log(`logs: ${logs.length} entries`)
  console.log(`new surface: ${profiles.length} profiles, ${accounts.length} accounts, cpu ${metrics.cpuPercent}%`)
  process.exit(0)
}

main()
  .catch((err) => {
    console.error('CLIENT E2E FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(() => {
    child.kill()
  })
