// Credential-leak guard: the security model promises that pairing
// credentials (device tokens, host public keys) never leave the browser
// except over the E2EE WebSocket to the paired host itself. This test
// enforces that statically:
//   1. app/ code may never call fetch/XMLHttpRequest/sendBeacon/EventSource
//      — the only network primitive allowed is the WebSocket in the
//      runtime client.
//   2. localStorage may only be touched by the hosts store (single choke
//      point for credential persistence).
//   3. No third-party origin literal may appear in app/ or shared/.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

function collectFiles(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectFiles(full, exts, out)
    } else if (exts.some((e) => full.endsWith(e))) {
      out.push(full)
    }
  }
  return out
}

const APP_FILES = collectFiles(join(ROOT, 'app'), ['.ts', '.vue'])
const SHARED_FILES = collectFiles(join(ROOT, 'shared'), ['.ts'])
const ALL_CLIENT_FILES = [...APP_FILES, ...SHARED_FILES]

describe('credential-leak guard: no outbound HTTP from client code', () => {
  it('app/ and shared/ never use fetch, XHR, sendBeacon, or EventSource', () => {
    const forbidden = [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /new\s+EventSource/,
    ]
    const offenders: string[] = []
    for (const file of ALL_CLIENT_FILES) {
      const code = readFileSync(file, 'utf8')
      for (const pattern of forbidden) {
        if (pattern.test(code)) {
          offenders.push(`${file}: matches ${pattern}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('WebSocket is only constructed in the runtime client', () => {
    const offenders: string[] = []
    for (const file of ALL_CLIENT_FILES) {
      const code = readFileSync(file, 'utf8')
      if (/new\s+WebSocket|WebSocketCtor/.test(code) && !file.endsWith(join('composables', 'runtime', 'client.ts'))) {
        offenders.push(file)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('credential-leak guard: localStorage only in app stores', () => {
  const ALLOWED_STORE_FILES = [
    join('stores', 'hosts.ts'),
    join('stores', 'theme.ts'),
  ]

  it('localStorage/sessionStorage appear only in allowed store files', () => {
    const offenders: string[] = []
    for (const file of APP_FILES) {
      const code = readFileSync(file, 'utf8')
      if (/(local|session)Storage/.test(code) && !ALLOWED_STORE_FILES.some((allowed) => file.endsWith(allowed))) {
        offenders.push(file)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('hosts store persists only its own namespaced key', () => {
    const code = readFileSync(join(ROOT, 'app', 'stores', 'hosts.ts'), 'utf8')
    expect(code).toContain("'orca-web:hosts:v1'")
    // No other storage keys sneak in.
    const matches = code.match(/orca-web:[\w:-]+/g) ?? []
    expect(new Set(matches)).toEqual(new Set(['orca-web:hosts:v1']))
  })

  it('theme store persists only UI preferences (never credentials)', () => {
    const code = readFileSync(join(ROOT, 'app', 'stores', 'theme.ts'), 'utf8')
    expect(code).toContain("'orca-web:theme:v1'")
    expect(code).not.toMatch(/deviceToken|serverPublicKey|endpoint/i)
  })
})

describe('credential-leak guard: no third-party origins hardcoded', () => {
  // Navigation links (to=/href= on anchors) are user-clicked navigation,
  // not data channels; the server sends Referrer-Policy: no-referrer so
  // even those carry nothing. Everything else — fetch, WebSocket URLs,
  // image/source literals — stays forbidden.
  const NAV_ATTR = /(?:to|href)\s*=\s*"https?:\/\//

  it('app/ and shared/ contain no non-navigation http(s):// literals', () => {
    const urlLiteral = /https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+/i
    const offenders: string[] = []
    for (const file of ALL_CLIENT_FILES) {
      const code = readFileSync(file, 'utf8')
      for (const line of code.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
          continue
        }
        if (urlLiteral.test(line) && !NAV_ATTR.test(line)) {
          offenders.push(`${file}: ${trimmed.slice(0, 80)}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
