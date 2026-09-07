import { describe, expect, it } from 'vitest'
import {
  evaluateProtocolCompat,
  RUNTIME_PROTOCOL_VERSION,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
} from '../shared/protocol'

describe('protocol compatibility window', () => {
  it('accepts the shipped values', () => {
    const verdict = evaluateProtocolCompat({
      serverProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
      clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleServerVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
    })
    expect(verdict).toEqual({ kind: 'ok' })
  })

  it('blocks a server older than the client minimum', () => {
    const verdict = evaluateProtocolCompat({
      serverProtocolVersion: 1,
      minCompatibleClientVersion: 2,
      clientProtocolVersion: 3,
      minCompatibleServerVersion: 2,
    })
    expect(verdict).toEqual({ kind: 'blocked', reason: 'server-too-old' })
  })

  it('blocks a client older than the server minimum', () => {
    const verdict = evaluateProtocolCompat({
      serverProtocolVersion: 3,
      minCompatibleClientVersion: 2,
      clientProtocolVersion: 1,
      minCompatibleServerVersion: 2,
    })
    expect(verdict).toEqual({ kind: 'blocked', reason: 'client-too-old' })
  })

  it('accepts an older server within the window', () => {
    const verdict = evaluateProtocolCompat({
      serverProtocolVersion: 2,
      minCompatibleClientVersion: 2,
      clientProtocolVersion: 3,
      minCompatibleServerVersion: 2,
    })
    expect(verdict).toEqual({ kind: 'ok' })
  })
})
