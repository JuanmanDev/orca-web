<script setup lang="ts">
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { storeToRefs } from 'pinia'
import { useOrcaHosts } from '~/stores/hosts'
import type {
  RuntimeTerminalSummary,
  TerminalProfile,
} from '@shared/protocol'

// Route: /worktree/:worktreeId — the param is encodeURIComponent'd by the
// WorktreeCard link because ids contain '::' and '/'.
const route = useRoute()
const router = useRouter()
const store = useOrcaHosts()
const { activeConnection } = storeToRefs(store)

const worktreeId = computed(() => decodeURIComponent(String(route.params.worktreeId ?? '')))

const terminals = ref<RuntimeTerminalSummary[]>([])
const selectedHandle = ref('')
const profiles = ref<TerminalProfile[]>([])
const loadError = ref('')
const terminalEl = ref<HTMLElement | null>(null)

type LayoutMode = 'fit' | 'full' | 'host'
const layoutMode = ref<LayoutMode>('fit')
const showAddMenu = ref(false)
const creating = ref(false)

let xterm: Terminal | null = null
let fitAddon: FitAddon | null = null
let subscription: { unsubscribe: () => void } | null = null
let resizeObserver: ResizeObserver | null = null
// Debounces resize storms while an xterm re-fit is in flight.
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let lastSentCols = 0
let lastSentRows = 0
useHead({ title: 'Session' })

const worktreeLabel = computed(() => {
  const short = worktreeId.value.split('::').pop() ?? worktreeId.value
  return short.split('/').pop() ?? short
})

const selectedTerminal = computed(
  () => terminals.value.find((t) => t.handle === selectedHandle.value) ?? null,
)

// -----------------------------------------------------------------------
// Terminal lifecycle
// -----------------------------------------------------------------------

function buildXterm(): Terminal {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    theme: {
      background: '#0b0e12',
    },
    allowProposedApi: true,
  })
  return term
}

function attachXterm() {
  if (!terminalEl.value) {
    return
  }
  xterm?.dispose()
  xterm = buildXterm()
  fitAddon = new FitAddon()
  xterm.loadAddon(fitAddon)
  xterm.open(terminalEl.value)
  applyLayout()
}

function applyLayout() {
  if (!xterm || !fitAddon || !terminalEl.value) {
    return
  }
  const el = terminalEl.value
  if (layoutMode.value === 'full') {
    // Full-window: stretch the pane to the viewport below the header.
    el.style.height = 'calc(100vh - 12rem)'
    el.style.maxHeight = 'none'
  } else {
    el.style.height = ''
    el.style.maxHeight = layoutMode.value === 'host' ? '60vh' : '60vh'
  }
  try {
    fitAddon.fit()
    syncHostSize()
  } catch {
    // fit() throws when the container is display:none (no terminal yet).
  }
}

/** Push the client's cols/rows to the host PTY (terminal.resize). */
function syncHostSize() {
  if (!xterm || !selectedHandle.value) {
    return
  }
  const cols = xterm.cols
  const rows = xterm.rows
  if (cols === lastSentCols && rows === lastSentRows) {
    return
  }
  lastSentCols = cols
  lastSentRows = rows
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (client) {
    void client.resizeTerminal(selectedHandle.value, cols, rows).catch(() => {})
  }
}

function subscribeTerminal() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client || !selectedHandle.value || !xterm) {
    return
  }
  subscription?.unsubscribe()
  xterm.reset()
  lastSentCols = 0
  lastSentRows = 0

  // Fit before subscribing so the scrollback echoes the real viewport dims —
  // the client resubscribes until they match (upstream contract).
  applyLayout()

  subscription = client.subscribeTerminal(
    selectedHandle.value,
    { cols: xterm.cols, rows: xterm.rows },
    {
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
    },
  )

  // Wire keyboard input from the browser into the host PTY.
  xterm.onData((data) => {
    void client.sendTerminalInput(selectedHandle.value, data)
  })
}

// -----------------------------------------------------------------------
// Data loading
// -----------------------------------------------------------------------

async function loadTerminals() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client) {
    terminals.value = []
    return
  }
  try {
    const result = await client.listTerminalSummaries(`id:${worktreeId.value}`)
    terminals.value = result.terminals ?? []
    // Keep the selection stable across refreshes; fall back to active/first.
    const stillThere = terminals.value.some((t) => t.handle === selectedHandle.value)
    if (!stillThere) {
      const active = terminals.value.find((t) => t.activity !== 'idle') ?? terminals.value[0]
      selectedHandle.value = active?.handle ?? ''
    }
    loadError.value = ''
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

async function loadProfiles() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client) {
    return
  }
  try {
    const result = await client.listTerminalProfiles()
    profiles.value = result.profiles ?? []
  } catch {
    // Older hosts answer method_not_found; the add menu just stays empty.
  }
}

// -----------------------------------------------------------------------
// Terminal creation / closing
// -----------------------------------------------------------------------

async function createTerminalFromProfile(profile: TerminalProfile) {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client) {
    return
  }
  creating.value = true
  showAddMenu.value = false
  try {
    // Idempotent mutation id: retry after a lost reply reuses the handle.
    const mutationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { handle } = await client.createTerminal(`id:${worktreeId.value}`, profile.id, mutationId)
    await loadTerminals()
    selectedHandle.value = handle
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

async function closeSelectedTerminal() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client || !selectedHandle.value) {
    return
  }
  const handle = selectedHandle.value
  try {
    await client.closeTerminal(handle)
    await loadTerminals()
    if (selectedHandle.value === handle || !terminals.value.some((t) => t.handle === selectedHandle.value)) {
      selectedHandle.value = terminals.value[0]?.handle ?? ''
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

// -----------------------------------------------------------------------
// Reconnect / mount
// -----------------------------------------------------------------------

async function reconnect() {
  const host = store.activeHost
  if (!host) {
    router.push('/connect')
    return
  }
  try {
    await store.connect(host.hostId)
    await loadTerminals()
    await loadProfiles()
  } catch {
    // The status bar / badge on this page shows the failure.
  }
}

// Deep-link support: ?terminal=<handle> opens that tab directly;
// ?new=1 opens the add-terminal menu.
const requestedTerminal = computed(() => String(route.query.terminal ?? ''))
const wantsNewTerminal = computed(() => route.query.new === '1')
watch(requestedTerminal, (handle) => {
  if (handle && terminals.value.some((t) => t.handle === handle)) {
    selectedHandle.value = handle
  }
})

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
  await loadProfiles()
  attachXterm()
  if (wantsNewTerminal.value) {
    showAddMenu.value = true
  }
  subscribeTerminal()

  resizeObserver = new ResizeObserver(() => {
    // Coalesce resize events; only 'fit' re-flows, 'host' keeps host rows.
    if (resizeTimer) {
      clearTimeout(resizeTimer)
    }
    resizeTimer = setTimeout(() => {
      if (layoutMode.value !== 'host' && xterm && fitAddon) {
        try {
          fitAddon.fit()
          syncHostSize()
        } catch {
          // hidden pane
        }
      }
    }, 150)
  })
  if (terminalEl.value) {
    resizeObserver.observe(terminalEl.value)
  }
  window.addEventListener('resize', onWindowResize)
})

function onWindowResize() {
  if (layoutMode.value !== 'host' && xterm && fitAddon) {
    try {
      fitAddon.fit()
      syncHostSize()
    } catch {
      // hidden pane
    }
  }
}

watch(selectedHandle, () => {
  subscribeTerminal()
})

watch(layoutMode, () => {
  applyLayout()
})

// Poll terminal states so tab badges (asking/processing/idle) stay live.
let statePoll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  statePoll = setInterval(() => {
    if (activeConnection.value?.phase === 'connected') {
      void loadTerminals()
    }
  }, 5_000)
})

onBeforeUnmount(() => {
  subscription?.unsubscribe()
  subscription = null
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeTimer) {
    clearTimeout(resizeTimer)
  }
  window.removeEventListener('resize', onWindowResize)
  if (statePoll) {
    clearInterval(statePoll)
  }
  xterm?.dispose()
  xterm = null
})
</script>

<template>
  <div class="w-full px-3 sm:px-4 lg:px-6 py-4 flex flex-col gap-3">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 flex-wrap">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        label="Worktrees"
        to="/"
      />
      <h1 class="text-base font-semibold text-highlighted truncate">{{ worktreeLabel }}</h1>
      <UBadge
        v-if="activeConnection?.phase === 'connected'"
        label="Live"
        color="success"
        variant="subtle"
        size="sm"
      />

      <div class="ms-auto flex items-center gap-1.5">
        <!-- Layout mode toggle -->
        <UTooltip text="Fit to container">
          <UButton
            :variant="layoutMode === 'fit' ? 'solid' : 'ghost'"
            color="neutral"
            size="xs"
            icon="i-lucide-maximize"
            @click="layoutMode = 'fit'"
          />
        </UTooltip>
        <UTooltip text="Full window height">
          <UButton
            :variant="layoutMode === 'full' ? 'solid' : 'ghost'"
            color="neutral"
            size="xs"
            icon="i-lucide-expand"
            @click="layoutMode = 'full'"
          />
        </UTooltip>
        <UTooltip text="Match host PTY size (no reflow)">
          <UButton
            :variant="layoutMode === 'host' ? 'solid' : 'ghost'"
            color="neutral"
            size="xs"
            icon="i-lucide-unfold-vertical"
            @click="layoutMode = 'host'"
          />
        </UTooltip>

        <UButton
          v-if="activeConnection?.phase !== 'connected'"
          icon="i-lucide-refresh-cw"
          size="xs"
          label="Reconnect"
          @click="reconnect"
        />
      </div>
    </div>

    <UAlert
      v-if="loadError"
      icon="i-lucide-triangle-alert"
      color="error"
      variant="subtle"
      :description="loadError"
      class="py-2"
    />

    <!-- Terminal tabs (Orca desktop style) -->
    <div
      v-if="terminals.length > 0"
      class="flex items-center gap-1 overflow-x-auto border-b border-default pb-1"
    >
      <button
        v-for="term in terminals"
        :key="term.handle"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-md text-xs whitespace-nowrap transition-colors border-b-2 -mb-px"
        :class="term.handle === selectedHandle
          ? 'border-primary bg-elevated/60 text-highlighted'
          : 'border-transparent text-muted hover:text-highlighted hover:bg-elevated/40'"
        @click="selectedHandle = term.handle"
      >
        <TerminalActivityIcon :activity="term.activity" size="0.85rem" />
        <span class="truncate max-w-40 sm:max-w-52">{{ term.title }}</span>
        <span
          v-if="term.agentType"
          class="opacity-60 shrink-0"
          :class="term.agentType === 'claude' ? 'i-simple-icons-anthropic' : term.agentType === 'codex' ? 'i-simple-icons-openai' : 'i-lucide-bot'"
          aria-hidden
        />
      </button>

      <!-- Add terminal -->
      <UPopover v-model:open="showAddMenu">
        <button
          class="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-dimmed hover:text-primary transition-colors shrink-0"
          title="Add terminal"
        >
          <span class="i-lucide-plus" aria-hidden />
        </button>
        <template #content>
          <div class="flex flex-col p-1 min-w-52">
            <div v-if="creating" class="flex items-center gap-2 px-3 py-2 text-xs text-muted">
              <span class="i-lucide-loader-circle animate-spin" aria-hidden />
              Creating…
            </div>
            <template v-else>
              <button
                v-for="profile in profiles"
                :key="profile.id"
                class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm hover:bg-elevated/60 transition-colors text-left"
                @click="createTerminalFromProfile(profile)"
              >
                <span class="shrink-0" :class="profile.icon" aria-hidden />
                <span class="flex-1 truncate">{{ profile.label }}</span>
                <span
                  class="text-[10px] uppercase text-dimmed shrink-0"
                  :class="profile.kind === 'agent' ? 'text-primary' : ''"
                >
                  {{ profile.kind }}
                </span>
              </button>
              <div v-if="profiles.length === 0" class="px-3 py-2 text-xs text-dimmed">
                No profiles on this host.
              </div>
            </template>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- Terminal pane -->
    <div
      v-show="selectedHandle"
      class="terminal-pane w-full"
      :class="layoutMode === 'full' ? 'terminal-pane-full' : ''"
    >
      <div ref="terminalEl" class="h-full w-full" />
    </div>

    <div v-if="terminals.length === 0 && !loadError" class="flex flex-col items-center gap-3 text-muted text-sm py-10">
      <span>No terminals on this worktree yet.</span>
      <UButton
        v-if="profiles.length > 0"
        icon="i-lucide-plus"
        size="sm"
        label="Add a terminal"
        @click="showAddMenu = true"
      />
    </div>

    <!-- Close terminal (only when one is selected) -->
    <div v-if="selectedHandle" class="flex items-center gap-2">
      <UButton
        icon="i-lucide-x"
        size="xs"
        color="error"
        variant="soft"
        label="Close terminal"
        @click="closeSelectedTerminal"
      />
      <span v-if="selectedTerminal" class="text-xs text-dimmed">
        {{ selectedTerminal.activity }} · updated {{ new Date(selectedTerminal.updatedAt).toLocaleTimeString() }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.terminal-pane {
  background: #0b0e12;
  border-radius: 0.5rem;
  min-height: 320px;
  height: 60vh;
  padding: 0.5rem 0 0 0.5rem;
}

.terminal-pane-full {
  height: calc(100vh - 13rem);
  max-height: none;
}
</style>
