/*
 * Which gear a workout was done on.
 *
 * Strava's model: gear has a
 * default per kind, a logged ride picks it up with no taps, and the tap is only
 * for the day you rode the other bike. The rules — which kinds a workout can use,
 * and what defaults — are `lib/gear.js`; this is the control.
 *
 * It renders NOTHING when the workout's discipline uses no gear. A dance class,
 * a swim before the user owns any swim gear, a rest day: no row, no empty select, no
 * "None" to dismiss. An input that can only ever be answered one way is not a
 * question, and on a form this long every row has to earn itself.
 */

import { useEffect, useMemo } from 'react'
import { Icon } from './lib/icons.jsx'
import { useStrava } from './lib/strava.jsx'
import { gearChoicesFor, defaultGearFor, gearOn, kindOf } from './lib/gear.js'
import { usePlan } from './lib/planctx.jsx'

export function GearPicker({ session, out, entries = [], onChange }) {
  const plan = usePlan()
  const { cache: strava } = useStrava()

  const choices = useMemo(
    () => (plan ? gearChoicesFor({ plan, entries, strava, opt: session, out }) : []),
    [plan, entries, strava, session, out])

  const picked = gearOn({ data: { out } })

  /*
   * Default it in, once, and only while nothing has been chosen.
   *
   * `out.gear` being absent is "nobody has decided"; an empty array is "the user took
   * the default off", which must stick. Without that distinction the picker would
   * helpfully put the bike back every time the form re-rendered.
   */
  useEffect(() => {
    if (!plan || out?.gear !== undefined || !choices.length) return
    const def = defaultGearFor({ plan, entries, strava, opt: session, out })
    if (def.length) onChange(def)
  }, [plan, choices.length, out?.gear, session?.id])

  if (!choices.length) return null

  const toggle = (id) => {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]
    onChange(next)
  }

  return (
    <div className="out-field out-gear">
      <div className="out-label">
        <span>On what</span>
        {picked.length === 0 && <span className="out-value">optional</span>}
      </div>
      <div className="gearpick">
        {choices.map(g => (
          <button key={g.id} type="button"
            className={`gearchip ${picked.includes(g.id) ? 'on' : ''}`}
            onClick={() => toggle(g.id)}>
            <Icon name={kindOf(plan, g.kind)?.icon || 'ShoppingBag'} size={15} />
            <span>{g.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
