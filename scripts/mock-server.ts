// Standalone mock Orca runtime server — a faithful port of
// stablyai/orca mobile/scripts/mock-server.ts, adapted to share orca-web's
// protocol library. Lets you develop and demo the web client without a
// running Orca desktop/serve instance. Responds to the same RPC methods the
// real runtime exposes, with realistic fake data. Supports the E2EE handshake.
//
// Env knobs (all optional):
//   PORT                listen port (default 6768)
//   MOCK_AUTH_TOKEN     device token (default "mock-device-token")
//   MOCK_REPO_COUNT / MOCK_WORKTREE_COUNT / MOCK_RPC_DELAY_MS  scenario sizing
import { WebSocketServer, type WebSocket } from 'ws'
import { encodePairingUrl } from '../shared/pairing'
import {
  deriveSharedKey,
  encryptForNode,
  decryptForNode,
  generateKeyPair,
  publicKeyToBase64,
} from '../shared/e2ee'
import { createMockRuntimeHandlers, defaultMockScenario } from './mock-server-runtime'
import type { RpcRequest } from '../shared/protocol'

const PORT = Number(process.env.PORT) || 6768
const AUTH_TOKEN = process.env.MOCK_AUTH_TOKEN || 'mock-device-token'
// Loopback-only unless explicitly overridden — the mock mints a known
// device token, so it must never be reachable from the network by default.
const HOST = process.env.MOCK_HOST ?? '127.0.0.1'

// Fresh server keypair per run (the real runtime persists one; the mock does
// not need to survive restarts).
const serverKeyPair = generateKeyPair()
const serverPublicKeyB64 = publicKeyToBase64(serverKeyPair.publicKey)

type E2EEState = { sharedKey: Uint8Array; deviceToken: string | null; authenticated: boolean }

const wss = new WebSocketServer({ port: PORT, host: HOST })
const connectionState = new Map<WebSocket, E2EEState>()
const mockRuntime = createMockRuntimeHandlers()

wss.on('connection', (ws) => {
  console.log('[mock] Client connected — waiting for e2ee_hello')

  ws.on('message', (data) => {
    const msg = typeof data === 'string' ? data : data.toString('utf8')
    const e2ee = connectionState.get(ws)

    if (!e2ee) {
      handleHandshake(ws, msg)
      return
    }

    const plaintext = decryptForNode(msg, e2ee.sharedKey)
    if (plaintext === null) {
      console.log('[mock] Decryption failed — dropping message')
      return
    }

    let request: RpcRequest
    try {
      request = JSON.parse(plaintext) as RpcRequest
    } catch {
      ws.send(
        encryptForNode(
          JSON.stringify({ id: 'unknown', ok: false, error: { code: 'bad_request', message: 'Invalid JSON' } }),
          e2ee.sharedKey,
        ),
      )
      return
    }

    if (!e2ee.authenticated) {
      const auth = request as unknown as { type?: string; deviceToken?: string }
      if (auth.type !== 'e2ee_auth' || auth.deviceToken !== AUTH_TOKEN) {
        ws.send(
          encryptForNode(
            JSON.stringify({ type: 'e2ee_error', error: { code: 'unauthorized' } }),
            e2ee.sharedKey,
          ),
        )
        ws.close()
        return
      }
      e2ee.deviceToken = auth.deviceToken
      e2ee.authenticated = true
      ws.send(encryptForNode(JSON.stringify({ type: 'e2ee_authenticated' }), e2ee.sharedKey))
      console.log('[mock] E2EE authentication complete')
      return
    }

    console.log(`[mock] ${request.method} (id: ${request.id})`)
    mockRuntime.handleRequest(request, (response) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(encryptForNode(JSON.stringify(response), e2ee.sharedKey))
      }
    }, ws)
  })

  ws.on('close', () => {
    connectionState.delete(ws)
    mockRuntime.onClose(ws)
    console.log('[mock] Client disconnected')
  })

  ws.on('error', () => {
    connectionState.delete(ws)
    ws.close()
  })
})

function handleHandshake(ws: WebSocket, msg: string): void {
  let hello: { type?: string; publicKeyB64?: string }
  try {
    hello = JSON.parse(msg)
  } catch {
    ws.send(JSON.stringify({ type: 'e2ee_error', message: 'Invalid JSON' }))
    ws.close()
    return
  }

  if (hello.type !== 'e2ee_hello' || !hello.publicKeyB64) {
    ws.send(JSON.stringify({ type: 'e2ee_error', message: 'Expected e2ee_hello' }))
    ws.close()
    return
  }

  const clientPublicKey = Uint8Array.from(Buffer.from(hello.publicKeyB64, 'base64'))
  if (clientPublicKey.length !== 32) {
    ws.send(JSON.stringify({ type: 'e2ee_error', message: 'Invalid public key' }))
    ws.close()
    return
  }

  const sharedKey = deriveSharedKey(serverKeyPair.secretKey, clientPublicKey)
  connectionState.set(ws, { sharedKey, deviceToken: null, authenticated: false })
  ws.send(JSON.stringify({ type: 'e2ee_ready' }))
  console.log('[mock] E2EE key exchange complete — waiting for encrypted auth')
}

console.log(`[mock] Orca mock server listening on ws://${HOST}:${PORT}`)
console.log(`[mock] Auth token: ${AUTH_TOKEN}`)
console.log(`[mock] Server public key (base64): ${serverPublicKeyB64}`)
console.log(
  `[mock] Scenario: ${defaultMockScenario.repoCount} repos, ${defaultMockScenario.worktreeCount} worktrees, ${defaultMockScenario.rpcDelayMs}ms default RPC delay`,
)
console.log(
  `[mock] Pairing URL: ${encodePairingUrl({
    endpoint: `ws://${HOST}:${PORT}`,
    deviceToken: AUTH_TOKEN,
    serverPublicKeyB64,
    label: 'Mock Orca runtime',
  })}`,
)
