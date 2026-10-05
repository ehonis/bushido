/*
 * Achievements — the tab.
 *
 * Moved here 2026-09-15 from two places at once: the progress card sat on Today
 * and the editor sat in the profile panel, so seeing where something stood and
 * changing it were three taps and a different mental mode apart. Achievements
 * moved out of the profile into their own tab.
 *
 * ONE CARD PER ACHIEVEMENT, and it does both jobs. The weekly bars say what this
 * week asked for and what has filled it; Edit opens the same card in place. That
 * is the whole argument for the move — the thing you look at and the thing you
 * change are one object, and they were being rendered by two files that did not
 * know about each other.
 *
 * NOT Totem's goals. Those have their own tab (see goals.jsx) because they are a
 * genuinely different thing — a week or a quarter with metrics that expire — and
 * the two words a screen apart were the bug that started this rename.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { progress as quotaProgress } from './lib/quota.js'
import { localIso } from './lib/dates.js'
import { profileFacts } from './lib/profile.js'
import {
  achievements, buildEntry, buildTombstone, idFor, blank as blankAchievement,
} from './lib/achievements.js'

/*
 * A short, opinionated icon list rather than all of lucide.
 *
 * Every one is already in the registry (see lib/icons.jsx) and means something in
 * a training app. A free-text field would let them type a name that renders as the
 * fallback dot, which looks like a bug the user caused.
 */
const ACH_ICONS = [
  'Mountain', 'Waves', 'Bike', 'Footprints', 'Dumbbell', 'Hand',
  'Target', 'Flame', 'Timer', 'Route', 'Activity', 'Infinity',
  'Sprout', 'Feather', 'Flag', 'HeartPulse',
]

export function AchievementsTab({ plan, entries, upsertEntry }) {
  const today = localIso()
  const facts = profileFacts(entries)
  const list = useMemo(() => achievements(plan, entries, facts), [plan, entries, facts])
  const week = useMemo(() => quotaProgress({ plan, entries, iso: today }), [plan, entries, today])
  const cats = plan?.quotaCategories || []

  // `null` is closed, an object is the one being edited. A brand new one has a
  // null id, which is what tells `save` to mint one.
  const [editing, setEditing] = useState(null)

  const save = () => {
    const name = String(editing.name || '').trim()
    if (!name) return
    const id = editing.id || idFor(name, list.map(a => a.id))
    upsertEntry(buildEntry({ ...editing, id }))
    setEditing(null)
  }

  const remove = (a) => { upsertEntry(buildTombstone(a.id)); setEditing(null) }

  const field = (k, v) => setEditing(e => ({ ...e, [k]: v }))
  const toggleCat = (key) => setEditing(e => ({
    ...e,
    categories: e.categories.includes(key)
      ? e.categories.filter(c => c !== key)
      : [...e.categories, key],
  }))

  return (
    <>
      {!list.length && !editing && (
        <div className="card">
          <h2>Nothing yet</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            An achievement is a standing thing you are training for — climb a grade, finish
            a race. It groups the quota categories that count toward it, and the Week tab is
            where you say how many of each you want.
          </p>
        </div>
      )}

      {list.map(a => {
        const rows = week.categories.filter(c => a.categories.includes(c.key))
        const planned = rows.reduce((n, c) => n + c.planned, 0)
        const done = rows.reduce((n, c) => n + Math.min(c.done, c.planned), 0)
        return (
          <div className="card" key={a.id}>
            <div className="achrow-head">
              <Icon name={a.icon} size={16} />
              <strong>{a.name}</strong>
              <span className="sub">{planned ? `${done}/${planned} this week` : 'nothing asked for'}</span>
            </div>

            {a.blurb && <p className="sub achblurb">{a.blurb}</p>}

            <div className="achbars">
              {rows.map(c => (
                <span key={c.key} className={`achbar ${c.complete ? 'done' : c.planned ? 'open' : 'none'}`}
                  title={`${c.name}: ${c.done} of ${c.planned || '–'}`}>
                  <span className="achbar-label">{c.name}</span>
                  <span className="achbar-count">{c.planned ? `${c.done}/${c.planned}` : c.done || '–'}</span>
                </span>
              ))}
            </div>

            {/* Claiming no category means no bars, and without this it renders as
                a name and nothing else — which reads as broken rather than as
                unfinished. */}
            {!rows.length && (
              <p className="sub achrow-none">
                No quota categories yet, so nothing counts toward it. Press Edit to pick some.
              </p>
            )}

            <p className="sub achdate">
              {a.date
                ? `Target ${a.date}. The board can start leaning toward it as the weeks run down.`
                : 'No date, so there is no taper and no countdown — the quotas ARE the plan.'}
            </p>

            <div className="achacts">
              <button className="btn" onClick={() => setEditing({ ...a })}>
                <Icon name="NotebookPen" size={14} /> Edit
              </button>
              <button className="btn danger" onClick={() => remove(a)}>
                <Icon name="Trash2" size={14} /> Delete
              </button>
            </div>

            {/* Deleting a seeded one is a different act from deleting one the user typed:
                plan.json still has it, and it comes back if the tombstone is ever
                lost. Saying so beats them discovering it. */}
            {a.seeded && <p className="sub achseed">Came with the app.</p>}
          </div>
        )
      })}

      {!editing && (
        <button className="restbtn" onClick={() => setEditing(blankAchievement())}>
          <Icon name="Plus" size={17} />
          <span>Add an achievement</span>
        </button>
      )}

      {editing && (
        <div className="card acheditor">
          <h2>{editing.id ? `Edit ${editing.name || 'achievement'}` : 'New achievement'}</h2>

          <label className="field">
            Name
            <input value={editing.name} autoFocus placeholder="Climb 5.12a"
              onChange={e => field('name', e.target.value)} />
          </label>

          <label className="field">
            Short name <span className="sub">for filters and charts</span>
            <input value={editing.short} placeholder={editing.name || '12a'}
              onChange={e => field('short', e.target.value)} />
          </label>

          <label className="field">
            Target date <span className="sub">optional</span>
            <input type="date" value={editing.date || ''}
              onChange={e => field('date', e.target.value || null)} />
          </label>

          <div className="field">
            Icon
            <div className="achicons">
              {ACH_ICONS.map(name => (
                <button key={name} type="button"
                  className={`achicon ${editing.icon === name ? 'on' : ''}`}
                  aria-pressed={editing.icon === name} aria-label={name}
                  onClick={() => field('icon', name)}>
                  <Icon name={name} size={17} />
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            Quota categories <span className="sub">what counts toward it</span>
            <div className="achpick">
              {cats.map(c => (
                <button key={c.key} type="button"
                  className={`achcat pick ${editing.categories.includes(c.key) ? 'on' : ''}`}
                  aria-pressed={editing.categories.includes(c.key)}
                  onClick={() => toggleCat(c.key)}>
                  <Icon name={c.icon} size={13} /> {c.name}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            Notes <span className="sub">optional</span>
            <textarea rows={3} value={editing.blurb} placeholder="What it actually takes."
              onChange={e => field('blurb', e.target.value)} />
          </label>

          <div className="achacts">
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="primary" onClick={save} disabled={!String(editing.name || '').trim()}>
              {editing.id ? 'Save' : 'Add it'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>How these work</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          An achievement groups <strong>quota categories</strong> — a category belongs to at
          most one, and anything none of them claims still counts and still shows up. You set
          the weekly counts on the <strong>Week</strong> tab. These are not Totem&rsquo;s
          goals: those are a week or a quarter with metrics that expire, and they have their
          own <strong>Goals</strong> tab.
        </p>
      </div>
    </>
  )
}
