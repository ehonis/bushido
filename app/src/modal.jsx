/*
 * The app's modal, and the fullscreen session page it can escalate to.
 *
 * Rendered inline with position:fixed rather than through a portal — nothing in
 * the layout establishes a containing block, and renderToString cannot follow a
 * portal, so the smoke suite would lose it.
 *
 * Dismissal is deliberately asymmetric. While you're only READING, tapping the
 * scrim or hitting Escape closes it, because that's the fast gesture. The
 * moment you start entering numbers it locks to the X button only: logging a
 * set on a phone means fat fingers near the edge of a sheet, and losing the
 * form to a stray tap is the single most annoying thing a log app can do.
 */

import { useEffect, useState } from 'react'
import { Icon } from './lib/icons.jsx'

/*
 * What has to happen to the page underneath while a layer is open.
 *
 * Two things, and both were wrong:
 *
 * 1. THE PAGE SCROLLED BEHIND THE SHEET. Scrolling inside a modal that has
 *    nothing left to scroll hands the gesture to the document, so a swipe on a
 *    bottom sheet quietly moved the feed behind it. `overflow: hidden` on the
 *    body does not stop this on iOS Safari; pinning the body with
 *    `position: fixed` and restoring the offset on close is the thing that does.
 *
 * 2. THE COACH BUTTON SAT ON TOP OF THE SHEET. Not a z-index typo — a stacking
 *    context. The scrim is rendered inline (see the file header: a portal would
 *    break the smoke suite, which renders to string and cannot follow one), so
 *    it lives inside `.hdr`, which is `position: sticky; z-index: 20`. That
 *    makes its z-index 60 mean "60 within the header", while the FAB's 40 is in
 *    the root context and therefore above all of it. Raising numbers cannot fix
 *    a nested context, so the layer marks the body instead and the FAB hides
 *    itself — which is what you want anyway, because it is unreachable then.
 *
 * Counted rather than boolean: a modal can open on top of a fullscreen page, and
 * the first one to close must not unlock the page under the second.
 */
let openLayers = 0
let savedScrollY = 0

export function useModalLayer(active = true) {
  useEffect(() => {
    if (!active) return undefined
    const body = document.body
    if (openLayers === 0) {
      savedScrollY = window.scrollY
      body.style.position = 'fixed'
      body.style.top = `-${savedScrollY}px`
      body.style.left = '0'
      body.style.right = '0'
      body.style.width = '100%'
      body.classList.add('layer-open')
    }
    openLayers += 1
    return () => {
      openLayers -= 1
      if (openLayers > 0) return
      body.style.position = ''
      body.style.top = ''
      body.style.left = ''
      body.style.right = ''
      body.style.width = ''
      body.classList.remove('layer-open')
      // Pinning the body loses the scroll position; put it back without the
      // smooth-scroll behaviour, which would animate the jump.
      window.scrollTo({ top: savedScrollY, behavior: 'instant' })
    }
  }, [active])
}

/**
 * `onRename` and `onDelete` put two buttons beside the X, and the second one
 * asks first.
 *
 * Delete sits at the top beside the X behind a confirmation screen, and rename
 * is a pencil next to it. Both were at the FOOT of the sheet as small text links, below the whole
 * protocol and the whole log form — which is a long way to scroll to do something
 * irreversible, and no distance at all once you are already down there.
 *
 * The confirmation is a SCREEN rather than a native `confirm()`: this app is used
 * one-handed with chalky hands, and a system dialog puts its buttons wherever iOS
 * feels like putting them. It replaces the body rather than stacking on it, so
 * there is exactly one thing on screen to answer.
 */
export function Modal({
  title, sub, icon, tone, onClose, onRename = null, onDelete = null,
  deleteLabel = 'Remove this session', deleteBody = null,
  dismissable = true, footer, children,
}) {
  const [confirming, setConfirming] = useState(false)
  useModalLayer()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, dismissable])

  return (
    <div className="modal-scrim" onClick={() => dismissable && onClose()} role="presentation">
      <div className={`modal ${tone ? `t-${tone}` : ''}`} role="dialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          {icon && <span className="modal-ico"><Icon name={icon} size={20} /></span>}
          <div className="modal-titles">
            <div className="modal-title">{title}</div>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
          {onRename && (
            <button className="modal-btn" onClick={onRename} aria-label="Edit this workout" title="Edit">
              <Icon name="Pencil" size={16} />
            </button>
          )}
          {onDelete && (
            <button className="modal-btn danger" onClick={() => setConfirming(true)}
              aria-label={deleteLabel} title={deleteLabel}>
              <Icon name="Trash2" size={16} />
            </button>
          )}
          <button className="modal-btn close" onClick={onClose} aria-label="Close">
            <Icon name="X" size={18} />
          </button>
        </header>

        {confirming ? (
          <div className="modal-body">
            <div className="confirm">
              <span className="confirm-ico"><Icon name="TriangleAlert" size={34} /></span>
              <h3>{deleteLabel}?</h3>
              <p className="sub">
                {deleteBody || <>It comes off the day, out of the week&rsquo;s quotas and out of your
                  training load. Anything you logged on it goes with it.</>}
              </p>
              <div className="confirm-acts">
                <button className="btn ghost" onClick={() => setConfirming(false)}>Keep it</button>
                {/* Just the verb: the heading above it already says what of. The
                    full label wrapped onto two lines at 430px. */}
                <button className="btn bad" onClick={() => { setConfirming(false); onDelete() }}>
                  <Icon name="Trash2" size={16} /> Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="modal-body">{children}</div>
        )}

        {footer && !confirming && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

/**
 * A whole screen for one session. Same data as the sheet — it reads and writes
 * the same entry — just given the room a phone actually needs to follow a
 * twelve-step block without scrolling past the numbers you're typing.
 */
export function FullScreen({ title, sub, icon, tone, onBack, tabs, active, onTab, children }) {
  useModalLayer()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onBack() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onBack])

  return (
    <div className={`fs ${tone ? `t-${tone}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="fs-head">
        <button className="modal-btn" onClick={onBack} aria-label="Back">
          <Icon name="ChevronDown" size={19} style={{ transform: 'rotate(90deg)' }} />
        </button>
        {icon && <span className="fs-ico"><Icon name={icon} size={20} /></span>}
        <div className="modal-titles">
          <div className="modal-title">{title}</div>
          {sub && <div className="modal-sub">{sub}</div>}
        </div>
      </header>

      {tabs?.length > 1 && (
        <div className="fs-tabs" role="tablist">
          {tabs.map(t => (
            <button key={t.key} role="tab" aria-selected={t.key === active}
              className={`fs-tab ${t.key === active ? 'on' : ''}`} onClick={() => onTab(t.key)}>
              <Icon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="fs-body">{children}</div>
    </div>
  )
}

/**
 * A panel anchored to the thing that opened it.
 *
 * Added 2026-09-15 for the profile, which had been a `FullScreen` and should not
 * have been. Full-screen is right for a session you are in the middle of — one
 * thing, all the room. It is wrong for "who am I and what do I own" on a desktop:
 * at 2300px the content sat in a narrow column inside a dark void, with six tabs
 * spread edge to edge.
 *
 * So: anchored under its trigger and sized to its contents on a desktop, a bottom
 * sheet on a phone. Both from one component, because the difference is entirely
 * CSS and a second component would be a second thing to keep in step.
 *
 * `anchor` is a DOMRect from the trigger. Absent, it centres — which is what the
 * render suite gets, and what a keyboard-opened menu gets.
 */
export function Popover({ anchor, label, onClose, children }) {
  useModalLayer()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Right-aligned to the trigger, because the trigger lives in the top right and
  // a panel that grows leftward from it cannot run off the screen. Clamped so a
  // narrow window still gets a gap rather than a panel flush to the edge.
  const style = anchor
    ? {
        top: Math.round(anchor.bottom + 8),
        right: Math.max(8, Math.round(window.innerWidth - anchor.right)),
      }
    : undefined

  return (
    <div className="pop-scrim" onClick={onClose} role="presentation">
      <div className={`pop ${anchor ? '' : 'centred'}`} style={style}
        role="dialog" aria-modal="true" aria-label={label}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
