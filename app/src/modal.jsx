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
 *
 * THE SHELL OWNS THAT POLICY (#77), so no caller can forget it. The sheet
 * counts as touched from the first keystroke, whatever the caller passes as
 * `dismissable`, and the scrim and Escape also wait while a box has focus. And WHILE A BOX HAS FOCUS THERE
 * IS NO FOOTER AT ALL, on a sheet or a full screen's sticky bar: the footer
 * sat directly under the set being edited, and on a phone with the keyboard
 * up it was the strip a thumb crosses between the number and the keys, so the
 * owner closed the sheet mid-workout over and over. The footer comes back a
 * moment after the last box lets go (`EDIT_SETTLE_MS`), so a tap that blurred
 * the box lands on what was under the finger, not on a footer that slid in.
 * Escape while typing ends the typing; it does not close.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

/** Box types that bring up no keyboard: focusing one is not typing. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'])

/** Is this element a box being typed into? (A switch or a button is not.) */
export function isTextEntry(el) {
  if (!el || typeof el !== 'object') return false
  if (el.disabled || el.readOnly) return false
  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') return !NOT_TYPED.has(String(el.type || 'text').toLowerCase())
  return el.isContentEditable === true
}

/** How long after the last box lets go before a hidden footer comes back. */
export const EDIT_SETTLE_MS = 400

/** A finger, not a mouse: where a footer under the box being typed in is a hazard. */
const touchScreen = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)

/** Is a box being typed into right now, anywhere on the page? */
const typingNow = () => {
  const el = typeof document !== 'undefined' ? document.activeElement : null
  return isTextEntry(el) && el.isConnected !== false
}

/**
 * The footer policy's memory, as plain events (`useEditing` feeds it). A box
 * taking focus hides the footer; it comes back `delay` after nothing is being
 * typed into, checked again when the timer runs.
 *
 * NOT ONLY ON BLUR (C N1). A focused box that is REMOVED from the page fires no
 * blur React hears: the exercise picker's search box goes the moment an exercise
 * is picked, and on iOS the row tapped does not take focus, so the footer, with
 * the only way to keep the plan, stayed hidden with nothing saying why.
 * `changed()` is called whenever the page's content changes or focus leaves
 * anything, and asks the page itself (`typing`) whether a box still has focus.
 */
export function editWatch({ typing = typingNow, set, delay = EDIT_SETTLE_MS, touch = touchScreen } = {}) {
  let on = false
  let timer = null
  const settle = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (on && !typing()) { on = false; set(false) }
    }, delay)
  }
  return {
    focus(el) {
      if (!isTextEntry(el) || !touch()) return
      clearTimeout(timer)
      if (!on) { on = true; set(true) }
    },
    // Moving from one box straight to another never shows the footer in between.
    blur(el, next) {
      if (!on || !isTextEntry(el) || isTextEntry(next)) return
      settle()
    },
    changed() { if (on && !typing()) settle() },
    stop() { clearTimeout(timer) },
  }
}

/**
 * Whether a box inside this layer has focus, for the footer policy above.
 * Spread `bind` on the layer's root: React's focus events bubble (through a
 * portal too), and while editing the page is watched for a box removed under
 * the focus (`editWatch`): the whole body, because a box in a popover over the
 * layer (a block's name) is portalled out of it. Touch screens only: with a
 * mouse there is no keyboard rising under a thumb, and hiding the footer would
 * only cost a click ("Write it for me" after typing the ask).
 */
export function useEditing() {
  const [editing, setEditing] = useState(false)
  const watch = useRef(null)
  if (!watch.current) watch.current = editWatch({ set: setEditing })
  useEffect(() => () => watch.current.stop(), [])
  useEffect(() => {
    if (!editing || typeof document === 'undefined') return undefined
    const changed = () => watch.current.changed()
    const mo = typeof MutationObserver !== 'undefined' && document.body ? new MutationObserver(changed) : null
    mo?.observe(document.body, { childList: true, subtree: true })
    // Focus leaving for somewhere React does not see (another window, a box in a
    // portal closing): asked once the move has landed.
    const out = () => setTimeout(changed, 0)
    document.addEventListener('focusout', out, true)
    return () => { mo?.disconnect(); document.removeEventListener('focusout', out, true) }
  }, [editing])
  const bind = {
    onFocus: (e) => watch.current.focus(e.target),
    onBlur: (e) => watch.current.blur(e.target, e.relatedTarget),
  }
  return { editing, bind }
}

/** Whether a sheet shows its footer: never over its delete confirmation, never while typing. */
export const footerShown = ({ footer, confirming = false, editing = false }) => Boolean(footer) && !confirming && !editing

/**
 * Whether the scrim and Escape may close a sheet: not once something was typed in
 * it (`touched`), and not while a box has focus. Focusing a box is not a change,
 * so once it lets go of the box an untouched sheet closes the fast way again.
 */
export const sheetDismissable = ({ dismissable = true, touched = false, editing = false }) => dismissable && !touched && !editing

/** Escape while typing puts the typing down; it never takes the layer with it. */
function endTyping() {
  const el = typeof document !== 'undefined' ? document.activeElement : null
  if (isTextEntry(el)) { el.blur(); return true }
  return false
}

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
  title, sub, status = null, icon, tone, onClose, onRename = null, onDelete = null,
  deleteLabel = 'Remove this session', deleteBody = null,
  dismissable = true, footer, children,
}) {
  const [confirming, setConfirming] = useState(false)
  const { editing, bind } = useEditing()
  // Touched once anything is actually typed (focusing a box is not a change):
  // from then on the X is the exit. While a box has focus the scrim and Escape
  // wait too, without that counting as a change.
  const [touched, setTouched] = useState(false)
  const canDismiss = sheetDismissable({ dismissable, touched, editing })
  useModalLayer()
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (endTyping()) return
      if (canDismiss) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, canDismiss])

  return (
    <div className="modal-scrim" onClick={() => canDismiss && onClose()} role="presentation">
      <div className={`modal ${tone ? `t-${tone}` : ''}`} role="dialog" aria-modal="true" aria-label={title}
        data-editing={editing ? '' : undefined}
        onClick={(e) => e.stopPropagation()} onInput={() => setTouched(true)} {...bind}>
        {/* THE HEADER (#82, from #91's review): one title row that never wraps its
            line (the day and one count, ellipsized), the bin, pencil and X on it,
            and the state row (the done chip, who it is shared with) across the
            full width under it. Squeezed beside three buttons, "Wed, Nov 4 · 3
            exercises" broke and the chips stacked: a 190px header at 390. The
            icon well is decoration and gives way on a phone when the bin and the
            pencil are both there (`.modal-head.full`). */}
        <header className={`modal-head${onDelete && onRename ? ' full' : ''}`}>
          <div className="modal-headrow">
            {icon && <span className="modal-ico"><Icon name={icon} size={20} /></span>}
            <div className="modal-titles">
              <div className="modal-title">{title}</div>
              {sub && <div className="modal-sub">{sub}</div>}
            </div>
            {/* The bin first and the pencil between it and the X, so the destructive
                one is never beside the exit (it asks first anyway). */}
            {onDelete && (
              <button className="modal-btn danger" onClick={() => setConfirming(true)}
                aria-label={deleteLabel} title={deleteLabel}>
                <Icon name="Trash2" size={16} />
              </button>
            )}
            {onRename && (
              <button className="modal-btn" onClick={onRename} aria-label="Edit this workout" title="Edit">
                <Icon name="Pencil" size={16} />
              </button>
            )}
            <button className="modal-btn close" onClick={onClose} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
          </div>
          {/* A state you can flip (the session's done chip): at the top, far from every input. */}
          {status && !confirming && <div className="modal-status">{status}</div>}
        </header>

        {confirming ? (
          <div className="modal-body">
            <div className="confirm">
              <span className="confirm-ico"><Icon name="TriangleAlert" size={34} /></span>
              <h3>{deleteLabel}?</h3>
              <p className="sub">
                {deleteBody || <>It comes off the day and out of your
                  training load. Anything you logged on it goes with it.</>}
              </p>
              <div className="confirm-acts">
                <button className="btn secondary" onClick={() => setConfirming(false)}>Keep it</button>
                {/* Just the verb: the heading above it already says what of. The
                    full label wrapped onto two lines at 430px. */}
                <button className="btn destructive" onClick={() => { setConfirming(false); onDelete() }}>
                  <Icon name="Trash2" size={16} /> Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="modal-body">{children}</div>
        )}

        {footerShown({ footer, confirming, editing }) && <footer className="modal-foot">{footer}</footer>}
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
  // A full screen's footer is the planner's sticky bar, hidden while typing by
  // `.fs[data-editing]` in styles.css: the same policy as the sheet's.
  const { editing, bind } = useEditing()
  useModalLayer()
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (!endTyping()) onBack()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onBack])

  return (
    <div className={`fs ${tone ? `t-${tone}` : ''}`} role="dialog" aria-modal="true" aria-label={title}
      data-editing={editing ? '' : undefined} {...bind}>
      <header className="fs-head">
        <button className="modal-btn" onClick={onBack} aria-label="Back">
          <Icon name="ChevronLeft" size={19} />
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
export function Popover({ anchor, label, onClose, children, over = false }) {
  useModalLayer()
  const box = useRef(null)
  useEffect(() => {
    /*
     * Escape closes this and nothing under it. Caught on the way DOWN and
     * stopped there, so the sheet or full screen it was opened from (which
     * listen on the way up) keeps its place: Escape from the exercise sheet
     * over a session closes the exercise sheet.
     */
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  // Focus moves in, so the keyboard and a screen reader are where the reader is.
  useEffect(() => { box.current?.focus({ preventScroll: true }) }, [])

  // Right-aligned to the trigger, because the trigger lives in the top right and
  // a panel that grows leftward from it cannot run off the screen. Clamped so a
  // narrow window still gets a gap rather than a panel flush to the edge.
  const style = anchor
    ? {
        top: Math.round(anchor.bottom + 8),
        right: Math.max(8, Math.round(window.innerWidth - anchor.right)),
      }
    : undefined

  const pop = (
    <div className={`pop-scrim ${over ? 'over' : ''}`} onClick={onClose} role="presentation">
      <div className={`pop ${anchor ? '' : 'centred'}`} style={style} ref={box} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label={label}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
  /*
   * `over`: a reference opened from inside another sheet or a full screen (the
   * exercise sheet, issue #63). It goes to the body, because a fixed box inside
   * a sheet that is still animating is fixed to the SHEET, and above full
   * screens. Server rendering has no body, so the smoke suite gets it inline.
   */
  if (over && typeof document !== 'undefined') return createPortal(pop, document.body)
  return pop
}
