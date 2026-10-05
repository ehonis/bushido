/*
 * A context blurb: explanation you want available but not permanently in the way.
 *
 * Hidden state collapses to a single tappable line rather than vanishing, so you
 * can always find the reasoning again — the point is to get it out of the daily
 * path, not to lose it.
 */

import { Icon } from './lib/icons.jsx'
import { usePrefs } from './lib/prefs.jsx'

export function Blurb({ id, title, children, tone = 'note' }) {
  const { isHidden, toggle } = usePrefs()

  if (isHidden(id)) {
    return (
      <button className="blurb-stub" onClick={() => toggle(id)} aria-expanded="false">
        <Icon name="Info" size={13} />
        <span className="blurb-stub-title">{title}</span>
        <Icon name="ChevronDown" size={15} className="blurb-stub-chev" />
      </button>
    )
  }

  return (
    <div className={`card ${tone} blurb`}>
      <div className="blurb-head">
        <h2>{title}</h2>
        <button className="blurb-x" onClick={() => toggle(id)} aria-label={`Hide "${title}"`} title="Hide this">
          <Icon name="X" size={16} />
        </button>
      </div>
      {children}
    </div>
  )
}

/** Header control: collapse or restore every blurb at once. */
export function BlurbToggle() {
  const { allHidden, setAllHidden } = usePrefs()
  return (
    <button
      className={`ctx-toggle ${allHidden ? 'off' : ''}`}
      onClick={() => setAllHidden(!allHidden)}
      title={allHidden ? 'Show context blurbs' : 'Hide context blurbs'}
      aria-pressed={allHidden}
    >
      <Icon name={allHidden ? 'EyeOff' : 'Eye'} size={15} />
      <span className="ctx-label">{allHidden ? 'context off' : 'context'}</span>
    </button>
  )
}
