/*
 * A context blurb: explanation you want available but not permanently in the way.
 *
 * Hidden state collapses to a single tappable line rather than vanishing, so you
 * can always find the reasoning again — the point is to get it out of the daily
 * path, not to lose it.
 *
 * Progress no longer carries one (issue #43: the charts that apply are the ones
 * on the page, and a paragraph saying so was in the way). The climbing pages
 * still do. The header's "hide every blurb" switch went with it: nothing had
 * rendered it since the header was cut down to the mark and the avatar (#29).
 */

import { Icon } from './lib/icons.jsx'
import { usePrefs } from './lib/prefs.jsx'

export function Blurb({ id, title, children, tone = 'note' }) {
  const { isHidden, toggle } = usePrefs()

  if (isHidden(id)) {
    return (
      <button type="button" className="blurb-stub" onClick={() => toggle(id)} aria-expanded="false">
        <Icon name="Info" size={16} />
        <span className="blurb-stub-title">{title}</span>
        <Icon name="ChevronDown" size={16} className="blurb-stub-chev" />
      </button>
    )
  }

  return (
    <div className={`card ${tone} blurb`}>
      <div className="blurb-head">
        <h2>{title}</h2>
        <button type="button" className="blurb-x" onClick={() => toggle(id)} aria-label={`Hide "${title}"`}>
          <Icon name="X" size={16} />
        </button>
      </div>
      {children}
    </div>
  )
}
