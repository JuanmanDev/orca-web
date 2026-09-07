import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@nuxt/eslint', '@pinia/nuxt'],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'Orca Web',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Self-hosted web client for the Orca agent runtime — monitor and steer your parallel agent fleet from any browser.' },
        { name: 'theme-color', content: '#0b0e12' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },

  runtimeConfig: {
    // Server-side only. When set, /api/health reports the demo host.
    mockRuntimeUrl: process.env.NUXT_MOCK_RUNTIME_URL ?? '',
  },

  // The runtime client is 100% browser-side; nothing about paired hosts
  // should ever reach the server logs.
  telemetry: false,

  routeRules: {
    '/': { ssr: false },
  },

  future: {
    typescriptBundlerResolution: true,
  },

  typescript: {
    strict: true,
    // Typecheck runs as its own CI step (`pnpm typecheck`), never inside
    // `nuxt build` — keeps Docker builds hermetic and fast.
    typeCheck: false,
  },

  alias: {
    '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    '@mock': fileURLToPath(new URL('./scripts', import.meta.url)),
  },

  devServer: {
    // 3013 avoids the busy 3000-3012 range on this machine. host 0.0.0.0
    // exposes the dev server to the LAN so phones on the same network can
    // test against it (like the Orca mobile app's LAN pairing flow).
    // Nuxt syncs these into Vite (which forbids setting server.host itself).
    port: 3013,
    host: '0.0.0.0',
  },

  vite: {
    server: {
      // Trust any host header in dev (proxies, LAN IPs, hostnames).
      allowedHosts: true,
    },
  },
})
