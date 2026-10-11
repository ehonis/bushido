/*
 * Post-session capture. Appears once you've logged a session.
 *
 * Kept deliberately short — six fields at most, sliders default to sensible
 * values, and it saves on every change rather than behind a submit button. A
 * form you skip because it's tedious produces worse data than no form.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, mix, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Chip, Input, Press, Toggle } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { Fold } from '../ui/Fold'
import { success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { NumInput } from './numinput'
import { SetLog, GradeSelect, RangeSlider, totalSets, totalReps } from './setlog'
import { LiftLog } from './liftlog'
import { ActivityPicker } from './activitypicker'
import { liftSets, liftReps, liftsLine } from '../lib/lifts.js'
import { asksItsOwnDuration, minutesFor, minutesSourceOf } from '../lib/minutes.js'
import { visibleOutputs, pruneHidden, derivedValue, filledBy } from '../lib/outputs.js'
import { gateResolver } from '../lib/activities.js'
import { usePlan } from '../lib/planctx.jsx'
import { quickNames, titleOf, nameFor, rename, titleFor } from '../lib/naming.js'
import { GearPicker } from './gearpicker'
import { WhoopWorkouts } from './whoop'
import { StravaActivities } from './strava'

/* --------------------------------------------------------------- notes --- */

/**
 * Every previous time you did THIS session, newest first. The point of writing
 * "grip kept opening on the last circuit" is being shown it again before the
 * next one, so this is what the repeat lookup reads.
 */
export function priorSessions(entries: any[], session: any, excludeId?: any) {
  const ids = priorIdsOf(session)
  if (!ids.length) return []
  return (entries || [])
    .filter((e) => e.kind === 'daily' && !e.deleted && ids.includes(e.data?.optId) && e.id !== excludeId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

/**
 * Which optIds count as "this session", for history: a card's own id plus the
 * ids it has ANSWERED TO — `aka` (a rename) and `priorIds` (a card this one was
 * split out of). Max hangs and repeaters were one card (`hard-home`) until
 * 2026-08-10, so without `priorIds` the history truncated exactly where it is
 * meant to be useful. Content, not code: the ids live on the card in plan.json.
 */
export function priorIdsOf(session: any): string[] {
  if (!session?.id) return []
  return [session.id, ...(session.aka || []), ...(session.priorIds || [])]
}

const dayLabel = (iso: string) => {
  const days = Math.round((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 86400000)
  if (days <= 0) return 'earlier today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return iso
}

/** "3 sets, 21 reps · 5.10+" — what the session itself was, off what was logged. */
function priorWork(out: any) {
  const bits: string[] = []
  const sets = totalSets(out)
  const reps = totalReps(out)
  if (sets) bits.push(`${sets} set${sets === 1 ? '' : 's'}${reps ? `, ${reps} reps` : ''}`)
  const lifting = liftsLine(out)
  if (lifting) bits.push(lifting)
  if (Number(out?.distance) > 0) bits.push(`${out.distance} mi`)
  if (Number(out?.minutesSpent) > 0) bits.push(`${out.minutesSpent} min`)
  return bits.join(' · ')
}

/**
 * The last time you did this, surfaced BEFORE you do it again.
 *
 * A SESSION WITH NOTHING WRITTEN ON IT IS STILL A SESSION: what the user looks
 * for before a hangboard session is what they hung last time, and that is on the
 * entry whether or not they also had something to say.
 */
export function PriorNote({ entries, session, excludeId, all = false, style }: any) {
  const prior = priorSessions(entries, session, excludeId)
  if (!prior.length) return null
  const shown = all ? prior.slice(0, 5) : prior.slice(0, 1)
  const noted = prior.filter((e) =>
    String(e.data?.out?.notes || '').trim() || String(e.data?.out?.improve || '').trim())

  return (
    <View style={[st.prior, style]}>
      <View style={st.priorHead}>
        <Icon name="Repeat" size={13} color={colors.load3} />
        <T size={11} caps color={colors.load3} style={{ flex: 1 }}>
          {all
            ? `Your last ${shown.length} session${shown.length === 1 ? '' : 's'}${noted.length ? '' : ' — nothing written down yet'}`
            : 'Last time you did this'}
        </T>
      </View>
      {shown.map((e, i) => {
        const o = e.data?.out
        const work = priorWork(o)
        return (
          <View key={e.id} style={i > 0 ? st.priorNext : null}>
            <T size={11} faint tabular style={{ marginBottom: 4 }}>
              {dayLabel(e.date)
                + (Number.isFinite(o?.rpe) ? ` · RPE ${o.rpe}` : '')
                + (Number.isFinite(o?.fingers) ? ` · fingers ${o.fingers}/5` : '')}
            </T>
            {work ? <T size={12.5} dim style={{ marginTop: 3 }}>{work}</T> : null}
            {o?.notes ? <T size={13} dim lineHeight={19}>{o.notes}</T> : null}
            {o?.improve ? (
              <T size={13} lineHeight={19} style={{ marginTop: 6 }}>
                <T size={13} weight={700} color={colors.load3}>To improve:</T>{` ${o.improve}`}
              </T>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

/**
 * Free text saves on a timer rather than per keystroke — the store rewrites its
 * whole localStorage cache on every commit, and a season of entries is not
 * something you want re-serialised once per letter.
 */
function NoteField({ label, hint, value, onCommit }: {
  label: string
  hint: string
  value: any
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const commit = useRef(onCommit)
  commit.current = onCommit

  useEffect(() => {
    if (draft === (value ?? '')) return
    const t = setTimeout(() => commit.current(draft), 400)
    return () => clearTimeout(t)
  }, [draft, value])

  return (
    <View style={{ marginBottom: 12 }}>
      <T size={12} dim style={{ marginBottom: 5 }}>{label}</T>
      <Input multiline value={draft} placeholder={hint} onChangeText={setDraft}
        onBlur={() => { if (draft !== (value ?? '')) commit.current(draft) }}
        style={{ minHeight: 76, lineHeight: 22 }} />
    </View>
  )
}

function Slider({ field, value, onChange }: any) {
  const v = value ?? field.default
  const scale: string[] | null = field.scale || null
  return (
    <View style={st.field}>
      <View style={st.label}>
        <T size={13} dim style={{ flex: 1 }}>{field.label}</T>
        <T size={17} weight={600} tabular align="right" style={{ minWidth: 24 }}>{v == null ? '' : String(v)}</T>
      </View>
      <RangeSlider min={field.min} max={field.max} step={field.step ?? 1} value={v} label={field.label} onChange={onChange} />
      {/* On a phone only the two ends of the scale have room. */}
      {scale && scale.length > 0 && (
        <View style={st.scale}>
          <T size={10} faint>{scale[0]}</T>
          {scale.length > 1 ? <T size={10} faint align="right">{scale[scale.length - 1]}</T> : null}
        </View>
      )}
    </View>
  )
}

/**
 * Rename this one workout — mostly by tapping.
 *
 * **Blank is not nameless.** The box is EMPTY until the user names it and the
 * session's current name is its placeholder, so clearing the box is how you get
 * the default back. **Tapping the live chip clears it.** **The overflow is a
 * fold, not a slice**, so every declared name is in the page and one tap away.
 * **It is app-level**, like gear, time spent and the notes.
 */
const NAMES_SHOWN = 6

export function NameField({ session, out, onChange }: any) {
  const plan = usePlan()
  const mine = titleOf(out)
  const [draft, setDraft] = useState(mine || '')
  const commit = useRef(onChange)
  commit.current = onChange

  // Typed text commits on a pause, not per keystroke. Same reason as NoteField.
  useEffect(() => {
    if (draft === (mine || '')) return
    const t = setTimeout(() => commit.current(draft), 400)
    return () => clearTimeout(t)
  }, [draft, mine])

  // A name that arrived from somewhere else — a chip, or "just miles" writing
  // "Commute" — belongs in the box the user is looking at.
  useEffect(() => { setDraft(mine || '') }, [mine])

  const names: string[] = quickNames(plan, session, out)
  const otherwise = nameFor(session, { ...out, title: undefined }) || session?.name || ''
  const pick = (name: string) => { setDraft(name === mine ? '' : name); commit.current(name === mine ? '' : name) }

  const chip = (name: string) => (
    <Chip key={name} out label={name} on={name === mine} onPress={() => pick(name)} />
  )

  return (
    <View style={st.field}>
      <View style={st.label}>
        <T size={13} dim>Name</T>
        {mine && otherwise ? (
          <Press onPress={() => { tap(); pick(mine) }} hitSlop={10}>
            <T size={11} faint style={{ textDecorationLine: 'underline' }}>{`use “${otherwise}”`}</T>
          </Press>
        ) : null}
      </View>
      <Input value={draft} placeholder={otherwise} maxLength={60} returnKeyType="done"
        onChangeText={setDraft}
        onBlur={() => { if (draft !== (mine || '')) commit.current(draft) }}
        style={{ marginTop: 1 }} />
      {names.length > 0 && (
        <>
          <View style={st.choices}>{names.slice(0, NAMES_SHOWN).map(chip)}</View>
          {names.length > NAMES_SHOWN && (
            <Fold summary={`${names.length - NAMES_SHOWN} more`} style={{ marginTop: 2 }} headStyle={{ minHeight: TAP }}>
              <View style={st.choices}>{names.slice(NAMES_SHOWN).map(chip)}</View>
            </Fold>
          )}
        </>
      )}
    </View>
  )
}

/**
 * Pick one of a fixed set. Tapping the selected chip again clears it, because a
 * card whose whole point is being open-ended must not force an answer.
 */
function Choice({ field, value, onChange }: any) {
  return (
    <View style={st.field}>
      <View style={st.label}><T size={13} dim>{field.label}</T></View>
      <View style={st.choices}>
        {(field.options || []).map((o: any) => {
          const on = value === o.value
          return <Chip key={o.value} out icon={o.icon} label={o.label} on={on} onPress={() => onChange(on ? undefined : o.value)} />
        })}
      </View>
    </View>
  )
}

/**
 * How long it actually took.
 *
 * Never PRE-FILLED with a number the user did not give — a pre-filled 150 is a
 * number you confirm without reading. Whatever source is winning is the
 * placeholder and is named underneath; typing over it wins, clearing hands it
 * back. The order lives in lib/minutes.js and is read here, not restated.
 */
function TimeSpent({ session, out, onChange }: any) {
  const value = out?.minutesSpent
  const source = minutesSourceOf(session, out)
  const inUse = Number(minutesFor(session, out))
  const measured = Number(out?.elapsedMin)

  const hint = ({
    typed: 'This is what the weekly training-load chart multiplies your RPE by.',
    whoop: `Using the ${inUse} min WHOOP recorded. Type to change it.`,
    strava: `Using the ${inUse} min moving on the Strava activity you attached. Type to change it.`,
    timer: `Using the ${inUse} min workout mode measured. Type to change it.`,
    estimate: Number.isFinite(inUse)
      ? `Blank uses the card's ${inUse} min estimate. The weekly load chart is RPE × this, so a night that ran short or long is worth a second here.`
      : 'The weekly load chart is RPE × this.',
  } as Record<string, string>)[source]

  return (
    <View style={st.field}>
      <View style={st.label}>
        <T size={13} dim>Time spent</T>
        <T size={17} weight={600} tabular>min</T>
      </View>
      <View style={st.spentRow}>
        <NumInput
          decimal={false}
          placeholder={Number.isFinite(inUse) ? String(inUse) : ''}
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Time spent, in minutes"
          value={value ?? ''}
          onChange={(v: any) => onChange(v == null || v === '' ? undefined : v)}
          keyboardAppearance="dark" selectionColor={colors.accent} returnKeyType="done"
          style={[st.box, { width: 92, textAlign: 'center', fontVariant: ['tabular-nums'] }]}
        />
        {/* The one number that is measured but NOT winning, offered as a tap. */}
        {(source === 'whoop' || source === 'strava') && Number.isFinite(measured) && measured > 0 && Math.round(measured) !== inUse && (
          <Press haptic onPress={() => onChange(Math.round(measured))} style={st.spentUse} accessibilityRole="button">
            <T size={12} dim>{`use ${Math.round(measured)} from the timer instead`}</T>
          </Press>
        )}
      </View>
      <T size={12} faint style={{ marginTop: 0 }}>{hint}</T>
    </View>
  )
}

/** A checkbox row, as a native switch: the label, and the switch on the right. */
function ToggleRow({ value, onChange, children }: { value: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <Press onPress={() => { tap(); onChange(!value) }} style={st.toggle} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      <Toggle value={value} onChange={onChange} />
    </Press>
  )
}

/**
 * WHAT THIS SESSION WAS, as opposed to how it went: its name, what it was done
 * on, whether it was training at all, and how long it took. Each is set once and
 * then left, so they live behind the pencil rather than between the measurements
 * and the note. A PANEL and not a screen, so both sheets that have one open the
 * same thing. `onTraining` is absent where the question is nonsense.
 */
export function SessionDetails({ session, entry, entries, onSave, training, onTraining = null }: any) {
  const out = entry?.data?.out || {}
  // Pruned on the way in exactly as the form does it. See lib/outputs.js.
  const derive = useMemo(() => gateResolver(session), [session])
  const set = (key: string, value: any) => onSave((pruneHidden as any)(session, { ...out, [key]: value }, derive))

  return (
    <View style={{ gap: 16 }}>
      {/* Blank is not nameless: see NameField. */}
      <NameField session={session} out={out} onChange={(v: string) => onSave(rename(out, v))} />

      {/* What it was done on. App-level; renders nothing for a session whose
          discipline uses no gear. */}
      <GearPicker session={session} out={out} entries={entries} onChange={(v: any) => set('gear', v)} />

      {/* Training, or just activity? `training: false` keeps the miles, the gear
          and the streak, and takes it out of the quota and the training load. */}
      {onTraining && (
        <ToggleRow value={training === false} onChange={(v) => onTraining(!v)}>
          <T size={14}>Just miles — not a workout</T>
          <T size={11} faint style={{ marginTop: 2 }}>Counts the distance and the streak. Not the quota, not the training load.</T>
        </ToggleRow>
      )}

      {/* The number the weekly load chart multiplies RPE by. A session that asks
          for its own duration does not also get this box. */}
      {!asksItsOwnDuration(session) && (
        <TimeSpent session={session} out={out} onChange={(v: any) => set('minutesSpent', v)} />
      )}
    </View>
  )
}

/**
 * What this session WAS, on its own layer, opened by the pencil beside the X.
 * A page sheet over the session sheet.
 */
export function DetailsSheet({
  session, entry, entries, onSave, onClose, training, onTraining = null,
}: any) {
  return (
    <Modal title="Edit this workout"
      sub={titleFor(session, entry?.data?.out, entry?.data?.plan)}
      icon="Pencil" onClose={onClose}
      footer={<Btn title="Done" flex onPress={onClose} />}>
      <SessionDetails session={session} entry={entry} entries={entries} onSave={onSave}
        training={training} onTraining={onTraining} />
    </Modal>
  )
}

/** `bare` drops the collapse header — the log feed's sheet is already the form. */
export function SessionLog({
  session, entry, entries, onSave, bare = false,
  defaultOpen = false,
}: any) {
  const declared = session?.outputs || []
  const hasSets = Boolean(session?.logSpec?.exercises?.length)
  /*
   * Collapsed by default: on a real session the protocol is what you open the
   * sheet to read and the form is what you fill in afterwards. `defaultOpen` is
   * for the cards where that is backwards and the form IS the card.
   */
  const [open, setOpen] = useState(defaultOpen)
  const out = entry?.data?.out || {}

  // The catalog resolver, so a field may gate on what the CATALOG says about the
  // picked activity rather than on a list of ninety-one keys. See lib/outputs.js.
  const derive = useMemo(() => gateResolver(session), [session])
  const fields: any[] = (visibleOutputs as any)(session, out, derive)

  // Pruned on the way in, so what is stored and what is on screen can never
  // disagree — correcting a run to a lift takes its distance with it.
  const set = (key: string, value: any) => onSave((pruneHidden as any)(session, { ...out, [key]: value }, derive))

  /*
   * WHAT COUNTS AS HAVING LOGGED SOMETHING.
   *
   * An `optional` field never BLOCKS "logged", but a card whose fields are ALL
   * optional must not satisfy `every()` vacuously: where nothing is required,
   * one real answer is. And the field the card NAMES ITSELF from is its
   * identity, not an answer — counting it would make "Session logged" true the
   * instant the user chose "Mountain bike".
   */
  const identity = session?.nameFrom
  const asked = fields.filter((f) => f.key !== identity)
  const filled = asked.filter((f) => out[f.key] !== undefined).length
  const setsDone = totalSets(out) + liftSets(out)
  const repsDone = totalReps(out) + liftReps(out)
  const hasNote = Boolean(String(out.notes || '').trim() || String(out.improve || '').trim())
  // A field that is not being ASKED cannot block it either.
  const required = asked.filter((f) => !f.optional)
  const answered = filled > 0 || setsDone > 0 || hasNote
  const complete = required.every((f) => out[f.key] !== undefined)
    && (required.length > 0 || answered)
    && (!hasSets || totalSets(out) > 0)

  // The buzz for "Session logged", on the edit that makes it true — not on
  // opening a sheet that already was.
  const was = useRef(complete)
  useEffect(() => {
    if (complete && !was.current) success()
    was.current = complete
  }, [complete])

  // Notes are app-level, not plan-level: every session gets them, including the
  // ones with no measurable outputs at all.
  if (!declared.length && !hasSets && !entry) return null

  const shown = bare || open
  const headColor = complete ? colors.vizGood : colors.ink

  return (
    <View style={bare ? null : st.outlog}>
      {!bare && (
        <Press onPress={() => { tap(); setOpen((o: boolean) => !o) }} style={st.altHead}
          accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Icon name={complete ? 'CircleCheck' : 'NotebookPen'} size={15} color={headColor} />
          <T size={14} weight={600} color={headColor} style={{ flex: 1 }}>
            {complete
              ? `Session logged${setsDone ? ` — ${setsDone} sets${repsDone ? `, ${repsDone} reps` : ''}` : ''}${hasNote ? ' · noted' : ''}`
              : filled || setsDone || hasNote
                ? `How did it go? (${filled}/${asked.length})${hasNote ? ' · noted' : ''}`
                : 'How did it go?'}
          </T>
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={17} color={colors.inkFaint} />
        </Press>
      )}

      {!shown && !filled && (
        <T size={13} dim style={{ marginTop: 8 }}>
          Takes about twenty seconds and it's what makes the progress charts mean anything.
        </T>
      )}

      {shown && (
        <View style={[st.body, bare && { marginTop: 0 }]}>
          {hasSets && <SetLog session={session} out={out} onSave={onSave} />}

          {fields.map((f) => {
            if (f.type === 'slider') {
              return <Slider key={f.key} field={f} value={out[f.key]} onChange={(v: any) => set(f.key, v)} />
            }
            if (f.type === 'choice') {
              return <Choice key={f.key} field={f} value={out[f.key]} onChange={(v: any) => set(f.key, v)} />
            }
            // What you did, out of ninety-one sports. It decides what the rest of
            // this form means, so it is always first. See lib/activities.js.
            if (f.type === 'activity') {
              return <ActivityPicker key={f.key} field={f} value={out[f.key]} out={out} onChange={(v: any) => set(f.key, v)} />
            }
            // A grade is a fixed ladder, not a number you type: see lib/grades.js.
            if (f.type === 'grade') {
              return (
                <View key={f.key} style={st.field}>
                  <View style={st.label}><T size={13} dim>{f.label}</T></View>
                  <GradeSelect value={out[f.key]} label={f.label} style={{ alignSelf: 'flex-start', marginTop: 1 }}
                    onChange={(v: any) => set(f.key, v === '' ? undefined : v)} />
                </View>
              )
            }
            if (f.type === 'toggle') {
              return (
                <ToggleRow key={f.key} value={Boolean(out[f.key])} onChange={(v) => set(f.key, v)}>
                  <T size={14}>{f.label}</T>
                </ToggleRow>
              )
            }
            // Exercises chosen at log time, with their own implement and sets.
            if (f.type === 'lifts') {
              return (
                <LiftLog key={f.key} field={f} out={out} entries={entries} entryId={entry?.id} onSave={onSave} />
              )
            }
            // A number the app can work out is a PLACEHOLDER, and one a service
            // measured says which service: a value the user did not type must
            // never look like one the user did.
            const derived = (derivedValue as any)(f, out)
            const source = filledBy(out, f.key)
            return (
              <View key={f.key} style={{ gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <T size={12} dim>{`${f.label} ${f.unit ? `(${f.unit})` : ''}`}</T>
                  {source ? <T size={10} caps color={colors.accent} style={{ marginLeft: 6 }}>{`from ${source}`}</T> : null}
                </View>
                <NumInput
                  placeholder={derived != null ? String(derived) : f.hint}
                  placeholderTextColor={colors.inkFaint}
                  accessibilityLabel={f.label}
                  value={out[f.key] ?? ''}
                  onChange={(v: any) => set(f.key, v == null || v === '' ? undefined : v)}
                  keyboardAppearance="dark" selectionColor={colors.accent} returnKeyType="done"
                  style={st.box}
                />
                {derived != null && out[f.key] === undefined && (
                  <T size={11} faint>worked out from your distance and time</T>
                )}
              </View>
            )
          })}

          {/* What the band recorded, if anything. Renders nothing when there is
              no WHOOP. Above time spent, because attaching fills it in. */}
          <WhoopWorkouts session={session} entry={entry} entries={entries} onSave={onSave} />

          {/* What Strava recorded. Same rules as WHOOP: suggest, never apply. */}
          <StravaActivities session={session} entry={entry} entries={entries} onSave={onSave} />

          {/*
            * Name, gear, "just miles" and time spent moved out on 2026-09-21:
            * they are `SessionDetails` now, behind the pencil. What stayed is
            * what the form is FOR.
            */}

          <View style={st.notes}>
            <View style={st.notesHead}>
              <Icon name="NotebookPen" size={13} color={colors.inkFaint} />
              <T size={11} faint caps>Notes for this session</T>
            </View>
            {/*
              * A PLAIN NOTES BOX, back since 2026-09-21, under the same key as
              * the retired "how did it feel?", so the notes written before read
              * back in the same box rather than beside a second one.
              */}
            <NoteField
              key={`notes-${entry?.id}`}
              label="Notes"
              hint="rowed 10 min to warm up; left knee grumbled on the last set"
              value={out.notes}
              onCommit={(v) => set('notes', v.trim() || undefined)}
            />
            <NoteField
              key={`improve-${entry?.id}`}
              label="What to improve next time"
              hint="start the timer before chalking; drop a grade on problem 3"
              value={out.improve}
              onCommit={(v) => set('improve', v.trim() || undefined)}
            />
            <PriorNote entries={entries} session={session} excludeId={entry?.id} all style={{ marginBottom: 0 }} />
          </View>
        </View>
      )}
    </View>
  )
}

const st = StyleSheet.create({
  outlog: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 13 },
  altHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP },
  body: { marginTop: 14, gap: 16 },
  field: { gap: 7 },
  label: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: TAP },
  box: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 10, minHeight: TAP, color: colors.ink, fontSize: 16,
  },
  spentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 1 },
  spentUse: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 999,
    paddingHorizontal: 12, minHeight: TAP, justifyContent: 'center',
  },
  notes: { marginTop: 18, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  notesHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 11 },
  prior: {
    backgroundColor: mix(colors.series1, 7, colors.panel2),
    borderWidth: 1, borderColor: mix(colors.series1, 26, colors.line),
    borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 13, marginVertical: 14,
  },
  priorHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },
  priorNext: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 },
})
