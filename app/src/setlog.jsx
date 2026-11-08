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

import { Fragment, useRef, useState, useSyncExternalStore } from 'react'
import { Undo2 } from 'lucide-react'
import { Icon } from './lib/icons.jsx'
import { NumInput } from './numinput.jsx'
import { pushToast } from './lib/toast.js'
import {
  GRADE_FIELD, hardestGrade, gradesIn, hasGrades, fitGrades, repCount,
  VGRADES, CLIMB_FIELD, offersClimbs, climbsOn, blankClimb, fitClimbs, fallsIn, climbsIn,
  stepClimbs, FELT_MIN, FELT_MAX, feltLabel, DOWN_OPTIONS, downLabel, downsIn, lengthsIn,
  routeLadder, routeSystem, setRouteSystem, ROUTE_SYSTEMS, labelOn, scaleOfExercise,
  climbCount, detailOn, dropClimb, putClimb, climbSaid, saidIn, isClean,
  outcomesFor, outcomeOf, outcomeLabel, withOutcome, MAX_CLIMBS,
} from './lib/grades.js'

const FIELD_META = {
  reps: { label: 'reps', width: 58 },
  seconds: { label: 'secs', width: 58 },
  weight: { label: 'lb', width: 68 },
  // Crimp crawls have no load cell and no counterweight — how high the feet are
  // IS the intensity dial, so the stair number is logged per set like a weight.
  stair: { label: 'stair', width: 58 },
  // The one field that is a LIST rather than a number: a doubled lead lap is two
  // laps in one set and they are not always the same route, so the grade belongs
  // to the rep. The list mechanics live in lib/grades.js.
  grades: { label: 'grade', kind: 'grades' },
}

/** An unrecognised field renders as a plain number rather than crashing the log. */
const meta = (f) => FIELD_META[f] || { label: f, width: 62 }

/** "route" → "routes"; the plan's own word for one climb, counted. */
export const plural = (word, n = 2) => (n === 1 ? word : /(s|sh|ch|x)$/.test(word) ? `${word}es` : `${word}s`)
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w)

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

/* ------------------------------------------------- how route grades are written */

/*
 * Letters (5.10a) or plus/minus (5.10+): the climber's choice, kept on the device
 * (lib/grades.js `routeSystem`). A tiny store so every route picker on screen
 * follows the switch at once, not only the one beside it.
 */
const sysListeners = new Set()
const subscribeSystem = (fn) => { sysListeners.add(fn); return () => sysListeners.delete(fn) }
export function useRouteSystem() {
  const system = useSyncExternalStore(subscribeSystem, routeSystem, () => 'pm')
  const set = (next) => { setRouteSystem(next); for (const fn of sysListeners) fn() }
  return [system, set]
}

/** The explicit scale choice, beside the route pickers it changes. Two 44px segments. */
export function GradeSystemSwitch() {
  const [system, setSystem] = useRouteSystem()
  return (
    <div className="seg tap gradesys" role="group" aria-label="How route grades are written">
      {ROUTE_SYSTEMS.map(s => (
        <button key={s.key} type="button" className={system === s.key ? 'on' : ''}
          aria-pressed={system === s.key} title={s.name} onClick={() => setSystem(s.key)}>{s.label}</button>
      ))}
    </div>
  )
}

/**
 * One value off a fixed ladder.
 *
 * A native select rather than chips: thirty rungs is several rows of chips per
 * climb, and the OS picker is the better target for one thumb with chalk on it.
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
      {/* A value off this ladder (an old hand-written grade, or one written the
          other way, 5.10a under plus/minus) keeps its own option, so opening the
          picker cannot silently overwrite it. */}
      {has && !known && <option value={String(n)}>{fmt(n)}</option>}
      {ladder.map(g => <option key={g.value} value={String(g.value)}>{g.label}</option>)}
    </select>
  )
}

/** The rungs a scale offers on this device: V0–V17, or the routes written its way. */
const ladderFor = (scale, system) => (scale === 'v' ? VGRADES : routeLadder(system))

/** The route ladder, written the way this device writes it (5.5 to 5.15). */
export function GradeSelect({ value, onChange, label }) {
  const [system] = useRouteSystem()
  return <LadderSelect ladder={routeLadder(system)} fmt={v => labelOn('yds', v)} value={value} onChange={onChange} label={label} />
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

/** What a described climb says, in one line: "Sent · vert · up + down · a touch stiff". */
export function climbWords(c) {
  const felt = c.felt === '' || c.felt == null ? null : Number(c.felt)
  const tries = Number(c.tries)
  return [
    outcomeLabel(outcomeOf(c)),
    c.style || '',
    downLabel(c.down),
    felt == null ? '' : feltLabel(felt),
    Number.isFinite(tries) && tries > 1 ? `${tries} tries` : '',
  ].filter(Boolean).join(' · ')
}

/**
 * The per-climb log (D12, issue #81): one record per climb.
 *
 * Climbs already described are one readable row each ("problem 3 · V4 · Sent ·
 * roof"); a tap opens one again. The CURRENT climb is the only one with controls:
 * its grade, how it went (Onsight on routes, Flash, Sent, Fell), and behind
 * Details the optional rest (style, up or down where the plan offers it, how
 * honest the grade felt once there is one, tries, Remove). The next climb is
 * added from directly under it, because this is filled in one climb at a time
 * mid-session. Climbs nobody has described yet, after the current one, are one
 * quiet line, so a 25-problem evening is not 25 rows of pickers.
 *
 * `spec` is the exercise's `climbLog` from the plan: `scale` picks the ladder
 * ('v' for boulders) and `styles` is the vocabulary. `omitGrade` is for the
 * doubled lead laps, which already ask a grade per lap (GradeLaps): two grade
 * pickers per lap would be two answers to one question, so there this renders
 * only what it adds. `onDrop(i)` is passed where a climb can be taken out (the
 * set log, which offers Undo); workout mode's review screen moves the count with
 * its own stepper.
 */
export function ClimbLog({ count, values, spec, onChange, onMore, onDrop, what = 'climb', where = '', omitGrade = false, initialCurrent = null }) {
  const [system] = useRouteSystem()
  const scale = spec?.scale === 'v' ? 'v' : 'yds'
  const ladder = ladderFor(scale, system)
  const fmt = (v) => labelOn(scale, v)
  const list = Array.isArray(values) ? values : []
  const climbs = Array.from({ length: count }, (_, i) =>
    (list[i] && typeof list[i] === 'object' ? { ...blankClimb(), ...list[i] } : blankClimb()))
  // Which climb has the controls. Pinned once touched: the first undescribed
  // climb is only the default, or picking a grade would move the editor away
  // before the outcome was tapped.
  const [picked, setPicked] = useState(initialCurrent)
  const current = picked != null && picked < count ? picked : climbs.findIndex(c => !climbSaid(c))
  const write = (i, rec) => { setPicked(i); onChange(climbs.map((c, k) => (k === i ? rec : c))) }
  const at = (i, patch) => write(i, { ...climbs[i], ...patch })

  const nextBlank = current >= 0 ? climbs.findIndex((c, k) => k > current && !climbSaid(c)) : -1
  const untold = current >= 0 ? climbs.filter((c, k) => k > current && !climbSaid(c)).length : 0
  const next = nextBlank >= 0
    ? { label: `Next ${what}`, go: () => setPicked(nextBlank) }
    : onMore ? { label: `Add ${what}`, go: () => { setPicked(count); onMore() } } : null
  const nextButton = next && (
    <button type="button" className="btn secondary climb-next" onClick={next.go}>
      <Icon name="Plus" size={18} /> {next.label}
    </button>
  )

  const editor = (i) => {
    const c = climbs[i]
    const tag = `${where}${what} ${i + 1}`
    const felt = c.felt === '' || c.felt == null ? null : Number(c.felt)
    const hasGrade = !omitGrade && c.grade !== '' && c.grade != null
    const pct = (((felt ?? 0) - FELT_MIN) / (FELT_MAX - FELT_MIN)) * 100
    const prev = omitGrade ? null
      : climbs.slice(0, i).reverse().find(p => p.grade !== '' && p.grade != null)?.grade ?? null
    const said = outcomeOf(c)
    const tries = Number(c.tries)
    const hasTries = Number.isFinite(tries) && tries >= 1
    return (
      <div className="climb-edit">
        <div className="climb-row">
          <span className="gradelap-n">{what} {i + 1}</span>
          {!omitGrade && (
            <LadderSelect ladder={ladder} fmt={fmt} value={c.grade} label={`${tag} grade`}
              onChange={v => at(i, { grade: v })} />
          )}
          {/* The fast path: most of an evening is the same grade again. */}
          {!hasGrade && !omitGrade && prev != null && (
            <button type="button" className="out-chip climb-same" onClick={() => at(i, { grade: prev })}>
              Same as last: {fmt(prev)}
            </button>
          )}
        </div>
        <div className="climb-outcomes" role="group" aria-label={`${tag}: how it went`}>
          {outcomesFor(scale).map(o => (
            <button key={o.value} type="button" className={`out-chip ${said === o.value ? 'on' : ''}`}
              aria-pressed={said === o.value}
              onClick={() => write(i, withOutcome(c, said === o.value ? null : o.value))}>
              {o.label}
            </button>
          ))}
        </div>
        <details className="climb-more">
          <summary>Details</summary>
          <div className="climb-row">
            {(spec?.styles?.length ?? 0) > 0 && (
              <select className="climb-style" aria-label={`${tag} style`}
                value={c.style || ''} onChange={e => at(i, { style: e.target.value })}>
                <option value="">style —</option>
                {spec.styles.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {/* Only where the plan says down-climbing is a thing on this card —
                you down-climb a route, not a twelve-move boulder problem. */}
            {spec?.downClimb && (
              <select className="climb-style climb-down" aria-label={`${tag} up or down`}
                value={c.down || ''} onChange={e => at(i, { down: e.target.value })}>
                {DOWN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <span className="repstep climb-tries">
              <button type="button" className="repstep-b" aria-label={`${tag}: one fewer try`}
                onClick={() => at(i, { tries: hasTries && tries > 1 ? tries - 1 : '' })}>−</button>
              <span className="climb-triesn">{hasTries ? `${tries} ${tries === 1 ? 'try' : 'tries'}` : 'tries —'}</span>
              <button type="button" className="repstep-b" aria-label={`${tag}: one more try`}
                onClick={() => at(i, { tries: hasTries ? tries + 1 : 1 })}>+</button>
            </span>
          </div>
          {hasGrade && (
            <div className="climb-felt">
              {/* onClick as well as onChange: a tap that lands where the thumb
                  already sits fires no change event, and dead centre — "spot
                  on" — is exactly where an untouched slider sits. */}
              <input type="range" className={`slider ${felt == null ? 'unset' : ''}`} min={FELT_MIN} max={FELT_MAX} step={1}
                value={felt ?? 0} style={{ '--pct': `${pct}%` }}
                aria-label={`${tag} felt for the grade`}
                onChange={e => at(i, { felt: Number(e.target.value) })}
                onClick={e => at(i, { felt: Number(e.target.value) })} />
              <span className="climb-feltword">
                {felt == null ? 'for the grade: —' : feltLabel(felt)}
              </span>
            </div>
          )}
          {onDrop && (
            <button type="button" className="btn quiet climb-drop"
              onClick={() => { setPicked(null); onDrop(i) }}>
              <Icon name="Trash2" size={16} /> Remove {what}
            </button>
          )}
        </details>
        {nextButton}
      </div>
    )
  }

  return (
    <div className="climblog">
      {climbs.map((c, i) => {
        if (i === current) return <div key={i} className="climb">{editor(i)}</div>
        // Undescribed climbs after the current one are the quiet line below.
        if (current >= 0 && i > current && !climbSaid(c)) return null
        const words = climbWords(c)
        return (
          <div key={i} className="climb">
            <button type="button" className="climb-done" onClick={() => setPicked(i)}
              aria-label={`${where}${what} ${i + 1}: change`}>
              <span className="gradelap-n">{what} {i + 1}</span>
              {!omitGrade && <span className="climb-grade">{fmt(c.grade) || '—'}</span>}
              {words && <span className="climb-words">{words}</span>}
              <Icon name="ChevronRight" size={16} className="list-row-chev" />
            </button>
          </div>
        )
      })}
      {untold > 0 && (
        <p className="climb-untold">{untold} more {plural(what, untold)}, not described</p>
      )}
      {current < 0 && nextButton}
    </div>
  )
}

/*
 * Taking climb `k` out of a row, and putting it back (the Undo). A lap's grade
 * (the doubles' per-rep list) goes and comes back WITH its climb, or every later
 * lap would carry the grade of the one before it.
 */
export function withoutClimb(row, k, perRep = false) {
  const next = dropClimb(row, k)
  if (!perRep) return next
  const grades = fitGrades(row[GRADE_FIELD], row.reps)
  return { ...next, [GRADE_FIELD]: fitGrades(grades.length > 1 ? grades.filter((_, x) => x !== k) : [''], next.reps) }
}
export function withClimbBack(row, k, climb, grade = '', perRep = false) {
  const back = putClimb(row, k, climb)
  if (!perRep) return back
  const grades = fitGrades(row[GRADE_FIELD], row.reps)
  const lone = back.reps === 1
  return { ...back, [GRADE_FIELD]: fitGrades(lone ? [grade] : [...grades.slice(0, k), grade, ...grades.slice(k)], back.reps) }
}

/** One exercise of the set log: its rows, and the per-climb detail where the plan offers it. */
function Exercise({ exercise, rows, sign, onRows, onSign, hintRows = null, initialConfirm = false }) {
  const fields = exercise.fields || []
  const perRep = hasGrades(fields)
  const what = exercise.repName || 'rep'
  // The plan says this exercise CAN log per-climb detail; the rows say whether
  // this entry IS. Presence of the list is the state — see lib/grades.js.
  const offers = offersClimbs(exercise)
  const detailed = climbsOn(rows)
  const routes = scaleOfExercise(exercise) === 'yds'
  const [confirmOff, setConfirmOff] = useState(initialConfirm)

  // An Undo runs after this render is gone: it must act on the rows as they are
  // THEN, and through the writer as it is then, or it would put back a stale copy
  // over whatever was logged in between.
  const latest = useRef({ rows, onRows })
  latest.current = { rows, onRows }
  const undo = (message, restore) => pushToast(message, 'info', {
    action: { label: 'Undo', icon: Undo2, onClick: () => latest.current.onRows(restore(latest.current.rows)) },
  })

  const set = (i, field, value) => {
    const next = rows.map((r, j) => {
      if (j !== i) return r
      const row = { ...r, [field]: value === '' || value === null ? '' : Number(value) }
      // The pickers follow the rep count, live — change 2 laps to 3 and a third
      // grade appears rather than the row quietly logging two.
      if (perRep && field === 'reps') row[GRADE_FIELD] = fitGrades(row[GRADE_FIELD], row.reps)
      if (Array.isArray(row[CLIMB_FIELD]) && field === 'reps') row[CLIMB_FIELD] = fitClimbs(row[CLIMB_FIELD], row.reps)
      return row
    })
    onRows(next)
  }

  // On: one record per climb already counted, the count kept (lib/grades.js).
  const turnOn = () => onRows(rows.map(detailOn))
  const turnOff = () => {
    setConfirmOff(false)
    onRows(rows.map(r => { const { [CLIMB_FIELD]: _dropped, ...rest } = r; return rest }))
  }
  // Switching the detail off strips it (hidden data that still charts is a log
  // disagreeing with itself), so when anything has been said it asks first.
  const said = saidIn(rows)
  const askOff = () => (said > 0 ? setConfirmOff(true) : turnOff())

  // The only way the count moves while the detail is on: one at a time.
  const bump = (i, delta) => onRows(rows.map((r, j) => (j === i ? stepClimbs(r, delta) : r)))
  const setList = (i, field, list) =>
    onRows(rows.map((r, j) => (j === i ? { ...r, [field]: list } : r)))
  const removeClimb = (i, k) => {
    const row = rows[i]
    const gone = fitClimbs(row[CLIMB_FIELD], row.reps)[k]
    const goneGrade = perRep ? fitGrades(row[GRADE_FIELD], row.reps)[k] ?? '' : ''
    onRows(rows.map((r, j) => (j === i ? withoutClimb(r, k, perRep) : r)))
    if (climbSaid(gone) || goneGrade !== '') {
      undo(`${cap(what)} ${k + 1} removed`, now => now.map((r, j) =>
        (j === i && Array.isArray(r[CLIMB_FIELD]) ? withClimbBack(r, k, gone, goneGrade, perRep) : r)))
    }
  }
  const addSet = () => onRows([...rows, cloneRow(rows.at(-1) || {}, fields, rows.at(-1)?.reps)])
  const dropSet = (i) => {
    const gone = rows[i]
    onRows(rows.filter((_, j) => j !== i))
    undo(`Set ${i + 1} removed`, now => [...now.slice(0, i), gone, ...now.slice(i)])
  }

  const hasWeight = fields.includes('weight')
  const cols = fields.filter(f => meta(f).kind !== 'grades')
  const colLabel = (f) => (f === 'reps' && exercise.repName ? plural(exercise.repName) : meta(f).label)
  // A described row whose only column is the count has nothing left for the
  // table to show: the climb list IS the count.
  const inTable = (r) => !(Array.isArray(r[CLIMB_FIELD]) && cols.every(f => f === 'reps'))
  const table = rows.some(inTable)

  const total = rows.reduce((s, r) => s + (Number(r.reps) || 0), 0)
  const falls = detailed ? fallsIn(rows) : 0
  const sent = detailed ? climbsIn(rows).filter(c => climbSaid(c) && isClean(c)).length : 0
  // Lengths of wall, which is the whole point of recording a down-climb: a lap
  // climbed and reversed is two of them. Shown only when it differs from the rep
  // count, so a session with no down-climbing in it reads exactly as it did.
  const downs = detailed ? downsIn(rows) : 0
  const lengths = detailed ? lengthsIn(rows) : 0
  const noun = exercise.repName ? plural(exercise.repName, total) : 'reps'

  const climbList = (r, i) => (
    <ClimbLog count={climbCount(r.reps)} values={r[CLIMB_FIELD]}
      spec={exercise.climbLog} what={what} omitGrade={perRep}
      where={rows.length > 1 ? `set ${i + 1} ` : ''}
      onChange={list => setList(i, CLIMB_FIELD, list)}
      onDrop={k => removeClimb(i, k)}
      onMore={climbCount(r.reps) < MAX_CLIMBS ? () => bump(i, 1) : undefined} />
  )

  return (
    <div className="exlog">
      <div className="exlog-head">
        <span className="exlog-name">{exercise.name}</span>
        {/* Letters or plus/minus, where route grades are asked. */}
        {routes && (perRep || detailed) && <GradeSystemSwitch />}
        {hasWeight && (
          <button className={`signtog ${sign === '-' ? 'neg' : ''}`} onClick={() => onSign(sign === '-' ? '+' : '-')}>
            {sign === '-' ? '− counterweight' : '+ added'}
          </button>
        )}
      </div>

      {/* The per-climb option, as a button that says what it does. Off is the
          default: a count is a twenty-second form, and stays one. */}
      {offers && !detailed && (
        <button type="button" className="btn secondary exlog-each" onClick={turnOn}>
          <Icon name="ListPlus" size={18} /> Log each {what}
        </button>
      )}

      {table ? (
        <table className={`exlog-table ${perRep || detailed ? 'perrep' : ''}`}>
          <thead>
            <tr>
              <th className="c-set">set</th>
              {cols.map(f => <th key={f}>{colLabel(f)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Fragment key={i}>
                {inTable(r) && (
                  <tr>
                    <td className="c-set">{i + 1}</td>
                    {cols.map(f => (
                      <td key={f}>
                        {/* While the detail is on, the climb list IS the count, so
                            the count is shown, not typed. Typing was the bug —
                            "12" over a 10 passes through "1", and each keystroke
                            refit the list, deleting climbs already filled in. */}
                        {f === 'reps' && Array.isArray(r[CLIMB_FIELD]) ? (
                          <span className="exlog-count" aria-label={`set ${i + 1} ${colLabel(f)}`}>{climbCount(r.reps)}</span>
                        ) : (
                          <NumInput
                            value={r[f] ?? ''} blank="" decimal={f === 'weight'}
                            onChange={v => set(i, f, v)}
                            placeholder={hintRows?.[i]?.[f] != null ? String(hintRows[i][f]) : undefined}
                            style={{ width: meta(f).width }}
                            aria-label={`set ${i + 1} ${meta(f).label}`}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                )}
                {/* The per-rep grades get their own line under the row: on a phone
                    a third column of selects pushes the reps cell off the screen. */}
                {perRep && (
                  <tr>
                    <td />
                    <td colSpan={cols.length}>
                      <GradeLaps count={repCount(r.reps)} values={r[GRADE_FIELD]}
                        what={what} where={`set ${i + 1} `}
                        onChange={list => setList(i, GRADE_FIELD, list)} />
                    </td>
                  </tr>
                )}
                {Array.isArray(r[CLIMB_FIELD]) && (
                  <tr>
                    <td className="c-set">{inTable(r) ? '' : i + 1}</td>
                    <td colSpan={cols.length}>{climbList(r, i)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="exlog-set">
            {rows.length > 1 && <div className="exlog-setn">Set {i + 1}</div>}
            {perRep && (
              <GradeLaps count={repCount(r.reps)} values={r[GRADE_FIELD]}
                what={what} where={`set ${i + 1} `}
                onChange={list => setList(i, GRADE_FIELD, list)} />
            )}
            {climbList(r, i)}
          </div>
        ))
      )}

      {detailed && !confirmOff && (
        <button type="button" className="btn quiet exlog-off" onClick={askOff}>Count only</button>
      )}
      {confirmOff && (
        <div className="exlog-confirm" role="alertdialog" aria-label="Stop logging each climb">
          <span>Remove what you logged for {said} {plural(what, said)}?</span>
          <button type="button" className="btn secondary" onClick={() => setConfirmOff(false)}>Keep it</button>
          <button type="button" className="btn destructive" onClick={turnOff}>Remove</button>
        </div>
      )}

      <div className="exlog-foot">
        <button type="button" className="btn secondary exlog-add" onClick={addSet}>
          <Icon name="Plus" size={18} /> Add set
        </button>
        {/* Off the number row on purpose: a remove beside the box being typed
            in is a remove pressed by accident. The set comes back with Undo. */}
        {rows.length > 1 && (
          <button type="button" className="btn quiet exlog-drop" onClick={() => dropSet(rows.length - 1)}>
            Remove last set
          </button>
        )}
      </div>
      <p className="exlog-total">
        {table ? `${rows.length} set${rows.length === 1 ? '' : 's'}${total ? ` · ${total} ${noun}` : ''}` : `${total} ${noun}`}
        {sent > 0 ? ` · ${sent} sent` : ''}
        {falls > 0 ? ` · fell on ${falls}` : ''}
        {downs > 0 ? ` · ${downs} down-climbed` : ''}
        {lengths > total ? ` · ${lengths} lengths` : ''}
      </p>
    </div>
  )
}

export function SetLog({ session, out, onSave, hints = null, initialConfirm = null }) {
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
          /* Someone else's copy of a shared workout: the owner's rows as
             placeholders only. See SessionLog's `hints`. */
          hintRows={hints?.sets?.[ex.key] || null}
          sign={signFor(ex)}
          onRows={rows => setRows(ex, rows)}
          onSign={s => setSign(ex, s)}
          initialConfirm={initialConfirm === ex.key}
        />
      ))}
      <p className="setlog-note">Pre-filled from the plan: change what didn't match, and add a set if you did more.</p>
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
