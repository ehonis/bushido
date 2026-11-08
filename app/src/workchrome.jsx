/* The chrome every workout screen wears (#98: out of timer.jsx, so the runner
 * and workout mode do not load the interval timer to draw their header). */

import { Icon } from './lib/icons.jsx'

/*
 * Every screen a workout is done on (the runner, its rest and timed sets,
 * workout mode, this timer and a circuit) wears the same three things, so a
 * thumb learns them once:
 *
 *   - ONE HEADER (`WorkHead`): the exit at the top left, always an X, as far
 *     from the thumb as the screen allows; the name and where you are; the
 *     sound. It was a chevron down, a chevron left and an X on the right.
 *   - ONE LEAVE DIALOG (`LeaveDialog`): Keep going is the primary, because the
 *     tap that opened it is more often a mis-tap than a decision. What ends the
 *     workout sits under it, and is the primary only when nothing is left to do.
 *   - ONE CONTROL ROW (`ControlRow`), at the bottom: Back · −10 · Pause · +10 ·
 *     Skip, in that order on every clock. A control a clock has no use for is
 *     shown disabled rather than removed, so nothing slides under the thumb.
 */
export function WorkHead({ title, sub = null, who = null, muted = false, onMute, onExit, exitLabel = 'Leave the workout' }) {
  return (
    <header className="wk-head">
      <button className="iconbtn wk-exit" onClick={onExit} aria-label={exitLabel}>
        <Icon name="X" size={20} />
      </button>
      <div className="wk-title">
        <div className="wk-name">
          {who && <span className="side-who" data-tone={who.tone}>{who.name}</span>}
          {title}
        </div>
        {sub != null && <div className="wk-sub">{sub}</div>}
      </div>
      <button className="iconbtn" onClick={() => onMute(!muted)} aria-pressed={muted}
        aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>
        <Icon name={muted ? 'VolumeX' : 'Volume2'} size={20} />
      </button>
    </header>
  )
}

/**
 * The leave dialog: one column of full-width buttons, the same on every
 * screen. `actions` are `{ label, kind, onClick }`, kind primary | secondary |
 * quiet | bad. Keep going is the primary unless an action is (Finish workout,
 * once every set is marked); a primary action goes above it, the rest below.
 */
export function LeaveDialog({ title, body = null, actions = [], onKeep, keepLabel = 'Keep going' }) {
  const cls = { secondary: 'secondary', quiet: 'quiet', destructive: 'destructive' }
  const first = actions.filter(a => a.kind === 'primary')
  const rest = actions.filter(a => a.kind !== 'primary')
  return (
    <div className="wk-scrim">
      <div className="wk-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {body && <p className="sub">{body}</p>}
        <div className="wk-acts">
          {first.map(a => <button key={a.label} className="btn" onClick={a.onClick}>{a.label}</button>)}
          <button className={`btn ${first.length ? 'secondary' : ''}`} onClick={onKeep}>{keepLabel}</button>
          {rest.map(a => <button key={a.label} className={`btn ${cls[a.kind] || 'secondary'}`} onClick={a.onClick}>{a.label}</button>)}
        </div>
      </div>
    </div>
  )
}

/**
 * What leaving a planned workout offers. With sets still to do, finishing is a
 * quiet "Finish with N sets left" that asks again (`onAskFinish`); with none
 * left, Finish workout is the primary.
 */
export function leaveActions({ left = 0, onLeave, onFinish, onAskFinish }) {
  return [
    ...(left === 0 ? [{ label: 'Finish workout', kind: 'primary', onClick: onFinish }] : []),
    { label: 'Leave it open', kind: 'secondary', onClick: onLeave },
    ...(left > 0 ? [{ label: `Finish with ${setsWord(left)} left`, kind: 'quiet', onClick: onAskFinish }] : []),
  ]
}

export const setsWord = (n) => `${n} ${n === 1 ? 'set' : 'sets'}`

/** Back · −10 · Pause · +10 · Skip. A missing handler is a disabled button in its place. */
export function ControlRow({ paused = false, onBack = null, onLess = null, onPause = null, onMore = null, onSkip = null, skipLabel = 'Skip', className = '' }) {
  return (
    <div className={`it-ctl wk-ctl ${className}`}>
      <button className="it-btn" onClick={onBack || undefined} disabled={!onBack} aria-label="Back">
        <Icon name="SkipBack" size={18} /><span>Back</span>
      </button>
      <button className="it-btn" onClick={onLess || undefined} disabled={!onLess} aria-label="10 seconds less">
        <Icon name="Minus" size={16} /><span>10s</span>
      </button>
      <button className="it-btn on" onClick={onPause || undefined} disabled={!onPause} aria-label={paused ? 'Resume' : 'Pause'}>
        <Icon name={paused ? 'Play' : 'Pause'} size={20} /><span>{paused ? 'Resume' : 'Pause'}</span>
      </button>
      <button className="it-btn" onClick={onMore || undefined} disabled={!onMore} aria-label="10 seconds more">
        <Icon name="Plus" size={16} /><span>10s</span>
      </button>
      <button className="it-btn" onClick={onSkip || undefined} disabled={!onSkip} aria-label={skipLabel}>
        <Icon name="SkipForward" size={18} /><span>Skip</span>
      </button>
    </div>
  )
}
