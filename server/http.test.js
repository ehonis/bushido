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
  await two.stop()
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
