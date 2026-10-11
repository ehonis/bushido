/*
 * The journal card (app/src/journal.jsx) — what the coach check-in became.
 *
 * The old card was a climbing block's daily questionnaire wrapped around a
 * conversation with a coach. Once the app stopped focusing on fingers that was
 * obsolete, so this is modelled on the WHOOP journal instead: track behaviours
 * and metrics, and find patterns in them. The coach is its own tab now.
 *
 * WHAT SURVIVED, AND WHY. Three of the old fields feed the recommender's hard
 * blocks: where you are, how long you have, and how the fingers read. Those are
 * today's facts, not journal entries, so they stay as one compact row and still
 * write the same `checkin` entry — `dayFacts` and the engine are untouched.
 *
 * Everything below that row is new: the behaviours the user tracks, their own
 * invented metrics, and — the point — what any of it does to the next morning.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Chip, Field, H2, Input, Press } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { showMenu } from '../ui/menu'
import { tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { NumInput } from './numinput'
import { useWhoop } from '../lib/whoop.jsx'
import { checkinFields, checkinFor, fieldsOf } from '../lib/checkin.js'
import {
  allFields, trackedFields, visibleFields, pruneJournal, journalValues, buildJournalEntry,
  customMetrics, buildCustomEntry, newMetricKey, correlate, recoveryIndex, journalStreak,
  MIN_DAYS,
} from '../lib/journal.js'

/* --------------------------------------------------------------- the card */

export function Journal({ plan, entries, iso, upsertEntry, settings, saveSettings }: {
  plan: any
  entries: any[]
  iso: string
  upsertEntry: (e: any) => void
  settings: any
  saveSettings: (patch: any) => void
}) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const { cache: whoop } = (useWhoop as any)()

  const tracked = settings?.journal?.tracked || []
  const values: any = (journalValues as any)(entries, iso)
  const fields: any[] = useMemo(() => (trackedFields as any)(plan, entries, tracked), [plan, entries, tracked])
  const shown: any[] = (visibleFields as any)(fields, values)

  const set = (key: string, value: any) => {
    const next = { ...values }
    if (value === undefined || value === null || value === '') delete next[key]
    else next[key] = value
    upsertEntry((buildJournalEntry as any)(iso, (pruneJournal as any)(fields, next)))
  }

  const answered = Object.keys(values).length
  const streak: any = (journalStreak as any)(entries, iso)

  return (
    <>
      <Card>
        <View style={st.h2}>
          <Icon name="NotebookPen" size={16} />
          <H2 style={{ marginBottom: 0, flex: 1 }}>Journal</H2>
          {answered > 0 && <T size={11} faint>{`${answered} logged`}</T>}
        </View>

        <TodayFacts plan={plan} entries={entries} iso={iso} upsertEntry={upsertEntry} />

        {!fields.length ? (
          <T size={13} dim>{plan?.journal?.note}</T>
        ) : (
          (plan?.journal?.groups || []).map((g: any) => {
            const mine = shown.filter(f => (f.group || 'state') === g.key)
            if (!mine.length) return null
            return (
              <View style={{ marginTop: 14 }} key={g.key}>
                <GroupHead icon={g.icon} name={g.name} />
                {mine.map(f => <JournalField key={f.key} field={f} value={values[f.key]} onChange={v => set(f.key, v)} />)}
              </View>
            )
          })
        )}

        <View style={st.foot}>
          <RestBtn icon="Grid2x2" label={fields.length ? `Tracking ${fields.length}` : 'Choose what to track'}
            onPress={() => setEditing(true)} style={{ flex: 1, marginBottom: 0 }} />
          <T size={11} dim>{`${streak.filled} of the last ${streak.of} days`}</T>
        </View>
      </Card>

      <Patterns plan={plan} entries={entries} tracked={tracked} whoop={whoop} />

      {editing && (
        <TrackEditor plan={plan} entries={entries} tracked={tracked}
          onToggle={(key) => {
            const next = tracked.includes(key) ? tracked.filter((k: string) => k !== key) : [...tracked, key]
            saveSettings({ journal: { ...(settings?.journal || {}), tracked: next } })
          }}
          onAdd={() => { setEditing(false); setAdding(true) }}
          onDeleteCustom={(key) => upsertEntry((buildCustomEntry as any)(
            (customMetrics as any)(entries).filter((m: any) => m.key !== key)))}
          onClose={() => setEditing(false)} />
      )}

      {adding && (
        <MetricMaker onSave={(m) => {
          upsertEntry((buildCustomEntry as any)([...(customMetrics as any)(entries), m]))
          setAdding(false)
        }} onClose={() => setAdding(false)} />
      )}
    </>
  )
}

/** .journal-group h3: small caps, faint, with the group's icon. */
function GroupHead({ icon, name }: { icon: string; name: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 }}>
      <Icon name={icon} size={14} color={colors.inkFaint} />
      <T size={11} weight={600} caps faint>{name}</T>
    </View>
  )
}

/** .restbtn: the dashed full-width button. */
function RestBtn({ icon, label, onPress, style }: { icon: string; label: string; onPress: () => void; style?: any }) {
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" style={[st.restbtn, style]}>
      <Icon name={icon} size={16} color={colors.inkFaint} />
      <T size={14} faint>{label}</T>
    </Press>
  )
}

/* ------------------------------------------------- today's facts, kept */

/**
 * The three fields the recommender actually reads. Compact and first: they are
 * what the board needs to know NOW. Everything else on this card is for the
 * version of them reading it in three months.
 */
function TodayFacts({ plan, entries, iso, upsertEntry }: { plan: any; entries: any[]; iso: string; upsertEntry: (e: any) => void }) {
  const defs = (checkinFields as any)(plan).filter((f: any) => f.informs)
  const entry = (checkinFor as any)(entries, iso)
  const fields: any = (fieldsOf as any)(entry)

  const set = (key: string, value: any) => {
    const next = { ...fields }
    if (value === undefined || value === null || value === '') delete next[key]
    else next[key] = value
    upsertEntry({
      ...(entry || { id: `checkin-${iso}`, kind: 'checkin', date: iso }),
      data: { ...(entry?.data || {}), fields: next },
    })
  }

  if (!defs.length) return null
  return (
    <View style={st.jfacts}>
      {defs.map((f: any) => (
        <View style={{ gap: 5 }} key={f.key}>
          <T size={11} caps faint>{f.label}</T>
          {f.type === 'choice' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
              {(f.options || []).map((o: any) => (
                <Chip key={o.value} label={o.label} icon={o.icon} on={fields[f.key] === o.value}
                  onPress={() => set(f.key, fields[f.key] === o.value ? '' : o.value)} />
              ))}
            </View>
          ) : f.type === 'slider' ? (
            <Slider field={f} value={fields[f.key]} onChange={v => set(f.key, v)} />
          ) : (
            <NumInput value={fields[f.key] ?? ''} blank="" placeholder={f.hint || ''}
              onChange={(v: any) => set(f.key, v)} />
          )}
        </View>
      ))}
    </View>
  )
}

/* ------------------------------------------------------------ the fields */

/** .jtoggle: a big tappable row, not a checkbox — answered one-handed at the end of a day. */
function JToggle({ on, label, onPress, disabled, mine }: { on: boolean; label: string; onPress?: () => void; disabled?: boolean; mine?: boolean }) {
  return (
    <Press haptic={!disabled} onPress={onPress} disabled={disabled} accessibilityRole="checkbox"
      accessibilityState={{ checked: on }} style={[st.jtoggle, disabled && { opacity: 1 }]}>
      <View style={[st.box, on && { borderColor: colors.accent }]}>
        {on && <Icon name="Check" size={13} color={colors.accent} />}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
        <T size={14} color={on ? colors.ink : colors.inkDim}>{label}</T>
        {mine && <View style={st.mine}><T size={10} color={colors.accent} lineHeight={13}>yours</T></View>}
      </View>
    </Press>
  )
}

function JournalField({ field, value, onChange }: { field: any; value: any; onChange: (v: any) => void }) {
  if (field.type === 'toggle') {
    return <JToggle on={Boolean(value)} label={field.label} onPress={() => onChange(!value)} />
  }
  if (field.type === 'slider') {
    return (
      <View style={{ paddingTop: 6, paddingBottom: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T size={14} dim>{field.label}</T>
          <T size={14} color={colors.accent} tabular>{value ?? '—'}</T>
        </View>
        <Slider field={field} value={value} onChange={onChange} />
      </View>
    )
  }
  if (field.type === 'text') {
    return (
      <Field label={field.label} style={{ marginTop: 8 }}>
        <Input value={value ?? ''} onChangeText={onChange} placeholder="optional" />
      </Field>
    )
  }
  return (
    <Field label={field.label} style={{ marginTop: 8 }}>
      <NumInput value={value ?? ''} blank="" onChange={(v: any) => {
        // The web's max/min attributes, enforced on the way in.
        if (typeof v === 'number' && field.max != null && v > field.max) return
        onChange(v)
      }} />
    </Field>
  )
}

/**
 * `<input type=range>` on a phone: a track you tap or drag along, stepping by
 * the field's step, with a tick under each change. No slider package: this is
 * the one place the app needs one, and it is a handful of integers.
 */
function Slider({ field, value, onChange }: { field: any; value: any; onChange: (v: number) => void }) {
  const min = field.min ?? 1
  const max = field.max ?? 10
  const step = field.step ?? 1
  const shown = value ?? field.default ?? Math.round((min + max) / 2)
  const [w, setW] = useState(0)
  const answered = value !== undefined && value !== null

  const at = (e: GestureResponderEvent) => {
    if (!w) return
    const x = Math.max(0, Math.min(w, e.nativeEvent.locationX))
    const raw = min + (x / w) * (max - min)
    const v = Math.round(Math.round((raw - min) / step) * step + min)
    const clamped = Math.max(min, Math.min(max, v))
    if (clamped !== value) { tap(); onChange(clamped) }
  }
  const frac = max > min ? (shown - min) / (max - min) : 0

  return (
    <View>
      <View
        style={st.slide}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={at}
        onResponderMove={at}
        accessibilityRole="adjustable"
        accessibilityValue={{ min, max, now: shown }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') onChange(Math.min(max, shown + step))
          if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(min, shown - step))
        }}
      >
        <View pointerEvents="none" style={st.slideTrack}>
          <View style={{ width: `${frac * 100}%`, height: '100%', borderRadius: 999, backgroundColor: answered ? colors.accent : colors.inkFaint }} />
        </View>
        <View pointerEvents="none" style={[st.thumb, { left: Math.max(0, frac * w - 11), borderColor: answered ? colors.accent : colors.inkFaint }]} />
      </View>
      {field.scale && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {field.scale.map((s: string, i: number) => <T key={i} size={10} faint>{s}</T>)}
        </View>
      )}
    </View>
  )
}

/* ---------------------------------------------------------- the patterns */

/**
 * What any of it is doing to the next morning — the reason the journal is in
 * Bushido rather than left to WHOOP: this app has the recovery scores AND knows
 * what the user trained.
 *
 * Says "not yet" out loud rather than showing a number that will move twenty
 * points next week: a correlation over three days is a coincidence with a decimal
 * place.
 */
function Patterns({ plan, entries, tracked, whoop }: { plan: any; entries: any[]; tracked: string[]; whoop: any }) {
  const recoveryByDate = useMemo(() => (recoveryIndex as any)(whoop), [whoop])
  const rows: any[] = useMemo(
    () => (correlate as any)({ plan, entries, tracked, recoveryByDate }),
    [plan, entries, tracked, recoveryByDate])

  if (!rows.length) return null
  const ready = rows.filter(r => r.enough)
  const waiting = rows.filter(r => !r.enough)

  return (
    <Card>
      <View style={st.h2}>
        <Icon name="Waypoints" size={16} />
        <H2 style={{ marginBottom: 0, flex: 1 }}>Patterns</H2>
      </View>
      <T size={13} dim style={{ marginTop: 4, marginBottom: 14 }}>
        {'Each behaviour against the '}
        <T size={13} weight={600} color={colors.ink}>{'next morning’s'}</T>
        {' recovery — what you did on Tuesday shows up in Wednesday’s score, because the score is computed off the night.'}
      </T>

      {!Object.keys(recoveryByDate).length && (
        <T size={13} dim style={{ marginBottom: 0 }}>
          No WHOOP recovery data cached yet, so there is nothing to compare against.
        </T>
      )}

      {ready.map(r => (
        <View style={st.pattern} key={r.field.key}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
            <T size={14} style={{ flex: 1 }}>
              {r.field.label}
              {r.split !== null && <T size={11} faint>{`  above ${r.split}`}</T>}
            </T>
            <T size={19} tabular align="right"
              color={r.delta > 0 ? colors.good : r.delta < 0 ? colors.bad : colors.inkDim}>
              {`${r.delta > 0 ? '+' : ''}${r.delta}`}
            </T>
          </View>
          <T size={11} faint>{`${r.on.mean} vs ${r.off.mean} · ${r.on.n}/${r.off.n} days`}</T>
        </View>
      ))}

      {waiting.length > 0 && (
        <T size={11.5} dim style={{ marginTop: 12 }}>
          {waiting.length === rows.length ? 'Nothing has enough days yet. ' : ''}
          {`Still gathering: ${waiting.slice(0, 6).map(r => r.field.label).join(', ')}`}
          {waiting.length > 6 ? ` and ${waiting.length - 6} more` : ''}
          {`. Each needs ${MIN_DAYS} days either side before it says anything.`}
        </T>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------ the editor */

function TrackEditor({ plan, entries, tracked, onToggle, onAdd, onDeleteCustom, onClose }: {
  plan: any
  entries: any[]
  tracked: string[]
  onToggle: (key: string) => void
  onAdd: () => void
  onDeleteCustom: (key: string) => void
  onClose: () => void
}) {
  const fields: any[] = (allFields as any)(plan, entries)
  const groups = plan?.journal?.groups || []
  return (
    <Modal title="What to track" icon="Grid2x2" onClose={onClose}
      sub={`${tracked.length} on, out of ${fields.filter(f => !f.custom).length}`}
      footer={<RestBtn icon="Plus" label="Make your own" onPress={onAdd} style={{ flex: 1, marginBottom: 0 }} />}>
      <T size={13} dim style={{ marginBottom: 14 }}>{plan?.journal?.note}</T>
      {groups.map((g: any) => (
        <View style={{ marginTop: 14 }} key={g.key}>
          <GroupHead icon={g.icon} name={g.name} />
          {fields.filter(f => (f.group || 'state') === g.key && !f.when).map(f => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} key={f.key}>
              <View style={{ flex: 1 }}>
                <JToggle on={Boolean(f.custom || tracked.includes(f.key))} label={f.label}
                  disabled={f.custom} mine={f.custom} onPress={() => onToggle(f.key)} />
              </View>
              {f.custom && (
                <Press haptic onPress={() => onDeleteCustom(f.key)} accessibilityRole="button"
                  accessibilityLabel={`Delete ${f.label}`} style={st.del}>
                  <Icon name="Trash2" size={14} color={colors.inkFaint} />
                </Press>
              )}
            </View>
          ))}
        </View>
      ))}
    </Modal>
  )
}

/** A <select> as a field that opens the system action sheet. */
function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const current = options.find(o => o.value === value)
  return (
    <Press accessibilityRole="button" style={st.select}
      onPress={() => showMenu(options.map(o => ({ label: o.label, onPress: () => onChange(o.value) })))}>
      <T size={16} style={{ flex: 1 }}>{current?.label || ''}</T>
      <Icon name="ChevronDown" size={16} color={colors.inkFaint} />
    </Press>
  )
}

/**
 * Making your own: a new metric with a choice of input. The four shapes the
 * catalog itself uses, so a custom metric is not second-class — it renders,
 * charts and correlates exactly as a catalogued one does.
 */
function MetricMaker({ onSave, onClose }: { onSave: (m: any) => void; onClose: () => void }) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState('toggle')
  const [group, setGroup] = useState('state')
  const [min, setMin] = useState('1')
  const [max, setMax] = useState('10')

  const save = () => {
    if (!label.trim()) return
    const m: any = { key: (newMetricKey as any)(), label: label.trim(), type, group }
    if (type === 'slider') { m.min = Number(min) || 1; m.max = Number(max) || 10; m.default = Math.round(((Number(min) || 1) + (Number(max) || 10)) / 2) }
    onSave(m)
  }

  return (
    <Modal title="Your own metric" icon="Plus" onClose={onClose}
      dismissable={!label.trim()}
      footer={<Btn title="Add it" flex onPress={save} disabled={!label.trim()} />}>
      <View style={{ gap: 14 }}>
        <Field label="What is it">
          <Input value={label} onChangeText={setLabel} placeholder="Gut feel, back pain, hours outside…" />
        </Field>
        <Field label="How do you answer it">
          <Select value={type} onChange={setType} options={[
            { value: 'toggle', label: 'Yes or no' },
            { value: 'slider', label: 'A slider' },
            { value: 'number', label: 'A number' },
            { value: 'text', label: 'A note' },
          ]} />
        </Field>
        {type === 'slider' && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="From"><Input value={min} onChangeText={setMin} keyboardType="number-pad" /></Field>
            <Field label="To"><Input value={max} onChangeText={setMax} keyboardType="number-pad" /></Field>
          </View>
        )}
        <Field label="Where it lives">
          <Select value={group} onChange={setGroup} options={[
            { value: 'sleep', label: 'Sleep & wind-down' },
            { value: 'intake', label: 'Intake' },
            { value: 'state', label: 'How you are' },
            { value: 'recovery', label: 'Recovery work' },
          ]} />
        </Field>
        <T size={13} dim>
          {`Anything except a note gets compared against your recovery once there are ${MIN_DAYS} days either side of it.`}
        </T>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  h2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jfacts: {
    gap: 10, paddingTop: 10, paddingBottom: 14, marginBottom: 4,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  jtoggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 4, borderRadius: 8 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  mine: { marginLeft: 7, borderWidth: 1, borderColor: colors.line, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  del: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  foot: {
    flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line,
  },
  restbtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    marginBottom: 14, padding: 14, minHeight: 44,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10,
  },
  slide: { height: 36, justifyContent: 'center' },
  slideTrack: { height: 6, borderRadius: 999, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  thumb: {
    position: 'absolute', width: 22, height: 22, borderRadius: 11, top: 7,
    backgroundColor: colors.panel, borderWidth: 2,
  },
  pattern: { gap: 2, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.line },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
  },
})
