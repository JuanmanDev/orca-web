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

  // The runtime client is 100% browser-side; nothing about paired hosts
  // should ever reach the server logs.
  telemetry: false,

  routeRules: {
    '/': { ssr: false },
    // Security invariants for the SPA shell:
    //  - default-src 'self': no CDN scripts, no external anything
    //  - connect-src: ONLY the app itself + ws/wss dials to the user's
    //    Orca runtime — credentials (device tokens) can only ever travel
    //    over the E2EE WebSocket to the paired host, never to any other
    //    origin. No fetch/XHR to the internet is possible, period.
    //  - form-action 'none': nothing is ever form-posted anywhere
    '/**': {
      headers: {
        'content-security-policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      },
    },
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
