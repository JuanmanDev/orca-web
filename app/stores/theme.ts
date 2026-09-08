// Theme store — color mode (light/dark/system) + accent color, persisted in
// localStorage under the orca-web namespace. Pure UI preference; holds no
// credentials.
import { defineStore } from 'pinia'

export type ThemeAccent = 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky'
export type ThemeColorMode = 'light' | 'dark' | 'system'

const ACCENTS: ThemeAccent[] = ['cyan', 'violet', 'emerald', 'amber', 'rose', 'sky']

const STORAGE_KEY = 'orca-web:theme:v1'

export const useThemeStore = defineStore('orca-theme', {
  state: () => ({
    colorMode: 'dark' as ThemeColorMode,
    accent: 'cyan' as ThemeAccent,
  }),

  actions: {
    load() {
      if (import.meta.server) {
        return
      }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) {
          return
        }
        const parsed = JSON.parse(raw) as { colorMode?: ThemeColorMode; accent?: ThemeAccent }
        if (parsed.colorMode && ['light', 'dark', 'system'].includes(parsed.colorMode)) {
          this.colorMode = parsed.colorMode
        }
        if (parsed.accent && ACCENTS.includes(parsed.accent)) {
          this.accent = parsed.accent
        }
      } catch {
        // Corrupt prefs fall back to defaults.
      }
    },

    persist() {
      if (import.meta.server) {
        return
      }
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ colorMode: this.colorMode, accent: this.accent }),
      )
    },

    setColorMode(mode: ThemeColorMode) {
      this.colorMode = mode
      this.apply()
      this.persist()
    },

    setAccent(accent: ThemeAccent) {
      this.accent = accent
      this.apply()
      this.persist()
    },

    /** Sync store state into the Nuxt UI runtime (color mode + app colors). */
    apply() {
      if (import.meta.server) {
        return
      }
      // Nuxt UI v4 color-mode integration: flip the html class directly,
      // matching what @nuxtjs/color-mode would render.
      const html = document.documentElement
      const resolved =
        this.colorMode === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : this.colorMode
      html.classList.toggle('dark', resolved === 'dark')

      // Accent swap: Nuxt UI derives --ui-primary from the Tailwind palette
      // at build time. Overriding the variable on <html> re-themes every
      // component that consumes var(--ui-primary) — immune to purging.
      const palette: Record<ThemeAccent, { light: string; dark: string }> = {
        cyan: { light: 'oklch(70.7% 0.165 194.2)', dark: 'oklch(78.9% 0.134 181.7)' },
        violet: { light: 'oklch(60.6% 0.25 292.7)', dark: 'oklch(70.2% 0.183 293.5)' },
        emerald: { light: 'oklch(69.6% 0.17 162.5)', dark: 'oklch(69.6% 0.17 162.5)' },
        amber: { light: 'oklch(76.9% 0.188 70.08)', dark: 'oklch(76.9% 0.188 70.08)' },
        rose: { light: 'oklch(64.5% 0.246 16.4)', dark: 'oklch(71.2% 0.194 13.4)' },
        sky: { light: 'oklch(68.5% 0.169 237.3)', dark: 'oklch(74.5% 0.139 237.6)' },
      }
      const tone = resolved === 'dark' ? 'dark' : 'light'
      const swatch = palette[this.accent]?.[tone]
      if (swatch) {
        html.style.setProperty('--ui-primary', swatch)
      }
    },
  },
})
