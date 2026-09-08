<template>
  <footer
    class="h-9 shrink-0 border-t border-default bg-default/80 backdrop-blur z-40 sticky bottom-0 flex items-center gap-3 px-3 sm:px-4 text-xs text-muted overflow-x-auto"
  >
    <!-- Rate limits per account -->
    <div v-if="accounts.length > 0" class="flex items-center gap-3 shrink-0">
      <div
        v-for="account in accounts"
        :key="account.provider"
        class="flex items-center gap-1.5"
        :title="`${account.accountLabel} — ${account.usage ?? ''}`"
      >
        <span
          class="shrink-0"
          :class="providerIcon(account.provider)"
          aria-hidden
        />
        <span
          class="font-medium"
          :class="account.limitedUntil ? 'text-error' : isLow(account) ? 'text-warning' : 'text-muted'"
        >
          {{ account.rateLimitReset ?? account.provider }}
        </span>
      </div>
    </div>

    <USeparator v-if="accounts.length > 0 && metrics" orientation="vertical" class="h-4 shrink-0" />

    <!-- System metrics -->
    <div v-if="metrics" class="flex items-center gap-3 shrink-0">
      <span class="flex items-center gap-1" title="CPU">
        <span class="i-lucide-cpu text-sm shrink-0" aria-hidden />
        {{ metrics.cpuPercent }}%
      </span>
      <span class="flex items-center gap-1" title="Memory">
        <span class="i-lucide-memory-stick text-sm shrink-0" aria-hidden />
        {{ metrics.memoryPercent }}% ({{ gb(metrics.memoryUsedMb) }}/{{ gb(metrics.memoryTotalMb) }}G)
      </span>
      <span class="flex items-center gap-1" title="Active agents">
        <span class="i-lucide-bot text-sm shrink-0" aria-hidden />
        {{ metrics.activeAgents }}
      </span>
      <span class="flex items-center gap-1" title="Running processes">
        <span class="i-lucide-terminal text-sm shrink-0" aria-hidden />
        {{ metrics.runningProcesses }}
      </span>
    </div>

    <div v-if="!accounts.length && !metrics" class="text-dimmed">
      {{ disconnected ? 'offline' : 'connecting…' }}
    </div>

    <!-- Right side: version + link -->
    <div class="ms-auto flex items-center gap-2 shrink-0 text-dimmed">
      <span class="hidden sm:inline">orca-web</span>
      <NuxtLink
        to="https://github.com/JuanmanDev/orca-web"
        target="_blank"
        class="hover:text-primary transition-colors"
      >
        v{{ version }}
      </NuxtLink>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useOrcaHosts } from '~/stores/hosts'
import type { RuntimeAccount, RuntimeSystemMetrics } from '@shared/protocol'

const store = useOrcaHosts()
const { activeConnection } = storeToRefs(store)

const accounts = ref<RuntimeAccount[]>([])
const metrics = ref<RuntimeSystemMetrics | null>(null)
const version = '0.2.0'

const disconnected = computed(
  () => activeConnection.value?.phase !== 'connected',
)

// A rate limit within ~30min is worth flagging amber.
function isLow(account: RuntimeAccount): boolean {
  const m = /(\d+)\s*m/.exec(account.rateLimitReset ?? '')
  if (!m) return false
  return Number(m[1]) <= 30
}

function providerIcon(provider: string): string {
  switch (provider) {
    case 'claude':
      return 'i-simple-icons-anthropic'
    case 'codex':
      return 'i-simple-icons-openai'
    case 'gemini':
      return 'i-simple-icons-google-gemini'
    default:
      return 'i-lucide-key-round'
  }
}

function gb(mb: number): string {
  return (mb / 1024).toFixed(mb >= 10240 ? 0 : 1)
}

let pollTimer: ReturnType<typeof setInterval> | null = null

async function poll() {
  const client = store.activeHostId ? store.clientFor(store.activeHostId) : null
  if (!client) {
    accounts.value = []
    metrics.value = null
    return
  }
  try {
    const [acct, sys] = await Promise.allSettled([client.getAccounts(), client.getSystemMetrics()])
    if (acct.status === 'fulfilled') {
      accounts.value = acct.value.accounts ?? []
    }
    if (sys.status === 'fulfilled') {
      metrics.value = sys.value
    }
  } catch {
    // Bottom bar is best-effort; failures just keep the last good values.
  }
}

onMounted(() => {
  void poll()
  pollTimer = setInterval(() => {
    if (activeConnection.value?.phase === 'connected') {
      void poll()
    }
  }, 15_000)
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
})
</script>
