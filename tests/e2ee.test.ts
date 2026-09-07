import { describe, expect, it } from 'vitest'
import { generateKeyPair, deriveSharedKey, encrypt, decrypt, encryptForNode, decryptForNode } from '../shared/e2ee'

describe('e2ee framing (browser-shaped helpers)', () => {
  it('round-trips a message between two parties', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()

    const aliceShared = deriveSharedKey(alice.secretKey, bob.publicKey)
    const bobShared = deriveSharedKey(bob.secretKey, alice.publicKey)

    const secret = 'terminal.send {"text":"ls -la"}'
    const wire = encrypt(secret, aliceShared)
    expect(wire).not.toContain('ls -la')
    expect(decrypt(wire, bobShared)).toBe(secret)
  })

  it('fails to decrypt with the wrong key', () => {
    const alice = generateKeyPair()
    const eve = generateKeyPair()
    const aliceShared = deriveSharedKey(alice.secretKey, eve.publicKey)
    const wire = encrypt('top secret', aliceShared)

    // A random third party must not open the frame — decrypt returns null.
    expect(decrypt(wire, aliceShared)).toBe('top secret')
    const mallory = generateKeyPair()
    const malloryShared = deriveSharedKey(mallory.secretKey, mallory.publicKey)
    expect(decrypt(wire, malloryShared)).toBeNull()
  })
})

describe('e2ee framing (node-shaped helpers)', () => {
  it('interops with the browser helpers', () => {
    const client = generateKeyPair()
    const host = generateKeyPair()
    const clientShared = deriveSharedKey(client.secretKey, host.publicKey)
    const hostShared = deriveSharedKey(host.secretKey, client.publicKey)

    const wire = encryptForNode('e2ee_auth', hostShared)
    expect(decrypt(wire, clientShared)).toBe('e2ee_auth')

    const reply = encrypt('e2ee_authenticated', clientShared)
    expect(decryptForNode(reply, hostShared)).toBe('e2ee_authenticated')
  })
})
