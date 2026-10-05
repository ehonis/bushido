/*
 * Picking what you did, out of ninety-one sports.
 *
 * The screen for `lib/activities.js`, and the sibling of `liftlog.jsx` — same
 * problem, same shape, and deliberately the same feel. The lift chooser already
 * proved that a searchable catalog beats a fixed row of buttons once the list
 * outgrows a phone screen; this is that, for activities.
 *
 * What it replaced was nine buttons: run, bike, walk, hike, lift, swim, sport,
 * mobility, something else. Nine fits on a screen and needs no search, which is
 * why it was right at the time and wrong by 2026-09-14 — "sport" covered
 * pickleball and jiu jitsu and a football match, "something else" covered
 * everything WHOOP actually recorded, and a dance workout could not be logged as
 * a dance workout at all.
 *
 * THREE THINGS IT DOES THAT A PLAIN SEARCH BOX DOES NOT.
 *
 * Their six sports are PINNED. Run, treadmill run, bike, mountain bike, swim and
 * lift are one tap, because they are the overwhelming majority of what the user logs
 * and making them type "bike" every time to save a rarely-needed dance entry
 * would be a worse card than the one being replaced. The catalog declares which
 * (`pinned`), so it is content and not a guess baked into this file.
 *
 * Search opens only when the user asks for it. Tapping a pin is one tap, not two, and
 * the keyboard does not come up over the top of the form on a phone.
 *
 * What the user picked is shown as ITSELF. Once an activity is chosen the picker
 * collapses to that one row — its own name, its own icon — because at that point
 * it has stopped being a question and the fields underneath are the card.
 */

import { useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import {
  activityOf, activityLabel, pinnedActivities, groupedActivities, searchActivities,
} from './lib/activities.js'
import { filledBy } from './lib/outputs.js'

export function ActivityPicker({ field, value, onChange, out = null }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef(null)

  const picked = activityOf(field, value)
  const pins = useMemo(() => pinnedActivities(field), [field])
  const results = useMemo(() => (q.trim() ? searchActivities(field, q) : null), [field, q])
  const groups = useMemo(() => groupedActivities(field), [field])

  const choose = (key) => {
    onChange(key)
    setOpen(false)
    setQ('')
  }

  const startSearch = () => {
    setOpen(true)
    // Focus after paint, or the keyboard opens against an element that is not
    // on screen yet and iOS scrolls the form somewhere unhelpful.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  /*
   * Which service chose this, if one did.
   *
   * The activity is the most consequential thing a WHOOP or Strava attach fills
   * in — it decides what the whole rest of the form asks for, and what quota the
   * workout fills. The same rule the numbers follow applies harder here: a value
   * the user did not give must never look like one the user did.
   */
  const source = out ? filledBy(out, field.key) : null

  /* Picked, and not being changed: one row, and the fields below are the card. */
  if (picked && !open) {
    return (
      <div className="actpick picked">
        <span className="actpick-ico"><Icon name={picked.icon} size={18} /></span>
        <span className="actpick-name">
          <strong>{picked.name}</strong>
          <span className="sub">
            {picked.group}
            {source && <span className="out-from">from {source}</span>}
          </span>
        </span>
        <button className="actpick-change" onClick={startSearch}>Change</button>
      </div>
    )
  }

  /*
   * An activity the catalog has forgotten — renamed, or removed — still reads
   * back as what the user logged rather than as a blank card. Same rule as a logged
   * lift keeping its own name: the catalog is allowed to change, their history is
   * not allowed to change under them.
   */
  if (value && !picked && !open) {
    return (
      <div className="actpick picked unknown">
        <span className="actpick-ico"><Icon name="Sparkles" size={18} /></span>
        <span className="actpick-name">
          <strong>{activityLabel(field, value)}</strong>
          <span className="sub">no longer in the catalog</span>
        </span>
        <button className="actpick-change" onClick={startSearch}>Change</button>
      </div>
    )
  }

  return (
    <div className="actpick">
      <div className="out-label"><span>{field.label}</span></div>

      {!open && (
        <>
          <div className="actpick-pins">
            {pins.map(a => (
              <button key={a.key} className={`actpin ${value === a.key ? 'on' : ''}`}
                onClick={() => choose(a.key)}>
                <Icon name={a.icon} size={17} />
                <span>{a.name}</span>
              </button>
            ))}
          </div>
          <button className="actpick-more" onClick={startSearch}>
            <Icon name="Plus" size={15} />
            <span>Something else — {(field.activities || []).length} to choose from</span>
          </button>
        </>
      )}

      {open && (
        <div className="actpick-search">
          <input
            ref={inputRef} type="search" value={q} placeholder={field.hint || 'Search activities'}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && results?.length) choose(results[0].key)
              if (e.key === 'Escape') { setOpen(false); setQ('') }
            }}
          />

          <div className="actpick-list">
            {results
              ? (results.length
                  ? results.map(a => (
                      <button key={a.key} className="actrow" onClick={() => choose(a.key)}>
                        <Icon name={a.icon} size={16} />
                        <span className="actrow-name">{a.name}</span>
                        <span className="actrow-group">{a.group}</span>
                      </button>
                    ))
                  : (
                    <p className="sub actpick-none">
                      Nothing matches “{q}”. Log it as <strong>Something else</strong> and it still
                      counts — or add it to the catalog in <code>plan.json</code>, which needs no rebuild.
                    </p>
                  ))
              : groups.map(g => (
                  <div key={g.name} className="actgroup">
                    <h4>{g.name}</h4>
                    {g.items.map(a => (
                      <button key={a.key} className="actrow" onClick={() => choose(a.key)}>
                        <Icon name={a.icon} size={16} />
                        <span className="actrow-name">{a.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
          </div>

          {value && (
            <button className="actpick-cancel" onClick={() => { setOpen(false); setQ('') }}>
              Keep {activityLabel(field, value)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
