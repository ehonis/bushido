// Imported first by the root layout, before anything that touches storage or
// the network.
//
// The modules ported from the web (the store's cache and outbox, whoami, the
// runner's draft) read and write localStorage synchronously. expo-sqlite installs
// a real, persistent, synchronous localStorage, so that code runs here unchanged.
import 'expo-sqlite/localStorage/install'
import { installFetch } from './connection'

// The two browser APIs the ported modules lean on that Hermes may not have.
// store.js clones its empty state; whoami.js bounds /api/auth/me with a timeout.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = ((v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))) as typeof structuredClone
}
if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout !== 'function') {
  ;(AbortSignal as any).timeout = (ms: number) => {
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), ms)
    return ctl.signal
  }
}

// `fetch('/api/…')` from any ported module now means the saved server (connection.ts).
installFetch()
