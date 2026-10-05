/*
 * Per-set logging.
 *
 * Sets arrive pre-filled from the prescription, so a session you did exactly as
 * written is zero typing — you just confirm. Everything is editable and sets can
 * be added or removed, because the interesting sessions are the ones where you
 * did four instead of three, or the last set fell apart at rep 7.
 *
 * Load is stored SIGNED: positive is weight added, negative is counterweight
 * removed. On a 20mm edge most repeater work is negative, so the sign is a
 * per-exercise toggle rather than something you type.
 */

import { Fragment } from 'react'
import { Icon } from './lib/icons.jsx'
import {
  GRADES, GRADE_FIELD, gradeLabel, hardestGrade, gradesIn, hasGrades, fitGrades, repCount,
  VGRADES, vLabel, CLIMB_FIELD, offersClimbs, climbsOn, blankClimb, fitClimbs, fallsIn,
  stepClimbs, FELT_MIN, FELT_MAX, feltLabel, DOWN_OPTIONS, downsIn, lengthsIn,
} from './lib/grades.js'

const FIELD_META = {
  reps: { label: 'reps', width: 58, step: 1 },
  seconds: { label: 'secs', width: 58, step: 1 },
  weight: { label: 'lb', width: 68, step: 0.5 },
  // Crimp crawls have no load cell and no counterweight — how high the feet are
  // IS the intensity dial, so the stair number is logged per set like a weight.
  stair: { label: 'stair', width: 58, step: 1 },
  // The one field that is a LIST rather than a number: a doubled lead lap is two
  // laps in one set and they are not always the same route, so the grade belongs
  // to the rep. The list mechanics live in lib/grades.js.
  grades: { label: 'grade', kind: 'grades' },
}

/** An unrecognised field renders as a plain number rather than crashing the log. */
const meta = (f) => FIELD_META[f] || { label: f, width: 62, step: 1 }

/* The per-rep grade list — its shape, and the rules that keep it the same length
 * as the rep count — is pure and lives in lib/grades.js, so it is tested as
 * arithmetic rather than through a rendered table. */

/** Build the default set rows for one exercise straight from the prescription. */
export function seedSets(exercise) {
  const { defaultSets, defaults = {}, fields } = exercise
  const row = {}
  for (const f of fields) row[f] = defaults[f] ?? ''
  // Fresh array per row — a shared reference would make every set of doubles
  // show the grade the user picked for the first one.
  return Array.from({ length: defaultSets }, () => cloneRow(row, fields, row.reps))
}

/** A row copy whose per-rep lists are their own arrays and the right length. */
function cloneRow(row, fields, reps) {
  const next = { ...row }
  if (hasGrades(fields)) next[GRADE_FIELD] = fitGrades(next[GRADE_FIELD], reps)
  // A copied set keeps the detail SWITCHED ON but not its answers — the grades
  // of the last ten problems say nothing about the next ten.
  if (Array.isArray(next[CLIMB_FIELD])) next[CLIMB_FIELD] = fitClimbs([], reps)
  return next
}

/**
 * One value off a fixed ladder.
 *
 * A native select rather than chips: sixteen rungs is four rows of chips per
 * lap, and the OS picker is the better target for one thumb with chalk on it.
 * Shared with the session-level grade field, workout mode's review screen and
 * the per-climb detail, so a grade is entered the same way wherever it is.
 */
function LadderSelect({ ladder, fmt, value, onChange, label }) {
  const n = Number(value)
  const has = value !== '' && value !== null && value !== undefined && Number.isFinite(n)
  const known = has && ladder.some(g => g.value === n)
  return (
    <select
      className="gradesel" aria-label={label}
      value={has ? String(n) : ''}
      onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    >
      <option value="">—</option>
      {/* An off-ladder value keeps its own option, so opening the picker on an
          old hand-written grade cannot silently overwrite it. */}
      {has && !known && <option value={String(n)}>{fmt(n)}</option>}
      {ladder.map(g => <option key={g.value} value={String(g.value)}>{g.label}</option>)}
    </select>
  )
}

/** The route ladder — 5.7 to 5.12. */
export function GradeSelect({ value, onChange, label }) {
  return <LadderSelect ladder={GRADES} fmt={gradeLabel} value={value} onChange={onChange} label={label} />
}

/**
 * The grade pickers for one set — one per rep, labelled by rep number.
 *
 * `what` is what a rep of this exercise is CALLED, from the exercise's own
 * `repName`: a rep of a double is a lap, and "rep 2" over a picker on a session
 * whose whole protocol says "lap" is the app using its own vocabulary instead of
 * the plan's.
 */
export function GradeLaps({ count, values, onChange, what = 'rep', where = '' }) {
  const list = Array.isArray(values) ? values : []
  const at = (i, v) => onChange(Array.from({ length: count }, (_, k) => (k === i ? v : list[k] ?? '')))
  return (
    <div className="gradelaps">
      {Array.from({ length: count }, (_, i) => (
        <label key={i} className="gradelap">
          <span className="gradelap-n">{what} {i + 1}</span>
          <GradeSelect value={list[i]} onChange={v => at(i, v)}
            label={`${where}${what} ${i + 1} grade`} />
        </label>
      ))}
    </div>
  )
}

/**
 * The optional per-climb detail — one record per rep: grade, style, whether the user
 * fell, and how honest the grade felt.
 *
 * `spec` is the exercise's `climbLog` from the plan: `scale` picks the ladder
 * ('v' for boulders, the route ladder otherwise) and `styles` is the vocabulary
 * for what kind of climbing it was — content, so the list can grow with no
 * rebuild. The felt slider only appears once a climb HAS a grade, because "hard
 * for the grade" is not a question until there is a grade, and it stays
 * unanswered until touched — tapping the track is the answer, including a tap
 * dead centre for "spot on".
 */
/*
 * `omitGrade` is for the exercises that ALREADY log a grade per rep — the
 * doubled lead laps have carried one since before this detail existed. Two grade
 * pickers per lap is not a choice, it is a bug waiting to disagree with itself,
 * so where the ladder is already on screen this renders only what it adds:
 * what kind of climbing it was, and whether the user fell. "How honest was the grade"
 * goes with the grade, so it goes too.
 */
export function ClimbLog({ count, values, spec, onChange, onMore, what = 'climb', where = '', omitGrade = false }) {
  const list = Array.isArray(values) ? values : []
  const climbAt = (i) => (list[i] && typeof list[i] === 'object' ? { ...blankClimb(), ...list[i] } : blankClimb())
  const at = (i, patch) =>
    onChange(Array.from({ length: count }, (_, k) => (k === i ? { ...climbAt(k), ...patch } : climbAt(k))))
  const ladder = spec?.scale === 'v' ? VGRADES : GRADES
  const fmt = spec?.scale === 'v' ? vLabel : gradeLabel

  return (
    <div className="climblog">
      {Array.from({ length: count }, (_, i) => {
        const c = climbAt(i)
        const felt = c.felt === '' || c.felt == null ? null : Number(c.felt)
        const hasGrade = !omitGrade && c.grade !== '' && c.grade != null
        const pct = (((felt ?? 0) - FELT_MIN) / (FELT_MAX - FELT_MIN)) * 100
        return (
          <div key={i} className="climb">
            <div className="climb-row">
              <span className="gradelap-n">{what} {i + 1}</span>
              {!omitGrade && (
                <LadderSelect ladder={ladder} fmt={fmt} value={c.grade}
                  label={`${where}${what} ${i + 1} grade`}
                  onChange={v => at(i, { grade: v })} />
              )}
              {(spec?.styles?.length ?? 0) > 0 && (
                <select className="climb-style" aria-label={`${where}${what} ${i + 1} style`}
                  value={c.style || ''} onChange={e => at(i, { style: e.target.value })}>
                  <option value="">style —</option>
                  {spec.styles.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              {/* Only where the plan says down-climbing is a thing on this card —
                  you down-climb a route, not a twelve-move boulder problem. */}
              {spec?.downClimb && (
                <select className="climb-style climb-down" aria-label={`${where}${what} ${i + 1} up or down`}
                  value={c.down || ''} onChange={e => at(i, { down: e.target.value })}>
                  {DOWN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              <button type="button" className={`out-chip climb-fell ${c.fell ? 'on' : ''}`}
                aria-pressed={Boolean(c.fell)} onClick={() => at(i, { fell: !c.fell })}>
                <Icon name={c.fell ? 'CircleSlash' : 'Circle'} size={13} /> fell
              </button>
            </div>
            {hasGrade && (
              <div className="climb-felt">
                {/* onClick as well as onChange: a tap that lands where the thumb
                    already sits fires no change event, and dead centre — "spot
                    on" — is exactly where an untouched slider sits. */}
                <input type="range" className="slider" min={FELT_MIN} max={FELT_MAX} step={1}
                  value={felt ?? 0} style={{ '--pct': `${pct}%` }}
                  aria-label={`${where}${what} ${i + 1} felt for the grade`}
                  onChange={e => at(i, { felt: Number(e.target.value) })}
                  onClick={e => at(i, { felt: Number(e.target.value) })} />
                <span className="climb-feltword">
                  {felt == null ? 'for the grade: —' : feltLabel(felt)}
                </span>
              </div>
            )}
          </div>
        )
      })}
      {/* The next climb is added from HERE, because this is being filled in
          one climb at a time mid-session and the bottom of the list is where
          the thumb already is. Same step as the reps stepper above. */}
      {onMore && (
        <button type="button" className="exlog-add" onClick={onMore}>
          + one more {what}
        </button>
      )}
    </div>
  )
}

function Exercise({ exercise, rows, sign, onRows, onSign }) {
  const fields = exercise.fields || []
  const perRep = hasGrades(fields)
  const what = exercise.repName || 'rep'
  // The plan says this exercise CAN log per-climb detail; the rows say whether
  // this entry IS. Presence of the list is the state — see lib/grades.js.
  const offers = offersClimbs(exercise)
  const detailed = climbsOn(rows)

  const set = (i, field, value) => {
    const next = rows.map((r, j) => {
      if (j !== i) return r
      const row = { ...r, [field]: value === '' ? '' : Number(value) }
      // The pickers follow the rep count, live — change 2 laps to 3 and a third
      // grade appears rather than the row quietly logging two.
      if (perRep && field === 'reps') row[GRADE_FIELD] = fitGrades(row[GRADE_FIELD], row.reps)
      if (Array.isArray(row[CLIMB_FIELD]) && field === 'reps') row[CLIMB_FIELD] = fitClimbs(row[CLIMB_FIELD], row.reps)
      return row
    })
    onRows(next)
  }

  const setDetail = (on) => onRows(rows.map(r => {
    // Reps is normalised to the row count on the way in, because from here the
    // list is the source of truth and the box only displays it — a blank or
    // silly count would otherwise disagree with the rows on screen.
    if (on) return { ...r, reps: repCount(r.reps), [CLIMB_FIELD]: fitClimbs(r[CLIMB_FIELD], r.reps) }
    const { [CLIMB_FIELD]: dropped, ...rest } = r
    return rest
  }))

  // The only way the count moves while the detail is on. One at a time and
  // always at the end, so nothing filled in can vanish that was not on screen.
  const bump = (i, delta) => onRows(rows.map((r, j) => (j === i ? stepClimbs(r, delta) : r)))
  const setList = (i, field, list) =>
    onRows(rows.map((r, j) => (j === i ? { ...r, [field]: list } : r)))
  const addSet = () => onRows([...rows, cloneRow(rows.at(-1) || {}, fields, rows.at(-1)?.reps)])
  const dropSet = (i) => onRows(rows.filter((_, j) => j !== i))

  const hasWeight = fields.includes('weight')
  const total = rows.reduce((s, r) => s + (Number(r.reps) || 0), 0)
  const falls = detailed ? fallsIn(rows) : 0
  // Lengths of wall, which is the whole point of recording a down-climb: a lap
  // climbed and reversed is two of them. Shown only when it differs from the rep
  // count, so a session with no down-climbing in it reads exactly as it did.
  const downs = detailed ? downsIn(rows) : 0
  const lengths = detailed ? lengthsIn(rows) : 0

  return (
    <div className="exlog">
      <div className="exlog-head">
        <span className="exlog-name">{exercise.name}</span>
        {/* The per-climb option. A toggle rather than always-on: ten selects you
            scroll past is how a twenty-second form stops being filled in. */}
        {offers && (
          <button className={`signtog ${detailed ? 'on' : ''}`} aria-pressed={detailed}
            onClick={() => setDetail(!detailed)}>
            {detailed ? `logging each ${what}` : `log each ${what}`}
          </button>
        )}
        {hasWeight && (
          <button className={`signtog ${sign === '-' ? 'neg' : ''}`} onClick={() => onSign(sign === '-' ? '+' : '-')}>
            {sign === '-' ? '− counterweight' : '+ added'}
          </button>
        )}
      </div>

      <table className={`exlog-table ${perRep || detailed ? 'perrep' : ''}`}>
        <thead>
          <tr>
            <th className="c-set">set</th>
            {fields.filter(f => meta(f).kind !== 'grades').map(f => <th key={f}>{meta(f).label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={i}>
              <tr>
                <td className="c-set">{i + 1}</td>
                {fields.filter(f => meta(f).kind !== 'grades').map(f => (
                  <td key={f}>
                    {/* While the detail is on, the climb list IS the count: the
                        box only displays it and the steppers move it one at a
                        time. Typing was the bug — "12" over a 10 passes through
                        "1", and each keystroke refit the list, deleting climbs
                        the user had already filled in. */}
                    {f === 'reps' && Array.isArray(r[CLIMB_FIELD]) ? (
                      <span className="repstep">
                        <button type="button" className="repstep-b" onClick={() => bump(i, -1)}
                          aria-label={`set ${i + 1}: one fewer ${what}`}>−</button>
                        <input
                          type="number" inputMode="decimal" readOnly value={repCount(r.reps)}
                          style={{ width: 44 }} aria-label={`set ${i + 1} ${meta(f).label}`}
                        />
                        <button type="button" className="repstep-b" onClick={() => bump(i, 1)}
                          aria-label={`set ${i + 1}: one more ${what}`}>+</button>
                      </span>
                    ) : (
                      <input
                        type="number" inputMode="decimal" step={meta(f).step}
                        value={r[f] ?? ''} onChange={e => set(i, f, e.target.value)}
                        style={{ width: meta(f).width }}
                        aria-label={`set ${i + 1} ${meta(f).label}`}
                      />
                    )}
                  </td>
                ))}
                <td>
                  <button className="exlog-x" onClick={() => dropSet(i)} aria-label={`Remove set ${i + 1}`}>
                    <Icon name="X" size={14} />
                  </button>
                </td>
              </tr>
              {/* The per-rep grades get their own line under the row: on a phone
                  a third column of selects pushes the reps cell off the screen. */}
              {perRep && (
                <tr>
                  <td />
                  {/* Every visible column plus the remove button — the grade
                      field takes a slot in `fields` but not a column. */}
                  <td colSpan={fields.filter(f => meta(f).kind !== 'grades').length + 1}>
                    <GradeLaps count={repCount(r.reps)} values={r[GRADE_FIELD]}
                      what={what} where={`set ${i + 1} `}
                      onChange={list => setList(i, GRADE_FIELD, list)} />
                  </td>
                </tr>
              )}
              {/* The optional per-climb detail, same full-width slot. */}
              {Array.isArray(r[CLIMB_FIELD]) && (
                <tr>
                  <td />
                  <td colSpan={fields.filter(f => meta(f).kind !== 'grades').length + 1}>
                    <ClimbLog count={repCount(r.reps)} values={r[CLIMB_FIELD]}
                      spec={exercise.climbLog} what={what} omitGrade={perRep}
                      where={rows.length > 1 ? `set ${i + 1} ` : ''}
                      onChange={list => setList(i, CLIMB_FIELD, list)}
                      onMore={repCount(r.reps) < 20 ? () => bump(i, 1) : undefined} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="exlog-foot">
        <button className="exlog-add" onClick={addSet}>+ add set</button>
        <span className="exlog-total">
          {rows.length} set{rows.length === 1 ? '' : 's'}{total ? ` · ${total} reps` : ''}
          {downs > 0 ? ` · ${downs} down-climbed` : ''}
          {lengths > total ? ` · ${lengths} lengths` : ''}
          {falls > 0 ? ` · fell on ${falls}` : ''}
        </span>
      </div>
    </div>
  )
}

export function SetLog({ session, out, onSave }) {
  const spec = session?.logSpec
  if (!spec?.exercises?.length) return null

  const stored = out.sets || {}
  const signs = out.signs || {}

  const rowsFor = (ex) => stored[ex.key] ?? seedSets(ex)
  const signFor = (ex) => signs[ex.key] ?? ex.defaults?.sign ?? '+'

  const setRows = (ex, rows) => onSave({ ...out, sets: { ...stored, [ex.key]: rows } })
  const setSign = (ex, sign) => onSave({ ...out, signs: { ...signs, [ex.key]: sign } })

  return (
    <div className="setlog">
      {spec.exercises.map(ex => (
        <Exercise
          key={ex.key}
          exercise={ex}
          rows={rowsFor(ex)}
          sign={signFor(ex)}
          onRows={rows => setRows(ex, rows)}
          onSign={s => setSign(ex, s)}
        />
      ))}
      <p className="setlog-note">
        Pre-filled from the plan — change anything that didn't match, add a set if you did more,
        remove one if you stopped early. Load is per set, so a drop-off shows up; where a grade is
        asked for it is per rep, so a set of two laps on two different routes reads as two.
        {spec.exercises.some(offersClimbs) && (
          ' Entirely optional: "log each climb" opens a line per climb — style, whether you fell, and (where the grade is not already asked per rep) its grade and how honest that felt.'
        )}
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- derived --- */

/** Signed load for a row, honouring the exercise's +/− toggle. */
export function signedLoad(row, sign) {
  const w = Number(row?.weight)
  if (!Number.isFinite(w)) return null
  return sign === '-' ? -Math.abs(w) : Math.abs(w)
}

/** Total completed reps across every exercise in a logged session. */
export function totalReps(out) {
  return Object.values(out?.sets || {})
    .flat()
    .reduce((s, r) => s + (Number(r?.reps) || 0), 0)
}

/**
 * Lengths of wall climbed across every exercise — a lap climbed AND down-climbed
 * is two of them, everything else is one.
 *
 * Equal to `totalReps` until something is marked as down-climbed, which is what
 * makes it safe to plot: a series that switches to this measure does not step the
 * day the user starts recording down-climbs, and every entry logged before the field
 * existed reads exactly as its rep count.
 */
export function totalLengths(out) {
  return Object.values(out?.sets || {}).reduce((s, rows) => s + lengthsIn(rows), 0)
}

/** Total sets across every exercise. */
export function totalSets(out) {
  return Object.values(out?.sets || {}).reduce((s, rows) => s + rows.length, 0)
}

/** Every per-rep grade logged for one exercise, in the order they were climbed. */
export function gradesFor(out, key) {
  return gradesIn(out?.sets?.[key])
}

/** The hardest rung logged for one exercise, or null if none was. */
export function topGrade(out, key) {
  return hardestGrade(gradesFor(out, key))
}

/** Heaviest signed load recorded for one exercise. */
export function topLoad(out, key) {
  const rows = out?.sets?.[key] || []
  const sign = out?.signs?.[key] ?? '+'
  const vals = rows.map(r => signedLoad(r, sign)).filter(v => v != null)
  return vals.length ? Math.max(...vals) : null
}
