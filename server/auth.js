/*
 * Single-owner sign-in.
 *
 * One account, created in the browser. On first run with no owner the server
 * prints a one-time setup URL carrying a random token (the Jupyter/Grafana
 * pattern); only that link opens /setup, so the first person to find the port
 * cannot claim the box. The password is hashed with scrypt and stored in
 * `data/auth.json` (0600) next to the key that signs session cookies.
 *
 * Three ways in, checked in this order:
 *
 *   BUSHIDO_AUTH=proxy  Something in front (Cloudflare Access, an auth proxy, a
 *                       tailnet you trust) already decided who may reach this
 *                       port. Every request is let through and there is no login.
 *   Bearer token        `Authorization: Bearer <secret>` for machine callers. The
 *                       secret is BUSHIDO_API_TOKEN and nothing else: the Totem
 *                       bridge secret is for Bushido calling Totem, and nothing
 *                       calls Bushido with it, so it is not a way in.
 *                       The native app has no cookie jar it controls, so it signs
 *                       in with POST /api/auth/session and sends the same signed
 *                       session value as its bearer. It is checked exactly as the
 *                       cookie is: same signature, same versions, same expiry.
 *   Session cookie      `bushido_session`, HMAC-signed, httpOnly, SameSite=Lax,
 *                       Secure behind https. Changing the password bumps a
 *                       version number in it, which signs every other device out.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const COOKIE = 'bushido_session'
const SESSION_DAYS = 30
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
const MIN_PASSWORD = 8

const b64u = (buf) => Buffer.from(buf).toString('base64url')

function scrypt(password, salt, { N, r, p, keylen } = SCRYPT) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      (err ? reject(err) : resolve(key)))
  })
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * The value of one cookie, decoded, or null. Only the cookie asked for is
 * decoded, and a malformed escape in it reads as absent rather than throwing.
 */
function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0 || part.slice(0, i).trim() !== name) continue
    try { return decodeURIComponent(part.slice(i + 1).trim()) } catch { return null }
  }
  return null
}

const isLoopback = (addr) => /^(127\.|::1$|::ffff:127\.)/.test(String(addr || ''))

/**
 * The address a login attempt is throttled against. The socket peer, unless the
 * forwarded headers can be trusted: BUSHIDO_TRUST_PROXY=1 says they can; when it
 * is unset, they are trusted only from a loopback peer (a tunnel such as
 * cloudflared on the same machine); BUSHIDO_TRUST_PROXY=0 never trusts them.
 */
function clientAddress(req, trustProxy = process.env.BUSHIDO_TRUST_PROXY) {
  const peer = req.socket?.remoteAddress || '?'
  const trust = trustProxy === '1' || trustProxy === 'true' || (trustProxy == null || trustProxy === '' ? isLoopback(peer) : false)
  if (!trust) return peer
  const fwd = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return fwd || peer
}

/** Is this request reaching us over https, directly or through a proxy? */
function isHttps(req) {
  if (req.socket?.encrypted) return true
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {string|() => string} [o.mode]  'proxy' disables sign-in; anything else means
 *   password. A function is read on every request, so the mode can come from a
 *   settings file that is written after this object is created.
 * @param {() => string[]} [o.bearerSecrets]  accepted machine tokens, read per request
 */
function createAuth({ dataDir, mode = 'password', bearerSecrets = () => [] }) {
  const file = path.join(dataDir, 'auth.json')
  const modeOf = typeof mode === 'function' ? mode : () => mode
  const isProxy = () => String(modeOf() || '').toLowerCase() === 'proxy'
  let doc = null
  let setupToken = null
  const failures = new Map() // ip -> { count, until }

  function load() {
    if (doc) return doc
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { doc = {} }
    return doc
  }

  function save(next) {
    fs.mkdirSync(dataDir, { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
    try { fs.chmodSync(file, 0o600) } catch { /* best effort */ }
    doc = next
  }

  function sessionKey() {
    const d = load()
    if (d.sessionKey) return Buffer.from(d.sessionKey, 'base64url')
    const key = crypto.randomBytes(32)
    save({ ...d, sessionKey: b64u(key) })
    return key
  }

  const hasOwner = () => Boolean(load().owner?.hash)

  /** The one-time token for /setup, minted on demand while there is no owner. */
  function ensureSetupToken() {
    if (isProxy() || hasOwner()) return null
    if (!setupToken) setupToken = crypto.randomBytes(24).toString('base64url')
    return setupToken
  }

  const checkSetupToken = (token) => Boolean(setupToken && token && safeEqual(token, setupToken))

  async function createOwner({ token, username, password }) {
    if (hasOwner()) throw new Error('an owner account already exists')
    if (!checkSetupToken(token)) throw new Error('this setup link is not valid')
    const name = String(username || '').trim()
    if (!name) throw new Error('choose a username')
    if (String(password || '').length < MIN_PASSWORD) throw new Error(`use at least ${MIN_PASSWORD} characters`)
    const salt = crypto.randomBytes(16)
    const hash = await scrypt(password, salt)
    save({
      ...load(),
      owner: {
        username: name, salt: b64u(salt), hash: b64u(hash), scrypt: SCRYPT,
        passwordVersion: 1, createdAt: new Date().toISOString(),
      },
    })
    sessionKey()
    setupToken = null
    return { username: name }
  }

  async function verifyPassword(password) {
    const o = load().owner
    if (!o?.hash) return false
    const key = await scrypt(password, Buffer.from(o.salt, 'base64url'), o.scrypt || SCRYPT)
    return safeEqual(b64u(key), o.hash)
  }

  /*
   * Throttling: five failures from one address lock it for a minute, and
   * GLOBAL_CAP failures from everyone in a minute lock all logins for a minute,
   * which is what stops a spray from many addresses. The per-address map is
   * bounded and expired entries are dropped as it is used.
   */
  const PER_ADDRESS = 5
  const GLOBAL_CAP = 30
  const WINDOW = 60_000
  const MAX_TRACKED = 1000
  let global = { count: 0, until: 0 }

  function prune(now) {
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k)
    while (failures.size > MAX_TRACKED) failures.delete(failures.keys().next().value)
  }

  function throttled(ip) {
    const now = Date.now()
    if (global.count >= GLOBAL_CAP && global.until > now) return true
    const f = failures.get(ip)
    return Boolean(f && f.count >= PER_ADDRESS && f.until > now)
  }

  function noteFailure(ip) {
    const now = Date.now()
    global = global.until > now ? { count: global.count + 1, until: global.until } : { count: 1, until: now + WINDOW }
    const f = failures.get(ip)
    const fresh = !f || f.until <= now
    failures.delete(ip) // re-insert so the newest is last in iteration order
    failures.set(ip, { count: fresh ? 1 : f.count + 1, until: now + WINDOW })
    prune(now)
  }

  /*
   * Concurrency. scrypt is async, so without care thirty simultaneous attempts
   * would all pass the throttle check before the first one finished hashing and
   * recorded its failure. So an attempt is RESERVED as a failure before any
   * hashing starts and released only on success, and at most MAX_VERIFYING
   * verifications run at once; anything beyond that is refused with 429.
   */
  const MAX_VERIFYING = 2
  let verifying = 0
  const refuse = (message, status) => Object.assign(new Error(message), { status })

  function release(ip) {
    failures.delete(ip)
    if (global.count > 0) global = { ...global, count: global.count - 1 }
  }

  async function login({ username, password, ip = '?' }) {
    if (throttled(ip)) throw refuse('too many attempts — wait a minute and try again', 429)
    if (verifying >= MAX_VERIFYING) throw refuse('sign-in is busy — try again in a moment', 429)
    noteFailure(ip) // the reservation
    verifying++
    let ok = false
    try {
      const o = load().owner
      ok = Boolean(o) && safeEqual(String(username || '').trim(), o.username) && await verifyPassword(password)
    } finally {
      verifying--
    }
    if (!ok) throw refuse('wrong username or password', 401)
    release(ip)
    return issue()
  }

  async function changePassword({ current, next }) {
    if (!await verifyPassword(current)) throw new Error('the current password is wrong')
    if (String(next || '').length < MIN_PASSWORD) throw new Error(`use at least ${MIN_PASSWORD} characters`)
    const d = load()
    const salt = crypto.randomBytes(16)
    const hash = await scrypt(next, salt)
    save({
      ...d,
      owner: { ...d.owner, salt: b64u(salt), hash: b64u(hash), scrypt: SCRYPT,
        passwordVersion: (d.owner.passwordVersion || 1) + 1,
        sessionVersion: (d.owner.sessionVersion || 1) + 1, updatedAt: new Date().toISOString() },
    })
    return issue()
  }

  /** A signed session value for the current owner and password version. */
  function issue() {
    const o = load().owner
    const payload = b64u(JSON.stringify({
      u: o.username, v: o.passwordVersion || 1, s: o.sessionVersion || 1, exp: Date.now() + SESSION_DAYS * 86400_000,
    }))
    const sig = b64u(crypto.createHmac('sha256', sessionKey()).update(payload).digest())
    return `${payload}.${sig}`
  }

  function readSession(value) {
    if (!value || typeof value !== 'string' || !value.includes('.')) return null
    const [payload, sig] = value.split('.')
    const want = b64u(crypto.createHmac('sha256', sessionKey()).update(payload).digest())
    if (!safeEqual(sig, want)) return null
    let s
    try { s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
    const o = load().owner
    if (!o || s.u !== o.username || s.v !== (o.passwordVersion || 1) || (s.s || 1) !== (o.sessionVersion || 1) ||
      !(s.exp > Date.now())) return null
    return { username: s.u }
  }

  /**
   * Sign out: every session cookie issued so far stops working, on every device.
   * A cookie is a signed token, so clearing it in one browser would not stop a
   * copy of it; bumping the version does.
   */
  function revokeSessions() {
    const d = load()
    if (!d.owner) return
    save({ ...d, owner: { ...d.owner, sessionVersion: (d.owner.sessionVersion || 1) + 1 } })
  }

  function cookieHeader(req, value, { clear = false } = {}) {
    const parts = [
      `${COOKIE}=${clear ? '' : encodeURIComponent(value)}`,
      'Path=/', 'HttpOnly', 'SameSite=Lax',
      clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`,
    ]
    if (isHttps(req)) parts.push('Secure')
    return parts.join('; ')
  }

  /**
   * Who is asking. `{ ok, via, user }` — `via` is 'proxy', 'bearer' or 'session'.
   * A request with none of the three is `{ ok: false }`.
   */
  function check(req) {
    if (isProxy()) return { ok: true, via: 'proxy', user: null }
    const authz = String(req.headers.authorization || '')
    if (/^bearer /i.test(authz)) {
      const token = authz.slice(7).trim()
      const secrets = (bearerSecrets() || []).filter(s => typeof s === 'string' && s.length >= 16)
      if (token && secrets.some(s => safeEqual(token, s))) return { ok: true, via: 'bearer', user: null }
      const session = readSession(token)
      if (session) return { ok: true, via: 'session', user: session }
    }
    const user = readSession(cookieValue(req.headers.cookie, COOKIE))
    if (user) return { ok: true, via: 'session', user }
    return { ok: false }
  }

  return {
    get mode() { return isProxy() ? 'proxy' : 'password' },
    inFlight: () => verifying, MAX_VERIFYING,
    hasOwner, ensureSetupToken, checkSetupToken, createOwner, login, changePassword,
    check, cookieHeader, readSession, revokeSessions, owner: () => load().owner?.username || null,
    file, MIN_PASSWORD,
  }
}

module.exports = { createAuth, cookieValue, clientAddress, isLoopback, isHttps, COOKIE }
