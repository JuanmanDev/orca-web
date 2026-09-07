#!/usr/bin/env node
// Runs the mock Orca runtime and the Nuxt dev server together, forwarding
// Ctrl+C to both — `pnpm dev:mock`.
import { spawn } from 'node:child_process'

const children = []

function shutdown() {
  for (const child of children) {
    child.kill()
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const mock = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/mock-server.ts'], {
  stdio: 'inherit',
})
children.push(mock)

// Give the mock a moment to print its pairing URL before dev output floods.
await new Promise((resolve) => setTimeout(resolve, 1500))

const nuxt = spawn(process.execPath, ['node_modules/nuxt/bin/nuxt.mjs', 'dev'], {
  stdio: 'inherit',
})
children.push(nuxt)

nuxt.on('exit', shutdown)
mock.on('exit', shutdown)
