<template>
  <div v-if="host" class="flex items-center gap-1.5 text-xs">
    <span class="text-muted">{{ host.label }}</span>
    <UBadge
      :color="badgeColor"
      :icon="badgeIcon"
      :label="badgeLabel"
      variant="subtle"
      size="sm"
    />
  </div>
  <UBadge v-else color="neutral" variant="subtle" size="sm" icon="i-lucide-unplug" label="No host" />
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useOrcaHosts } from '~/stores/hosts'

const store = useOrcaHosts()
const { activeHost, activeConnection } = storeToRefs(store)

const host = computed(() => activeHost.value)
const phase = computed(() => activeConnection.value?.phase ?? 'idle')

const badgeColor = computed(() => {
  switch (phase.value) {
    case 'connected':
      return 'success'
    case 'error':
      return 'error'
    case 'connecting':
    case 'handshaking':
    case 'authenticating':
      return 'warning'
    default:
      return 'neutral'
  }
})

const badgeIcon = computed(() => {
  switch (phase.value) {
    case 'connected':
      return 'i-lucide-check'
    case 'error':
      return 'i-lucide-triangle-alert'
    case 'connecting':
    case 'handshaking':
    case 'authenticating':
      return 'i-lucide-loader-circle animate-spin'
    default:
      return 'i-lucide-unplug'
  }
})

const badgeLabel = computed(() => {
  switch (phase.value) {
    case 'connected':
      return 'Live'
    case 'error':
      return 'Error'
    case 'connecting':
      return 'Dialing…'
    case 'handshaking':
      return 'E2EE…'
    case 'authenticating':
      return 'Auth…'
    case 'closed':
      return 'Offline'
    default:
      return 'Offline'
  }
})
</script>
