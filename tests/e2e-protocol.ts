// End-to-end protocol test: real WebSocket, real E2EE handshake, real RPC —
// exactly the frames a browser client sends. Run with tsx:
//   pnpm mock:e2e
import { WebSocket } from 'ws'
import { spawn } from 'node:child_process'
import { generateKeyPair, deriveSharedKey, publicKeyToBase64, encryptForNode, decryptForNode } from '../shared/e2ee'

const PORT = 16868
const TOKEN = 'e2e-token'
// Match the mock's default loopback bind (MOCK_HOST default is 127.0.0.1).
const HOST = '127.0.0.1'

type JsonRecord = Record<string, unknown>

const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/mock-server.ts'], {
  env: { ...process.env, PORT: String(PORT), MOCK_AUTH_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk.toString()
})

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function connectUntilReady(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (output.includes(`ws://${HOST}:${PORT}`)) {
      return
    }
    await wait(250)
  }
  throw new Error(`mock server never became ready; output:\n${output}`)
}

function rpc(ws: WebSocket, shared: Uint8Array, id: string, method: string, params: Record<string, unknown> = {}): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const listener = (data: unknown) => {
      const msg = typeof data === 'string' ? data : (data as Buffer).toString('utf8')
      const plaintext = decryptForNode(msg, shared)
      if (plaintext === null) return
      const response = JSON.parse(plaintext)
      if (response.id === id) {
        ws.off('message', listener)
        if (!response.ok) {
          reject(new Error(response.error?.message ?? 'rpc failed'))
        } else {
          resolve(response)
        }
      }
    }
    ws.on('message', listener)
    ws.send(encryptForNode(JSON.stringify({ id, method, params }), shared))
    setTimeout(() => reject(new Error(`rpc ${method} timed out`)), 10_000)
  })
}

async function main() {
  await connectUntilReady()

  const keyPair = generateKeyPair()
  const serverPublicKeyB64 = /Server public key \(base64\): (\S+)/.exec(output)?.[1]
  if (!serverPublicKeyB64) {
    throw new Error('mock server did not print its public key')
  }

  // Pairing URL round-trips through the same decoder the browser uses.
  const pairingUrl = /Pairing URL: (\S+)/.exec(output)?.[1]
  if (!pairingUrl?.startsWith('orca://pair?code=')) {
    throw new Error('mock server did not print a pairing URL')
  }

  const ws = new WebSocket(`ws://${HOST}:${PORT}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  // 1. Handshake
  ws.send(JSON.stringify({ type: 'e2ee_hello', publicKeyB64: publicKeyToBase64(keyPair.publicKey) }))
  const ready = await new Promise<{ type: string }>((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()))
      } catch (err) {
        reject(err)
      }
    })
    setTimeout(() => reject(new Error('no e2ee_ready')), 5000)
  })
  if (ready.type !== 'e2ee_ready') {
    throw new Error(`expected e2ee_ready, got ${ready.type}`)
  }

  const { publicKeyFromBase64 } = await import('../shared/e2ee')
  const shared = deriveSharedKey(keyPair.secretKey, publicKeyFromBase64(serverPublicKeyB64))

  // 2. Auth
  ws.send(encryptForNode(JSON.stringify({ type: 'e2ee_auth', deviceToken: TOKEN }), shared))
  const authReply = await new Promise<JsonRecord>((resolve, reject) => {
    ws.on('message', (data) => {
      const plaintext = decryptForNode(data.toString(), shared)
      if (plaintext) {
        try {
          resolve(JSON.parse(plaintext))
        } catch {
          reject(new Error('bad auth json'))
        }
      }
    })
    setTimeout(() => reject(new Error('no auth reply')), 5000)
  })
  if (authReply.type !== 'e2ee_authenticated') {
    throw new Error(`expected e2ee_authenticated, got ${authReply.type}`)
  }

  // 3. RPC: status.get → worktree.ps → repo.list → terminal stream
  const status = await rpc(ws, shared, 's1', 'status.get')
  const statusResult = status.result as { runtimeId: string; protocolVersion: number }
  if (statusResult.runtimeId !== 'mock-runtime') {
    throw new Error('unexpected runtimeId')
  }
  if (statusResult.protocolVersion !== 3) {
    throw new Error(`unexpected protocolVersion ${statusResult.protocolVersion}`)
  }

  const ps = await rpc(ws, shared, 's2', 'worktree.ps')
  if (!Array.isArray((ps.result as { worktrees?: unknown[] }).worktrees)) {
    throw new Error('worktree.ps returned no worktrees')
  }

  const repos = await rpc(ws, shared, 's3', 'repo.list')
  if (!Array.isArray((repos.result as { repos?: unknown[] }).repos)) {
    throw new Error('repo.list returned no repos')
  }

  // 4. Terminal subscribe: scrollback frame, then at least one data frame.
  const streamFrames = await new Promise<JsonRecord[]>((resolve, reject) => {
    const frames: JsonRecord[] = []
    const listener = (data: unknown) => {
      const msg = typeof data === 'string' ? data : (data as Buffer).toString('utf8')
      const plaintext = decryptForNode(msg, shared)
      if (!plaintext) return
      const response = JSON.parse(plaintext) as { id?: string; result?: unknown }
      if (response.id === 's4') {
        frames.push(response.result as JsonRecord)
        if (frames.length >= 3) {
          ws.off('message', listener)
          resolve(frames)
        }
      }
    }
    ws.on('message', listener)
    ws.send(encryptForNode(JSON.stringify({ id: 's4', method: 'terminal.subscribe', params: { terminal: 'term-1', viewport: { cols: 80, rows: 24 } } }), shared))
    setTimeout(() => reject(new Error(`only ${frames.length} stream frames arrived`)), 12_000)
  })

  const scrollback = streamFrames[0] as { type: string; serialized: string }
  if (scrollback.type !== 'scrollback' || !scrollback.serialized.includes('claude')) {
    throw new Error('scrollback frame missing agent output')
  }
  if (!streamFrames.some((f) => (f as { type: string }).type === 'data')) {
    throw new Error('no data frames streamed')
  }

  ws.close()
  console.log('E2E OK — handshake, auth, status, worktree.ps, repo.list, terminal stream all verified')
  process.exit(0)
}

main().catch((err) => {
  console.error('E2E FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
}).finally(() => {
  child.kill()
})
