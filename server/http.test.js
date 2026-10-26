/*
 * The server end to end: a real process on a spare port with a throwaway data
 * directory. Covers the sign-in gate, first-run setup, cookies, bearer callers,
 * proxy mode, the defaults-off behaviour of a fresh install, and the migration
 * of an existing one. Run: node server/http.test.js
 */
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SERVER = path.join(__dirname, 'server.js')
const TOKEN = 'machine-token-for-tests-0123456789'

let failed = 0
const results = []
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

async function step(name, fn) {
  try { await fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}

/* Every temp dir this file makes is removed when it exits, pass or fail. */
const made = []
const mkdtemp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d }
const children = []
process.on('exit', () => {
  for (const c of children) { try { c.kill() } catch { /* gone */ } }
  for (const d of made) fs.rmSync(d, { recursive: true, force: true })
})

/** Start a server; resolves once it is listening, with its log so far. */
function boot({ env = {}, seed = null, dataDir: reuse = null } = {}) {
  const dataDir = reuse || mkdtemp('bushido-http-')
  if (seed) for (const [f, body] of Object.entries(seed)) fs.writeFileSync(path.join(dataDir, f), body)
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH, HOME: mkdtemp('bushido-home-'),
      BUSHIDO_DATA_DIR: dataDir, BUSHIDO_PORT: String(port), BUSHIDO_BIND: '127.0.0.1',
      CLAUDE_BIN: '/nonexistent/claude', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let log = ''
  child.stdout.on('data', c => { log += c })
  child.stderr.on('data', c => { log += c })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`server did not start:\n${log}`)) }, 10000)
    const poll = setInterval(() => {
      if (/listening on/.test(log) && (/setup\?token=|sign-in is off|plan /.test(log))) {
        clearInterval(poll); clearTimeout(timer)
        // A beat for the setup line, which prints just after.
        setTimeout(() => resolve({
          base: `http://127.0.0.1:${port}`, dataDir, child, log: () => log,
          stop: () => new Promise(r => { child.once('exit', r); child.kill() }),
        }), 50)
      }
    }, 25)
    child.on('exit', (code) => { clearInterval(poll); clearTimeout(timer); reject(new Error(`server exited ${code}:\n${log}`)) })
  })
}

const get = (url, opts = {}) => fetch(url, { redirect: 'manual', ...opts })
const form = (o) => ({
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(o).toString(),
})
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0]

/** Poll until `fn` returns something truthy; a model run is a child process, so "later" is real. */
async function waitFor(fn, label, ms = 8000) {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`)
    await new Promise(r => setTimeout(r, 40))
  }
}

;(async () => {
  /* ------------------------------------------------------------ fresh install */
  const s = await boot({ env: { BUSHIDO_API_TOKEN: TOKEN } })
  const token = (s.log().match(/setup\?token=([\w-]+)/) || [])[1]
  let cookie = ''

  await step('a fresh install prints a one-time setup link', async () => {
    ok(token && token.length >= 24, `no setup link in the log:\n${s.log()}`)
    ok(/every integration is off/.test(s.log()), 'the log does not say the install is fresh')
  })

  await step('signed out: pages go to setup, the API says 401, assets and health are public', async () => {
    const page = await get(`${s.base}/`)
    eq(page.status, 303); eq(page.headers.get('location'), '/setup')
    const api = await get(`${s.base}/api/state`)
    eq(api.status, 401); eq(api.headers.get('x-bushido-auth'), 'login')
    const health = await (await get(`${s.base}/api/health`)).json()
    eq(health, { ok: true, auth: 'password' }, 'health leaks detail when signed out')
    const asset = await get(`${s.base}/assets/nothing.js`)
    ok(asset.status !== 401 && asset.status !== 303, `an asset was gated (${asset.status})`)
  })

  await step('setup needs the token from the log', async () => {
    eq((await get(`${s.base}/setup`)).status, 403)
    eq((await get(`${s.base}/setup?token=wrong`)).status, 403)
    eq((await get(`${s.base}/setup?token=${token}`)).status, 200)
    eq((await get(`${s.base}/setup`, form({ token: 'wrong', username: 'me', password: 'correct horse' }))).status, 403)
  })

  await step('setup creates the owner and signs them in', async () => {
    const res = await get(`${s.base}/setup`, form({ token, username: 'me', password: 'correct horse' }))
    eq(res.status, 303); eq(res.headers.get('location'), '/settings?welcome=1')
    const set = res.headers.get('set-cookie') || ''
    ok(/HttpOnly/.test(set) && /SameSite=Lax/.test(set), `cookie flags: ${set}`)
    cookie = cookieFrom(res)
    const me = await (await get(`${s.base}/api/auth/me`, { headers: { cookie } })).json()
    eq({ mode: me.mode, via: me.via, user: me.user }, { mode: 'password', via: 'session', user: 'me' })
    // One person: the owner, whose log this is, not acting as anyone.
    eq({ id: me.me.id, owner: me.me.owner, admin: me.real.admin, acting: me.acting }, { id: 'owner', owner: true, admin: true, acting: false })
    eq((await get(`${s.base}/api/state`, { headers: { cookie } })).status, 200)
    eq((await get(`${s.base}/setup?token=${token}`)).status, 200, 'the closed setup page should still render')
    ok(/Already set up/.test(await (await get(`${s.base}/setup?token=${token}`)).text()), 'setup still open after use')
  })

  await step('a bearer token reaches the API without a session', async () => {
    eq((await get(`${s.base}/api/state`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 200)
    eq((await get(`${s.base}/api/state`, { headers: { authorization: 'Bearer not-the-token-at-all' } })).status, 401)
  })

  await step('the native app signs in for a session it sends as a bearer', async () => {
    const post = (body) => get(`${s.base}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    eq((await post({ username: 'me', password: 'wrong horse' })).status, 401)
    const res = await post({ username: 'me', password: 'correct horse' })
    eq(res.status, 200)
    ok(!res.headers.get('set-cookie'), 'the native sign-in set a cookie')
    const { session, user } = await res.json()
    eq(user, 'me')
    const bearer = { headers: { authorization: `Bearer ${session}` } }
    eq((await get(`${s.base}/api/state`, bearer)).status, 200)
    const me = await (await get(`${s.base}/api/auth/me`, bearer)).json()
    eq({ via: me.via, user: me.user, id: me.me.id }, { via: 'session', user: 'me', id: 'owner' })
    eq((await get(`${s.base}/api/state`, { headers: { authorization: `Bearer ${session}x` } })).status, 401, 'a tampered session got in')
    eq((await get(`${s.base}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
  })

  await step('fresh defaults: no WHOOP, Strava, notifications or AI, and nothing errors', async () => {
    const h = { headers: { cookie } }
    eq((await (await get(`${s.base}/api/whoop`, h)).json()).configured, false)
    eq((await (await get(`${s.base}/api/strava`, h)).json()).configured, false)
    eq((await (await get(`${s.base}/api/push/key`, h)).json()).configured, false)
    const health = await (await get(`${s.base}/api/health`, h)).json()
    eq([health.notify, health.totem.enabled, health.ai.claude], [false, false, false])
    const plan = await get(`${s.base}/api/plan/workout`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"kinds":["legs"],"minutes":30}',
    })
    eq(plan.status, 503)
    const refusal = await plan.json()
    eq(refusal.code, 'ai-not-configured')
    ok(/Settings/.test(refusal.error), `the owner was not told where to set AI up: ${refusal.error}`)
    // Off for the owner too (#55): the app offers Build it myself alone.
    eq((await (await get(`${s.base}/api/auth/me`, h)).json()).features.ai, false, 'the owner was offered AI with no CLI')
    const content = await (await get(`${s.base}/api/content`, h)).json()
    ok(!('achievements' in content), 'a fresh install seeds achievements')
    ok(!('facility' in content), 'a fresh install serves the example plan')
    ok(!/error|failed/i.test(s.log()), `the server logged an error:\n${s.log()}`)
  })

  await step('AI is on only while the CLI runs: not a plain file, not one that fails', async () => {
    const dir = mkdtemp('bushido-cli-')
    const cli = (name, body, mode) => { const f = path.join(dir, name); fs.writeFileSync(f, body, { mode }); return f }
    const cases = [
      ['not executable', cli('plain', '#!/bin/sh\necho 1.0\n', 0o644), false],
      ['exits non-zero', cli('broken', '#!/bin/sh\nexit 1\n', 0o755), false],
      ['a directory', dir, false],
      ['runs', cli('works', '#!/bin/sh\necho 1.0.0\n', 0o755), true],
    ]
    for (const [label, bin, want] of cases) {
      const srv = await boot({ env: { BUSHIDO_AUTH: 'proxy', CLAUDE_BIN: bin } })
      try {
        // The settings view waits for the `--version` probe that featuresFor reads.
        eq((await get(`${srv.base}/api/settings`)).status, 200, label)
        eq((await (await get(`${srv.base}/api/auth/me`)).json()).features.ai, want, label)
        if (!want) {
          const r = await get(`${srv.base}/api/plan/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          eq([r.status, (await r.json()).code], [503, 'ai-not-configured'], label)
        }
      } finally { await srv.stop() }
    }
  })

  await step('settings round-trip and never echo a secret', async () => {
    const put = await get(`${s.base}/api/settings`, {
      method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ai: { apiKey: 'fake-test-key-9876' }, athlete: { name: 'Sam' } }),
    })
    eq(put.status, 200)
    const text = await (await get(`${s.base}/api/settings`, { headers: { cookie } })).text()
    ok(!text.includes('fake-test-key'), 'the stored key came back to the browser')
    ok(text.includes('9876') && text.includes('"name":"Sam"'))
    eq(fs.statSync(path.join(s.dataDir, 'settings.json')).mode & 0o777, 0o600)
    eq((await get(`${s.base}/settings`, { headers: { cookie } })).status, 200)
  })

  await step('importing a plan, then going back to the starter', async () => {
    const post = (p, body) => get(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    eq((await post('/api/plan/import', { plan: { nope: 1 } })).status, 400)
    eq((await post('/api/plan/import', { plan: { dailyMenu: [], marker: 'mine' } })).status, 200)
    eq((await (await get(`${s.base}/api/content`, { headers: { cookie } })).json()).marker, 'mine')
    eq((await post('/api/plan/example')).status, 200)
    ok(fs.readdirSync(path.join(s.dataDir, 'backups', 'plans')).some(f => f.startsWith('plan-')), 'replacing data/plan.json kept no backup in backups/plans/')
    eq((await post('/api/plan/reset')).status, 200)
    ok(!('marker' in await (await get(`${s.base}/api/content`, { headers: { cookie } })).json()), 'reset did not return to the starter')
  })

  await step('no CORS: an API answer allows no other origin', async () => {
    const r = await get(`${s.base}/api/state`, { headers: { cookie, origin: 'https://evil.example' } })
    eq(r.headers.get('access-control-allow-origin'), null)
  })

  await step('cross-site writes are refused; a non-JSON body gets 415', async () => {
    const put = (headers) => get(`${s.base}/api/state`, { method: 'PUT', headers: { cookie, ...headers }, body: '{"state":{}}' })
    eq((await put({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status, 403)
    eq((await put({ 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403)
    eq((await put({ 'content-type': 'application/json', origin: 'null' })).status, 403)
    eq((await put({ 'content-type': 'text/plain' })).status, 415)
    eq((await put({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' })).status, 200)
    const cross = await get(`${s.base}/login`, { ...form({ username: 'me', password: 'correct horse' }), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } })
    eq(cross.status, 403, 'a cross-site login form was accepted')
  })

  await step('a bridge secret saved in Settings is not a login bearer', async () => {
    const secret = 'saved-bridge-secret-0123456789'
    await get(`${s.base}/api/settings`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ totem: { secret } }) })
    eq((await get(`${s.base}/api/state`, { headers: { authorization: `Bearer ${secret}` } })).status, 401)
  })

  await step('Settings cannot set a path or a program over HTTP', async () => {
    await get(`${s.base}/api/settings`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ai: { bin: '/bin/sh' }, links: { brainFile: '/etc/passwd' }, plan: { file: '/etc/passwd' } }) })
    const saved = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'settings.json'), 'utf8'))
    eq([saved.ai.bin, saved.links.brainFile, saved.plan.file], ['', '', ''])
  })

  await step('plan backups survive state-backup rotation', async () => {
    const dir = path.join(s.dataDir, 'backups')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, `state-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z-v${i}.json`), '{}')
    const plans = fs.readdirSync(path.join(dir, 'plans'))
    ok(plans.length > 0, 'the earlier import left no plan backup in backups/plans/')
    fs.writeFileSync(path.join(dir, 'plan-handplaced.json'), '{}')
    for (let i = 0; i < 3; i++) {
      eq((await get(`${s.base}/api/state`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: '{"state":{}}' })).status, 200)
    }
    eq(fs.readdirSync(path.join(dir, 'plans')), plans, 'state rotation pruned a plan backup')
    ok(fs.existsSync(path.join(dir, 'plan-handplaced.json')), 'state rotation pruned a non-state file')
    eq(fs.readdirSync(dir).filter(f => f.startsWith('state-')).length, 60, 'state rotation is not keeping 60')
  })

  await step('the app\'s sign-out API revokes the session and clears the HTTP cache', async () => {
    const login = await get(`${s.base}/login`, form({ username: 'me', password: 'correct horse', next: '/' }))
    const mine = cookieFrom(login)
    eq((await get(`${s.base}/api/state`, { headers: { cookie: mine } })).status, 200)
    const out = await get(`${s.base}/api/auth/logout`, { method: 'POST', headers: { cookie: mine, 'content-type': 'application/json' }, body: '{}' })
    eq(out.status, 200)
    eq(out.headers.get('clear-site-data'), '"cache"')
    ok(/Max-Age=0/.test(out.headers.get('set-cookie') || ''), 'the cookie was not cleared')
    eq((await get(`${s.base}/api/state`, { headers: { cookie: mine } })).status, 401, 'the session survived sign-out')
    eq((await get(`${s.base}/api/auth/logout`, { method: 'POST', headers: { cookie: mine, 'content-type': 'application/json' }, body: '{}' })).status, 401,
      'a second sign-out should read as already signed out')
    // the shared session the rest of the steps use was revoked too: sign in again.
    cookie = cookieFrom(await get(`${s.base}/login`, form({ username: 'me', password: 'correct horse', next: '/' })))
  })

  await step('sign out, a wrong password, then sign in to a safe destination', async () => {
    const out = await get(`${s.base}/logout`, { method: 'POST', headers: { cookie } })
    eq(out.status, 303); ok(/Max-Age=0/.test(out.headers.get('set-cookie') || ''), 'sign-out kept the cookie')
    eq((await get(`${s.base}/api/state`, { headers: { cookie } })).status, 401, 'the signed-out cookie still works')
    eq((await get(`${s.base}/login`, form({ username: 'me', password: 'wrong horse', next: '/' }))).status, 401)
    const res = await get(`${s.base}/login`, form({ username: 'me', password: 'correct horse', next: '//evil.example/' }))
    eq(res.status, 303); eq(res.headers.get('location'), '/', 'next= is an open redirect')
    const tab = await get(`${s.base}/login`, form({ username: 'me', password: 'correct horse', next: '/%09/evil.example' }))
    eq(tab.headers.get('location'), '/', 'next= with an encoded tab is an open redirect')
    ok(cookieFrom(res).startsWith('bushido_session='))
  })

  await s.stop()

  /* ----------------------------------- reset clears a plan file named in settings */
  const named = await boot({
    env: { BUSHIDO_AUTH: 'proxy' },
    seed: { 'settings.json': JSON.stringify({ version: 1, install: 'fresh', plan: { file: 'examples/plan.json' } }) },
  })
  await step('"Back to the starter" also drops a plan file named in settings.json', async () => {
    const before = await (await get(`${named.base}/api/content`)).json()
    ok(before.dailyMenu.some(m => m.id === 'example-easy-run'), 'the named plan is not what loads to begin with')
    const r = await get(`${named.base}/api/plan/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    eq(r.status, 200)
    eq((await r.json()).plan.source, 'starter')
    const after = await (await get(`${named.base}/api/content`)).json()
    ok(!after.dailyMenu.some(m => m.id === 'example-easy-run'), 'the starter is not served after the reset')
    eq(JSON.parse(fs.readFileSync(path.join(named.dataDir, 'settings.json'), 'utf8')).plan.file, '', 'plan.file is still set')
  })
  await named.stop()

  /* --------------------------------------------------------------- proxy mode */
  const p = await boot({ env: { BUSHIDO_AUTH: 'proxy' } })
  await step('BUSHIDO_AUTH=proxy: no login, no setup link, the API is open', async () => {
    ok(!/setup\?token=/.test(p.log()) && /sign-in is off/.test(p.log()), p.log())
    eq((await get(`${p.base}/api/state`)).status, 200)
    eq((await get(`${p.base}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 409)
    eq((await get(`${p.base}/setup`)).headers.get('location'), '/')
    eq((await (await get(`${p.base}/api/auth/me`)).json()).via, 'proxy')
    const out = await get(`${p.base}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    eq(out.status, 409, 'proxy mode has nothing to sign out of')
    eq(out.headers.get('clear-site-data'), null)
    eq((await get(`${p.base}/api/state`)).status, 200, 'proxy mode was affected by a sign-out call')
  })
  await p.stop()

  /* ------------------------------------------- two people, behind Cloudflare Access */
  /*
   * A pretend Cloudflare: an RSA key, its JWKS on a local port, and tokens signed
   * with it. The server verifies them exactly as it would Access's own.
   */
  const crypto = require('crypto')
  const http = require('http')
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }] }
  const certs = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(jwks)) })
  await new Promise(r => certs.listen(0, '127.0.0.1', r))
  const TEAM_HOST = 'test-team.cloudflareaccess.com'
  const AUD = 'test-aud'
  const jwt = (email, key = privateKey) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const t = Math.floor(Date.now() / 1000)
    const hb = `${enc({ alg: 'RS256', kid: 'k1' })}.${enc({ iss: `https://${TEAM_HOST}`, aud: [AUD], email, iat: t, exp: t + 600 })}`
    return `${hb}.${crypto.sign('RSA-SHA256', Buffer.from(hb), key).toString('base64url')}`
  }
  const two = await boot({
    env: {
      BUSHIDO_AUTH: 'proxy', BUSHIDO_ACCESS_TEAM: 'test-team', BUSHIDO_ACCESS_AUD: AUD,
      BUSHIDO_ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs`,
    },
    seed: {
      'state.json': JSON.stringify({ version: 3, updatedAt: '2026-09-01T00:00:00Z', state: { entries: { 'daily-2026-09-01': { id: 'daily-2026-09-01', kind: 'daily', date: '2026-09-01', updatedAt: '2026-09-01T00:00:00Z', data: { optId: 'mine' } } } } }),
      'settings.json': JSON.stringify({ version: 1, install: 'fresh', auth: { mode: 'proxy' } }),
      'users.json': JSON.stringify({ users: [{ id: 'owner', name: 'Alex', emails: ['alex@example.com'] }, { id: 'sam', name: 'Sam', emails: ['sam@example.com'] }] }),
    },
  })
  const as = (email, extra = {}) => ({ headers: { 'cf-access-jwt-assertion': jwt(email), ...extra } })
  const json = { 'content-type': 'application/json' }
  const samEntry = { id: 'daily-2026-10-01', kind: 'daily', date: '2026-10-01', updatedAt: '2026-10-01T10:00:00Z', data: { optId: 'hers', done: true } }

  await step('each person reads and writes only their own log', async () => {
    const samState = await (await get(`${two.base}/api/state`, as('sam@example.com'))).json()
    eq(Object.keys(samState.state.entries), [], 'Sam was shown the owner\'s log')
    const put = await get(`${two.base}/api/state`, { method: 'PUT', headers: { ...json, ...as('sam@example.com').headers }, body: JSON.stringify({ state: { entries: { [samEntry.id]: samEntry } } }) })
    eq(put.status, 200)
    const onDisk = JSON.parse(fs.readFileSync(path.join(two.dataDir, 'users', 'sam', 'state.json'), 'utf8'))
    eq(Object.keys(onDisk.state.entries), [samEntry.id])
    const owner = await (await get(`${two.base}/api/state`, as('alex@example.com'))).json()
    eq(Object.keys(owner.state.entries), ['daily-2026-09-01'], 'Sam\'s save touched the owner\'s log')
    eq(owner.version, 3, 'the owner\'s log was rewritten')
    // No token at all (the box itself, the tailnet): the owner, as plain proxy mode always was.
    eq(Object.keys((await (await get(`${two.base}/api/state`)).json()).state.entries), ['daily-2026-09-01'])
  })

  await step('someone Access lets in but this install does not know is refused', async () => {
    eq((await get(`${two.base}/api/state`, as('stranger@example.com'))).status, 403)
    eq((await get(`${two.base}/`, as('stranger@example.com'))).status, 403)
    const forged = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    eq((await get(`${two.base}/api/state`, { headers: { 'cf-access-jwt-assertion': jwt('alex@example.com', forged) } })).status, 403, 'a forged owner token got in')
  })

  await step('for anyone but the owner: no settings, no AI, no integrations, the starter plan', async () => {
    const me = await (await get(`${two.base}/api/auth/me`, as('sam@example.com'))).json()
    eq([me.me.id, me.real.admin, me.acting, me.features.ai, me.people], ['sam', false, false, false, undefined])
    eq((await get(`${two.base}/settings`, as('sam@example.com'))).status, 403)
    eq((await get(`${two.base}/api/settings`, as('sam@example.com'))).status, 403)
    eq((await get(`${two.base}/api/act-as`, { method: 'POST', headers: { ...json, ...as('sam@example.com').headers }, body: JSON.stringify({ id: 'owner' }) })).status, 403)
    eq((await (await get(`${two.base}/api/whoop`, as('sam@example.com'))).json()).configured, false)
    eq((await (await get(`${two.base}/api/strava`, as('sam@example.com'))).json()).configured, false)
    eq((await (await get(`${two.base}/api/push/key`, as('sam@example.com'))).json()).configured, false)
    const ai = await get(`${two.base}/api/plan/workout`, { method: 'POST', headers: { ...json, ...as('sam@example.com').headers }, body: JSON.stringify({ kinds: ['legs'], minutes: 30 }) })
    eq([ai.status, (await ai.json()).code], [503, 'ai-not-configured'])
    ok((await (await get(`${two.base}/api/content`, as('sam@example.com'))).json()).dailyMenu.some(m => m.id === 'log-workout'), 'not the starter')
  })

  await step('the owner acts as someone: their log, until switching back', async () => {
    const r = await get(`${two.base}/api/act-as`, { method: 'POST', headers: { ...json, ...as('alex@example.com').headers }, body: JSON.stringify({ id: 'sam' }) })
    eq(r.status, 200)
    const asCookie = cookieFrom(r)
    eq(asCookie, 'bushido_as=sam')
    const withCookie = as('alex@example.com', { cookie: asCookie })
    const me = await (await get(`${two.base}/api/auth/me`, withCookie)).json()
    eq([me.me.id, me.real.id, me.acting, me.features.ai], ['sam', 'owner', true, false])
    eq(me.people.map(p => p.id), ['owner', 'sam'])
    eq(Object.keys((await (await get(`${two.base}/api/state`, withCookie)).json()).state.entries), [samEntry.id])
    // Marking a set for Sam lands in Sam's log.
    const mark = await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...withCookie.headers }, body: JSON.stringify({ entry: { ...samEntry, updatedAt: '2026-10-01T11:00:00Z', data: { ...samEntry.data, out: { rpe: 7 } } } }) })
    eq(mark.status, 200)
    eq(JSON.parse(fs.readFileSync(path.join(two.dataDir, 'users', 'sam', 'state.json'), 'utf8')).state.entries[samEntry.id].data.out.rpe, 7)
    // Settings stay reachable: the real person is the owner.
    eq((await get(`${two.base}/api/settings`, withCookie)).status, 200)
    const back = await get(`${two.base}/api/act-as`, { method: 'POST', headers: { ...json, ...withCookie.headers }, body: JSON.stringify({ id: null }) })
    ok(/bushido_as=;/.test(back.headers.get('set-cookie')), 'switching back did not clear the cookie')
  })

  await step('a device holding one person\'s log cannot read or write another\'s', async () => {
    // The app thinks it holds the owner's log, but the cookie now says Sam.
    const mixed = as('alex@example.com', { cookie: 'bushido_as=sam', 'x-bushido-user': 'owner' })
    const read = await get(`${two.base}/api/state`, mixed)
    eq([read.status, read.headers.get('x-bushido-auth')], [409, 'switched'])
    const write = await get(`${two.base}/api/state`, { method: 'PUT', headers: { ...json, ...mixed.headers }, body: JSON.stringify({ state: { entries: { x: { id: 'x', updatedAt: '2030-01-01T00:00:00Z' } } } }) })
    eq(write.status, 409)
    ok(!JSON.parse(fs.readFileSync(path.join(two.dataDir, 'users', 'sam', 'state.json'), 'utf8')).state.entries.x, 'the owner\'s cache was pushed into Sam\'s log')
    // Sam's own phone, claiming to be Sam, is fine.
    eq((await get(`${two.base}/api/state`, as('sam@example.com', { 'x-bushido-user': 'sam' }))).status, 200)
  })

  await step('people are managed in Settings, by the owner', async () => {
    const add = await get(`${two.base}/api/settings/users`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'Robin', emails: 'robin@example.com' }) })
    eq(add.status, 200)
    eq((await add.json()).user.id, 'robin')
    eq((await get(`${two.base}/api/state`, as('robin@example.com'))).status, 200, 'a newly added person cannot get in')
    eq((await get(`${two.base}/api/settings/users/robin`, { method: 'DELETE' })).status, 200)
    eq((await get(`${two.base}/api/state`, as('robin@example.com'))).status, 403, 'a removed person still gets in')
    const dup = await get(`${two.base}/api/settings/users`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'X', emails: 'sam@example.com' }) })
    eq(dup.status, 400)
  })
  /* --------------------------------------------- shared workouts (peopleRoute) */
  const samFile = () => JSON.parse(fs.readFileSync(path.join(two.dataDir, 'users', 'sam', 'state.json'), 'utf8'))
  const ownerFile = () => JSON.parse(fs.readFileSync(path.join(two.dataDir, 'state.json'), 'utf8'))
  const owns = (extra = {}) => as('alex@example.com', { 'x-bushido-user': 'owner', ...extra })
  const post = (id, entry, h = owns()) => get(`${two.base}/api/people/${id}/entry`, {
    method: 'POST', headers: { ...json, ...h.headers }, body: JSON.stringify({ entry }) })
  const shared = { id: 'daily-2026-10-05', kind: 'daily', date: '2026-10-05', updatedAt: '2026-10-05T09:00:00Z',
    data: { optId: 'log-workout', slot: 'main', done: true, out: { activity: 'bike', distance: 12 }, sharedFrom: { id: 'owner', name: 'forged' } } }

  await step('shared workouts: the owner lists the people and adds a copy to someone else\'s log', async () => {
    const list = await (await get(`${two.base}/api/people`, owns())).json()
    eq(list.people.map(p => [p.id, p.owner]), [['owner', true], ['sam', false]])
    const ownerBefore = ownerFile()
    const backupsBefore = fs.readdirSync(path.join(two.dataDir, 'users', 'sam', 'backups')).length
    const r = await post('sam', shared)
    eq(r.status, 200)
    const { entry } = await r.json()
    // Planning is not completing; sharedFrom is the server's, not the request's.
    eq([entry.data.done, entry.data.sharedFrom], [false, { id: 'owner', name: 'Alex' }])
    eq(samFile().state.entries[shared.id].data.out.distance, 12)
    ok(fs.readdirSync(path.join(two.dataDir, 'users', 'sam', 'backups')).length > backupsBefore, 'no backup before the write')
    eq(ownerFile(), ownerBefore, 'a write for Sam touched the owner\'s log')
    // Read back by id and by day.
    eq((await (await get(`${two.base}/api/people/sam/entry?id=${shared.id}`, owns())).json()).entry.data.done, false)
    eq((await (await get(`${two.base}/api/people/sam/entry?date=2026-10-05`, owns())).json()).entries.map(e => e.id), [shared.id])
    eq((await (await get(`${two.base}/api/people/sam/entry?id=nope`, owns())).json()).entry, null)
  })

  await step('shared workouts: marking her copy merges last-write-wins; a stale write loses', async () => {
    const mark = await post('sam', { ...shared, updatedAt: '2026-10-05T10:00:00Z', data: { ...shared.data, done: true, out: { ...shared.data.out, rpe: 6 } } })
    eq((await mark.json()).entry.data.done, true, 'an existing copy could not be marked done')
    const stale = await post('sam', { ...shared, updatedAt: '2026-10-05T09:30:00Z', data: { ...shared.data, out: { rpe: 1 } } })
    eq((await stale.json()).entry.data.out.rpe, 6, 'a stale write beat a newer one')
    // A tombstone, like every other removal.
    const tomb = await post('sam', { ...shared, deleted: true, updatedAt: '2026-10-05T11:00:00Z' })
    eq(tomb.status, 200)
    eq(samFile().state.entries[shared.id].deleted, true)
  })

  await step('shared workouts: never over something they logged themselves, never the owner\'s log', async () => {
    // samEntry is Sam's own, with no sharedFrom.
    const over = await post('sam', { ...samEntry, updatedAt: '2030-01-01T00:00:00Z', data: { ...samEntry.data, sharedFrom: { id: 'owner' } } })
    eq([over.status, (await over.json()).code], [409, 'not-shared'])
    eq(samFile().state.entries[samEntry.id].data.sharedFrom, undefined, 'the owner overwrote Sam\'s own entry')
    const self = await post('owner', shared)
    eq(self.status, 400)
    eq((await post('nobody', shared)).status, 404)
    eq((await post('sam', { ...shared, data: { optId: 'x' } })).status, 400, 'an entry that is not a shared workout')
    eq((await post('sam', { ...shared, id: 'quota-2026-10-05' })).status, 400, 'not a daily entry')
  })

  await step('shared workouts: refused to anyone but the owner, and while acting as someone', async () => {
    eq((await get(`${two.base}/api/people`, as('sam@example.com', { 'x-bushido-user': 'sam' }))).status, 403)
    eq((await post('owner', shared, as('sam@example.com'))).status, 403)
    eq((await get(`${two.base}/api/people/sam/entry?id=${shared.id}`, as('sam@example.com'))).status, 403)
    const acting = await get(`${two.base}/api/people`, as('alex@example.com', { cookie: 'bushido_as=sam' }))
    eq([acting.status, (await acting.json()).code], [409, 'acting'])
    // The owner's device says it holds the owner's log; a mismatch is still the 409 it always was.
    eq((await get(`${two.base}/api/people`, as('alex@example.com', { 'x-bushido-user': 'sam' }))).status, 409)
  })

  await step('shared workouts: habit sync fires for the owner\'s own save, never for a copy in someone else\'s log', async () => {
    const hits = []
    const bridge = http.createServer((q, r) => { if (q.url === '/api/habits/log') hits.push(q.url); r.writeHead(200, { 'content-type': 'application/json' }); r.end('{}') })
    await new Promise(r => bridge.listen(0, '127.0.0.1', r))
    try {
      const put = await get(`${two.base}/api/settings`, { method: 'PUT', headers: json,
        body: JSON.stringify({ totem: { url: `http://127.0.0.1:${bridge.address().port}`, secret: 'bridge-secret-for-tests', habitSync: true } }) })
      eq(put.status, 200)
      const settle = () => new Promise(r => setTimeout(r, 400))
      await post('sam', { ...shared, id: 'daily-2026-10-07', date: '2026-10-07', updatedAt: '2026-10-07T09:00:00Z' })
      await post('sam', { ...shared, id: 'daily-2026-10-07', date: '2026-10-07', updatedAt: '2026-10-07T10:00:00Z', data: { ...shared.data, done: true } })
      await settle()
      eq(hits.length, 0, 'a shared copy in Sam\'s log marked the owner\'s habit')
      // The same bridge does hear the owner's own completed session, so the silence above means something.
      await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...owns().headers },
        body: JSON.stringify({ entry: { id: 'daily-2026-10-07', kind: 'daily', date: '2026-10-07', data: { optId: 'mine', done: true } } }) })
      await settle()
      eq(hits.length, 1, 'the owner\'s own save did not sync the habit')
    } finally {
      await get(`${two.base}/api/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ totem: { url: '', habitSync: false } }) })
      bridge.close()
    }
  })

  await step('shared workouts: Sam sees the copy in Sam\'s own log, with who it came from', async () => {
    await post('sam', { ...shared, id: 'daily-2026-10-06', date: '2026-10-06', updatedAt: '2026-10-06T09:00:00Z' })
    const hers = (await (await get(`${two.base}/api/state`, as('sam@example.com', { 'x-bushido-user': 'sam' }))).json()).state.entries
    eq(hers['daily-2026-10-06'].data.sharedFrom.name, 'Alex')
  })

  /* ------------------------------------- shared workouts in sync (sharedsync.js) */
  const SYNC_DAY = '2026-10-20'
  const SID = `daily-${SYNC_DAY}`
  const st = (n, o = {}) => Array.from({ length: n }, () => ({ reps: 5, weight: 100, seconds: null, distance: null, restSec: null, unit: null, note: '', ...o }))
  const lifted = (name, sets) => ({ kind: 'lift', name, exercise: name.toLowerCase(), group: null, implement: 'barbell', unit: null, note: '', sets })
  const ids = (plan) => ({ ...plan, blocks: plan.blocks.map((b, bi) => ({ ...b, id: `b${bi}`,
    items: b.items.map((it, ii) => ({ ...it, id: `b${bi}i${ii}`, sets: it.sets.map((s, si) => ({ ...s, id: `b${bi}i${ii}s${si}` })) })) })) })
  const itemsIn = (e) => e.data.plan.blocks.flatMap(b => b.items)
  const namesIn = (e) => itemsIn(e).map(i => i.name)
  const samSays = as('sam@example.com', { 'x-bushido-user': 'sam' })
  const ownerEntry = () => ownerFile().state.entries[SID]
  const samCopy = () => samFile().state.entries[SID]
  let staleOwner = null
  let clock = Date.parse(`${SYNC_DAY}T08:00:00Z`)
  const tick = () => new Date(clock += 60000).toISOString()
  const saveOwn = (entry) => get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...owns().headers }, body: JSON.stringify({ entry: { ...entry, updatedAt: tick() } }) })
  const saveSams = (entry) => get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...samSays.headers }, body: JSON.stringify({ entry: { ...entry, updatedAt: tick() } }) })
  /** An edit to a plan, re-minting positional ids the way the editor does. */
  const replan = (e, fn) => ({ ...e, data: { ...e.data, plan: ids({ ...e.data.plan, blocks: fn(e.data.plan.blocks.map(b => ({ ...b, items: [...b.items] }))) }) } })

  await step('sync: adding someone with sync on gives both sides the same exercises, by the same uids', async () => {
    // The owner's planned workout, written by an app that mints no uids.
    const plan = ids({ title: 'Legs', blocks: [{ name: 'Main', note: '', items: [lifted('Squat', st(2)), lifted('Deadlift', st(1))] }] })
    eq((await saveOwn({ id: SID, kind: 'daily', date: SYNC_DAY, data: { optId: 'planned', slot: 'main', done: true, plan, out: { rpe: 8 } } })).status, 200)
    // The app makes Sam's copy (lib/shared.js sharedCopy: no weights), then names Sam on its own entry.
    const copyPlan = { ...plan, blocks: plan.blocks.map(b => ({ ...b, items: b.items.map(i => ({ ...i, sets: i.sets.map(s => ({ ...s, weight: null })) })) })) }
    eq((await post('sam', { id: SID, kind: 'daily', date: SYNC_DAY, updatedAt: tick(), data: { optId: 'planned', slot: 'main', done: false, plan: copyPlan, out: {}, sharedFrom: { id: 'owner' } } })).status, 200)
    eq((await saveOwn({ ...ownerEntry(), data: { ...ownerEntry().data, sharedWith: [{ id: 'sam', entryId: SID, sync: true }] } })).status, 200)
    const mine = itemsIn(ownerEntry()).map(i => i.uid)
    ok(mine.every(Boolean), 'the owner\'s exercises were not given uids')
    eq(itemsIn(samCopy()).map(i => i.uid), mine, 'Sam\'s copy does not share the owner\'s uids')
    ok(samCopy().data.syncBase && ownerEntry().data.syncBase, 'no sync base stamped')
  })

  await step('sync: an exercise the owner adds arrives on Sam\'s side blank; Sam\'s numbers stay Sam\'s', async () => {
    // Sam logs a squat set first.
    const c = samCopy()
    eq((await saveSams({ ...c, data: { ...c.data, run: { sets: { b0i0s0: { reps: 8, weight: 40 } } }, out: { rpe: 5 } } })).status, 200)
    eq((await saveOwn(replan(ownerEntry(), bs => { bs[0].items.splice(1, 0, lifted('Lunge', st(2, { weight: 30 }))); return bs }))).status, 200)
    eq(namesIn(samCopy()), ['Squat', 'Lunge', 'Deadlift'])
    eq(itemsIn(samCopy())[1].sets.map(s => [s.reps, s.weight]), [[null, null], [null, null]], 'the owner\'s numbers crossed')
    eq([samCopy().data.run.sets, samCopy().data.out.rpe], [{ b0i0s0: { reps: 8, weight: 40 } }, 5])
  })

  await step('sync: a set Sam adds on Sam\'s own phone is a blank set on the owner\'s', async () => {
    const r = await saveSams(replan(samCopy(), bs => { bs[0].items[2] = { ...bs[0].items[2], sets: [...bs[0].items[2].sets, { ...bs[0].items[2].sets[0], weight: 60 }] }; return bs }))
    eq(r.status, 200)
    const dl = itemsIn(ownerEntry()).find(i => i.name === 'Deadlift')
    eq(dl.sets.map(s => s.weight), [100, null])
    eq(ownerEntry().data.out.rpe, 8, 'Sam\'s write touched the owner\'s numbers')
  })

  await step('sync: the owner renaming on Sam\'s side (people route) renames it on the owner\'s too', async () => {
    const r = await post('sam', replan({ ...samCopy(), updatedAt: tick() }, bs => { bs[0].items[1] = { ...bs[0].items[1], name: 'Walking lunge' }; return bs }))
    eq(r.status, 200)
    eq(namesIn(ownerEntry()), ['Squat', 'Walking lunge', 'Deadlift'])
    eq(itemsIn(ownerEntry())[1].sets.map(s => s.weight), [30, 30], 'the owner\'s weights changed with the name')
  })

  await step('sync: numbers never cross (weights, effort, notes, done, the run); only the extra set does', async () => {
    const before = samCopy()
    // The owner changes every number, and adds a third squat set at the new weight.
    const e = replan(ownerEntry(), bs => {
      const sq = bs[0].items[0]
      bs[0].items[0] = { ...sq, sets: [...sq.sets, sq.sets[0]].map(s => ({ ...s, weight: 120, reps: 3 })) }
      return bs
    })
    eq((await saveOwn({ ...e, data: { ...e.data, done: false, out: { rpe: 10, notes: 'hard', gear: ['x'] }, run: { sets: { b0i0s1: { reps: 3, weight: 120 } } } } })).status, 200)
    const after = samCopy()
    eq(itemsIn(after)[0].sets.map(s => [s.reps, s.weight]), [...itemsIn(before)[0].sets.map(s => [s.reps, s.weight]), [null, null]],
      'Sam\'s squat should have gained one blank set and nothing else')
    const rest = (x) => JSON.stringify({ ...x.data, plan: { ...x.data.plan, blocks: x.data.plan.blocks.map(b => ({ ...b, items: b.items.slice(1) })) }, syncBase: null })
    eq(rest(after), rest(before), 'a change of numbers was written to Sam\'s log')
    eq([after.data.done, after.data.out, after.data.run], [before.data.done, before.data.out, before.data.run])
  })

  await step('sync: removed on one side; kept on the other only where the other logged on it', async () => {
    // Sam logged Squat (b0i0s0) and nothing on Walking lunge.
    staleOwner = JSON.parse(JSON.stringify(ownerEntry()))
    eq((await saveOwn(replan(ownerEntry(), bs => { bs[0].items = bs[0].items.filter(i => i.name === 'Deadlift'); return bs }))).status, 200)
    eq(namesIn(ownerEntry()), ['Deadlift'])
    eq(namesIn(samCopy()), ['Squat', 'Deadlift'], 'Sam lost logged sets, or kept an unlogged exercise')
    eq(samCopy().data.run.sets, { b0i0s0: { reps: 8, weight: 40 } })
  })

  await step('sync: a stale device cannot bring a removed exercise back', async () => {
    // A phone of the owner's that last pulled before the removal: it still has
    // Squat and Walking lunge, and the base it was given then. It changes its
    // effort and pushes the whole log, newer than anything stored.
    const stale = { ...staleOwner, updatedAt: tick(), data: { ...staleOwner.data, out: { rpe: 7 } } }
    const r = await get(`${two.base}/api/state`, { method: 'PUT', headers: { ...json, ...owns().headers }, body: JSON.stringify({ state: { entries: { [SID]: stale } } }) })
    eq(r.status, 200)
    // Walking lunge (nothing logged on it there) stays gone. Squat, which this phone logged a
    // set on, stays on the owner's side with that set: logged data is never removed by
    // another device's write. Neither reaches Sam's side.
    eq(namesIn(ownerEntry()), ['Squat', 'Deadlift'], 'the stale device resurrected an unlogged exercise, or lost its logged one')
    eq(Object.keys(ownerEntry().data.run.sets).length, 1, 'the stale device\'s logged set was lost')
    eq(ownerEntry().data.out.rpe, 7, 'the stale device\'s own change was lost')
    eq(namesIn(samCopy()), ['Squat', 'Deadlift'], 'the stale device changed Sam\'s side')
    ok(!itemsIn(samCopy()).some(i => i.name === 'Walking lunge'), 'the removed exercise came back on Sam\'s side')
  })

  await step('sync: switched off, each side stays as it is', async () => {
    eq((await saveOwn({ ...ownerEntry(), data: { ...ownerEntry().data, sharedWith: [{ id: 'sam', entryId: SID }] } })).status, 200)
    eq((await saveOwn(replan(ownerEntry(), bs => { bs[0].items.push(lifted('Row', st(1))); return bs }))).status, 200)
    eq(namesIn(samCopy()), ['Squat', 'Deadlift'], 'the owner\'s change reached Sam with sync off')
    eq((await saveSams(replan(samCopy(), bs => { bs[0].items.push(lifted('Curl', st(1))); return bs }))).status, 200)
    eq(namesIn(ownerEntry()), ['Squat', 'Deadlift', 'Row'], 'Sam\'s change reached the owner with sync off')
  })

  await step('sync: switched back on, Sam gets what Sam lacks and nothing of Sam\'s goes', async () => {
    eq((await saveOwn({ ...ownerEntry(), data: { ...ownerEntry().data, sharedWith: [{ id: 'sam', entryId: SID, sync: true }] } })).status, 200)
    eq(namesIn(samCopy()), ['Squat', 'Deadlift', 'Row', 'Curl'])
    eq(namesIn(ownerEntry()), ['Squat', 'Deadlift', 'Row'])
  })

  await step('sync: done, undone and doneAt stay on the side that wrote them', async () => {
    // Sam taps "Mark undone" (lib/store.js markDone); the owner has ticked theirs, with doneAt.
    const c = samCopy()
    const { doneAt: _a, ...samData } = c.data
    eq((await saveSams({ ...c, data: { ...samData, done: false, undone: true } })).status, 200)
    const o = ownerEntry()
    eq((await saveOwn({ ...o, data: { ...o.data, done: true, doneAt: '2026-10-20T09:00:00.000Z', undone: undefined } })).status, 200)
    const doneOf = (e) => [e.data.done, e.data.undone ?? null, e.data.doneAt ?? null]
    const samBefore = doneOf(samCopy())
    const ownerBefore = doneOf(ownerEntry())
    eq(samBefore, [false, true, null])
    eq(ownerBefore, [true, null, '2026-10-20T09:00:00.000Z'])
    // A structural change each way: the owner adds an exercise, Sam adds a set.
    eq((await saveOwn(replan(ownerEntry(), bs => { bs[0].items.push(lifted('Dip', st(1))); return bs }))).status, 200)
    ok(namesIn(samCopy()).includes('Dip'), 'the owner\'s exercise did not reach Sam, so this proves nothing')
    eq(doneOf(samCopy()), samBefore, 'the owner\'s tick crossed to Sam\'s side')
    eq((await saveSams(replan(samCopy(), bs => { bs[0].items[0] = { ...bs[0].items[0], sets: [...bs[0].items[0].sets, bs[0].items[0].sets[0]] }; return bs }))).status, 200)
    eq(doneOf(ownerEntry()), ownerBefore, 'Sam\'s "Mark undone" crossed to the owner\'s side')
    eq(doneOf(samCopy()), samBefore, 'Sam\'s own undone was lost on the way through the sync')
  })

  await step('sync: Sam\'s sets logged offline before the owner\'s change, and sent after it, are kept, with the owner\'s exercise', async () => {
    // Sam's phone, offline, logs two sets and an RPE at T1 on the copy as it was then.
    const offline = samCopy()
    const t1 = tick()
    const logged = { ...offline, updatedAt: t1, data: { ...offline.data, run: { sets: { b0i0s0: { reps: 6, weight: 50 }, b0i0s1: { reps: 6, weight: 50 } } }, out: { ...offline.data.out, rpe: 9 } } }
    // The owner adds an exercise at T2 > T1, which is carried into Sam's copy.
    eq((await saveOwn(replan(ownerEntry(), bs => { bs[0].items.push(lifted('Shrug', st(2))); return bs }))).status, 200)
    ok(namesIn(samCopy()).includes('Shrug'), 'the owner\'s exercise did not reach Sam, so this proves nothing')
    // Sam's phone comes back and sends what it saved at T1.
    const r = await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...samSays.headers }, body: JSON.stringify({ entry: logged }) })
    eq(r.status, 200)
    eq(samCopy().data.out.rpe, 9, 'Sam\'s RPE was thrown away by the carried change')
    eq(samCopy().data.run.sets.b0i0s0, { reps: 6, weight: 50 }, 'Sam\'s logged sets were thrown away by the carried change')
    ok(namesIn(samCopy()).includes('Shrug'), 'Sam\'s offline write dropped the owner\'s exercise')
  })

  await step('sync: an owner device whose clock runs an hour ahead cannot shut out Sam\'s later saves', async () => {
    const ahead = new Date(clock + 3600000).toISOString()
    const o = replan(ownerEntry(), bs => { bs[0].items.push(lifted('Calf raise', st(1))); return bs })
    eq((await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...owns().headers }, body: JSON.stringify({ entry: { ...o, updatedAt: ahead } }) })).status, 200)
    ok(namesIn(samCopy()).includes('Calf raise'), 'the owner\'s exercise did not reach Sam, so this proves nothing')
    ok(samCopy().updatedAt < ahead, `Sam's copy was stamped with the owner's clock (${samCopy().updatedAt})`)
    // Sam saves normally, on Sam's own (correct) clock.
    const c = samCopy()
    eq((await saveSams({ ...c, data: { ...c.data, out: { ...c.data.out, rpe: 4 } } })).status, 200)
    eq(samCopy().data.out.rpe, 4, 'Sam\'s normal save was discarded')
  })

  /* A workout of its own for each case below: the owner's entry, Sam's copy, and the link. */
  const freshShare = async (date, { sync }) => {
    const id = `daily-${date}`
    const plan = ids({ title: 'Pull', blocks: [{ name: 'Main', note: '', items: [lifted('Squat', st(2)), lifted('Deadlift', st(1))] }] })
    eq((await saveOwn({ id, kind: 'daily', date, data: { optId: 'planned', slot: 'main', done: false, plan, out: {} } })).status, 200)
    const copyPlan = { ...plan, blocks: plan.blocks.map(b => ({ ...b, items: b.items.map(i => ({ ...i, sets: i.sets.map(x => ({ ...x, weight: null })) })) })) }
    const r = await post('sam', { id, kind: 'daily', date, updatedAt: tick(), data: { optId: 'planned', slot: 'main', done: false, plan: copyPlan, out: {}, sharedFrom: { id: 'owner' } } })
    eq(r.status, 200)
    const own = ownerFile().state.entries[id]
    eq((await saveOwn({ ...own, data: { ...own.data, sharedWith: [{ id: 'sam', entryId: id, ...(sync ? { sync: true } : {}) }] } })).status, 200)
    return { id, pre: (await r.json()).entry }
  }
  const theirsOn = (id) => samFile().state.entries[id]
  const ownOn = (id) => ownerFile().state.entries[id]

  await step('sync: Sam\'s copy shared with sync off and edited offline; the owner adds Row and turns sync on; Sam\'s push keeps Row in BOTH logs and lands Sam\'s numbers', async () => {
    const { id } = await freshShare('2026-10-22', { sync: false })
    ok(!theirsOn(id).data.syncBase, 'the copy should have no sync base yet')
    // Sam's phone, offline: logs a squat set and an RPE on the copy as it was (no syncBase).
    const offline = { ...theirsOn(id), updatedAt: tick() }
    offline.data = { ...offline.data, run: { sets: { b0i0s0: { reps: 7, weight: 55 } } }, out: { rpe: 8 } }
    // The owner adds Row (sync off: it stays on the owner's side), then turns sync on.
    eq((await saveOwn(replan(ownOn(id), bs => { bs[0].items.push(lifted('Row', st(2))); return bs }))).status, 200)
    eq((await saveOwn({ ...ownOn(id), data: { ...ownOn(id).data, sharedWith: [{ id: 'sam', entryId: id, sync: true }] } })).status, 200)
    ok(namesIn(theirsOn(id)).includes('Row'), 'turning sync on did not bring Row to Sam, so this proves nothing')
    // Sam's phone comes back online and pushes what it saved.
    eq((await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...samSays.headers }, body: JSON.stringify({ entry: offline }) })).status, 200)
    eq(namesIn(ownOn(id)), ['Squat', 'Deadlift', 'Row'], 'Sam\'s push took Row out of the owner\'s own log')
    eq(namesIn(theirsOn(id)), ['Squat', 'Deadlift', 'Row'], 'Sam\'s push took Row out of Sam\'s log')
    eq([theirsOn(id).data.out.rpe, Object.values(theirsOn(id).data.run.sets)], [8, [{ reps: 7, weight: 55 }]], 'Sam\'s numbers did not land')
  })

  await step('sync: a pre-sync copy (no sync base, no uids) pushed after a carry keeps every exercise on both sides and lands Sam\'s numbers', async () => {
    const { id, pre } = await freshShare('2026-10-23', { sync: true })
    ok(!pre.data.syncBase && !itemsIn(pre).some(i => i.uid), 'the phone\'s copy should predate the sync')
    // The owner adds Lunge; it is carried to Sam.
    eq((await saveOwn(replan(ownOn(id), bs => { bs[0].items.push(lifted('Lunge', st(1))); return bs }))).status, 200)
    ok(namesIn(theirsOn(id)).includes('Lunge'), 'the owner\'s Lunge did not reach Sam, so this proves nothing')
    // Sam's phone still holds the copy from before the sync, and logs on it.
    const old = { ...pre, updatedAt: tick(), data: { ...pre.data, run: { sets: { b0i0s0: { reps: 6, weight: 50 } } }, out: { rpe: 7 } } }
    eq((await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...samSays.headers }, body: JSON.stringify({ entry: old }) })).status, 200)
    eq(namesIn(ownOn(id)), ['Squat', 'Deadlift', 'Lunge'], 'the old copy took an exercise out of the owner\'s log')
    eq(namesIn(theirsOn(id)), ['Squat', 'Deadlift', 'Lunge'], 'the old copy took an exercise out of Sam\'s log')
    eq([theirsOn(id).data.out.rpe, Object.values(theirsOn(id).data.run.sets)], [7, [{ reps: 6, weight: 50 }]], 'Sam\'s numbers did not land')
    eq(itemsIn(theirsOn(id)).map(i => i.uid), itemsIn(ownOn(id)).map(i => i.uid), 'the two sides no longer share uids')
  })

  await step('sync: X1, a deadlift set Sam logged offline survives the owner removing Deadlift, on Sam\'s side only', async () => {
    const { id } = await freshShare('2026-10-24', { sync: true })
    // Sam's phone holds the synced copy (with its base), goes offline, logs 140 on Deadlift.
    const held = theirsOn(id)
    const dl = itemsIn(held).findIndex(i => i.name === 'Deadlift')
    ok(held.data.syncBase && dl >= 0, 'the copy should be synced, with Deadlift')
    const setId = held.data.plan.blocks[0].items[dl].sets[0].id
    const offline = { ...held, updatedAt: tick(), data: { ...held.data, run: { sets: { [setId]: { reps: 3, weight: 140 } } } } }
    // The owner removes Deadlift; Sam's copy (nothing logged on it there yet) loses it too.
    eq((await saveOwn(replan(ownOn(id), bs => { bs[0].items = bs[0].items.filter(i => i.name !== 'Deadlift'); return bs }))).status, 200)
    eq(namesIn(theirsOn(id)), ['Squat'], 'the removal did not reach Sam, so this proves nothing')
    // Sam's phone comes back and pushes.
    eq((await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...samSays.headers }, body: JSON.stringify({ entry: offline }) })).status, 200)
    eq(namesIn(theirsOn(id)), ['Squat', 'Deadlift'], 'Sam\'s logged deadlift was removed by the owner\'s write')
    eq(Object.values(theirsOn(id).data.run.sets), [{ reps: 3, weight: 140 }], 'Sam\'s 140 kg set is gone')
    eq(namesIn(ownOn(id)), ['Squat'], 'keeping Sam\'s set brought Deadlift back on the owner\'s side')
  })

  await step('sync: never into an entry Sam logged themselves, even when the owner\'s entry points at it', async () => {
    const own = { id: 'daily-2026-10-21', kind: 'daily', date: '2026-10-21', data: { optId: 'planned', plan: ids({ title: 'Mine', blocks: [{ name: 'A', note: '', items: [lifted('Squat', st(1))] }] }) } }
    eq((await saveSams(own)).status, 200)
    const before = JSON.stringify(samFile().state.entries[own.id])
    await saveOwn({ ...own, data: { ...own.data, sharedWith: [{ id: 'sam', entryId: own.id, sync: true }] } })
    await saveOwn(replan(ownerFile().state.entries[own.id], bs => { bs[0].items.push(lifted('Row', st(1))); return bs }))
    eq(JSON.stringify(samFile().state.entries[own.id]), before, 'the owner\'s change was written into Sam\'s own entry')
    ok(ownerFile().state.entries[own.id].data.syncBase, 'sync never ran on the owner\'s entry, so this proves nothing')
  })

  /* ------------------------------------------ the owner as trainer (peopleRoute) */
  const planned = { id: 'daily-2026-10-08', kind: 'daily', date: '2026-10-08', updatedAt: '2026-10-08T07:00:00Z',
    data: { optId: 'planned', slot: 'main', done: true, name: 'Legs', plan: { title: 'Legs', blocks: [] }, out: {}, plannedBy: { id: 'sam', name: 'forged' } } }

  await step('trainer: the owner plans a session into Sam\'s log; it is not done and says who planned it', async () => {
    const ownerBefore = ownerFile()
    const r = await post('sam', planned)
    eq(r.status, 200)
    const { entry } = await r.json()
    eq([entry.data.done, entry.data.plannedBy, entry.data.sharedFrom], [false, { id: 'owner', name: 'Alex' }, undefined],
      'plannedBy is the server\'s, and planning is not completing')
    eq(ownerFile(), ownerBefore, 'planning for Sam touched the owner\'s log')
    // Sam sees it in Sam's own log, and can log it like anything else.
    const hers = (await (await get(`${two.base}/api/state`, as('sam@example.com', { 'x-bushido-user': 'sam' }))).json()).state.entries
    eq(hers[planned.id].data.plannedBy.name, 'Alex')
    const logged = await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...as('sam@example.com', { 'x-bushido-user': 'sam' }).headers },
      body: JSON.stringify({ entry: { ...hers[planned.id], updatedAt: '2026-10-08T09:00:00Z', data: { ...hers[planned.id].data, done: true, out: { rpe: 8 } } } }) })
    eq(logged.status, 200)
    eq(samFile().state.entries[planned.id].data.done, true, 'Sam could not log what was planned for Sam')
    // ...and the owner can still run it from Sam's side afterwards (it is still marked as the owner's).
    const ran = await post('sam', { ...samFile().state.entries[planned.id], updatedAt: '2026-10-08T10:00:00Z' })
    eq(ran.status, 200)
  })

  await step('trainer: a week can no longer be planned for someone (the quotas are gone)', async () => {
    const week = { id: 'quota-2026-10-12', kind: 'quota', date: '2026-10-12', updatedAt: '2026-10-10T08:00:00Z',
      data: { counts: { run: 2 }, plannedBy: { id: 'x', name: 'y' } } }
    eq((await post('sam', week)).status, 400)
    eq(samFile().state.entries[week.id], undefined, 'a quota entry was written into Sam\'s log')
  })


  await step('trainer: the owner reads Sam\'s log, plan and About you, and edits the About you', async () => {
    const st = await (await get(`${two.base}/api/people/sam/state`, owns())).json()
    ok(st.state.entries[planned.id], 'Sam\'s log did not come back')
    eq((await get(`${two.base}/api/people/sam/state`, { method: 'POST', headers: { ...json, ...owns().headers }, body: '{}' })).status, 405)
    const content = await get(`${two.base}/api/people/sam/content`, owns())
    eq(content.status, 200)
    ok(Array.isArray((await content.json()).dailyMenu), 'Sam\'s plan did not come back')
    eq((await (await get(`${two.base}/api/people/sam/about`, owns())).json()).name, 'Sam', 'the About you does not fall back to the People name')
    const put = await get(`${two.base}/api/people/sam/about`, { method: 'PUT', headers: { ...json, ...owns().headers },
      body: JSON.stringify({ name: 'Sam', notes: 'Training for a 10k.' }) })
    eq((await put.json()).notes, 'Training for a 10k.')
    eq(JSON.parse(fs.readFileSync(path.join(two.dataDir, 'users', 'sam', 'about.json'), 'utf8')).notes, 'Training for a 10k.')
    eq(fs.existsSync(path.join(two.dataDir, 'about.json')), false, 'Sam\'s About you landed in the owner\'s space')
  })

  await step('trainer: Sam edits Sam\'s own About you; the owner\'s stays on the Settings page', async () => {
    const sam = (extra = {}) => as('sam@example.com', { 'x-bushido-user': 'sam', ...extra })
    eq((await (await get(`${two.base}/api/about`, sam())).json()).notes, 'Training for a 10k.')
    const put = await get(`${two.base}/api/about`, { method: 'PUT', headers: { ...json, ...sam().headers }, body: JSON.stringify({ name: 'Sammy', notes: 'Knee is fine now.' }) })
    eq([put.status, (await put.json()).name], [200, 'Sammy'])
    const mine = await get(`${two.base}/api/about`, { method: 'PUT', headers: { ...json, ...owns().headers }, body: JSON.stringify({ notes: 'x' }) })
    eq([mine.status, (await mine.json()).code], [409, 'settings'])
    eq((await (await get(`${two.base}/api/about`, owns())).json()).owner, true)
    // Acting as Sam, it is Sam's.
    const acting = await get(`${two.base}/api/about`, { method: 'PUT', headers: { ...json, ...as('alex@example.com', { cookie: 'bushido_as=sam' }).headers },
      body: JSON.stringify({ name: 'Sammy', notes: 'Set by the owner while acting.' }) })
    eq(acting.status, 200)
    eq(JSON.parse(fs.readFileSync(path.join(two.dataDir, 'users', 'sam', 'about.json'), 'utf8')).notes, 'Set by the owner while acting.')
  })

  await step('trainer: none of it for anyone but the owner, and not while acting', async () => {
    const sam = as('sam@example.com', { 'x-bushido-user': 'sam' })
    for (const what of ['state', 'content', 'about', 'entry?id=x']) {
      eq((await get(`${two.base}/api/people/owner/${what}`, sam)).status, 403, `Sam reached /api/people/owner/${what}`)
    }
    eq((await post('owner', { ...planned, data: { ...planned.data } }, sam)).status, 403, 'Sam planned for the owner')
    eq((await get(`${two.base}/api/people/sam/about`, { method: 'PUT', headers: { ...json, ...sam.headers }, body: '{}' })).status, 403)
    const acting = await get(`${two.base}/api/people/sam/state`, as('alex@example.com', { cookie: 'bushido_as=sam' }))
    eq([acting.status, (await acting.json()).code], [409, 'acting'])
  })

  await step('trainer: planning "for" someone is the owner\'s, not while acting, never for the owner', async () => {
    const plan = (body, h = owns()) => get(`${two.base}/api/plan/workout`, { method: 'POST', headers: { ...json, ...h.headers },
      body: JSON.stringify({ kinds: ['legs'], minutes: 30, ...body }) })
    // With no CLI the answer is the ordinary "set AI up", whoever it is for (an
    // unknown target is a 404 once there is a CLI, in the "ai for everyone" steps).
    for (const target of ['sam', 'nobody']) {
      const none = await plan({ for: target })
      eq([none.status, (await none.json()).code], [503, 'ai-not-configured'], target)
    }
    const week = await get(`${two.base}/api/plan/week`, { method: 'POST', headers: { ...json, ...owns().headers },
      body: JSON.stringify({ monday: '2026-10-12', message: 'x', for: 'nobody' }) })
    eq(week.status, 404)
  })

  await two.stop()

  /* ------------------------------------- someone else's own Strava (per person) */
  /*
   * A pretend Strava on a local port: the token endpoint and the three API reads
   * a pull makes. The server's Strava client is pointed at it by STRAVA_API_ORIGIN.
   */
  const stravaCalls = []
  const fakeStrava = http.createServer((q, r) => {
    stravaCalls.push(`${q.method} ${q.url.split('?')[0]}`)
    const reply = (body) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(body)) }
    const u = q.url.split('?')[0]
    if (u === '/oauth/token') return reply({ access_token: 'acc', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 21600, athlete: { id: 7, firstname: 'Sam', lastname: 'R' } })
    if (u === '/oauth/revoke') return reply({})
    if (u === '/api/v3/athlete') return reply({ id: 7, firstname: 'Sam', lastname: 'R', shoes: [], bikes: [] })
    if (u === '/api/v3/athlete/activities') {
      return reply(q.url.includes('page=1') ? [{ id: 99, name: 'Morning Run', sport_type: 'Run', type: 'Run', distance: 5000, moving_time: 1500, elapsed_time: 1550,
        start_date: new Date(Date.now() - 3600e3).toISOString(), start_date_local: new Date(Date.now() - 3600e3).toISOString() }] : [])
    }
    r.writeHead(404); r.end('{}')
  })
  await new Promise(r => fakeStrava.listen(0, '127.0.0.1', r))
  const sv = await boot({
    env: {
      BUSHIDO_AUTH: 'proxy', BUSHIDO_ACCESS_TEAM: 'test-team', BUSHIDO_ACCESS_AUD: AUD,
      BUSHIDO_ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs`,
      STRAVA_API_ORIGIN: `http://127.0.0.1:${fakeStrava.address().port}`,
      BUSHIDO_STRAVA_CLIENT_ID: '4242', BUSHIDO_STRAVA_CLIENT_SECRET: 'strava-secret-for-tests',
      BUSHIDO_API_TOKEN: TOKEN,
    },
    seed: {
      'settings.json': JSON.stringify({ version: 1, install: 'fresh', auth: { mode: 'proxy' } }),
      'users.json': JSON.stringify({ users: [{ id: 'owner', name: 'Alex', emails: ['alex@example.com'] }, { id: 'sam', name: 'Sam', emails: ['sam@example.com'] }] }),
    },
  })
  const samPost = (p, extra = {}) => get(`${sv.base}${p}`, { method: 'POST', headers: { ...json, ...as('sam@example.com', extra).headers }, body: '{}' })

  await step('own Strava: Sam is offered Connect, not shown the owner\'s, until he connects', async () => {
    const me = await (await get(`${sv.base}/api/auth/me`, as('sam@example.com'))).json()
    eq([me.features.strava, me.features.stravaConnect], [false, true])
    eq((await (await get(`${sv.base}/api/strava`, as('sam@example.com'))).json()).configured, false)
    eq((await samPost('/api/strava/pull')).status, 409)
  })

  await step('own Strava: connect, Strava\'s callback, then Sam\'s runs in Sam\'s space', async () => {
    const start = await (await samPost('/api/strava/connect')).json()
    const auth = new URL(start.authUrl)
    eq(auth.searchParams.get('client_id'), '4242')
    eq(auth.searchParams.get('redirect_uri'), `${sv.base}/strava/callback`)
    const back = await get(`${sv.base}/strava/callback?state=${auth.searchParams.get('state')}&code=c&scope=read,activity:read_all,profile:read_all`, as('sam@example.com'))
    eq(back.status, 303)
    const tokens = JSON.parse(fs.readFileSync(path.join(sv.dataDir, 'users', 'sam', 'strava-oauth.json'), 'utf8'))
    eq(tokens.refresh_token, 'ref')
    const me = await (await get(`${sv.base}/api/auth/me`, as('sam@example.com'))).json()
    eq(me.features.strava, true)
    const cache = await (await get(`${sv.base}/api/strava`, as('sam@example.com'))).json()
    eq([cache.configured, cache.activities.map(a => a.id)], [true, [99]])
    ok(!fs.existsSync(path.join(sv.dataDir, 'strava.json')), 'Sam\'s pull wrote the owner\'s cache')
  })

  await step('own Strava: a callback with a state nobody started is refused', async () => {
    eq((await get(`${sv.base}/strava/callback?state=forged&code=c`, as('sam@example.com'))).status, 400)
  })

  await step('own Strava: the owner connects his own too; nobody connects while acting as someone', async () => {
    const acting = await get(`${sv.base}/api/strava/connect`, { method: 'POST', headers: { ...json, ...as('alex@example.com', { cookie: 'bushido_as=sam' }).headers }, body: '{}' })
    eq(acting.status, 409)
    const start = await (await get(`${sv.base}/api/strava/connect`, { method: 'POST', headers: { ...json, ...as('alex@example.com').headers }, body: '{}' })).json()
    const state = new URL(start.authUrl).searchParams.get('state')
    ok(/activity:write/.test(new URL(start.authUrl).searchParams.get('scope')), 'the owner was not asked for the writes Totem\'s agents use')
    eq((await get(`${sv.base}/strava/callback?state=${state}&code=c&scope=read,activity:read_all,profile:read_all,activity:write,profile:write,read_all`, as('alex@example.com'))).status, 303)
    ok(fs.existsSync(path.join(sv.dataDir, 'strava-oauth.json')), 'the owner\'s grant is not in the data dir')
    const me = await (await get(`${sv.base}/api/auth/me`, as('alex@example.com'))).json()
    eq([me.features.strava, me.features.stravaConnect], [true, true])
    eq((await (await get(`${sv.base}/api/strava`, as('alex@example.com'))).json()).activities.map(a => a.id), [99])
  })

  await step('own Strava: Totem calls the owner\'s client with the API token, and nobody else\'s', async () => {
    const call = (body, headers = { authorization: `Bearer ${TOKEN}` }) => get(`${sv.base}/api/strava/owner`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) })
    const status = await (await call({ method: 'status' })).json()
    eq([status.result.connected, status.result.state], [true, 'ready'])
    const list = await (await call({ method: 'activities', args: [{ days: 7 }] })).json()
    eq(list.result.activities.map(a => a.id), [99])
    eq((await call({ method: 'startAuth' })).status, 400, 'connecting is not Totem\'s to do')
    eq((await call({ method: 'status' }, as('sam@example.com').headers)).status, 403)
    eq((await call({ method: 'status' }, as('alex@example.com', { cookie: 'bushido_as=sam' }).headers)).status, 403)
  })

  await step('own Strava: disconnecting forgets the grant and the cache', async () => {
    eq((await samPost('/api/strava/disconnect')).status, 200)
    ok(!fs.existsSync(path.join(sv.dataDir, 'users', 'sam', 'strava.json')), 'the cache survived')
    eq((await (await get(`${sv.base}/api/auth/me`, as('sam@example.com'))).json()).features.strava, false)
  })

  await step('own Strava: the client secret is masked in Settings', async () => {
    const view = await (await get(`${sv.base}/api/settings`, as('alex@example.com'))).json()
    eq(view.effective.strava.configured, true)
    ok(!JSON.stringify(view).includes('strava-secret-for-tests'), 'the Strava client secret reached the browser')
  })

  await sv.stop()
  fakeStrava.close()

  /* -------------------------------------------------- the owner's WHOOP, held here */
  /*
   * A pretend WHOOP: the token endpoint (counting refreshes) and the five reads a
   * training pull makes, with one scored night. Pointed at by WHOOP_API_ORIGIN.
   */
  const whoopCalls = []
  const night = {
    id: 'sleep-1', cycle_id: 11, nap: false, score_state: 'SCORED', updated_at: '2026-10-14T12:00:00Z',
    start: new Date(Date.now() - 10 * 3600e3).toISOString(), end: new Date(Date.now() - 2 * 3600e3).toISOString(), timezone_offset: '+00:00',
    score: { sleep_performance_percentage: 91, stage_summary: { total_slow_wave_sleep_time_milli: 90 * 60e3, total_rem_sleep_time_milli: 100 * 60e3, total_light_sleep_time_milli: 200 * 60e3 } },
  }
  const fakeWhoop = http.createServer((q, r) => {
    const u = q.url.split('?')[0]
    whoopCalls.push(`${q.method} ${u}`)
    const reply = (body) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(body)) }
    if (u === '/oauth/oauth2/token') {
      // Like WHOOP: the full grant on a code exchange, an echo of `offline` on a refresh.
      let raw = ''
      q.on('data', (c) => { raw += c })
      return q.on('end', () => {
        const code = new URLSearchParams(raw).get('grant_type') === 'authorization_code'
        reply({ access_token: `acc-${whoopCalls.length}`, refresh_token: `ref-${whoopCalls.length}`, expires_in: 3600,
          scope: code ? 'read:sleep read:workout read:recovery read:cycles read:body_measurement offline' : 'offline' })
      })
    }
    if (u === '/developer/v2/activity/sleep') return reply({ records: [night] })
    if (u === '/developer/v2/recovery') return reply({ records: [{ cycle_id: 11, score_state: 'SCORED', score: { recovery_score: 74 } }] })
    if (u === '/developer/v2/cycle') return reply({ records: [{ id: 11, start: night.start, timezone_offset: '+00:00', score: { strain: 9.3, kilojoule: 8000 } }] })
    if (u === '/developer/v2/activity/workout') return reply({ records: [] })
    if (u === '/developer/v2/user/measurement/body') return reply({ max_heart_rate: 190 })
    if (u === '/developer/v2/user/access') { r.writeHead(204); return r.end() }
    r.writeHead(404); r.end('{}')
  })
  await new Promise(r => fakeWhoop.listen(0, '127.0.0.1', r))
  const wv = await boot({
    env: {
      BUSHIDO_AUTH: 'proxy', BUSHIDO_ACCESS_TEAM: 'test-team', BUSHIDO_ACCESS_AUD: AUD,
      BUSHIDO_ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs`,
      WHOOP_API_ORIGIN: `http://127.0.0.1:${fakeWhoop.address().port}`,
      BUSHIDO_WHOOP_CLIENT_ID: 'whoop-app', BUSHIDO_WHOOP_CLIENT_SECRET: 'whoop-secret-for-tests',
      BUSHIDO_API_TOKEN: TOKEN,
    },
    seed: {
      'settings.json': JSON.stringify({ version: 1, install: 'fresh', auth: { mode: 'proxy' } }),
      'users.json': JSON.stringify({ users: [{ id: 'owner', name: 'Alex', emails: ['alex@example.com'] }, { id: 'sam', name: 'Sam', emails: ['sam@example.com'] }] }),
    },
  })
  const ownerPost = (p, extra = {}) => get(`${wv.base}${p}`, { method: 'POST', headers: { ...json, ...as('alex@example.com', extra).headers }, body: '{}' })
  const whoopOwner = (body, headers = { authorization: `Bearer ${TOKEN}` }) => get(`${wv.base}/api/whoop/owner`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify(body) })

  await step('whoop: the owner is offered Connect; nobody else is, and nobody connects while acting', async () => {
    const me = await (await get(`${wv.base}/api/auth/me`, as('alex@example.com'))).json()
    eq([me.features.whoop, me.features.whoopConnect], [false, true])
    const sam = await (await get(`${wv.base}/api/auth/me`, as('sam@example.com'))).json()
    eq([sam.features.whoop, sam.features.whoopConnect], [false, false])
    eq((await get(`${wv.base}/api/whoop/connect`, { method: 'POST', headers: { ...json, ...as('sam@example.com').headers }, body: '{}' })).status, 409)
    eq((await ownerPost('/api/whoop/connect', { cookie: 'bushido_as=sam' })).status, 409)
    eq((await (await whoopOwner({ method: 'status' })).json()).result.state, 'disconnected')
  })

  await step('whoop: connect, the callback, and the first pull fills the cache', async () => {
    const start = await (await ownerPost('/api/whoop/connect')).json()
    const auth = new URL(start.authUrl)
    eq([auth.searchParams.get('client_id'), auth.searchParams.get('redirect_uri')], ['whoop-app', `${wv.base}/whoop/callback`])
    ok(/read:workout/.test(auth.searchParams.get('scope')) && /offline/.test(auth.searchParams.get('scope')), 'the scopes asked for are not the training ones')
    eq((await get(`${wv.base}/whoop/callback?state=forged&code=c`, as('alex@example.com'))).status, 400)
    eq((await get(`${wv.base}/whoop/callback?state=${auth.searchParams.get('state')}&code=c`, as('alex@example.com'))).status, 303)
    const tokens = JSON.parse(fs.readFileSync(path.join(wv.dataDir, 'whoop-oauth.json'), 'utf8'))
    ok(tokens.refresh_token && /read:workout/.test(tokens.scope), 'the grant or its real scope was not kept')
    eq(fs.statSync(path.join(wv.dataDir, 'whoop-oauth.json')).mode & 0o777, 0o600)
    eq((await (await get(`${wv.base}/api/auth/me`, as('alex@example.com'))).json()).features.whoop, true)
    const cache = await (await get(`${wv.base}/api/whoop`, as('alex@example.com'))).json()
    eq([cache.configured, cache.maxHeartRate, cache.sleep[0].score, cache.recovery[0].recovery], [true, 190, 91, 74])
  })

  await step('whoop: Totem and Krakatoa read through the owner endpoint with the API token', async () => {
    eq((await (await whoopOwner({ method: 'status' })).json()).result.state, 'ready')
    const training = (await (await whoopOwner({ method: 'training', args: [{ days: 7 }] })).json()).result
    eq([training.ok, training.sleep.length, training.days], [true, 1, 7])
    const nights = (await (await whoopOwner({ method: 'sleepNights', args: [{ start: night.start, end: night.end, value: 'performance' }] })).json()).result
    eq([nights.length, nights[0].id, nights[0].value, nights[0].stats.recovery], [1, 'sleep-1', 91, 74])
    eq((await whoopOwner({ method: 'startAuth' })).status, 400, 'connecting is not theirs to do')
    eq((await whoopOwner({ method: 'status' }, as('sam@example.com').headers)).status, 403)
    eq((await whoopOwner({ method: 'status' }, as('alex@example.com', { cookie: 'bushido_as=sam' }).headers)).status, 403)
  })

  await step('whoop: callers arriving together share one refresh, because WHOOP voids the old token', async () => {
    const file = path.join(wv.dataDir, 'whoop-oauth.json')
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), expires_at: 0 }))
    const before = whoopCalls.filter(c => c.endsWith('/oauth/oauth2/token')).length
    const all = await Promise.all([1, 2, 3].map(() => whoopOwner({ method: 'training', args: [{ days: 3 }] })))
    eq(all.map(r => r.status), [200, 200, 200])
    eq(whoopCalls.filter(c => c.endsWith('/oauth/oauth2/token')).length - before, 1)
  })

  await step('whoop: the secret is masked, and disconnecting forgets the grant', async () => {
    const view = await (await get(`${wv.base}/api/settings`, as('alex@example.com'))).json()
    eq([view.effective.whoop.configured, view.effective.whoop.linked], [true, true])
    ok(!JSON.stringify(view).includes('whoop-secret-for-tests'), 'the WHOOP client secret reached the browser')
    eq((await ownerPost('/api/whoop/disconnect')).status, 200)
    ok(whoopCalls.includes('DELETE /developer/v2/user/access'), 'the grant was not revoked at WHOOP')
    eq((await (await get(`${wv.base}/api/auth/me`, as('alex@example.com'))).json()).features.whoop, false)
    eq((await (await whoopOwner({ method: 'status' })).json()).result.state, 'disconnected')
  })

  await wv.stop()
  fakeWhoop.close()

  /* ---------------------------------- every person's AI runs, on their own space */
  /*
   * A fake Claude CLI that records what it was spawned with (argv and the prompt
   * on stdin) and answers in each run's shape. The owner has a brain file, WHOOP
   * and Strava caches, an old install's coach threads and About-you notes;
   * the point of these steps is that Sam's runs see none of it, and that the
   * owner planning FOR Sam gets Sam's context, not the owner's.
   */
  const ai = mkdtemp('bushido-ai-')
  const RECORD = path.join(ai, 'runs.jsonl')
  const FAKE = path.join(ai, 'claude')
  fs.writeFileSync(FAKE, `#!${process.execPath}
const fs = require('fs')
const argv = process.argv.slice(2)
let stdin = ''
process.stdin.on('data', c => { stdin += c })
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify({ argv, stdin }) + '\\n')
  const schema = argv[argv.indexOf('--json-schema') + 1] || ''
  const out = schema.includes('"blocks"') ? { title: 'Legs', minutes: 30, why: 'because', changed: 'x', blocks: [{ name: 'Main', items: [{ kind: 'lift', name: 'Squat', sets: [{ reps: 5, weight: 135 }] }] }] }
    : { reply: 'hello' }
  process.stdout.write(JSON.stringify({ structured_output: out, model: 'fake' }))
})
`, { mode: 0o755 })
  const BRAIN = path.join(ai, 'brain', 'projects', 'profile.md')
  fs.mkdirSync(path.dirname(BRAIN), { recursive: true })
  fs.writeFileSync(BRAIN, 'OWNER-BRAIN-PROFILE')
  const runs = () => fs.readFileSync(RECORD, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const lastRun = () => runs().at(-1)
  const argOf = (r, name) => { const i = r.argv.indexOf(name); return i < 0 ? '' : r.argv[i + 1] }
  const addDirsOf = (r) => r.argv.flatMap((a, i) => (a === '--add-dir' ? [r.argv[i + 1]] : []))
  const promptOf = (r) => `${argOf(r, '--append-system-prompt')}\n${r.stdin}`
  const rule = (p) => `/${path.resolve(p)}`

  const three = await boot({
    env: {
      BUSHIDO_AUTH: 'proxy', BUSHIDO_ACCESS_TEAM: 'test-team', BUSHIDO_ACCESS_AUD: AUD,
      BUSHIDO_ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs`,
      CLAUDE_BIN: FAKE, BUSHIDO_BRAIN_FILE: BRAIN,
    },
    seed: {
      'state.json': JSON.stringify({ version: 1, updatedAt: '2026-09-01T00:00:00Z', state: { entries: {} } }),
      'settings.json': JSON.stringify({ version: 1, install: 'fresh', auth: { mode: 'proxy' }, athlete: { name: 'Alex', notes: 'OWNER-NOTES' } }),
      'users.json': JSON.stringify({ users: [{ id: 'owner', name: 'Alex', emails: ['alex@example.com'] },
        { id: 'sam', name: 'Sam', emails: ['sam@example.com'] }, { id: 'robin', name: 'Robin', emails: ['robin@example.com'] }] }),
      'whoop.json': '{"workouts":[]}', 'strava.json': '{"activities":[]}',
    },
  })
  const D = three.dataDir
  const SAM_DIR = path.join(D, 'users', 'sam')
  fs.mkdirSync(path.join(D, 'coach'), { recursive: true })
  fs.writeFileSync(path.join(D, 'coach', 'towner.json'), JSON.stringify({ id: 'towner', title: 'Mine', messages: [] }))
  fs.mkdirSync(path.join(D, 'users', 'robin'), { recursive: true })
  fs.writeFileSync(path.join(D, 'users', 'robin', 'state.json'), '{}')
  const samH = (extra = {}) => as('sam@example.com', { 'x-bushido-user': 'sam', ...extra })
  const ownerH = (extra = {}) => as('alex@example.com', { 'x-bushido-user': 'owner', ...extra })
  const postAi = (p, body, h) => get(`${three.base}${p}`, { method: 'POST', headers: { ...json, ...h.headers }, body: JSON.stringify(body) })
  await get(`${three.base}/api/about`, { method: 'PUT', headers: { ...json, ...samH().headers }, body: JSON.stringify({ name: 'Sam', notes: 'SAM-NOTES' }) })

  /* What a run for Sam must and must not be able to see, by flag and by prompt. */
  const assertSamRun = (r, label) => {
    const deny = argOf(r, '--disallowedTools').split(',')
    const allow = argOf(r, '--allowedTools')
    const prompt = promptOf(r)
    eq(addDirsOf(r), [SAM_DIR], `${label}: --add-dir is not just Sam's space`)
    for (const want of [`Read(${rule(D)}/state.json*)`, `Read(${rule(D)}/coach/**)`, `Read(${rule(D)}/coach.json*)`,
      `Read(${rule(D)}/whoop.json*)`, `Read(${rule(D)}/strava.json*)`, `Read(${rule(D)}/backups/**)`, `Read(${rule(D)}/users.json*)`,
      `Read(${rule(D)}/drafts/**)`,
      `Read(${rule(path.join(D, 'users', 'robin'))}/**)`, `Read(${rule(BRAIN)})`, `Read(${rule(path.dirname(BRAIN))}/**)`]) {
      ok(deny.includes(want), `${label}: no deny for ${want}`)
    }
    ok(!deny.some(d => d.includes(rule(SAM_DIR))), `${label}: a rule denies Sam's own space`)
    ok(!/Edit\(|Write\(/.test(allow), `${label}: Sam's run may write somewhere: ${allow}`)
    ok(deny.includes('Bash'), `${label}: Sam's run has a shell`)
    ok(prompt.includes(path.join(SAM_DIR, 'state.json')), `${label}: the prompt does not point at Sam's log`)
    ok(prompt.includes('SAM-NOTES') && prompt.includes('Sam'), `${label}: Sam's About you is not in the prompt`)
    for (const never of ['OWNER-NOTES', BRAIN, path.dirname(BRAIN), 'whoop.json', 'strava.json', path.join(D, 'state.json')]) {
      ok(!prompt.includes(never), `${label}: the prompt mentions ${never}`)
    }
  }

  await step('ai for everyone: Sam has the workout planner once a CLI is configured', async () => {
    const me = await (await get(`${three.base}/api/auth/me`, samH())).json()
    eq([me.features.ai, me.features.whoop, me.features.strava, me.features.notifications],
      [true, false, false, false], 'AI on, the owner\'s grants still off')
    ok(!('goals' in me.features), 'linked goals are still a feature')
  })

  await step('ai for everyone: the removed AI routes answer 404, and the owner\'s old coach threads stay put', async () => {
    for (const [p, body] of [['/api/coach/chat', { message: 'hi' }], ['/api/plan/week', { monday: '2026-10-12', message: 'x' }], ['/api/chat', { messages: [] }]]) {
      eq((await postAi(p, body, ownerH())).status, 404, `${p} still answers`)
    }
    for (const p of ['/api/coach', '/api/coach/threads', '/api/goals']) eq((await get(`${three.base}${p}`, ownerH())).status, 404, `${p} still answers`)
    eq(fs.readdirSync(path.join(D, 'coach')), ['towner.json'], 'the owner\'s old coach folder was touched')
  })

  await step('ai for everyone: Sam\'s planner runs are Sam\'s too', async () => {
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30 }, samH())).status, 200)
    assertSamRun(lastRun(), 'planner')
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'owner' }, samH())).status, 403, 'Sam planned for the owner')
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'robin' }, samH())).status, 403, 'Sam planned for someone else')
  })

  await step('ai for everyone: the owner planning FOR Sam runs on Sam\'s context, not the owner\'s', async () => {
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'nobody' }, ownerH())).status, 404)
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'sam' }, ownerH())).status, 200)
    assertSamRun(lastRun(), 'owner planning for Sam')
    eq((await postAi('/api/plan/revise', { plan: { blocks: [] }, message: 'shorter', for: 'sam' }, ownerH())).status, 200)
    assertSamRun(lastRun(), 'owner revising for Sam')
    // Acting as Sam, "for Sam" is just Sam's own run; for anyone else it is refused.
    const acting = await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'robin' }, as('alex@example.com', { cookie: 'bushido_as=sam' }))
    eq(acting.status, 409, 'planned "for" someone else while acting as Sam')
  })

  await step('ai for everyone: acting as Sam, the planner is Sam\'s', async () => {
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30 }, as('alex@example.com', { cookie: 'bushido_as=sam' }))).status, 200)
    assertSamRun(lastRun(), 'acting as Sam')
  })

  await step('ai for everyone: the owner\'s own runs are unchanged (brain, WHOOP, Strava, the owner\'s notes)', async () => {
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30 }, ownerH())).status, 200)
    const r = lastRun()
    const prompt = promptOf(r)
    for (const want of ['OWNER-NOTES', BRAIN, path.join(D, 'whoop.json'), path.join(D, 'state.json')]) {
      ok(prompt.includes(want), `the owner's planner lost ${want}`)
    }
    ok(!/Edit\(|Write\(/.test(argOf(r, '--allowedTools')), 'the owner\'s planner may write somewhere')
    ok(!argOf(r, '--disallowedTools').includes(`Read(${rule(D)}/state.json*)`), 'the owner\'s run is denied the owner\'s own log')
    ok(addDirsOf(r).includes(D), 'the owner\'s data dir is not readable')
  })

  await step('drafts: Sam\'s drafts are in Sam\'s space, written by Sam\'s run, and invisible to the owner', async () => {
    const PICK = [{ key: 'legs', label: 'Legs', prompt: 'a leg day' }]
    const r = await postAi('/api/plan/drafts', { picked: PICK, minutes: 30 }, samH())
    eq(r.status, 200)
    const { draft } = await r.json()
    const mine = (h) => get(`${three.base}/api/plan/drafts/${draft.id}`, h)
    await waitFor(async () => (await (await mine(samH())).json()).draft.status === 'ready', 'Sam\'s draft')
    assertSamRun(lastRun(), 'Sam\'s draft')
    ok(fs.existsSync(path.join(SAM_DIR, 'drafts', `${draft.id}.json`)), 'Sam\'s draft is not in Sam\'s space')
    ok(!fs.existsSync(path.join(D, 'drafts', `${draft.id}.json`)), 'Sam\'s draft is in the owner\'s folder')
    eq((await mine(ownerH())).status, 404, 'the owner read Sam\'s draft by id')
    eq((await get(`${three.base}/api/plan/drafts/${draft.id}`, { method: 'DELETE', ...ownerH() })).status, 404, 'the owner discarded Sam\'s draft')
    const ownerList = (await (await get(`${three.base}/api/plan/drafts`, ownerH())).json()).drafts
    ok(!ownerList.some(d => d.id === draft.id), 'the owner was shown Sam\'s draft')
    eq((await (await get(`${three.base}/api/plan/drafts`, samH())).json()).drafts.map(d => d.id), [draft.id])
  })

  await step('drafts: the owner\'s draft FOR Sam is the owner\'s, and its run is Sam\'s', async () => {
    const r = await postAi('/api/plan/drafts', { picked: [{ key: 'legs', label: 'Legs' }], minutes: 30, for: 'sam' }, ownerH())
    eq(r.status, 200)
    const { draft } = await r.json()
    eq(draft.for, { id: 'sam', name: 'Sam' })
    await waitFor(async () => (await (await get(`${three.base}/api/plan/drafts/${draft.id}`, ownerH())).json()).draft.status === 'ready', 'the draft for Sam')
    assertSamRun(lastRun(), 'owner drafting for Sam')
    ok(fs.existsSync(path.join(D, 'drafts', `${draft.id}.json`)), 'the owner\'s draft is not in the owner\'s folder')
    const rev = await postAi(`/api/plan/drafts/${draft.id}/revise`, { message: 'shorter' }, ownerH())
    eq(rev.status, 200)
    await waitFor(async () => (await (await get(`${three.base}/api/plan/drafts/${draft.id}`, ownerH())).json()).draft.status === 'ready', 'the revision for Sam')
    assertSamRun(lastRun(), 'owner revising a draft for Sam')
    ok(!(await (await get(`${three.base}/api/plan/drafts`, samH())).json()).drafts.some(d => d.id === draft.id), 'Sam was shown the owner\'s draft')
    // Kept into Sam's log, the owner's draft is retired by the entry there.
    const ready = (await (await get(`${three.base}/api/plan/drafts/${draft.id}`, ownerH())).json()).draft
    const entry = { id: 'daily-2026-10-25', date: '2026-10-25', type: 'daily', data: { optId: 'planned', done: false, plan: { ...ready.pres, draftId: draft.id } } }
    eq((await get(`${three.base}/api/entry`, { method: 'POST', headers: { ...json, ...samH().headers }, body: JSON.stringify({ entry }) })).status, 200)
    ok(!(await (await get(`${three.base}/api/plan/drafts`, ownerH())).json()).drafts.some(d => d.id === draft.id),
      'a draft kept into Sam\'s log is still offered to the owner')
    eq((await postAi('/api/plan/drafts', { picked: [{ key: 'legs', label: 'Legs' }], minutes: 30, for: 'owner' }, samH())).status, 403, 'Sam drafted for the owner')
  })

  /* --------------------------------- several people at once, and a prompt alone (#59) */
  const draftOf = async (id, h = ownerH()) => (await (await get(`${three.base}/api/plan/drafts/${id}`, h)).json()).draft
  const readyDraft = (id, label) => waitFor(async () => { const d = await draftOf(id); return d.status === 'ready' && d }, label)

  const denyOf = (r) => argOf(r, '--disallowedTools').split(',')
  const setsOf = (pres) => pres.blocks.flatMap(b => b.items).flatMap(i => i.sets)

  await step('plan together: you and Sam is the owner\'s run, told about both; by rule it reads no one else\'s space and writes no loads', async () => {
    const r = await postAi('/api/plan/drafts', { picked: [], goal: 'a lift day together', minutes: 45, for: ['owner', 'sam'] }, ownerH())
    eq(r.status, 200)
    const { draft } = await r.json()
    eq([draft.for, draft.people], [null, [{ id: 'owner', name: 'Alex', owner: true }, { id: 'sam', name: 'Sam' }]])
    ok(fs.existsSync(path.join(D, 'drafts', `${draft.id}.json`)), 'the group draft is not the owner\'s')
    const ready = await readyDraft(draft.id, 'the group draft')
    const run = lastRun()
    const prompt = promptOf(run)
    const deny = denyOf(run)
    eq(addDirsOf(run).includes(SAM_DIR), false, 'the group run was given Sam\'s space')
    ok(addDirsOf(run).includes(D), 'the group run is not the owner\'s')
    for (const want of [`Read(${rule(path.join(D, 'users'))})`, `Read(${rule(path.join(D, 'users'))}/**)`]) {
      ok(deny.includes(want), `no deny for ${want}: everyone's space is readable`)
    }
    ok(!deny.includes(`Read(${rule(D)}/state.json*)`) && !deny.includes(`Read(${rule(D)}/**)`), 'the owner\'s own log is denied to the owner\'s run')
    ok(!argOf(run, '--allowedTools').match(/Edit\(|Write\(/) && deny.includes('Bash'), 'the group run may write or has a shell')
    for (const want of ['OWNER-NOTES', 'SAM-NOTES', 'Alex and Sam', 'MORE THAN ONE PERSON', path.join(D, 'state.json')]) {
      ok(prompt.includes(want), `the group prompt lacks ${want}`)
    }
    ok(!prompt.includes(path.join(SAM_DIR, 'state.json')), 'the group prompt points at Sam\'s log')
    // The fake model wrote a weight; a shared plan carries none.
    ok(setsOf(ready.pres).every(x => !('weight' in x)), `a group plan kept a load: ${JSON.stringify(setsOf(ready.pres))}`)
    // A revision of it is the same group run, and keeps no loads either.
    eq((await postAi(`/api/plan/drafts/${draft.id}/revise`, { message: 'shorter' }, ownerH())).status, 200)
    const revised = await waitFor(async () => { const d = await draftOf(draft.id); return d.status === 'ready' && d.pres.thread.length === 2 && d }, 'the group revision')
    ok(promptOf(lastRun()).includes('SAM-NOTES') && denyOf(lastRun()).includes(`Read(${rule(path.join(D, 'users'))}/**)`), 'the revision forgot Sam, or may read Sam\'s space')
    ok(setsOf(revised.pres).every(x => !('weight' in x)), 'a group revision kept a load')
    // One person's run keeps the loads the model wrote.
    const one = await (await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30 }, ownerH())).json()
    eq(setsOf(one.plan)[0].weight, 135, 'the owner\'s own plan lost its load')
  })

  await step('plan together: others only reads nobody\'s data by rule; refused to anyone else, acting, or an unknown', async () => {
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: ['sam', 'robin'] }, ownerH())).status, 200)
    const run = lastRun()
    const prompt = promptOf(run)
    const deny = denyOf(run)
    for (const never of ['OWNER-NOTES', BRAIN, 'whoop.json', 'strava.json', path.join(D, 'state.json')]) ok(!prompt.includes(never), `others-only mentions ${never}`)
    ok(prompt.includes('Sam and Robin'), 'others-only does not name them')
    eq(addDirsOf(run), [], 'others-only was handed a directory')
    for (const want of [`Read(${rule(D)}/state.json*)`, `Read(${rule(D)}/whoop.json*)`, `Read(${rule(D)}/strava.json*)`,
      `Read(${rule(D)}/drafts/**)`, `Read(${rule(SAM_DIR)}/**)`, `Read(${rule(path.join(D, 'users', 'robin'))}/**)`,
      `Read(${rule(path.join(D, 'users'))}/**)`, `Read(${rule(D)}/**)`, `Read(${rule(BRAIN)})`, `Read(${rule(path.dirname(BRAIN))}/**)`]) {
      ok(deny.includes(want), `others-only: no deny for ${want}`)
    }
    ok(deny.includes('Bash') && !argOf(run, '--allowedTools').match(/Edit\(|Write\(/), 'others-only may write or has a shell')
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: ['sam', 'robin'] }, samH())).status, 403, 'Sam planned for a group')
    eq((await postAi('/api/plan/drafts', { picked: [{ key: 'legs', label: 'Legs' }], minutes: 30, for: ['owner', 'sam'] }, samH())).status, 403, 'Sam drafted for a group')
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: ['owner', 'sam'] }, as('alex@example.com', { cookie: 'bushido_as=sam' }))).status, 409, 'a group while acting')
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: ['owner', 'nobody'] }, ownerH())).status, 404)
  })

  await step('prompt only: what they wrote is enough, with no kind, and a draft is labelled by it', async () => {
    eq((await postAi('/api/plan/drafts', { picked: [], goal: '', minutes: 30 }, ownerH())).status, 400, 'nothing at all was accepted')
    eq((await postAi('/api/plan/workout', { kinds: [], minutes: 30 }, ownerH())).status, 400)
    eq((await postAi('/api/plan/workout', { goal: 'an easy spin', minutes: 30 }, ownerH())).status, 200, 'a prompt alone was refused')
    const r = await postAi('/api/plan/drafts', { goal: 'legs, then twenty minutes easy on the bike', minutes: 50 }, ownerH())
    eq(r.status, 200)
    const { draft } = await r.json()
    eq([draft.picked, draft.ask.kinds, draft.ask.goal], [[], [], 'legs, then twenty minutes easy on the bike'])
    ok(/^legs, then twenty minutes easy on the bike/.test(draft.ask.label), `the label is ${draft.ask.label}`)
    const done = await readyDraft(draft.id, 'the prompt-only draft')
    ok(lastRun().stdin.includes('did not pick a kind'), 'the model was not told to choose the blocks')
    ok(lastRun().stdin.includes('legs, then twenty minutes easy on the bike'), 'what they wrote did not reach the model')
    eq(done.pres.ask.kinds, [])
  })

  await step('an old draft for Sam (a single `for`, no `people`) reopens, and its runs are still Sam\'s', async () => {
    const id = 'dold59draft'
    const at = new Date().toISOString()
    fs.writeFileSync(path.join(D, 'drafts', `${id}.json`), JSON.stringify({
      id, createdAt: at, updatedAt: at, status: 'ready', error: null,
      picked: [{ key: 'legs', label: 'Legs', prompt: 'a leg day' }],
      ask: { kinds: ['a leg day'], label: 'Legs', minutes: 30, goal: '' }, context: '',
      for: { id: 'sam', name: 'Sam' },
      pres: { title: 'Legs', minutes: 30, why: 'w', blocks: [{ name: 'Main', items: [] }], ask: null, thread: [] }, run: null,
    }))
    const listed = (await (await get(`${three.base}/api/plan/drafts`, ownerH())).json()).drafts.find(d => d.id === id)
    ok(listed, 'the old draft is not listed')
    eq([listed.for, listed.people], [{ id: 'sam', name: 'Sam' }, undefined])
    eq((await postAi(`/api/plan/drafts/${id}/revise`, { message: 'shorter' }, ownerH())).status, 200)
    await readyDraft(id, 'the old draft\'s revision')
    assertSamRun(lastRun(), 'an old draft for Sam')
  })

  await step('plan together: keeping it puts it in the owner\'s log and shares it with Sam, synced, through the shared-workout path', async () => {
    const { pathToFileURL } = require('url')
    const lib = (f) => import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'lib', f)).href)
    const { placeEntries, plannedItems, shareKept } = await lib('trainer.js')
    const { splitPrescription, normalizePrescription } = await lib('prescription.js')
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'starter.json'), 'utf8'))
    const liftField = content.dailyMenu.flatMap(o => o.outputs || []).find(f => f.type === 'lifts')
    const r = await postAi('/api/plan/drafts', { picked: [{ key: 'legs', label: 'Legs' }], minutes: 45, for: ['owner', 'sam'] }, ownerH())
    const ready = await readyDraft((await r.json()).draft.id, 'the draft to keep')
    const pres = { ...normalizePrescription(ready.pres, { liftField }), draftId: ready.id }
    const day = '2026-10-26'
    const mine = placeEntries({ menu: content.dailyMenu, onDay: [], items: plannedItems(splitPrescription(pres)), date: day, today: day })
    const ownerFileNow = () => JSON.parse(fs.readFileSync(path.join(D, 'state.json'), 'utf8')).state.entries
    const samFileNow = () => JSON.parse(fs.readFileSync(path.join(SAM_DIR, 'state.json'), 'utf8')).state.entries
    const people = `${three.base}/api/people/sam/entry`
    const call = async (url, init) => { const res = await get(url, init); const b = await res.json(); if (!res.ok) throw Object.assign(new Error(b.error), { code: b.code }); return b }
    const save = (entry) => get(`${three.base}/api/entry`, { method: 'POST', headers: { ...json, ...ownerH().headers }, body: JSON.stringify({ entry: { ...entry, updatedAt: new Date().toISOString() } }) })
    const api = {
      getPersonDay: async (_, date) => (await call(`${people}?date=${date}`, ownerH())).entries,
      getPersonEntry: async (_, id) => (await call(`${people}?id=${id}`, ownerH())).entry,
      putPersonEntry: async (_, entry) => (await call(people, { method: 'POST', headers: { ...json, ...ownerH().headers },
        body: JSON.stringify({ entry: { ...entry, updatedAt: new Date().toISOString() } }) })).entry,
    }
    for (const e of mine) eq((await save(e)).status, 200)
    const saves = []
    const out = await shareKept({ entries: mine, people: [{ id: 'sam', name: 'Sam' }], menu: content.dailyMenu,
      owner: { id: 'owner', name: 'Alex' }, api, save: (e) => saves.push(save(e)) })
    await Promise.all(saves)
    eq(out.failed, [])
    const id = mine[0].id
    const ownerSide = ownerFileNow()[id]
    eq(ownerSide.data.sharedWith, [{ id: 'sam', entryId: id, sync: true }], 'the owner\'s entry does not name Sam with sync on')
    eq(ownerSide.data.plan.draftId, ready.id, 'the owner\'s entry lost the draft id')
    const samSide = samFileNow()[id]
    ok(samSide && !samSide.deleted, 'Sam has no copy')
    eq([samSide.data.done, samSide.data.sharedFrom, samSide.data.plan.draftId], [false, { id: 'owner', name: 'Alex' }, undefined])
    const uids = (e) => e.data.plan.blocks.flatMap(b => b.items).map(i => i.uid)
    ok(uids(ownerSide).every(Boolean), 'the owner\'s exercises have no uids')
    eq(uids(samSide), uids(ownerSide), 'the two sides are not one synced structure')
    // Kept: the draft is retired by the owner's entry.
    ok(!(await (await get(`${three.base}/api/plan/drafts`, ownerH())).json()).drafts.some(d => d.id === ready.id), 'a kept group draft is still offered')
  })

  await step('plan together: "Try again" for others only never writes a part twice, part-way or with a lost answer', async () => {
    const { pathToFileURL } = require('url')
    const lib = (f) => import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'lib', f)).href)
    const { keepPlanFor, keepForEach, keepKeyFor } = await lib('trainer.js')
    const { splitPrescription } = await lib('prescription.js')
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'starter.json'), 'utf8'))
    const [c1, c2] = content.quotaCategories.map(c => c.key)
    const set = (o) => ({ id: 's', reps: null, weight: null, seconds: null, distance: null, restSec: null, unit: null, note: '', ...o })
    const pres = { title: 'Two parts', minutes: 50, why: '', notes: [], blocks: [
      { id: 'b0', name: 'One', note: '', category: c1, activity: null, items: [{ id: 'b0i0', kind: 'lift', name: 'Squat', exercise: 'squat', implement: null, unit: null, note: '', sets: [set({ id: 'b0i0s0', reps: 5 })] }] },
      { id: 'b1', name: 'Two', note: '', category: c2, activity: null, items: [{ id: 'b1i0', kind: 'interval', name: 'Easy', exercise: null, implement: null, unit: null, note: '', sets: [set({ id: 'b1i0s0', seconds: 600 })] }] },
    ] }
    const parts = splitPrescription(pres)
    eq(parts.length, 2, 'the plan is not two parts')
    const day = '2026-10-27'
    const people = (pid) => `${three.base}/api/people/${pid}/entry`
    const call = async (url, init) => { const res = await get(url, init); const b = await res.json(); if (!res.ok) throw new Error(b.error); return b }
    const real = {
      getPersonDay: async (pid, date) => (await call(`${people(pid)}?date=${date}`, ownerH())).entries,
      getPersonEntry: async (pid, id) => (await call(`${people(pid)}?id=${id}`, ownerH())).entry,
      putPersonEntry: async (pid, entry) => (await call(people(pid), { method: 'POST', headers: { ...json, ...ownerH().headers },
        body: JSON.stringify({ entry: { ...entry, updatedAt: new Date().toISOString() } }) })).entry,
    }
    const keepWith = (api, key) => (person) => keepPlanFor({ person, parts, menu: content.dailyMenu, date: day, owner: { id: 'owner', name: 'Alex' }, api, key })
    const onDay = (dir, key) => Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).state.entries)
      .filter(e => !e.deleted && e.date === day && String(e.data?.keepKey || '').startsWith(`${key}:`))
    const ROBIN_DIR = path.join(D, 'users', 'robin')
    const SAM_P = { id: 'sam', name: 'Sam' }
    const ROBIN_P = { id: 'robin', name: 'Robin' }

    // Robin's second part does not get there.
    const k1 = keepKeyFor({ draftId: 'dhttpretry1' })
    let robinPuts = 0
    const flaky = { ...real, putPersonEntry: async (pid, e) => { if (pid === 'robin' && ++robinPuts === 2) throw new Error('offline'); return real.putPersonEntry(pid, e) } }
    const r = await keepForEach({ people: [SAM_P, ROBIN_P], keep: keepWith(flaky, k1) })
    eq(r.failed.map(f => [f.person.id, f.written, f.of]), [['robin', 1, 2]], 'Robin\'s part-way keep is not reported as such')
    await keepForEach({ people: [ROBIN_P], keep: keepWith(real, k1) })
    eq(onDay(ROBIN_DIR, k1).length, 2, 'Robin does not have exactly one entry per part after the retry')
    eq(onDay(SAM_DIR, k1).length, 2, 'Sam does not have one entry per part')

    // Sam's write lands; the answer is lost.
    const k2 = keepKeyFor({ draftId: 'dhttpretry2' })
    let samPuts = 0
    const lossy = { ...real, putPersonEntry: async (pid, e) => { const out = await real.putPersonEntry(pid, e); if (pid === 'sam' && ++samPuts === 1) throw new Error('timeout'); return out } }
    const r2 = await keepForEach({ people: [SAM_P, ROBIN_P], keep: keepWith(lossy, k2) })
    eq(r2.failed.map(f => f.person.id), ['sam'])
    await keepForEach({ people: [SAM_P], keep: keepWith(real, k2) })
    eq(onDay(SAM_DIR, k2).length, 2, 'a lost answer\'s retry wrote Sam\'s part again')
  })

  await three.stop()
  certs.close()

  /* ------------------------------------------ AI workout drafts, end to end */
  /*
   * A fake CLI the test can hold: a goal saying SLOW waits for a release file,
   * a goal saying FAIL exits non-zero while a flag file exists. Nothing here is
   * a real model; the point is that the run belongs to the draft on disk and
   * not to any request, so "the page went away" is just "nobody asked".
   */
  const dk = mkdtemp('bushido-drafts-')
  const RELEASE = path.join(dk, 'release')
  const FAILFLAG = path.join(dk, 'fail')
  const SLOWFAKE = path.join(dk, 'claude')
  fs.writeFileSync(SLOWFAKE, `#!${process.execPath}
const fs = require('fs')
const argv = process.argv.slice(2)
let stdin = ''
process.stdin.on('data', c => { stdin += c })
process.stdin.on('end', () => {
  if (stdin.includes('GOAL-FAIL') && fs.existsSync(${JSON.stringify(FAILFLAG)})) {
    process.stderr.write('fake planner fell over\\n'); process.exit(1)
  }
  const revise = stdin.includes('Return the WHOLE session again')
  const answer = () => process.stdout.write(JSON.stringify({ model: 'fake', structured_output: {
    title: revise ? 'Shorter legs' : stdin.includes('GOAL-SLOW') ? 'Slow legs' : 'Legs', minutes: 30, why: 'because',
    ...(revise ? { changed: 'Cut a set.' } : {}),
    blocks: [{ name: 'Main', items: [{ kind: 'lift', name: 'Squat', sets: [{ reps: 5 }] }] }] } }))
  if (!stdin.includes('GOAL-SLOW')) return answer()
  const iv = setInterval(() => { if (fs.existsSync(${JSON.stringify(RELEASE)})) { clearInterval(iv); answer() } }, 30)
})
`, { mode: 0o755 })
  const draftEnv = { BUSHIDO_AUTH: 'proxy', CLAUDE_BIN: SLOWFAKE }
  let dv = await boot({ env: draftEnv })
  const DV = dv.dataDir
  const PICKED = [{ key: 'legs', label: 'Legs', prompt: 'a leg day', category: 'strength', activity: 'lift' }]
  const dpost = (p, body = {}) => get(`${dv.base}${p}`, { method: 'POST', headers: json, body: JSON.stringify(body) })
  const dget = async (id) => (await (await get(`${dv.base}/api/plan/drafts/${id}`)).json()).draft
  const dlist = async () => (await (await get(`${dv.base}/api/plan/drafts`)).json()).drafts
  const settled = (id, status = 'ready') => waitFor(async () => { const d = await dget(id); return d?.status === status && d }, `draft ${status}`)
  const newDraft = async (goal) => {
    const r = await dpost('/api/plan/drafts', { picked: PICKED, minutes: 45, goal })
    eq(r.status, 200, `create (${goal})`)
    return (await r.json()).draft
  }

  await step('drafts: "Write it for me" survives a reload mid-run and after it finishes', async () => {
    const d = await newDraft('GOAL-SLOW')
    eq(d.status, 'working')
    // A reload mid-run: nothing is waiting on the first request, and the draft is still there, working.
    eq((await dlist()).map(x => [x.id, x.status]), [[d.id, 'working']])
    await new Promise(r => setTimeout(r, 150))
    eq((await dget(d.id)).status, 'working', 'it finished without being released')
    fs.writeFileSync(RELEASE, '')
    const done = await settled(d.id)
    eq([done.pres.title, done.pres.category, done.pres.ask.kinds], ['Slow legs', 'strength', ['Legs']])
    // After it finished: a fresh read, as another device would make.
    eq((await dlist()).find(x => x.id === d.id).status, 'ready')
    ok(fs.existsSync(path.join(DV, 'drafts', `${d.id}.json`)), 'the draft is not a file in data/drafts')
    const state = await (await get(`${dv.base}/api/state`)).json()
    eq(Object.keys(state.state.entries), [], 'a draft wrote the log')
  })

  await step('drafts: two at once are written side by side', async () => {
    fs.rmSync(RELEASE, { force: true })
    const a = await newDraft('GOAL-SLOW first')
    const b = await newDraft('GOAL-SLOW second')
    eq([(await dget(a.id)).status, (await dget(b.id)).status], ['working', 'working'])
    fs.writeFileSync(RELEASE, '')
    await settled(a.id); await settled(b.id)
    ok((await dlist()).filter(x => x.status === 'ready').length >= 3, 'a draft went missing')
  })

  await step('drafts: a failed run is a draft with the error, and Try again writes it', async () => {
    fs.writeFileSync(FAILFLAG, '')
    const d = await newDraft('GOAL-FAIL')
    const f = await settled(d.id, 'failed')
    ok(/fake planner fell over/.test(f.error), `the error is not the planner's: ${f.error}`)
    eq(f.pres, null)
    fs.rmSync(FAILFLAG)
    eq((await dpost(`/api/plan/drafts/${d.id}/retry`)).status, 200)
    eq((await settled(d.id)).pres.title, 'Legs')
  })

  await step('drafts: a revision is stored on the draft, message first and answer after', async () => {
    const d = await newDraft('quick')
    const ready = await settled(d.id)
    const r = await dpost(`/api/plan/drafts/${d.id}/revise`, { message: 'make it shorter', pres: { ...ready.pres, title: 'My edit' } })
    eq(r.status, 200)
    const w = (await r.json()).draft
    eq([w.status, w.pres.thread.at(-1).text], ['working', 'make it shorter'])
    const done = await settled(d.id)
    eq(done.pres.thread.map(m => [m.role, m.text]), [['you', 'make it shorter'], ['coach', 'Cut a set.']])
    eq(done.pres.title, 'Shorter legs')
    // Edits on the review screen are saved too.
    const put = await get(`${dv.base}/api/plan/drafts/${d.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ pres: { ...done.pres, title: 'Mine now' } }) })
    eq(put.status, 200)
    eq((await dget(d.id)).pres.title, 'Mine now')
  })

  await step('drafts: discard deletes it', async () => {
    const d = await newDraft('quick')
    eq((await get(`${dv.base}/api/plan/drafts/${d.id}`, { method: 'DELETE' })).status, 200)
    eq((await get(`${dv.base}/api/plan/drafts/${d.id}`)).status, 404)
    ok(!(await dlist()).some(x => x.id === d.id), 'a discarded draft is still listed')
  })

  await step('drafts: keeping is once only: claimed, placed with its id, then removed', async () => {
    const d = await settled((await newDraft('quick')).id)
    // Two devices have it open. The first claims it, places it, discards it.
    eq((await dpost(`/api/plan/drafts/${d.id}/keep`)).status, 200)
    eq((await dpost(`/api/plan/drafts/${d.id}/keep`)).status, 409, 'the second device was allowed to keep it too')
    ok(!(await dlist()).some(x => x.id === d.id), 'a draft being kept is still offered')
    const entry = { id: 'daily-2026-10-25', date: '2026-10-25', type: 'daily', data: { optId: 'planned', done: false, plan: { ...d.pres, draftId: d.id } } }
    eq((await get(`${dv.base}/api/entry`, { method: 'POST', headers: json, body: JSON.stringify({ entry }) })).status, 200)
    eq((await get(`${dv.base}/api/plan/drafts/${d.id}`, { method: 'DELETE' })).status, 200)
    eq((await dpost(`/api/plan/drafts/${d.id}/keep`)).status, 404, 'a kept and discarded draft could be kept again')
    const state = await (await get(`${dv.base}/api/state`)).json()
    eq(state.state.entries['daily-2026-10-25'].data.plan.title, 'Legs')
  })

  await step('drafts: kept offline (the discard never arrived), the synced entry retires the draft', async () => {
    const d = await settled((await newDraft('quick')).id)
    // A failed placement hands the claim back and the draft is offered again.
    eq((await dpost(`/api/plan/drafts/${d.id}/keep`)).status, 200)
    eq((await dpost(`/api/plan/drafts/${d.id}/keep`, { release: true })).status, 200)
    ok((await dlist()).some(x => x.id === d.id), 'a released draft is not offered again')
    // The phone kept it offline: its entry syncs later, its DELETE never comes.
    const entry = { id: 'daily-2026-10-26', date: '2026-10-26', type: 'daily', data: { optId: 'planned', done: false, plan: { ...d.pres, draftId: d.id } } }
    await get(`${dv.base}/api/entry`, { method: 'POST', headers: json, body: JSON.stringify({ entry }) })
    ok(!(await dlist()).some(x => x.id === d.id), 'a draft already on the day is offered again as Ready')
    eq((await get(`${dv.base}/api/plan/drafts/${d.id}`)).status, 404, 'the kept draft was not removed')
  })

  await step('drafts: a restart mid-run leaves the draft failed with a retry, not stuck working', async () => {
    fs.rmSync(RELEASE, { force: true })
    const d = await newDraft('GOAL-SLOW restart')
    await dv.stop()
    dv = await boot({ env: draftEnv, dataDir: DV })
    const f = await dget(d.id)
    eq(f.status, 'failed', 'a draft whose run died with the server still says working')
    ok(/restarted/.test(f.error), f.error)
    fs.writeFileSync(RELEASE, '')
    eq((await dpost(`/api/plan/drafts/${d.id}/retry`)).status, 200)
    eq((await settled(d.id)).pres.title, 'Slow legs')
  })
  await dv.stop()

  /* ------------------------------------ an old log, with the removed features in it */
  /*
   * Issue #31 removed the check-in, the journal, achievements, linked goals,
   * quotas and the week planner, and the AI coach. Stored data is NEVER deleted
   * or rewritten: an old log carries their entries, and an old data dir carries
   * coach.json, coach/ threads and goals.json. The server must boot on it, keep
   * every one of those byte for byte through reads, writes, export and backup,
   * and never treat any of them as a workout.
   */
  const LEGACY_ENTRIES = {
    'daily-2026-09-01': { id: 'daily-2026-09-01', kind: 'daily', date: '2026-09-01', updatedAt: '2026-09-01T10:00:00Z',
      data: { optId: 'log-workout', name: 'Run', level: 2, done: true, out: { activity: 'run', distance: 3 } } },
    'checkin-2026-09-01': { id: 'checkin-2026-09-01', kind: 'checkin', date: '2026-09-01', updatedAt: '2026-09-01T07:00:00Z',
      data: { fields: { weightLb: 150, feeling: 4 }, messages: [{ role: 'you', at: 'z', text: 'no gym tonight' }, { role: 'coach', at: 'z', text: 'crawls then' }] } },
    'journal-2026-09-01': { id: 'journal-2026-09-01', kind: 'journal', date: '2026-09-01', updatedAt: '2026-09-01T22:00:00Z', data: { values: { caffeine: true } } },
    'journal-custom': { id: 'journal-custom', kind: 'journal-custom', updatedAt: '2026-08-01T00:00:00Z', data: { metrics: [{ key: 'x-1', label: 'Sauna' }] } },
    'quota-2026-08-31': { id: 'quota-2026-08-31', kind: 'quota', date: '2026-08-31', updatedAt: '2026-08-31T08:00:00Z',
      data: { counts: { run: 3, pe: 2 }, why: 'three runs', plannedBy: { id: 'owner', name: 'Alex' } } },
    'achievement-run-a-50k': { id: 'achievement-run-a-50k', kind: 'achievement', date: null, updatedAt: '2026-08-01T00:00:00Z',
      data: { id: 'run-a-50k', name: 'Run a 50k', categories: ['run'] } },
    'achievement-half-iron': { id: 'achievement-half-iron', kind: 'achievement', date: null, deleted: true, updatedAt: '2026-08-02T00:00:00Z', data: { id: 'half-iron', deleted: true } },
    // Not legacy: an interval-timer preset (#36), undated. Nothing #31 removed may filter it out.
    'timer-last': { id: 'timer-last', kind: 'timer', updatedAt: '2026-09-01T09:00:00Z', data: { name: 'Last', work: 30, rest: 15, rounds: 8 } },
  }
  const LEGACY_FILES = {
    'coach.json': JSON.stringify({ version: 1, date: '2026-09-01', headline: 'old note', nudges: [] }),
    'goals.json': JSON.stringify({ fetchedAt: '2026-09-01T00:00:00Z', goals: [{ id: 'g1', title: '50 Miles Biked' }] }),
  }
  const old = await boot({
    env: { BUSHIDO_AUTH: 'proxy', BUSHIDO_COACH: '1' },
    seed: {
      'state.json': JSON.stringify({ version: 40, updatedAt: '2026-09-02T00:00:00Z', state: { entries: LEGACY_ENTRIES } }),
      'settings.json': JSON.stringify({ version: 1, install: 'migrated', auth: { mode: 'proxy' },
        totem: { goals: true }, links: { krakatoaDir: '/nowhere/food' } }),
      ...LEGACY_FILES,
    },
  })
  fs.mkdirSync(path.join(old.dataDir, 'coach'))
  const THREAD = JSON.stringify({ id: 't1', title: 'old chat', messages: [{ role: 'user', text: 'hi' }] })
  fs.writeFileSync(path.join(old.dataDir, 'coach', 't1.json'), THREAD)
  const sameEntries = (got, what) => {
    for (const [id, e] of Object.entries(LEGACY_ENTRIES)) eq(got[id], e, `${what}: ${id} was changed or dropped`)
  }
  await step('legacy data: an old log with check-ins, journal, quotas, achievements and coach files boots and reads back untouched', async () => {
    const got = await (await get(`${old.base}/api/state`)).json()
    eq(got.version, 40, 'the log was rewritten on boot')
    sameEntries(got.state.entries, 'GET /api/state')
    const health = await (await get(`${old.base}/api/health`)).json()
    eq([health.ok, health.entries], [true, Object.keys(LEGACY_ENTRIES).length])
    ok(!('coach' in health) && !('goals' in health) && !('chat' in health), 'health still reports a removed feature')
    for (const p of ['/api/coach', '/api/goals', '/api/coach/threads']) eq((await get(`${old.base}${p}`)).status, 404, `${p} answers`)
  })
  await step('legacy data: writing a new workout keeps every old entry, and the export carries them all', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const fresh = { id: `daily-${today}`, kind: 'daily', date: today, data: { optId: 'log-workout', name: 'Ride', level: 2, done: true, out: { activity: 'bike' } } }
    const put = await get(`${old.base}/api/state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: { entries: { [fresh.id]: { ...fresh, updatedAt: new Date().toISOString() } } } }) })
    eq(put.status, 200)
    const doc = await put.json()
    sameEntries(doc.state.entries, 'PUT /api/state')
    ok(doc.state.entries[fresh.id], 'the new workout was not written')
    const posted = await get(`${old.base}/api/entry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry: { ...fresh, id: `${fresh.id}-x`, updatedAt: new Date().toISOString() } }) })
    eq(posted.status, 200)
    sameEntries((await posted.json()).state.entries, 'POST /api/entry')
    const exported = await (await get(`${old.base}/api/export`)).json()
    sameEntries(exported.state.entries, 'GET /api/export')
    const backups = fs.readdirSync(path.join(old.dataDir, 'backups'))
    ok(backups.length >= 1, 'the write took no backup')
  })
  await step('legacy data: coach and goals files are left exactly as they were, and nothing logged an error', async () => {
    for (const [f, body] of Object.entries(LEGACY_FILES)) eq(fs.readFileSync(path.join(old.dataDir, f), 'utf8'), body, `${f} was touched`)
    eq(fs.readFileSync(path.join(old.dataDir, 'coach', 't1.json'), 'utf8'), THREAD, 'an old coach thread was touched')
    // BUSHIDO_COACH=1 used to force the check-in coach on; it now does nothing.
    eq((await get(`${old.base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404)
    ok(!/error|failed|TypeError/i.test(old.log()), `the server logged an error:\n${old.log()}`)
  })
  await old.stop()

  /* ------------------------------------------------------- an existing install */
  const seed = {
    'state.json': JSON.stringify({ version: 7, updatedAt: '2026-09-01T00:00:00Z', state: { entries: {} } }),
    'plan.json': JSON.stringify({ dailyMenu: [], achievements: [{ id: 'my-own', name: 'Mine', categories: [] }] }),
  }
  // No BUSHIDO_AUTH here: the point is that an upgrade needs no env change.
  const m = await boot({ seed })
  await step('an existing training log keeps its plan and no login, with integrations off', async () => {
    const settings = JSON.parse(fs.readFileSync(path.join(m.dataDir, 'settings.json'), 'utf8'))
    eq(settings.install, 'migrated')
    eq(settings.auth.mode, 'proxy', 'the migration did not write proxy auth')
    ok(!/setup\?token=/.test(m.log()) && /sign-in is off/.test(m.log()), `an upgraded install asks for setup:\n${m.log()}`)
    eq((await get(`${m.base}/api/state`)).status, 200, 'an upgraded install requires a login')
    eq(settings.totem.url, '', 'the migration turned a bridge on from code')
    const content = await (await get(`${m.base}/api/content`)).json()
    eq(content.achievements[0].id, 'my-own', 'the plan in the data dir did not load')
    const health = await (await get(`${m.base}/api/health`)).json()
    eq(health.totem.enabled, false)
    eq(health.version, 7, 'the log was rewritten')
  })
  await m.stop()

  const forced = await boot({ seed, env: { BUSHIDO_AUTH: 'password' } })
  await step('BUSHIDO_AUTH=password turns sign-in back on for a migrated install', async () => {
    eq((await get(`${forced.base}/api/state`)).status, 401)
    ok(/setup\?token=/.test(forced.log()), 'no setup link with sign-in forced on')
  })
  await forced.stop()

  /* --------------------------------------------------- done by default (#27) */
  {
    // A notify core that records what it would have sent, and a Totem bridge
    // that records the habit records. Nothing leaves the machine.
    const core = mkdtemp('bushido-fakecore-')
    const pushLog = path.join(core, 'sent.jsonl')
    const files = {
      'push.mjs': "export const generateVapidKeys = () => ({ publicKey: 'p', privateKey: 'k' })\n",
      'store.mjs': 'export const createNotifyStore = () => ({ applyPlan: async () => {} })\n',
      'notifier.mjs': "import fs from 'node:fs'\nexport const createNotifier = () => ({ deliver: async (m) => fs.appendFileSync(process.env.FAKE_PUSH_LOG, JSON.stringify(m) + '\\n') })\n",
      'http.mjs': 'export const createPushHttpHandler = () => async () => false\nexport const PUSH_PUBLIC_PATHS = []\n',
      'plan.mjs': 'export const planDay = () => ({ entries: [] })\n',
      'schedule.mjs': 'export {}\n',
    }
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(core, f), body)
    const habit = []
    const bridge = require('http').createServer((q, r) => {
      let b = ''
      q.on('data', c => { b += c })
      q.on('end', () => { if (q.url === '/api/habits/log') habit.push(JSON.parse(b)); r.writeHead(200, { 'content-type': 'application/json' }); r.end('{}') })
    })
    await new Promise(r => bridge.listen(0, '127.0.0.1', r))
    const T = new Date().toISOString().slice(0, 10) // BUSHIDO_TZ=UTC below
    const settings = { auth: { mode: 'proxy' },
      totem: { url: `http://127.0.0.1:${bridge.address().port}`, secret: 'bridge-secret-for-tests', habitSync: true, goals: false } }
    const d = await boot({ seed: { 'settings.json': JSON.stringify(settings) },
      env: { BUSHIDO_AUTH: 'proxy', BUSHIDO_TZ: 'UTC', BUSHIDO_NOTIFY_CORE: core, FAKE_PUSH_LOG: pushLog } })
    await waitFor(() => /notifications ready/.test(d.log()), 'the fake notify core')
    const sent = () => (fs.existsSync(pushLog) ? fs.readFileSync(pushLog, 'utf8').trim().split('\n').filter(Boolean) : [])
    const settle = () => new Promise(r => setTimeout(r, 400))
    const id = `daily-${T}`
    const at = (h) => `${T}T${String(h).padStart(2, '0')}:00:00.000Z`
    const run = (h, data) => ({ id, kind: 'daily', date: T, updatedAt: at(h), data: { optId: 'log-workout', name: 'Run', slot: 'main', ...data } })
    const postEntry = (entry) => get(`${d.base}/api/entry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry }) })
    const putState = (entries) => get(`${d.base}/api/state`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: { entries: Object.fromEntries(entries.map(e => [e.id, e])) } }) })
    const stored = async () => (await (await get(`${d.base}/api/state`)).json()).state.entries[id]

    try {
      await step('done by default: picking a session for today counts for the habit, and sends no push yet', async () => {
        eq((await postEntry(run(1, { done: true, out: { activity: 'run' } }))).status, 200)
        await settle()
        eq(habit.at(-1)?.count, 1, 'the habit did not count a session done by default')
        eq(sent().length, 0, 'a "nice session" went out before anything was logged')
      })
      await step('done by default: the first thing logged on it is the one push', async () => {
        await postEntry(run(2, { done: true, out: { activity: 'run', distance: 5 } }))
        await settle()
        eq(sent().length, 1, 'logging a distance did not announce it')
        await postEntry(run(3, { done: true, out: { activity: 'run', distance: 5, rpe: 6 } }))
        await settle()
        eq(sent().length, 1, 'an edit after that announced it again')
      })
      await step('an old client\'s untick (a bare done: false) reads as not done: marker added, habit 0, no push', async () => {
        // What "Done — tap to undo" wrote before #27, through a full-log PUT.
        const untick = run(4, { done: false, out: { activity: 'run', distance: 5, rpe: 6 } })
        eq((await putState([untick])).status, 200)
        await settle()
        const e = await stored()
        eq([e.data.done, e.data.undone, e.updatedAt], [false, true, at(4)], 'the untick was not kept as one')
        eq(habit.at(-1)?.count, 0, 'the habit still counted a session the user unticked')
        eq(sent().length, 1, 'an untick sent a push')
        // The old device re-sends its copy at the same updatedAt: the marker stays.
        await putState([untick])
        eq((await stored()).data.undone, true, 'a same-stamp re-send stripped the marker')
      })
      await step('a planned or legacy done: false is never given the marker', async () => {
        const later = `daily-${T}-planned`
        await postEntry({ id: later, kind: 'daily', date: T, updatedAt: at(5), data: { optId: 'planned', done: false } })
        await postEntry({ id: later, kind: 'daily', date: T, updatedAt: at(6), data: { optId: 'planned', done: false, out: { notes: 'x' } } })
        const e = (await (await get(`${d.base}/api/state`)).json()).state.entries[later]
        eq('undone' in e.data, false, 'a plan was turned into an untick')
      })
    } finally {
      await d.stop()
      bridge.close()
    }
  }

  if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
  console.log('\nhttp ok')
})().catch((e) => { console.error(e); process.exit(1) })
