/*
 * UI preferences — currently just which context blurbs are collapsed.
 *
 * Stored in the synced settings blob, so hiding an explainer on your phone hides
 * it on the laptop too. Nothing is ever deleted: a hidden blurb collapses to a
 * one-line stub you can tap to bring back.
 *
 * Two sets rather than one, so the global toggle and per-blurb toggles compose
 * predictably: when everything is hidden, `shown` holds the exceptions; when
 * everything is visible, `hidden` holds them.
 */

import { createContext, useCallback, useContext, useMemo } from 'react'

const PrefsCtx = createContext(null)

export function PrefsProvider({ settings, saveSettings, children }) {
  const blurbs = settings?.blurbs || {}
  const allHidden = Boolean(blurbs.allHidden)
  const hidden = blurbs.hidden || {}
  const shown = blurbs.shown || {}

  const isHidden = useCallback(
    (id) => (allHidden ? !shown[id] : Boolean(hidden[id])),
    [allHidden, hidden, shown],
  )

  const toggle = useCallback((id) => {
    if (allHidden) {
      const next = { ...shown }
      if (next[id]) delete next[id]; else next[id] = true
      saveSettings({ blurbs: { allHidden, hidden, shown: next } })
    } else {
      const next = { ...hidden }
      if (next[id]) delete next[id]; else next[id] = true
      saveSettings({ blurbs: { allHidden, hidden: next, shown } })
    }
  }, [allHidden, hidden, shown, saveSettings])

  // Flipping the global switch clears the per-blurb exceptions, so "show all"
  // genuinely means all rather than "all except the six you hid in July".
  const setAllHidden = useCallback((next) => {
    saveSettings({ blurbs: { allHidden: next, hidden: {}, shown: {} } })
  }, [saveSettings])

  const value = useMemo(
    () => ({ isHidden, toggle, allHidden, setAllHidden }),
    [isHidden, toggle, allHidden, setAllHidden],
  )
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>
}

/** Safe outside a provider (server-render smoke tests) — nothing is hidden. */
export function usePrefs() {
  return useContext(PrefsCtx) || {
    isHidden: () => false,
    toggle: () => {},
    allHidden: false,
    setAllHidden: () => {},
  }
}
