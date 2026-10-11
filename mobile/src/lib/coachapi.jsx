/*
 * The coach's threads, shared between the tab and the floating bubble.
 *
 * Same threads, two views. Ask something in the bubble and
 * find it later in the tab, without having to remember where you asked it. That
 * requires one store rather than two, and a context is the cheapest way to have
 * one: both surfaces mount inside it, so neither owns the data and neither has to
 * tell the other anything.
 *
 * Threads live on the box (see server/coach.js) rather than in the synced log,
 * so this is a fetch layer rather than part of the store. The practical
 * consequence is that a coach conversation does NOT work offline — which is
 * correct and not a compromise, because the coach is a model running on that box
 * and there is nothing to say when it cannot be reached.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const CoachCtx = createContext(null)

const json = async (url, opts) => {
  const r = await fetch(url, opts)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`)
  return body
}

export function CoachProvider({ children }) {
  const [threads, setThreads] = useState([])
  const [active, setActive] = useState(null)      // the full thread, with messages
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try { setThreads((await json('/api/coach/threads')).threads || []) }
    catch { /* the box is unreachable; the list stays as it was */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const open = useCallback(async (id) => {
    if (!id) { setActive(null); return null }
    try {
      const t = await json(`/api/coach/thread/${id}`)
      setActive(t)
      return t
    } catch (e) { setError(e.message); return null }
  }, [])

  const start = useCallback(() => { setActive(null); setError(null) }, [])

  /**
   * Ask, and show their message immediately.
   *
   * A turn can take minutes — it is an agent that goes and reads things. Waiting
   * for the round trip to show what the user typed would make the box feel broken for
   * the whole of it, so their message goes on screen optimistically and the server's
   * copy replaces the lot when it lands. The server has already stored it by
   * then: it writes the question before asking the model, so a failed turn costs
   * the reply and never the question.
   */
  const send = useCallback(async (message, context = null) => {
    setError(null)
    setAsking(true)
    const optimistic = { role: 'user', text: message, at: new Date().toISOString() }
    setActive(t => (t
      ? { ...t, messages: [...(t.messages || []), optimistic] }
      : { id: null, title: message.slice(0, 60), messages: [optimistic] }))
    try {
      const t = await json('/api/coach/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, threadId: active?.id || null, context }),
      })
      setActive(t)
      refresh()
      return t
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setAsking(false)
    }
  }, [active?.id, refresh])

  const remove = useCallback(async (id) => {
    try { await json(`/api/coach/thread/${id}`, { method: 'DELETE' }) } catch { /* already gone */ }
    if (active?.id === id) setActive(null)
    refresh()
  }, [active?.id, refresh])

  const value = useMemo(
    () => ({ threads, active, asking, error, open, start, send, remove, refresh }),
    [threads, active, asking, error, open, start, send, remove, refresh])

  return <CoachCtx.Provider value={value}>{children}</CoachCtx.Provider>
}

export const useCoach = () => useContext(CoachCtx) || {
  threads: [], active: null, asking: false, error: null,
  open: async () => null, start: () => {}, send: async () => null,
  remove: async () => {}, refresh: async () => {},
}
