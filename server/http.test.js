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
function boot({ env = {}, seed = null } = {}) {
  const dataDir = mkdtemp('bushido-http-')
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

  await step('fresh defaults: no WHOOP, Strava, goals, notifications or AI, and nothing errors', async () => {
    const h = { headers: { cookie } }
    eq((await (await get(`${s.base}/api/whoop`, h)).json()).configured, false)
    eq((await (await get(`${s.base}/api/strava`, h)).json()).configured, false)
    eq((await (await get(`${s.base}/api/goals`, h)).json()).configured, false)
    eq((await (await get(`${s.base}/api/push/key`, h)).json()).configured, false)
    const health = await (await get(`${s.base}/api/health`, h)).json()
    eq([health.notify, health.totem.enabled, health.chat.claude], [false, false, false])
    const plan = await get(`${s.base}/api/plan/workout`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"kinds":["legs"],"minutes":30}',
    })
    eq(plan.status, 503)
    eq((await plan.json()).code, 'ai-not-configured')
    const content = await (await get(`${s.base}/api/content`, h)).json()
    eq(content.achievements, [], 'a fresh install seeds achievements')
    ok(!('facility' in content), 'a fresh install serves the example plan')
    ok(!/error|failed/i.test(s.log()), `the server logged an error:\n${s.log()}`)
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
    ok(before.achievements.some(a => a.id === 'example-10k'), 'the named plan is not what loads to begin with')
    const r = await get(`${named.base}/api/plan/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    eq(r.status, 200)
    eq((await r.json()).plan.source, 'starter')
    const after = await (await get(`${named.base}/api/content`)).json()
    eq(after.achievements, [], 'the starter is not served after the reset')
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
    eq((await (await get(`${two.base}/api/coach/threads`, as('sam@example.com'))).json()).threads, [])
    const ai = await get(`${two.base}/api/plan/workout`, { method: 'POST', headers: { ...json, ...as('sam@example.com').headers }, body: JSON.stringify({ kinds: ['legs'], minutes: 30 }) })
    eq([ai.status, (await ai.json()).code], [503, 'ai-not-configured'])
    eq((await (await get(`${two.base}/api/content`, as('sam@example.com'))).json()).achievements, [], 'not the starter')
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

  await step('trainer: a planned week is Sam\'s quota-<monday>; a week Sam set is never overwritten', async () => {
    const week = { id: 'quota-2026-10-12', kind: 'quota', date: '2026-10-12', updatedAt: '2026-10-10T08:00:00Z',
      data: { counts: { run: 2 }, plannedBy: { id: 'x', name: 'y' } } }
    const r = await post('sam', week)
    eq(r.status, 200)
    eq((await r.json()).entry.data.plannedBy, { id: 'owner', name: 'Alex' })
    eq(samFile().state.entries[week.id].data.counts, { run: 2 })
    eq(samFile().state.entries[week.id].data.done, undefined, 'a quota entry was given a done flag')
    // Sam sets the next week herself; the owner's planner may not replace it.
    const own = { id: 'quota-2026-10-19', kind: 'quota', date: '2026-10-19', updatedAt: '2026-10-10T08:00:00Z', data: { counts: { bike: 1 } } }
    await get(`${two.base}/api/entry`, { method: 'POST', headers: { ...json, ...as('sam@example.com', { 'x-bushido-user': 'sam' }).headers }, body: JSON.stringify({ entry: own }) })
    const over = await post('sam', { ...own, updatedAt: '2030-01-01T00:00:00Z', data: { counts: { run: 9 }, plannedBy: { id: 'owner' } } })
    const body = await over.json()
    eq([over.status, body.code], [409, 'not-shared'])
    ok(/already set that week/.test(body.error), body.error)
    eq(samFile().state.entries[own.id].data.counts, { bike: 1 }, 'the owner overwrote a week Sam set')
    eq((await post('sam', { ...week, data: { counts: { run: 1 } } })).status, 400, 'a quota with no plannedBy')
    eq((await post('sam', { ...week, data: { counts: {}, sharedFrom: { id: 'owner' } } })).status, 400, 'a quota can only be planned, not shared')
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
    eq((await plan({ for: 'nobody' })).status, 404)
    // With no CLI the target is accepted and the answer is the ordinary "set AI up".
    const none = await plan({ for: 'sam' })
    eq([none.status, (await none.json()).code], [503, 'ai-not-configured'])
    const week = await get(`${two.base}/api/plan/week`, { method: 'POST', headers: { ...json, ...owns().headers },
      body: JSON.stringify({ monday: '2026-10-12', message: 'x', for: 'nobody' }) })
    eq(week.status, 404)
  })

  await two.stop()

  /* ---------------------------------- every person's AI runs, on their own space */
  /*
   * A fake Claude CLI that records what it was spawned with (argv and the prompt
   * on stdin) and answers in each run's shape. The owner has a brain file, a
   * food-log digest, WHOOP and Strava caches, coach threads and About-you notes;
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
  const out = schema.includes('"counts"') ? { reply: 'ok', counts: [], changed: 'nothing' }
    : schema.includes('"blocks"') ? { title: 'Legs', minutes: 30, why: 'because', changed: 'x', blocks: [{ name: 'Main', items: [{ kind: 'lift', name: 'Squat', sets: [{ reps: 5 }] }] }] }
    : { reply: 'hello' }
  process.stdout.write(JSON.stringify({ structured_output: out, model: 'fake' }))
})
`, { mode: 0o755 })
  const BRAIN = path.join(ai, 'brain', 'projects', 'profile.md')
  const FOOD = path.join(ai, 'food')
  fs.mkdirSync(path.dirname(BRAIN), { recursive: true })
  fs.writeFileSync(BRAIN, 'OWNER-BRAIN-PROFILE')
  fs.mkdirSync(FOOD)
  fs.writeFileSync(path.join(FOOD, 'digest.json'), '{}')
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
      CLAUDE_BIN: FAKE, BUSHIDO_BRAIN_FILE: BRAIN, BUSHIDO_KRAKATOA_DIR: FOOD,
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
      `Read(${rule(path.join(D, 'users', 'robin'))}/**)`, `Read(${rule(BRAIN)})`, `Read(${rule(path.dirname(BRAIN))}/**)`, `Read(${rule(FOOD)}/**)`]) {
      ok(deny.includes(want), `${label}: no deny for ${want}`)
    }
    ok(!deny.some(d => d.includes(rule(SAM_DIR))), `${label}: a rule denies Sam's own space`)
    ok(!/Edit\(|Write\(/.test(allow), `${label}: Sam's run may write somewhere: ${allow}`)
    ok(deny.includes('Bash'), `${label}: Sam's run has a shell`)
    ok(prompt.includes(path.join(SAM_DIR, 'state.json')), `${label}: the prompt does not point at Sam's log`)
    ok(prompt.includes('SAM-NOTES') && prompt.includes('Sam'), `${label}: Sam's About you is not in the prompt`)
    for (const never of ['OWNER-NOTES', BRAIN, path.dirname(BRAIN), FOOD, 'digest.json', 'whoop.json', 'strava.json', path.join(D, 'state.json')]) {
      ok(!prompt.includes(never), `${label}: the prompt mentions ${never}`)
    }
  }

  await step('ai for everyone: Sam has the coach and planners once a CLI is configured', async () => {
    const me = await (await get(`${three.base}/api/auth/me`, samH())).json()
    eq([me.features.ai, me.features.whoop, me.features.strava, me.features.goals, me.features.notifications],
      [true, false, false, false, false], 'AI on, the owner\'s grants still off')
  })

  await step('ai for everyone: Sam\'s coach run reads only Sam\'s space and Sam\'s About you', async () => {
    const r = await postAi('/api/coach/chat', { message: 'how was my week?' }, samH())
    eq(r.status, 200)
    assertSamRun(lastRun(), 'coach')
    ok(fs.readdirSync(path.join(SAM_DIR, 'coach')).length === 1, 'Sam\'s thread is not in Sam\'s coach folder')
    eq(fs.readdirSync(path.join(D, 'coach')), ['towner.json'], 'Sam\'s thread landed in the owner\'s coach folder')
    eq((await (await get(`${three.base}/api/coach/threads`, samH())).json()).threads.map(t => t.id).includes('towner'), false,
      'Sam was shown the owner\'s threads')
  })

  await step('ai for everyone: Sam\'s planner and week planner runs are Sam\'s too', async () => {
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30 }, samH())).status, 200)
    assertSamRun(lastRun(), 'planner')
    eq((await postAi('/api/plan/week', { monday: '2026-10-12', message: 'draft it' }, samH())).status, 200)
    assertSamRun(lastRun(), 'week planner')
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'owner' }, samH())).status, 403, 'Sam planned for the owner')
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'robin' }, samH())).status, 403, 'Sam planned for someone else')
  })

  await step('ai for everyone: the owner planning FOR Sam runs on Sam\'s context, not the owner\'s', async () => {
    eq((await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'sam' }, ownerH())).status, 200)
    assertSamRun(lastRun(), 'owner planning for Sam')
    eq((await postAi('/api/plan/revise', { plan: { blocks: [] }, message: 'shorter', for: 'sam' }, ownerH())).status, 200)
    assertSamRun(lastRun(), 'owner revising for Sam')
    eq((await postAi('/api/plan/week', { monday: '2026-10-12', message: 'x', for: 'sam' }, ownerH())).status, 200)
    assertSamRun(lastRun(), 'owner planning Sam\'s week')
    // Acting as Sam, "for Sam" is just Sam's own run; for anyone else it is refused.
    const acting = await postAi('/api/plan/workout', { kinds: ['legs'], minutes: 30, for: 'robin' }, as('alex@example.com', { cookie: 'bushido_as=sam' }))
    eq(acting.status, 409, 'planned "for" someone else while acting as Sam')
  })

  await step('ai for everyone: acting as Sam, the coach is Sam\'s', async () => {
    eq((await postAi('/api/coach/chat', { message: 'hi' }, as('alex@example.com', { cookie: 'bushido_as=sam' }))).status, 200)
    assertSamRun(lastRun(), 'acting as Sam')
  })

  await step('ai for everyone: the owner\'s own runs are unchanged (brain, food log, WHOOP, Strava, the owner\'s notes)', async () => {
    eq((await postAi('/api/coach/chat', { message: 'hi' }, ownerH())).status, 200)
    const r = lastRun()
    const prompt = promptOf(r)
    for (const want of ['OWNER-NOTES', BRAIN, path.join(FOOD, 'digest.json'), path.join(D, 'whoop.json'), path.join(D, 'state.json')]) {
      ok(prompt.includes(want), `the owner's coach lost ${want}`)
    }
    ok(argOf(r, '--allowedTools').includes(`Edit(${rule(path.dirname(BRAIN))}/**)`), 'the owner\'s coach lost the brain Write grant')
    ok(!argOf(r, '--disallowedTools').includes(`Read(${rule(D)}/state.json*)`), 'the owner\'s run is denied the owner\'s own log')
    ok(addDirsOf(r).includes(D), 'the owner\'s data dir is not readable')
  })

  await three.stop()
  certs.close()

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

  if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
  console.log('\nhttp ok')
})().catch((e) => { console.error(e); process.exit(1) })
