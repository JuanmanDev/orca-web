<template>
  <div class="min-h-screen flex flex-col bg-default text-default">
    <!-- Orca-style compact header -->
    <header
      class="h-12 shrink-0 border-b border-default backdrop-blur z-50 sticky top-0 bg-default/80"
    >
      <div class="flex items-center gap-2 px-3 sm:px-4 h-full">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold text-highlighted shrink-0">
          <span class="i-simple-icons-orca text-xl text-primary shrink-0" aria-hidden />
          <span class="hidden sm:inline text-sm">Orca</span>
        </NuxtLink>

        <USeparator orientation="vertical" class="h-5" />

        <nav class="flex items-center gap-0.5 min-w-0 overflow-x-auto">
          <UButton
            to="/"
            icon="i-lucide-layout-dashboard"
            variant="ghost"
            color="neutral"
            size="sm"
            :label="isMobile ? undefined : 'Worktrees'"
          />
          <UButton
            to="/connect"
            icon="i-lucide-qr-code"
            variant="ghost"
            color="neutral"
            size="sm"
            :label="isMobile ? undefined : 'Add host'"
          />
        </nav>

        <div class="ms-auto flex items-center gap-1.5">
          <!-- Theme controls -->
          <UTooltip text="Color mode">
            <UButton
              :icon="colorModeIcon"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="cycleColorMode"
            />
          </UTooltip>
          <UPopover>
            <UTooltip text="Accent color">
              <UButton icon="i-lucide-palette" variant="ghost" color="neutral" size="sm" />
            </UTooltip>
            <template #content>
              <div class="flex items-center gap-1.5 p-3">
                <button
                  v-for="accentOption in accentSwatches"
                  :key="accentOption.accent"
                  class="size-5 rounded-full border-2 transition-transform hover:scale-110"
                  :class="theme.accent === accentOption.accent ? 'border-(--ui-text)' : 'border-transparent'"
                  :style="{ backgroundColor: accentOption.color }"
                  :aria-label="accentOption.accent"
                  @click="theme.setAccent(accentOption.accent)"
                />
              </div>
            </template>
          </UPopover>

          <HostStatusBadge />
        </div>
      </div>
    </header>

    <!-- Full-width main; the dashboard manages its own max-width -->
    <main class="flex-1 w-full">
      <slot />
    </main>

    <!-- Orca-style bottom status bar -->
    <StatusBar />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useThemeStore, type ThemeAccent, type ThemeColorMode } from '~/stores/theme'
import HostStatusBadge from '~/components/HostStatusBadge.vue'
import StatusBar from '~/components/StatusBar.vue'

const theme = useThemeStore()
const { colorMode } = storeToRefs(theme)

// Static swatch colors — Tailwind can't generate dynamic bg-* classes.
const accentSwatches: Array<{ accent: ThemeAccent; color: string }> = [
  { accent: 'cyan', color: '#06b6d4' },
  { accent: 'violet', color: '#8b5cf6' },
  { accent: 'emerald', color: '#10b981' },
  { accent: 'amber', color: '#f59e0b' },
  { accent: 'rose', color: '#f43f5e' },
  { accent: 'sky', color: '#0ea5e9' },
]
const isMobile = ref(false)

const colorModeIcon = computed(() => {
  switch (colorMode.value) {
    case 'light':
      return 'i-lucide-sun'
    case 'dark':
      return 'i-lucide-moon'
    default:
      return 'i-lucide-monitor'
  }
})

const modeCycle: ThemeColorMode[] = ['system', 'light', 'dark']

function cycleColorMode() {
  const next = modeCycle[(modeCycle.indexOf(theme.colorMode) + 1) % modeCycle.length]!
  theme.setColorMode(next)
}

onMounted(() => {
  isMobile.value = window.innerWidth < 640
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth < 640
  })
})
</script>
