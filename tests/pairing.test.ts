import { describe, expect, it } from 'vitest'
import { encodePairingUrl, decodePairingUrl, decodePairingCode } from '../shared/pairing'

const offer = {
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'tok-abc',
  serverPublicKeyB64: 'a'.repeat(43) + '=',
  label: 'Mac Studio',
}

describe('pairing round-trip', () => {
  it('encodes and decodes an orca://pair URL', () => {
    const url = encodePairingUrl(offer)
    expect(url).toMatch(/^orca:\/\/pair\?code=/)
    expect(decodePairingUrl(url)).toEqual(offer)
  })

  it('decodes a bare code', () => {
    const url = encodePairingUrl(offer)
    const code = url.split('code=')[1]!
    expect(decodePairingCode(code)).toEqual(offer)
  })

  it('rejects garbage', () => {
    expect(decodePairingUrl('')).toBeNull()
    expect(decodePairingUrl('not-a-url-with-code')).toBeNull()
    expect(decodePairingUrl('orca://pair')).toBeNull()
    expect(decodePairingCode('!!!!')).toBeNull()
  })

  it('rejects a non-orca scheme', () => {
    expect(decodePairingUrl('https://evil.example/pair?code=xyz')).toBeNull()
  })
})
