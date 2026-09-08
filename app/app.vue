<template>
  <UApp :locale="en">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<script setup lang="ts">
import { en } from '@nuxt/ui/locale'
import { useThemeStore } from '~/stores/theme'

useHead({
  titleTemplate: (title) => (title ? `${title} · Orca Web` : 'Orca Web'),
})

// Restore theme prefs before first paint of the layout.
const theme = useThemeStore()
onMounted(() => {
  theme.load()
  theme.apply()
})
</script>
