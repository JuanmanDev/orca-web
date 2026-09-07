// Pairing-offer URL parsing — mirrors the Orca mobile app's
// `orca://pair?...` deep link and the plain-code paste fallback
// (mobile/src/transport/pairing.ts).
//
// A pairing offer is a capability containing a device credential and E2EE
// material. Share it only with the intended client and never log it.

export type PairingOffer = {
  /** WebSocket endpoint of the runtime, e.g. ws://192.168.1.10:6768 */
  endpoint: string
  /** Device token issued by the host during pairing. */
  deviceToken: string
  /** Host's Curve25519 public key, base64 — pinned after first connect. */
  serverPublicKeyB64: string
  /** Optional host label, e.g. "Juanm's Mac Studio". */
  label?: string
}

// Browser-and-Node-safe base64url (atob/btoa exist in both since Node 16).
function base64UrlDecodeToString(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function stringToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Parse an `orca://pair?code=...` URL into a connection offer.
 * Accepts the raw code as well, since the mobile paste path does.
 */
export function decodePairingUrl(input: string): PairingOffer | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'orca:') {
    return null
  }

  const code = url.searchParams.get('code')
  if (!code) {
    return null
  }

  return decodePairingCode(code)
}

/** Decode a bare pairing code (the value inside `?code=`). */
export function decodePairingCode(code: string): PairingOffer | null {
  const trimmed = code.trim()
  if (!trimmed) {
    return null
  }

  let payload: {
    endpoint?: unknown
    deviceToken?: unknown
    serverPublicKeyB64?: unknown
    publicKeyB64?: unknown
    label?: unknown
  }

  try {
    payload = JSON.parse(base64UrlDecodeToString(trimmed))
  } catch {
    return null
  }

  const endpoint = payload.endpoint
  const token = payload.deviceToken
  const key = payload.serverPublicKeyB64 ?? payload.publicKeyB64

  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    typeof token !== 'string' ||
    token.length === 0 ||
    typeof key !== 'string' ||
    key.length === 0
  ) {
    return null
  }

  return {
    endpoint,
    deviceToken: token,
    serverPublicKeyB64: key,
    label: typeof payload.label === 'string' ? payload.label : undefined,
  }
}

/** Build an `orca://pair?code=...` URL from an offer (host-side helper). */
export function encodePairingUrl(offer: PairingOffer): string {
  const json = JSON.stringify({
    endpoint: offer.endpoint,
    deviceToken: offer.deviceToken,
    serverPublicKeyB64: offer.serverPublicKeyB64,
    ...(offer.label ? { label: offer.label } : {}),
  })
  return `orca://pair?code=${stringToBase64Url(json)}`
}
