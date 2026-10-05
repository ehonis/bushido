/*
 * What the phone actually gives the page.
 *
 * Added after two rounds of guessing at a layout bug from screenshots. Making
 * the Home Screen web app fit the screen exactly needed numbers nobody here could
 * see: the installed app on iOS 26 reports a layout viewport SHORTER than the
 * screen by exactly the top safe-area inset, and the strip that leaves at the
 * bottom is outside the WebView — nothing can paint into it or be tapped there.
 * Headless Chrome, which is what this repo screenshots with, has no safe area and
 * cannot show any of it.
 *
 * So this card reads the real values on the device and says what they mean. It is
 * a reading, not a setting; nothing here changes anything.
 */

import { useEffect, useState } from 'react'
import { Icon } from './lib/icons.jsx'

/** env() cannot be read from JS; a probe element with it as padding can. */
function readInsets() {
  if (typeof document === 'undefined') return null
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);' +
    'padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)'
  document.body.appendChild(el)
  const cs = getComputedStyle(el)
  const px = (v) => Math.round(parseFloat(v) || 0)
  const out = { top: px(cs.paddingTop), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft), right: px(cs.paddingRight) }
  el.remove()
  return out
}

export function measureScreen() {
  if (typeof window === 'undefined') return null
  const standalone = Boolean(window.navigator?.standalone) ||
    Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches)
  return {
    inner: { w: window.innerWidth, h: window.innerHeight },
    screen: { w: window.screen?.width ?? null, h: window.screen?.height ?? null },
    visual: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    dpr: window.devicePixelRatio || 1,
    insets: readInsets(),
    standalone,
    ua: window.navigator?.userAgent || '',
  }
}

/**
 * The sentence the numbers add up to.
 *
 * A layout viewport shorter than the screen, in an installed app, by about the top
 * inset is the iOS 26 regression; anything else is described rather than diagnosed.
 */
export function describeScreen(m) {
  if (!m) return null
  const gap = (m.screen.h ?? 0) - m.inner.h
  if (m.standalone && m.insets && gap > 0 && Math.abs(gap - m.insets.top) <= 12) {
    return `The page is ${gap}px shorter than the screen — the same as the status-bar inset. ` +
      'That is an iOS 26 bug in installed web apps: the strip at the bottom is outside the page and ' +
      'nothing can draw or be tapped there. Apple fixed it in a 26.x update; nothing in this app can.'
  }
  if (m.standalone && gap > 0) {
    return `The page is ${gap}px shorter than the screen. The bottom strip is not the app's to use.`
  }
  if (m.standalone) return 'The page fills the screen.'
  return 'Open from the Home Screen icon to see what the installed app gets.'
}

export function ScreenCard() {
  const [m, setM] = useState(null)
  useEffect(() => {
    const read = () => setM(measureScreen())
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  const ios = m?.ua?.match(/OS (\d+)_(\d+)/)
  return (
    <div className="card screen-card">
      <h2>Screen</h2>
      <p className="sub">
        What this device is actually giving the page. A reading, for when a button is
        hiding under the clock or there is a dead strip at the bottom.
      </p>
      {!m ? (
        <p className="sub">Measuring…</p>
      ) : (
        <>
          <dl className="screen-grid">
            <dt>Screen</dt><dd>{m.screen.w} × {m.screen.h} pt · {m.dpr}×</dd>
            <dt>Page</dt><dd>{m.inner.w} × {m.inner.h} pt{m.visual && m.visual !== m.inner.h ? ` (visible ${m.visual})` : ''}</dd>
            <dt>Safe area</dt><dd>{m.insets ? `top ${m.insets.top} · bottom ${m.insets.bottom}` : '—'}</dd>
            <dt>Mode</dt><dd>{m.standalone ? 'installed app' : 'browser tab'}{ios ? ` · iOS ${ios[1]}.${ios[2]}` : ''}</dd>
          </dl>
          <p className="sub screen-verdict"><Icon name="Info" size={13} /> {describeScreen(m)}</p>
        </>
      )}
    </div>
  )
}
