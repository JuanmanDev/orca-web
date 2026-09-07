<script setup lang="ts">
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { storeToRefs } from 'pinia'
import { useOrcaHosts } from '~/stores/hosts'
import type { RuntimeTerminal } from '@shared/protocol'

// Route: /worktree/:worktreeId — the param is encodeURIComponent'd by the
// WorktreeCard link because ids contain '::' and '/'.
const route = useRoute()
const router = useRouter()
const store = useOrcaHosts()
const { activeConnection } = storeToRefs(store)

const worktreeId = computed(() => decodeURIComponent(String(route.params.worktreeId ?? '')))

const terminals = ref<RuntimeTerminal[]>([])
const selectedHandle = ref('')
const loadError = ref('')
const terminalEl = ref<HTMLElement | null>(null)

let xterm: Terminal | null = null
let subscription: { unsubscribe: () => void } | null = null
let resizeObserver: ResizeObserver | null = null

useHead({ title: 'Session' })

const worktreeLabel = computed(() => {
  const short = worktreeId.value.split('::').pop() ?? worktreeId.value
  return short.split('/').pop() ?? short
})

async function loadTerminals() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client) {
    terminals.value = []
    return
  }
  try {
    const result = await client.listTerminals(`id:${worktreeId.value}`)
    terminals.value = result.terminals ?? []
    const active = terminals.value.find((t) => t.isActive) ?? terminals.value[0]
    if (active && !terminals.value.some((t) => t.handle === selectedHandle.value)) {
      selectedHandle.value = active.handle
    }
    if (!active) {
      selectedHandle.value = ''
    }
    loadError.value = ''
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

function attachXterm() {
  if (!terminalEl.value) {
    return
  }
  xterm?.dispose()
  xterm = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    theme: {
      background: '#0b0e12',
    },
    allowProposedApi: true,
  })
  xterm.open(terminalEl.value)
}

function subscribeTerminal() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client || !selectedHandle.value || !xterm) {
    return
  }
  subscription?.unsubscribe()
  xterm.reset()

  const viewport = {
    cols: Math.max(xterm.cols, 40),
    rows: Math.max(xterm.rows, 10),
  }

  subscription = client.subscribeTerminal(selectedHandle.value, viewport, {
    onScrollback: (event) => {
      xterm?.reset()
      xterm?.write(event.serialized)
    },
    onData: (chunk) => {
      xterm?.write(chunk)
    },
    onEnd: () => {
      xterm?.write('\r\n\x1b[90m— stream ended —\x1b[0m\r\n')
    },
  })

  // Wire keyboard input from the browser into the host PTY.
  xterm.onData((data) => {
    void client.sendTerminalInput(selectedHandle.value, data)
  })
}

async function reconnect() {
  const host = store.activeHost
  if (!host) {
    router.push('/connect')
    return
  }
  try {
    await store.connect(host.hostId)
    await loadTerminals()
  } catch {
    // badge/log on this page shows the failure
  }
}

onMounted(async () => {
  store.init()
  if (store.hosts.length === 0) {
    router.push('/connect')
    return
  }
  if (!store.activeHostId) {
    store.activeHostId = store.hosts[0]!.hostId
  }
  if (activeConnection.value?.phase !== 'connected') {
    await reconnect()
  }
  await loadTerminals()
  attachXterm()
  subscribeTerminal()

  resizeObserver = new ResizeObserver(() => {
    // xterm measures itself; nothing to forward until the runtime supports
    // terminal.resize (not part of the shared contract subset yet).
  })
  if (terminalEl.value) {
    resizeObserver.observe(terminalEl.value)
  }
})

watch(selectedHandle, () => {
  subscribeTerminal()
})

onBeforeUnmount(() => {
  subscription?.unsubscribe()
  subscription = null
  resizeObserver?.disconnect()
  resizeObserver = null
  xterm?.dispose()
  xterm = null
})
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        label="Worktrees"
        to="/"
      />
      <h1 class="text-lg font-semibold text-highlighted">{{ worktreeLabel }}</h1>
      <UBadge
        v-if="activeConnection?.phase === 'connected'"
        label="Live"
        color="success"
        variant="subtle"
        size="sm"
      />
      <USelect
        v-if="terminals.length > 0"
        v-model="selectedHandle"
        :items="terminals.map((t) => ({ label: t.title, value: t.handle }))"
        size="sm"
        class="w-56"
      />
      <UButton
        v-if="activeConnection?.phase !== 'connected'"
        icon="i-lucide-refresh-cw"
        size="sm"
        label="Reconnect"
        @click="reconnect"
      />
    </div>

    <UAlert
      v-if="loadError"
      icon="i-lucide-triangle-alert"
      color="error"
      variant="subtle"
      :description="loadError"
    />

    <div v-if="terminals.length === 0 && !loadError" class="text-muted text-sm py-8 text-center">
      No terminals on this worktree.
    </div>

    <div v-show="selectedHandle" class="terminal-pane" data-testid="terminal-pane">
      <div ref="terminalEl" class="h-full w-full" />
    </div>
  </div>
</template>
