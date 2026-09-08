<template>
  <span
    class="inline-flex items-center justify-center shrink-0"
    :class="sizeClass"
    :title="tooltip"
    :aria-label="tooltip"
  >
    <span :class="iconClass" class="text-current" aria-hidden />
  </span>
</template>

<script setup lang="ts">
import type { TerminalActivityState } from '@shared/protocol'

const props = withDefaults(
  defineProps<{
    activity: TerminalActivityState
    /** pixel size of the icon box */
    size?: number | string
  }>(),
  { size: '1rem' },
)

const sizeClass = computed(() => ({ fontSize: typeof props.size === 'number' ? `${props.size}px` : props.size }))

// Orca desktop badges: spinner while processing, a question bubble while
// asking, a pulsing dot while a shell command runs, nothing when idle.
const iconClass = computed(() => {
  switch (props.activity) {
    case 'processing':
      return 'i-lucide-loader-circle animate-spin text-primary'
    case 'asking':
      return 'i-lucide-message-circle-question text-warning animate-pulse'
    case 'running':
      return 'i-lucide-circle-solid text-success animate-pulse text-[0.6em]'
    default:
      return 'i-lucide-circle text-dimmed text-[0.6em]'
  }
})

const tooltip = computed(() => {
  switch (props.activity) {
    case 'processing':
      return 'Agent is processing'
    case 'asking':
      return 'Agent is asking a question'
    case 'running':
      return 'Command is running'
    default:
      return 'Idle'
  }
})
</script>
