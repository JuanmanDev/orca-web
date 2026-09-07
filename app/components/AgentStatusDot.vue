<template>
  <div class="flex items-center gap-3">
    <span
      class="inline-block size-2 rounded-full shrink-0"
      :class="status === 'working' ? 'bg-primary animate-pulse' : status === 'done' ? 'bg-success' : status === 'waiting' ? 'bg-warning' : 'bg-muted'"
      :aria-label="status"
    />
    <span class="text-sm">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    status: string
    label: string
  }>(),
  {},
)
</script>
