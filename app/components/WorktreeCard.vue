<template>
  <NuxtLink
    :to="{ name: 'worktree-worktreeId', params: { worktreeId: encodedId } }"
    class="block group"
  >
    <UCard
      class="transition-all group-hover:border-primary/50 group-hover:shadow-lg shadow-primary/5"
      :ui="{ body: 'p-4 sm:p-4' }"
    >
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold text-highlighted truncate">{{ worktree.displayName }}</span>
            <UBadge v-if="worktree.isPinned" icon="i-lucide-pin" color="primary" variant="subtle" size="sm" />
            <UBadge v-if="worktree.unread" label="Unread" color="warning" variant="subtle" size="sm" />
          </div>
          <div class="text-xs text-muted truncate font-mono">
            {{ worktree.branch }}
          </div>
        </div>

        <AgentStatusDot
          :status="worktree.status"
          :label="worktree.status"
          class="shrink-0"
        />
      </div>

      <!-- Agent row -->
      <div v-if="worktree.agents.length > 0" class="mt-3 border-t border-default pt-3">
        <div v-for="agent in worktree.agents" :key="agent.paneKey" class="flex items-center gap-2 text-xs">
          <AgentStatusDot :status="agent.state" :label="agent.agentType" />
          <span class="text-muted truncate">{{ agent.taskTitle ?? agent.prompt ?? 'Working…' }}</span>
        </div>
      </div>

      <div class="mt-3 flex items-center gap-3 text-xs text-dimmed">
        <span class="inline-flex items-center gap-1">
          <span class="i-lucide-terminal text-sm" aria-hidden />
          {{ worktree.liveTerminalCount }}
        </span>
        <span v-if="worktree.linkedPR" class="inline-flex items-center gap-1">
          <span class="i-lucide-git-pull-request text-sm" aria-hidden />
          #{{ worktree.linkedPR.number }}
        </span>
        <span v-if="worktree.linkedLinearIssue" class="inline-flex items-center gap-1">
          <span class="i-lucide-square-check text-sm" aria-hidden />
          {{ worktree.linkedLinearIssue }}
        </span>
        <span class="ms-auto inline-flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          Open
          <span class="i-lucide-arrow-right text-sm" aria-hidden />
        </span>
      </div>
    </UCard>
  </NuxtLink>
</template>

<script setup lang="ts">
import type { RuntimeWorktreePsSummary } from '@shared/protocol'

const props = defineProps<{ worktree: RuntimeWorktreePsSummary }>()

// Worktree ids contain '::' and '/' — keep them URL-safe in the route param.
const encodedId = computed(() => encodeURIComponent(props.worktree.worktreeId))
</script>
