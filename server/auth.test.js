/*
 * Sign-in, as units: the setup token, the password, the cookie, the bearer
 * token and proxy mode. Run: node server/auth.test.js
 *
 * server/http.test.js drives the same things through a real server.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createAuth, cookieValue, clientAddress, COOKIE } = require('./auth.js')

let failed = 0
const queue = []
const check = (name, fn) => queue.push([name, fn])
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const rejects = async (p, re, m) => {
  try { await p } catch (e) { if (re && !re.test(e.message)) throw new Error(`${m}: wrong error "${e.message}"`); return }
  throw new Error(m || 'expected a rejection')
}

const made = []
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-auth-')); made.push(d); return d }
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })
const req = (headers = {}) => ({ headers, socket: {} })
const cookieOf = (value) => req({ cookie: `${COOKIE}=${encodeURIComponent(value)}` })
const SECRET = 'a-bridge-secret-long-enough'

check('no owner: everything is refused, and a setup token exists', async () => {
  const a = createAuth({ dataDir: tmp() })
  ok(!a.hasOwner(), 'a fresh dir has no owner')
  ok(!a.check(req()).ok, 'an anonymous request got in')
  const t = a.ensureSetupToken()
  ok(typeof t === 'string' && t.length >= 24, 'the token is too short to be a secret')
  ok(a.ensureSetupToken() === t, 'the token changed between calls')
})

check('the setup token is required to create the owner', async () => {
  const a = createAuth({ dataDir: tmp() })
  a.ensureSetupToken()
  await rejects(a.createOwner({ token: 'guess', username: 'me', password: 'longenough' }), /not valid/, 'a wrong token')
  await rejects(a.createOwner({ token: '', username: 'me', password: 'longenough' }), /not valid/, 'no token')
  ok(!a.hasOwner(), 'an owner was created without the token')
})

check('setup creates exactly one owner, stored hashed and private', async () => {
  const dir = tmp()
  const a = createAuth({ dataDir: dir })
  const token = a.ensureSetupToken()
  await rejects(a.createOwner({ token, username: 'me', password: 'short' }), /at least/, 'a short password')
  await a.createOwner({ token, username: 'me', password: 'correct horse' })
  ok(a.hasOwner(), 'no owner after setup')
  ok(a.ensureSetupToken() === null, 'the setup token outlived setup')
  const raw = fs.readFileSync(path.join(dir, 'auth.json'), 'utf8')
  ok(!raw.includes('correct horse'), 'the password is stored in plain text')
  ok((fs.statSync(path.join(dir, 'auth.json')).mode & 0o777) === 0o600, 'auth.json is not 0600')
  await rejects(a.createOwner({ token, username: 'two', password: 'another one' }), /already exists/, 'a second owner')
})

check('login issues a cookie the server accepts; a wrong password does not', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  await rejects(a.login({ username: 'me', password: 'wrong horse', ip: '1' }), /wrong/, 'a wrong password')
  await rejects(a.login({ username: 'you', password: 'correct horse', ip: '1' }), /wrong/, 'a wrong user')
  const value = await a.login({ username: 'me', password: 'correct horse', ip: '1' })
  const who = a.check(cookieOf(value))
  ok(who.ok && who.via === 'session' && who.user.username === 'me', 'the cookie was not accepted')
  ok(!a.check(cookieOf(value.replace(/.$/, c => (c === 'A' ? 'B' : 'A')))).ok, 'a tampered cookie was accepted')
})

check('the cookie is httpOnly and SameSite=Lax, and Secure only behind https', async () => {
  const a = createAuth({ dataDir: tmp() })
  const plain = a.cookieHeader(req(), 'v')
  ok(/HttpOnly/.test(plain) && /SameSite=Lax/.test(plain) && /Path=\//.test(plain), plain)
  ok(!/Secure/.test(plain), 'Secure over plain http would drop the cookie')
  ok(/Secure/.test(a.cookieHeader(req({ 'x-forwarded-proto': 'https' }), 'v')), 'not Secure behind an https proxy')
  ok(/Max-Age=0/.test(a.cookieHeader(req(), '', { clear: true })), 'sign-out does not clear the cookie')
})

check('changing the password signs every other session out', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  const old = await a.login({ username: 'me', password: 'correct horse', ip: '1' })
  await rejects(a.changePassword({ current: 'nope', next: 'battery staple' }), /current password/, 'a wrong current password')
  const fresh = await a.changePassword({ current: 'correct horse', next: 'battery staple' })
  ok(!a.check(cookieOf(old)).ok, 'the old session survived a password change')
  ok(a.check(cookieOf(fresh)).ok, 'the new session does not work')
  await a.login({ username: 'me', password: 'battery staple', ip: '1' })
})

check('signing out revokes every session, including copies of the cookie', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  const phone = await a.login({ username: 'me', password: 'correct horse', ip: '1' })
  const laptop = await a.login({ username: 'me', password: 'correct horse', ip: '1' })
  a.revokeSessions()
  ok(!a.check(cookieOf(phone)).ok && !a.check(cookieOf(laptop)).ok, 'a session survived sign-out')
  ok(a.check(cookieOf(await a.login({ username: 'me', password: 'correct horse', ip: '1' }))).ok, 'signing in again does not work')
})

check('only the session cookie is decoded, and a malformed one is just absent', async () => {
  ok(cookieValue('a=%E0%A4%A; bushido_session=x%2Ey', COOKIE) === 'x.y', 'another cookie\'s bad escape broke parsing')
  ok(cookieValue('bushido_session=%E0%A4%A', COOKIE) === null, 'a malformed session cookie threw or was accepted')
  ok(cookieValue('', COOKIE) === null)
  const a = createAuth({ dataDir: tmp() })
  ok(!a.check(req({ cookie: 'bushido_session=%E0%A4%A' })).ok)
})

check('the throttle key is the socket peer unless forwarded headers are trusted', async () => {
  const fwd = (peer) => ({ headers: { 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '198.51.100.1' }, socket: { remoteAddress: peer } })
  ok(clientAddress(fwd('192.168.1.9'), undefined) === '192.168.1.9', 'a LAN peer could spoof its address')
  ok(clientAddress(fwd('127.0.0.1'), undefined) === '198.51.100.1', 'a local tunnel\'s header was ignored')
  ok(clientAddress(fwd('127.0.0.1'), '0') === '127.0.0.1', 'BUSHIDO_TRUST_PROXY=0 still trusted headers')
  ok(clientAddress(fwd('10.0.0.2'), '1') === '198.51.100.1', 'BUSHIDO_TRUST_PROXY=1 ignored headers')
})

check('a spray from many addresses hits a global cap', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  for (let i = 0; i < 30; i++) await rejects(a.login({ username: 'me', password: 'x', ip: `10.0.${i}.1` }), /wrong/)
  await rejects(a.login({ username: 'me', password: 'correct horse', ip: '10.9.9.9' }), /too many/, 'no global cap')
})

check('30 concurrent attempts: at most 2 hash at once, the rest are refused with 429', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  let peak = 0
  const watch = setInterval(() => { peak = Math.max(peak, a.inFlight()) }, 0)
  const outcomes = await Promise.allSettled(Array.from({ length: 30 }, () =>
    a.login({ username: 'me', password: 'wrong horse', ip: '7.7.7.7' })))
  clearInterval(watch)
  const statuses = outcomes.map(o => o.reason?.status)
  ok(outcomes.every(o => o.status === 'rejected'), 'a wrong password got in')
  ok(statuses.filter(s => s === 401).length <= 2, `more than two attempts reached scrypt: ${statuses.filter(s => s === 401).length}`)
  ok(statuses.filter(s => s === 429).length >= 28, 'the rest were not refused with 429')
  ok(peak <= a.MAX_VERIFYING, `peak verifications in flight ${peak}`)
  // ...and the right password from that address is now throttled too: reservations count.
  for (let i = 0; i < 3; i++) await rejects(a.login({ username: 'me', password: 'wrong horse', ip: '7.7.7.7' }))
  await rejects(a.login({ username: 'me', password: 'correct horse', ip: '7.7.7.7' }), /too many/, 'reservations did not count')
})

check('a successful login releases its reservation', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  for (let i = 0; i < 10; i++) await a.login({ username: 'me', password: 'correct horse', ip: '8.8.8.8' })
  ok(a.inFlight() === 0, 'a verification slot leaked')
})

check('a bearer token works for machine callers; a short or wrong one does not', async () => {
  const a = createAuth({ dataDir: tmp(), bearerSecrets: () => [SECRET, '', undefined, 'short'] })
  ok(a.check(req({ authorization: `Bearer ${SECRET}` })).via === 'bearer', 'the bridge secret was refused')
  ok(!a.check(req({ authorization: 'Bearer wrong-but-long-enough-x' })).ok, 'a wrong token got in')
  ok(!a.check(req({ authorization: 'Bearer short' })).ok, 'a token under 16 characters is accepted')
  ok(!a.check(req({ authorization: 'Bearer ' })).ok, 'an empty token matched an empty secret')
})

check('a session sent as a bearer is read like the cookie, and revoked with it', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  const value = await a.login({ username: 'me', password: 'correct horse' })
  const got = a.check(req({ authorization: `Bearer ${value}` }))
  ok(got.ok && got.via === 'session' && got.user.username === 'me', 'a bearer session was refused')
  ok(!a.check(req({ authorization: `Bearer ${value.slice(0, -2)}xx` })).ok, 'a forged session got in')
  a.revokeSessions()
  ok(!a.check(req({ authorization: `Bearer ${value}` })).ok, 'a revoked session still works as a bearer')
})

check('proxy mode lets everything through and has no setup', async () => {
  const a = createAuth({ dataDir: tmp(), mode: 'proxy' })
  ok(a.mode === 'proxy')
  ok(a.check(req()).ok && a.check(req()).via === 'proxy', 'proxy mode refused a request')
  ok(a.ensureSetupToken() === null, 'proxy mode minted a setup token')
})

check('repeated wrong passwords are throttled per address', async () => {
  const a = createAuth({ dataDir: tmp() })
  await a.createOwner({ token: a.ensureSetupToken(), username: 'me', password: 'correct horse' })
  for (let i = 0; i < 5; i++) await rejects(a.login({ username: 'me', password: 'x', ip: '9' }), /wrong/)
  await rejects(a.login({ username: 'me', password: 'correct horse', ip: '9' }), /too many/, 'not throttled')
  await a.login({ username: 'me', password: 'correct horse', ip: '8' })
})

;(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
  console.log('\nauth ok')
})()
