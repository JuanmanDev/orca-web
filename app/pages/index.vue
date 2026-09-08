<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useOrcaHosts } from '~/stores/hosts'
import type { RuntimeWorktreePsSummary, RuntimeRepo } from '@shared/protocol'
import WorktreeCard from '~/components/WorktreeCard.vue'

useHead({ title: 'Worktrees' })
definePageMeta({ layout: 'default' })

const store = useOrcaHosts()
const { activeHost, activeConnection } = storeToRefs(store)
const showLog = ref(false)

const worktrees = ref<RuntimeWorktreePsSummary[]>([])
const repos = ref<RuntimeRepo[]>([])
const loading = ref(false)
const loadError = ref('')
const autoRefresh = ref(true)
let refreshTimer: ReturnType<typeof setInterval> | null = null

const grouped = computed(() => {
  const byRepo = new Map<string, RuntimeWorktreePsSummary[]>()
  for (const wt of worktrees.value) {
    const bucket = byRepo.get(wt.repo) ?? []
    bucket.push(wt)
    byRepo.set(wt.repo, bucket)
  }
  return [...byRepo.entries()].map(([repo, rows]) => ({
    repo,
    color: repos.value.find((r) => r.displayName === repo)?.badgeColor ?? '#64748b',
    rows: rows.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      return (b.sortOrder ?? 0) - (a.sortOrder ?? 0)
    }),
  }))
})

async function refresh() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client) {
    worktrees.value = []
    repos.value = []
    return
  }
  try {
    const [ps, repoList] = await Promise.all([client.listWorktrees(), client.listRepos()])
    worktrees.value = ps.worktrees ?? []
    repos.value = repoList.repos ?? []
    loadError.value = ''
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

async function connectActive() {
  if (!activeHost.value) {
    return
  }
  loading.value = true
  try {
    await store.connect(activeHost.value.hostId)
    await refresh()
  } catch {
    // store already recorded the error in activeConnection
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  store.init()
  if (store.hosts.length > 0 && !store.activeHostId) {
    store.activeHostId = store.hosts[0]!.hostId
  }
  if (store.hosts.length === 0) {
    return
  }
  void connectActive()
  refreshTimer = setInterval(() => {
    if (autoRefresh.value) {
      void refresh()
    }
  }, 5000)
})

onBeforeUnmount(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
})
</script>

<template>
  <div class="w-full px-3 sm:px-4 lg:px-6 py-6">
    <!-- Empty state: no hosts -->
    <div v-if="store.hosts.length === 0" class="flex flex-col items-center gap-4 py-20 text-center max-w-xl mx-auto">
      <span class="i-simple-icons-orca text-6xl text-primary" aria-hidden />
      <h1 class="text-2xl font-bold text-highlighted">Connect your Orca runtime</h1>
      <p class="text-muted text-sm">
        orca-web talks to the same encrypted runtime endpoint the Orca mobile app uses.
        Pair with the QR code from <span class="text-highlighted">Settings → Mobile</span> in your
        Orca desktop app, or point it at a headless <code class="text-xs">orca serve</code> host.
      </p>
      <div class="flex flex-wrap items-center justify-center gap-3">
        <UButton to="/connect" icon="i-lucide-qr-code" size="lg" label="Add your first host" />
        <UButton
          to="https://www.onorca.dev/docs/mobile"
          target="_blank"
          icon="i-lucide-book-open"
          size="lg"
          color="neutral"
          variant="soft"
          label="How pairing works"
        />
      </div>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <h1 class="text-2xl font-bold text-highlighted me-auto">Worktrees</h1>
        <USwitch v-model="autoRefresh" label="Auto-refresh" size="sm" />
        <UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="soft" label="Refresh" @click="refresh" />
      </div>

      <!-- Connection error -->
      <UAlert
        v-if="activeConnection?.phase === 'error'"
        icon="i-lucide-triangle-alert"
        color="error"
        variant="subtle"
        :title="`Could not connect to ${activeHost?.label}`"
        :description="activeConnection.error"
        class="mb-6"
      >
        <template #actions>
          <UButton size="sm" :loading="loading" label="Retry" @click="connectActive" />
          <UButton size="sm" color="neutral" variant="soft" label="Connection log" @click="showLog = !showLog" />
        </template>
      </UAlert>

      <UCard v-if="showLog" class="mb-6">
        <template #header>
          <span class="text-sm font-semibold text-highlighted">Connection log</span>
        </template>
        <pre class="text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">{{
          (store.logs[activeHost!.hostId] ?? []).join('\n') || 'No log entries.'
        }}</pre>
      </UCard>

      <!-- Connecting state -->
      <div v-if="loading || ['connecting', 'handshaking', 'authenticating'].includes(activeConnection?.phase ?? '')" class="flex items-center gap-3 text-muted py-12 justify-center">
        <span class="i-lucide-loader-circle animate-spin text-xl" aria-hidden />
        <span class="text-sm">Establishing encrypted connection…</span>
      </div>

      <div v-else-if="grouped.length === 0 && activeConnection?.phase === 'connected'" class="text-muted py-12 text-center text-sm">
        No worktrees on this host yet.
      </div>

      <div v-else class="flex flex-col gap-6">
        <section v-for="group in grouped" :key="group.repo" :aria-label="`Repo ${group.repo}`">
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-block size-2.5 rounded-full" :style="{ backgroundColor: group.color }" />
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted">{{ group.repo }}</h2>
            <UBadge :label="String(group.rows.length)" color="neutral" variant="subtle" size="sm" />
          </div>
          <!-- Wider grids: 2 cols on tablet, 3 on lg, 4 on 2xl -->
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            <WorktreeCard
              v-for="wt in group.rows"
              :key="wt.worktreeId"
              :worktree="wt"
            />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
