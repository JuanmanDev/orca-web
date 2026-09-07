<template>
  <div class="min-h-screen flex flex-col">
    <header
      class="h-(--ui-header-height) shrink-0 border-b border-default backdrop-blur z-50 sticky top-0 bg-default/75"
    >
      <div class="flex items-center gap-3 px-4 h-full">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold text-highlighted">
          <span class="i-simple-icons-orca text-xl text-primary shrink-0" aria-hidden />
          <span class="hidden sm:inline">Orca Web</span>
        </NuxtLink>

        <USeparator orientation="vertical" class="h-5" />

        <nav class="flex items-center gap-1 min-w-0">
          <UButton
            to="/"
            icon="i-lucide-layout-dashboard"
            variant="ghost"
            size="sm"
            label="Worktrees"
          />
          <UButton
            to="/connect"
            icon="i-lucide-qr-code"
            variant="ghost"
            size="sm"
            label="Add host"
          />
        </nav>

        <div class="ms-auto flex items-center gap-2">
          <HostStatusBadge />
        </div>
      </div>
    </header>

    <main class="flex-1">
      <slot />
    </main>

    <footer class="py-4 px-4 text-xs text-muted border-t border-default">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>orca-web · community client for</span>
        <NuxtLink to="https://github.com/stablyai/orca" target="_blank" class="text-primary hover:underline">
          Orca
        </NuxtLink>
        <span>· not affiliated with Stably AI</span>
      </div>
    </footer>
  </div>
</template>
