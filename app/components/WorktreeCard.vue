<template>
  <NuxtLink
    :to="{ name: 'worktree-worktreeId', params: { worktreeId: encodedId } }"
    class="block group"
  >
    <UCard
      :ui="{ body: 'p-3 sm:p-4' }"
      class="transition-all group-hover:border-primary/50 group-hover:shadow-md h-full"
    >
      <!-- Row 1: name, branch, status -->
      <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
        <span
          class="inline-block size-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: statusColor }"
          :aria-label="worktree.status"
        />
        <span class="font-semibold text-highlighted truncate max-w-[45%] sm:max-w-none">
          {{ worktree.displayName }}
        </span>
        <UBadge
          v-if="worktree.isPinned"
          icon="i-lucide-pin"
          color="primary"
          variant="subtle"
          size="sm"
        />
        <code class="text-xs text-muted truncate flex-1 min-w-0 hidden md:inline">{{ worktree.branch }}</code>

        <div class="ms-auto flex items-center gap-2 shrink-0">
          <UBadge
            :label="worktree.workspaceStatus"
            color="neutral"
            variant="subtle"
            size="sm"
            class="capitalize"
          />
          <span
            v-if="worktree.unread"
            class="inline-block size-2 rounded-full bg-warning shrink-0"
            title="Unread output"
          />
        </div>
      </div>

      <!-- Row 2: terminal chips with activity state (desktop widths) -->
      <div v-if="terminalChips.length > 0" class="mt-2.5 flex items-center gap-1.5 flex-wrap">
        <button
          v-for="chip in terminalChips"
          :key="chip.handle"
          class="flex items-center gap-1.5 px-2 py-1 rounded-md border border-default bg-elevated/50 text-xs hover:border-primary/50 hover:bg-elevated transition-colors"
          :title="`Open ${chip.title}`"
          @click.prevent.stop="goToTerminal(chip.handle)"
        >
          <TerminalActivityIcon :activity="chip.activity" size="0.85rem" />
          <span class="truncate max-w-32 sm:max-w-40">{{ chip.title }}</span>
          <span
            v-if="chip.agentType"
            class="shrink-0 opacity-60"
            :class="agentIcon(chip.agentType)"
            aria-hidden
          />
        </button>
        <button
          class="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-default text-xs text-dimmed hover:text-primary hover:border-primary/50 transition-colors"
          title="Add terminal"
          @click.prevent.stop="goToTerminal()"
        >
          <span class="i-lucide-plus" aria-hidden />
        </button>
      </div>

      <!-- Row 3: linked items + meta -->
      <div class="mt-2.5 flex items-center gap-2.5 text-xs text-dimmed flex-wrap">
        <span v-if="worktree.linkedPR" class="inline-flex items-center gap-1">
          <span class="i-lucide-git-pull-request" aria-hidden />
          #{{ worktree.linkedPR.number }}
          <span v-if="worktree.linkedPR.state === 'draft'" class="uppercase">(draft)</span>
        </span>
        <span v-if="worktree.linkedLinearIssue" class="inline-flex items-center gap-1">
          <span class="i-lucide-square-check" aria-hidden />
          {{ worktree.linkedLinearIssue }}
        </span>
        <span v-if="worktree.lastOutputAt" class="inline-flex items-center gap-1" :title="new Date(worktree.lastOutputAt).toLocaleString()">
          <span class="i-lucide-clock" aria-hidden />
          {{ relativeTime(worktree.lastOutputAt) }}
        </span>
        <span class="ms-auto inline-flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          Open
          <span class="i-lucide-arrow-right" aria-hidden />
        </span>
      </div>
    </UCard>
  </NuxtLink>
</template>

<script setup lang="ts">
import type { RuntimeWorktreePsSummary } from '@shared/protocol'

const props = defineProps<{ worktree: RuntimeWorktreePsSummary }>()
const router = useRouter()

// Worktree ids contain '::' and '/' — keep them URL-safe in the route param.
const encodedId = computed(() => encodeURIComponent(props.worktree.worktreeId))

const terminalChips = computed(() => (props.worktree.terminals ?? []).slice(0, 6))

const statusColor = computed(() => {
  switch (props.worktree.status) {
    case 'working':
      return 'var(--ui-primary)'
    case 'done':
      return 'var(--ui-success)'
    default:
      return 'var(--ui-text-dimmed)'
  }
})

function agentIcon(agentType: string): string {
  switch (agentType) {
    case 'claude':
      return 'i-simple-icons-anthropic'
    case 'codex':
      return 'i-simple-icons-openai'
    case 'gemini':
      return 'i-simple-icons-google-gemini'
    default:
      return 'i-lucide-bot'
  }
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function goToTerminal(handle?: string) {
  void router.push({
    name: 'worktree-worktreeId',
    params: { worktreeId: encodedId.value },
    query: handle ? { terminal: handle } : { new: '1' },
  })
}
</script>
