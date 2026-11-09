#!/usr/bin/env node
/*
 * `pnpm start`: build the frontend if there is no build yet (or `--build` asks
 * for a fresh one), then run the server in this process.
 *
 * The systemd unit in deploy/ runs server/server.js directly and builds as a
 * separate step; this is the one-command path for everyone else.
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIST = process.env.BUSHIDO_DIST_DIR || path.join(ROOT, 'dist')
const want = process.argv.includes('--build') || !fs.existsSync(path.join(DIST, 'index.html'))

if (want) {
  if (!fs.existsSync(path.join(ROOT, 'app', 'node_modules'))) {
    console.error('[bushido] app dependencies are missing: run `pnpm install` first')
    process.exit(1)
  }
  console.log('[bushido] building the app (one time; `pnpm start --build` to rebuild)')
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const r = spawnSync(pnpm, ['--dir', 'app', 'run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.error) console.error(`[bushido] could not run pnpm (${r.error.message}): run \`corepack enable pnpm\` once`)
  if (r.status !== 0) process.exit(r.status || 1)
}

require(path.join(ROOT, 'server', 'server.js')).main()
