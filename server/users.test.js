/*
 * More than one person, as units: the people file, the Cloudflare Access token
 * check, and who a request resolves to. Run: node server/users.test.js
 *
 * server/http.test.js drives the same things through a real server.
 */
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createUsers, createAccessVerifier, identify, actAsCookie, accessHost, slug, OWNER } = require('./users.js')

let failed = 0
const queue = []
const check = (name, fn) => queue.push([name, fn])
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const throws = (fn, re, m) => {
  try { fn() } catch (e) { if (re && !re.test(e.message)) throw new Error(`${m}: wrong error "${e.message}"`); return }
  throw new Error(m || 'expected a throw')
}
const rejects = async (p, re, m) => {
  try { await p } catch (e) { if (re && !re.test(e.message)) throw new Error(`${m}: wrong error "${e.message}"`); return }
  throw new Error(m || 'expected a rejection')
}

const made = []
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-users-')); made.push(d); return d }
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

/* ------------------------------------------------- a pretend Cloudflare team */

const TEAM = 'example-team'
const HOST = 'example-team.cloudflareaccess.com'
const AUD = 'aud-tag-for-tests'
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })

function sign(claims, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg, kid, typ: 'JWT' })
  const t = Math.floor(Date.now() / 1000)
  const body = enc({ iss: `https://${HOST}`, aud: [AUD], iat: t, exp: t + 600, ...claims })
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')
  return `${head}.${body}.${sig}`
}

function fakeFetch() {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    return { ok: true, json: async () => ({ keys: [jwk] }) }
  }
  fn.calls = calls
  return fn
}

const verifier = (fetchFn = fakeFetch(), s = { team: TEAM, aud: AUD }) => createAccessVerifier({ settings: () => s, fetchFn })

/* --------------------------------------------------------------- the people */

check('a fresh install has one person: the owner, an admin, living in the data dir', () => {
  const dir = tmp()
  const u = createUsers({ dataDir: dir, ownerName: () => 'Alex' })
  eq(u.list().map(p => p.id), [OWNER])
  eq(u.owner().name, 'Alex', 'the owner takes the About-you name')
  ok(u.owner().admin, 'the owner is not an admin')
  eq(u.dirOf(OWNER), dir, 'the owner\'s log moved')
  ok(!fs.existsSync(u.file), 'reading wrote a file')
})

check('adding someone gives them an id, a folder of their own and no admin', () => {
  const dir = tmp()
  const u = createUsers({ dataDir: dir })
  const sam = u.add({ name: 'Sam Lee', emails: 'Sam@Example.com' })
  eq(sam.id, 'sam-lee')
  eq(sam.emails, ['sam@example.com'], 'emails are not normalised')
  ok(!sam.admin, 'a new person is an admin')
  eq(u.dirOf('sam-lee'), path.join(dir, 'users', 'sam-lee'))
  eq(u.byEmail(' SAM@example.com ').id, 'sam-lee')
  eq(u.add({ name: 'Sam Lee' }).id, 'sam-lee-2', 'a second Sam Lee collided')
  eq(fs.statSync(u.file).mode & 0o777, 0o600, 'users.json is readable by others')
})

check('an email belongs to one person, and bad input is refused', () => {
  const u = createUsers({ dataDir: tmp() })
  u.update(OWNER, { emails: ['me@example.com'] })
  throws(() => u.add({ name: 'Sam', emails: 'me@example.com' }), /already belongs/, 'a second owner of an email')
  throws(() => u.add({ name: 'Sam', emails: 'not-an-email' }), /not an email/, 'a junk email')
  throws(() => u.add({ name: '  ' }), /name/, 'a nameless person')
  throws(() => u.remove(OWNER), /owner/, 'the owner was removed')
})

check('ids cannot climb out of the data dir', () => {
  const u = createUsers({ dataDir: tmp() })
  for (const bad of ['../etc', 'a/b', '', '.', 'UPPER']) throws(() => u.dirOf(bad), /not a user id/, `"${bad}" was a folder`)
  eq(slug('Zoë  O\'Brien!'), 'zoe-o-brien')
  const raw = { users: [{ id: '../../x', name: 'evil', emails: ['e@example.com'] }] }
  fs.writeFileSync(u.file, JSON.stringify(raw)); u.reload()
  eq(u.list().map(p => p.id), [OWNER], 'a hand-edited bad id was taken')
})

check('removing someone stops them signing in and leaves their folder', () => {
  const dir = tmp()
  const u = createUsers({ dataDir: dir })
  u.add({ name: 'Sam', emails: 'sam@example.com' })
  fs.mkdirSync(u.dirOf('sam'), { recursive: true })
  fs.writeFileSync(path.join(u.dirOf('sam'), 'state.json'), '{}')
  u.remove('sam')
  eq(u.byEmail('sam@example.com'), null)
  ok(fs.existsSync(path.join(dir, 'users', 'sam', 'state.json')), 'their log was deleted')
})

/* ----------------------------------------------------------------- Access */

check('the team can be written three ways', () => {
  eq(accessHost('example-team'), HOST)
  eq(accessHost('Example-Team.cloudflareaccess.com'), HOST)
  eq(accessHost('https://example-team.cloudflareaccess.com/'), HOST)
  eq(accessHost(''), '')
})

check('a good token gives its email; keys are fetched once', async () => {
  const f = fakeFetch()
  const v = verifier(f)
  eq((await v.verify(sign({ email: 'Sam@Example.com' }))).email, 'sam@example.com')
  await v.verify(sign({ email: 'sam@example.com' }))
  eq(f.calls, [`https://${HOST}/cdn-cgi/access/certs`], 'keys refetched for every token')
})

check('anything but a good token is refused, never let through', async () => {
  const v = verifier()
  await rejects(v.verify(sign({ email: 'a@b.co' }, { key: other.privateKey })), /signature/, 'another key\'s signature')
  await rejects(v.verify(sign({ email: 'a@b.co', aud: ['someone-elses-app'] })), /another application/, 'another app\'s token')
  await rejects(v.verify(sign({ email: 'a@b.co', iss: 'https://evil.cloudflareaccess.com' })), /another team/, 'another team\'s token')
  await rejects(v.verify(sign({ email: 'a@b.co', exp: 1000 })), /expired/, 'an expired token')
  await rejects(v.verify(sign({ email: 'a@b.co' }, { kid: 'nope' })), /unknown key/, 'an unknown key id')
  await rejects(v.verify(sign({ email: 'a@b.co' }, { alg: 'none' })), /algorithm/, 'alg none')
  await rejects(v.verify(sign({ email: '' })), /no email/, 'a service token')
  await rejects(v.verify('not.a-token'), /malformed/, 'junk')
  const [h, b] = sign({ email: 'sam@example.com' }).split('.')
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), email: 'owner@example.com' })).toString('base64url')
  await rejects(v.verify(`${h}.${forged}.${sign({ email: 'sam@example.com' }).split('.')[2]}`), /signature/, 'a payload swapped under a real signature')
})

check('not configured until both the team and the AUD are set', async () => {
  ok(!verifier(fakeFetch(), { team: TEAM, aud: '' }).configured())
  ok(!verifier(fakeFetch(), { team: '', aud: AUD }).configured())
  ok(verifier().configured())
})

/* --------------------------------------------------------------- identify */

function setup() {
  const u = createUsers({ dataDir: tmp(), ownerName: () => 'Alex' })
  u.update(OWNER, { emails: ['alex@example.com'] })
  u.add({ name: 'Sam', emails: 'sam@example.com' })
  return u
}
const proxyGate = { ok: true, via: 'proxy' }
const reqWith = (headers) => ({ headers })

check('behind Access, the token picks the person', async () => {
  const users = setup()
  const access = verifier()
  const sam = await identify({ req: reqWith({ 'cf-access-jwt-assertion': sign({ email: 'sam@example.com' }) }), gate: proxyGate, mode: 'proxy', users, access })
  eq([sam.real.id, sam.user.id, sam.acting], ['sam', 'sam', false])
  const alex = await identify({ req: reqWith({ 'cf-access-jwt-assertion': sign({ email: 'alex@example.com' }) }), gate: proxyGate, mode: 'proxy', users, access })
  eq(alex.user.id, OWNER)
})

check('a stranger and a bad token are refused, not given the owner\'s log', async () => {
  const users = setup()
  const access = verifier()
  const stranger = await identify({ req: reqWith({ 'cf-access-jwt-assertion': sign({ email: 'who@example.com' }) }), gate: proxyGate, mode: 'proxy', users, access })
  eq(stranger.refused?.status, 403)
  const forged = await identify({ req: reqWith({ 'cf-access-jwt-assertion': sign({ email: 'alex@example.com' }, { key: other.privateKey }) }), gate: proxyGate, mode: 'proxy', users, access })
  eq(forged.refused?.status, 403)
})

check('no token is the owner, exactly as plain proxy mode was', async () => {
  const r = await identify({ req: reqWith({}), gate: proxyGate, mode: 'proxy', users: setup(), access: verifier() })
  eq(r.user.id, OWNER)
})

check('only an admin can act as someone, and only as someone who exists', async () => {
  const users = setup()
  const access = verifier()
  const asSam = { cookie: 'bushido_as=sam' }
  const owner = await identify({ req: reqWith(asSam), gate: proxyGate, mode: 'proxy', users, access })
  eq([owner.real.id, owner.user.id, owner.acting], [OWNER, 'sam', true])
  const ghost = await identify({ req: reqWith({ cookie: 'bushido_as=ghost' }), gate: proxyGate, mode: 'proxy', users, access })
  eq(ghost.user.id, OWNER, 'acting as nobody')
  const sam = await identify({
    req: reqWith({ cookie: 'bushido_as=owner', 'cf-access-jwt-assertion': sign({ email: 'sam@example.com' }) }),
    gate: proxyGate, mode: 'proxy', users, access,
  })
  eq([sam.real.id, sam.user.id], ['sam', 'sam'], 'a non-admin acted as the owner with a cookie')
})

check('with built-in sign-in, the session is the owner and Access headers mean nothing', async () => {
  const r = await identify({
    req: reqWith({ 'cf-access-jwt-assertion': sign({ email: 'sam@example.com' }) }),
    gate: { ok: true, via: 'session' }, mode: 'password', users: setup(), access: verifier(),
  })
  eq(r.user.id, OWNER)
})

check('the act-as cookie is httpOnly, short-lived, and clears', () => {
  const c = actAsCookie('sam', { secure: true })
  ok(/HttpOnly/.test(c) && /SameSite=Lax/.test(c) && /Secure/.test(c) && /Max-Age=43200/.test(c), c)
  ok(/Max-Age=0/.test(actAsCookie(null)), 'clearing does not expire it')
})

;(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
  console.log('\nusers ok')
})()
