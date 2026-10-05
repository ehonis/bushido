/*
 * The request guards, as units: safeNext, the cross-site and content-type
 * checks, and the proxy-mode settings restriction (which needs a non-loopback
 * peer the HTTP tests cannot produce). Run: node server/guard.test.js
 */
const os = require('os')
const fs = require('fs')
const path = require('path')

// server.js builds its config at load; point it at a throwaway data dir.
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-guard-'))
process.env.BUSHIDO_DATA_DIR = tmpData
process.on('exit', () => fs.rmSync(tmpData, { recursive: true, force: true }))
const { safeNext, requestGuard, proxySettingsRefusal } = require('./server.js')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

const req = (method, headers = {}, peer = '127.0.0.1') => ({ method, headers: { host: 'app.local:8099', ...headers }, socket: { remoteAddress: peer } })
const json = { 'content-type': 'application/json' }

check('safeNext keeps same-origin paths', () => {
  eq(safeNext('/'), '/')
  eq(safeNext('/settings?welcome=1#x'), '/settings?welcome=1#x')
  eq(safeNext('/log?w=1'), '/log?w=1')
})

check('safeNext refuses other origins, backslashes and control characters', () => {
  for (const bad of ['//evil.example', '/\\evil.example', '/%09/evil.example', '/%5Cevil.example', '/\t/evil.example',
    'https://evil.example', 'evil', '/%0d%0aSet-Cookie:x', '/%zz', null, 42]) {
    eq(safeNext(bad), '/', `for ${JSON.stringify(bad)}`)
  }
})

check('GET and HEAD are never refused', () => {
  eq(requestGuard(req('GET', { 'sec-fetch-site': 'cross-site' }), '/api/state'), null)
  eq(requestGuard(req('HEAD', { origin: 'null' }), '/'), null)
})

check('a cross-site write is refused, by Sec-Fetch-Site or by Origin', () => {
  eq(requestGuard(req('POST', { ...json, 'sec-fetch-site': 'cross-site' }), '/api/entry').status, 403)
  eq(requestGuard(req('POST', { ...json, 'sec-fetch-site': 'same-site' }), '/api/entry').status, 403)
  eq(requestGuard(req('POST', { ...json, origin: 'https://evil.example' }), '/api/entry').status, 403)
  eq(requestGuard(req('POST', { ...json, origin: 'null' }), '/api/entry').status, 403)
  eq(requestGuard(req('POST', { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }), '/login').status, 403)
})

check('a same-origin write passes, including behind a tunnel that rewrites Host', () => {
  eq(requestGuard(req('PUT', { ...json, 'sec-fetch-site': 'same-origin', origin: 'https://public.example' }), '/api/state'), null)
  eq(requestGuard(req('PUT', { ...json, origin: 'http://app.local:8099' }), '/api/state'), null)
  eq(requestGuard(req('PUT', { ...json, origin: 'https://public.example', 'x-forwarded-host': 'public.example' }), '/api/state'), null)
})

check('a script with no Origin (a bearer client) is not refused', () => {
  eq(requestGuard(req('POST', { ...json, authorization: 'Bearer x' }), '/api/entry'), null)
})

check('JSON routes refuse other content types with 415; DELETE, push and forms are exempt', () => {
  eq(requestGuard(req('POST', { 'content-type': 'text/plain' }), '/api/entry').status, 415)
  eq(requestGuard(req('PUT', {}), '/api/settings').status, 415)
  eq(requestGuard(req('POST', { 'content-type': 'application/json; charset=utf-8' }), '/api/entry'), null)
  eq(requestGuard(req('DELETE', {}), '/api/coach/thread/x'), null)
  eq(requestGuard(req('POST', {}), '/api/push/test'), null)
  eq(requestGuard(req('POST', { 'content-type': 'application/x-www-form-urlencoded' }), '/login'), null)
})

check('proxy mode: settings writes only from a loopback peer', () => {
  eq(proxySettingsRefusal('proxy', req('PUT', json, '100.64.0.9'), '/api/settings') !== null, true, 'tailnet peer allowed')
  eq(proxySettingsRefusal('proxy', req('POST', json, '192.168.1.5'), '/api/settings/ai/test') !== null, true, 'LAN peer allowed')
  eq(proxySettingsRefusal('proxy', req('PUT', json, '127.0.0.1'), '/api/settings'), null)
  eq(proxySettingsRefusal('proxy', req('PUT', json, '::1'), '/api/settings'), null)
  eq(proxySettingsRefusal('proxy', req('PUT', json, '::ffff:127.0.0.1'), '/api/settings'), null)
  eq(proxySettingsRefusal('proxy', req('GET', {}, '100.64.0.9'), '/api/settings'), null, 'reading is fine')
  eq(proxySettingsRefusal('password', req('PUT', json, '100.64.0.9'), '/api/settings'), null, 'a signed-in owner is fine')
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nguards ok')
