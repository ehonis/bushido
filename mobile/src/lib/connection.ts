// Where the Bushido server is, and how this phone proves who it is. The one
// place auth is handled: when the server's sign-in changes (more than one
// person, say), this file and connect.tsx change and nothing else does.
//
// The web app is served by the server, so every call there is a relative path
// on the same origin, and main.jsx wraps window.fetch to react to the gate's
// answers. The app has no origin of its own, so installFetch() does the same
// job for it: a fetch of '/api/...' from any ported module is sent to the saved
// base URL with the credential, the Cloudflare Access token and the
// X-Bushido-User header, and the gate's answers are handled here once.
//
// Three ways in, matching server/auth.js:
//   session  username + password, exchanged once (POST /api/auth/session) for
//            the signed session value a browser keeps in its cookie; sent as
//            `Authorization: Bearer`.
//   token    BUSHIDO_API_TOKEN, pasted, sent as `Authorization: Bearer`.
//   proxy    BUSHIDO_AUTH=proxy: something in front (Cloudflare Access, a
//            tailnet) already decided; nothing is sent.
// The credential and the Access token live in the keychain (expo-secure-store),
// never in localStorage, and are cached in memory so the fetch wrapper stays
// synchronous about headers.
import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import { isAccessResponse } from './cfAccess'

const BASE_KEY = 'bushido.server.base'
const KIND_KEY = 'bushido.server.kind'
const USER_KEY = 'bushido.server.user'
const CREDENTIAL_KEY = 'bushido.server.credential'
const ACCESS_KEY = 'bushido.server.cfAccess'

/** The port `npm start` serves on (server.js PORT). */
export const DEFAULT_PORT = '8099'

// expo-secure-store has no web implementation. The web build only exists for
// previewing layouts in a desktop browser, so it keeps the secret in localStorage.
const secure = Platform.OS === 'web'
  ? {
      getItemAsync: async (k: string) => localStorage.getItem(k),
      setItemAsync: async (k: string, v: string) => localStorage.setItem(k, v),
      deleteItemAsync: async (k: string) => localStorage.removeItem(k),
    }
  : SecureStore

export type AuthKind = 'session' | 'token' | 'proxy'

export interface Connection {
  baseUrl: string
  kind: AuthKind | ''
  /** The session value or the API token. Empty in proxy mode. */
  credential: string
  /** The account name a session was signed in as, for the profile. */
  user?: string
  /** Cloudflare Access app token, when the server sits behind Access. */
  accessToken?: string
  /** Access answered a request instead of Bushido: the token is missing or expired. */
  accessNeeded?: boolean
}

let current: Connection = { baseUrl: '', kind: '', credential: '' }
let loaded = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((fn) => fn())

/**
 * What was typed, to a base URL with no trailing slash. A full URL is kept. An
 * IP, `localhost`, a bare machine name or a Tailscale/LAN name (`*.ts.net`,
 * `*.local`) is the server itself: http on its port (8099 unless given). Any
 * other domain is a published one (a Cloudflare tunnel, a proxy): https on 443.
 */
export function normalizeBaseUrl(input: string, defaultPort = DEFAULT_PORT): string {
  const raw = String(input || '').trim().replace(/\/+$/g, '')
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  const host = raw.replace(/:\d+$/, '')
  const hasPort = /:\d+$/.test(raw)
  const direct = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost' || !host.includes('.') || /\.(ts\.net|local)$/i.test(host) || hasPort
  if (!direct) return `https://${raw}`
  return `http://${raw}${hasPort ? '' : `:${defaultPort}`}`
}

export async function loadConnection(): Promise<Connection> {
  if (loaded) return current
  const baseUrl = localStorage.getItem(BASE_KEY) || ''
  const kind = (localStorage.getItem(KIND_KEY) || '') as AuthKind | ''
  const user = localStorage.getItem(USER_KEY) || undefined
  const credential = (await secure.getItemAsync(CREDENTIAL_KEY).catch(() => null)) || ''
  const accessToken = (await secure.getItemAsync(ACCESS_KEY).catch(() => null)) || ''
  current = { baseUrl, kind, credential, ...(user ? { user } : {}), ...(accessToken ? { accessToken } : {}) }
  loaded = true
  emit()
  return current
}

export async function saveConnection(next: Connection) {
  localStorage.setItem(BASE_KEY, next.baseUrl)
  localStorage.setItem(KIND_KEY, next.kind)
  if (next.user) localStorage.setItem(USER_KEY, next.user)
  else localStorage.removeItem(USER_KEY)
  if (next.credential) await secure.setItemAsync(CREDENTIAL_KEY, next.credential)
  else await secure.deleteItemAsync(CREDENTIAL_KEY).catch(() => {})
  if (next.accessToken) await secure.setItemAsync(ACCESS_KEY, next.accessToken)
  else await secure.deleteItemAsync(ACCESS_KEY).catch(() => {})
  current = { ...next, accessNeeded: false }
  emit()
}

/** Signed out: forget the credential, keep the address (and the kind) so signing back in is one form. */
export async function forgetCredential() {
  await secure.deleteItemAsync(CREDENTIAL_KEY).catch(() => {})
  localStorage.setItem(KIND_KEY, current.kind === 'proxy' ? '' : current.kind)
  current = { ...current, credential: '', kind: current.kind === 'proxy' ? '' : current.kind }
  emit()
}

/** A fresh Access token after signing in again; requests pick it up at once. */
export async function saveAccessToken(token: string) {
  await secure.setItemAsync(ACCESS_KEY, token)
  current = { ...current, accessToken: token, accessNeeded: false }
  emit()
}

function markAccessNeeded() {
  if (current.accessNeeded) return
  current = { ...current, accessNeeded: true }
  emit()
}

export const getConnection = () => current
export const getBaseUrl = () => current.baseUrl
export const isConnected = (c: Connection = current) => Boolean(c.baseUrl && (c.kind === 'proxy' || (c.kind && c.credential)))

/** The headers that prove who this is: the credential and, behind Access, its token. */
export function authHeaders(c: Connection = current): Record<string, string> {
  const h: Record<string, string> = {}
  if (c.kind !== 'proxy' && c.credential) h.Authorization = `Bearer ${c.credential}`
  if (c.accessToken) h['cf-access-token'] = c.accessToken
  return h
}

/** An absolute URL for a server path. Absolute URLs pass through untouched. */
export function serverUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${current.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`
}

/* ------------------------------------------------------- whose log, and the gate */

// lib/whoami.js decides whose log is open before the store mounts; every API call
// then says so, as main.jsx's wrapper does.
let userId: string | null = null
export const setUserId = (id: string | null) => { userId = id }

let onSwitched: () => void = () => {}
/** The server now answers for someone else (409 switched): the app reloads into their log. */
export const setOnSwitched = (fn: () => void) => { onSwitched = fn }

let leaving = false
/** Reset after a fresh sign-in, so the next 401 is handled again. */
export const resetGate = () => { leaving = false }

let realFetch: typeof fetch | null = null

/** fetch() that skips the wrapper: no gate handling (sign-out's own calls use this, as main.jsx does). */
export function rawFetch(input: RequestInfo | URL, init?: RequestInit) {
  return (realFetch || fetch)(input, init)
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return (input as Request).url
}

/**
 * Make `fetch('/api/…')` mean this server, everywhere. Called once from boot.ts,
 * before any ported module runs. Absolute URLs (Cloudflare, Expo's own) are
 * left exactly as they were.
 */
export function installFetch() {
  if (realFetch) return
  realFetch = globalThis.fetch.bind(globalThis)
  const wrapped = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = urlOf(input)
    if (!url.startsWith('/')) return realFetch!(input, init)
    const headers = new Headers(init.headers || (typeof input === 'object' && 'headers' in input ? (input as Request).headers : undefined))
    for (const [k, v] of Object.entries(authHeaders())) if (!headers.has(k)) headers.set(k, v)
    if (userId && url.startsWith('/api/')) headers.set('X-Bushido-User', userId)
    const res = await realFetch!(serverUrl(url), { ...init, headers })
    if (isAccessResponse(res)) markAccessNeeded()
    // The session expired or the password changed on another device: back to
    // Connect once, rather than every card showing its own error.
    if (res.status === 401 && res.headers.get('X-Bushido-Auth') === 'login' && !leaving) {
      leaving = true
      void forgetCredential()
    }
    if (res.status === 409 && res.headers.get('X-Bushido-Auth') === 'switched' && !leaving) {
      leaving = true
      onSwitched()
    }
    return res
  }
  globalThis.fetch = wrapped as typeof fetch
}

function subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } }
export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, getConnection, getConnection)
}
