// Paired-host catalog — browser-only, mirroring the mobile app's host store.
// Pairing credentials (device tokens, host public keys) live in
// localStorage on the user's own machine and never leave the browser except
// as E2EE-encrypted WebSocket traffic to the host itself.
import { defineStore } from 'pinia'
import { OrcaRuntimeClient, type ConnectionPhase } from '~/composables/runtime/client'
import type { PairingOffer } from '@shared/pairing'

export type StoredHost = {
  hostId: string
  label: string
  endpoint: string
  deviceToken: string
  serverPublicKeyB64: string
  addedAt: number
  lastConnectedAt?: number
}

export type HostConnectionState = {
  phase: ConnectionPhase
  runtimeId?: string
  error?: string
}

const STORAGE_KEY = 'orca-web:hosts:v1'

// Vue reactivity re-assigns objects rather than deleting keys.
function omitKey<T extends Record<string, unknown>>(source: T, key: string): T {
  const next = { ...source }
  if (key in next) {
    const { [key]: _removed, ...rest } = next
    return rest as T
  }
  return next
}

function loadHosts(): StoredHost[] {
  if (import.meta.server || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as StoredHost[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * The host catalog + live connection registry. One store, one client per
 * host, exactly like the mobile app's client-context.
 */
export const useOrcaHosts = defineStore('orca-hosts', {
  state: () => ({
    hosts: [] as StoredHost[],
    connections: {} as Record<string, HostConnectionState>,
    logs: {} as Record<string, string[]>,
    activeHostId: null as string | null,
    clients: {} as Record<string, OrcaRuntimeClient>,
  }),

  getters: {
    activeHost(state): StoredHost | null {
      return state.hosts.find((h) => h.hostId === state.activeHostId) ?? null
    },
    activeConnection(state): HostConnectionState | null {
      return state.activeHostId ? state.connections[state.activeHostId] ?? null : null
    },
  },

  actions: {
    init() {
      this.hosts = loadHosts()
    },

    persist() {
      if (import.meta.server) {
        return
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.hosts))
    },

    addHostFromOffer(offer: PairingOffer): string {
      // Dedup by endpoint+token, like the mobile app's STA-1840 behavior.
      const existing = this.hosts.find(
        (h) => h.endpoint === offer.endpoint && h.deviceToken === offer.deviceToken,
      )
      if (existing) {
        existing.serverPublicKeyB64 = offer.serverPublicKeyB64
        if (offer.label) {
          existing.label = offer.label
        }
        this.persist()
        return existing.hostId
      }
      const hostId = `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      this.hosts.push({
        hostId,
        label: offer.label ?? new URL(offer.endpoint).host,
        endpoint: offer.endpoint,
        deviceToken: offer.deviceToken,
        serverPublicKeyB64: offer.serverPublicKeyB64,
        addedAt: Date.now(),
      })
      this.persist()
      return hostId
    },

    removeHost(hostId: string) {
      this.clients[hostId]?.dispose()
      this.clients = omitKey(this.clients, hostId)
      this.connections = omitKey(this.connections, hostId)
      this.logs = omitKey(this.logs, hostId)
      this.hosts = this.hosts.filter((h) => h.hostId !== hostId)
      if (this.activeHostId === hostId) {
        this.activeHostId = this.hosts[0]?.hostId ?? null
      }
      this.persist()
    },

    pushLog(hostId: string, message: string) {
      const bucket = (this.logs[hostId] ??= [])
      bucket.push(message)
      if (bucket.length > 200) {
        bucket.splice(0, bucket.length - 200)
      }
    },

    async connect(hostId: string): Promise<void> {
      const host = this.hosts.find((h) => h.hostId === hostId)
      if (!host) {
        throw new Error('Unknown host')
      }

      const existing = this.clients[hostId]
      if (existing) {
        existing.dispose()
        this.clients = omitKey(this.clients, hostId)
      }

      const client = new OrcaRuntimeClient({
        endpoint: host.endpoint,
        deviceToken: host.deviceToken,
        serverPublicKeyB64: host.serverPublicKeyB64,
        onLog: (message) => this.pushLog(hostId, message),
        onPhase: (phase) => {
          this.connections[hostId] = {
            ...this.connections[hostId],
            phase,
            error: phase === 'error' ? this.connections[hostId]?.error : undefined,
          }
        },
      })
      this.clients[hostId] = client
      this.activeHostId = hostId
      this.connections[hostId] = { phase: 'connecting' }

      try {
        await client.connect()
        this.connections[hostId] = {
          phase: 'connected',
          runtimeId: client.runtimeStatus?.runtimeId,
        }
        host.lastConnectedAt = Date.now()
        this.persist()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.connections[hostId] = { phase: 'error', error: message }
        throw err
      }
    },

    clientFor(hostId: string): OrcaRuntimeClient | null {
      return this.clients[hostId] ?? null
    },

    disconnect(hostId: string) {
      this.clients[hostId]?.dispose()
      this.clients = omitKey(this.clients, hostId)
      this.connections[hostId] = { phase: 'closed' }
    },
  },
})
