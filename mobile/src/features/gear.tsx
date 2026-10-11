/*
 * The gear screen — what the user owns and what it has done (app/src/gear.jsx).
 *
 * The logic is `lib/gear.js`; this is the page. It shows USE rather than price,
 * and the things in it are things the user owns rather than things somebody
 * thought they should buy.
 *
 * Grouped by kind rather than by origin. Where an item came from — Strava, or the
 * user's own typing — is a small tag, not a heading: "my bikes" is the question.
 *
 * Native: the add/edit form opens as a page sheet over the profile rather than
 * at the foot of the list, so editing the first row does not scroll it out of
 * reach; "What is it" is a system action sheet; "Since" is a day stepper.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, mix, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Field, Input, Press, Toggle } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { confirm, showMenu } from '../ui/menu'
import { success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { localIso } from '../lib/dates.js'
import { DayStepper } from './app'
import {
  gearUsage, gearKinds, kindOf, headlineFor, buildGearEntry, newGearId,
} from '../lib/gear.js'

const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : Math.round(n * 10) / 10)

/** `.pop-body .card`: inside the profile sheet a card is a section with a rule above it, not a box in a box. */
function PopCard({ first, children, style }: { first?: boolean; children: React.ReactNode; style?: any }) {
  return <View style={[st.card, !first && st.cardRule, style]}>{children}</View>
}

function H2({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <View style={st.h2}>
      {icon ? <Icon name={icon} size={16} color={colors.ink} /> : null}
      <T size={14} weight={600}>{children}</T>
    </View>
  )
}

export function GearSection({ plan, entries, strava, upsertEntry, deleteEntry }: any) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  const rows: any[] = useMemo(
    () => (gearUsage as any)({ plan, entries, strava }),
    [plan, entries, strava])

  const kinds: any[] = gearKinds(plan)
  const groups = kinds
    .map(k => ({ kind: k, items: rows.filter(r => r.kind === k.key) }))
    .filter(g => g.items.length)

  const save = (id: string, data: any) => {
    upsertEntry(buildGearEntry(id, data)); success(); setAdding(false); setEditing(null)
  }

  const remove = async (row: any) => {
    if (!(await confirm(`Delete ${row.name}?`, { message: 'Its history stays in your log; it stops being counted here.' }))) return
    deleteEntry?.(row.id)
  }

  return (
    <>
      <PopCard first>
        <H2>Your gear</H2>
        {plan?.gearNote ? <T size={13} dim>{plan.gearNote}</T> : null}
      </PopCard>

      {!groups.length && (
        <PopCard>
          <H2>Nothing here yet</H2>
          <T size={13} dim>
            Bikes and shoes arrive from Strava on their own. Everything else — ropes,
            harnesses, climbing shoes, plates, the Port-A-Board — you add below, and the
            app counts its use from what you log.
          </T>
        </PopCard>
      )}

      {groups.map(({ kind, items }) => (
        <PopCard key={kind.key}>
          <H2 icon={kind.icon}>{kind.name}</H2>
          {kind.blurb ? <T size={13} dim style={{ marginBottom: 6 }}>{kind.blurb}</T> : null}
          {items.map(row => (
            <GearRow key={row.id} row={row} kind={kind}
              onEdit={() => setEditing(row)}
              onDelete={row.source === 'local' ? () => remove(row) : null} />
          ))}
        </PopCard>
      ))}

      {(adding || editing) && (
        <GearForm plan={plan} row={editing} onSave={save}
          onCancel={() => { setAdding(false); setEditing(null) }} />
      )}

      <Press haptic onPress={() => setAdding(true)} style={st.add} accessibilityRole="button">
        <Icon name="Plus" size={16} color={colors.inkFaint} />
        <T size={13} faint>Add a piece of gear</T>
      </Press>
    </>
  )
}

function Pip({ children, tone }: { children: string; tone?: string }) {
  return (
    <View style={[st.pip, tone ? { borderColor: mix(tone, 45, colors.line) } : null]}>
      <T size={10} lineHeight={13} color={tone ? colors.inkDim : colors.inkFaint}>{children}</T>
    </View>
  )
}

function GearRow({ row, kind, onEdit, onDelete }: any) {
  const head = headlineFor(row)
  return (
    <View style={[st.row, row.retired && { opacity: 0.55 }]}>
      <View style={st.rowName}>
        <T size={14.5} weight={600} numberOfLines={2}>{row.name}</T>
        <View style={st.rowMeta}>
          {row.source === 'strava' && <Pip tone={colors.series2}>Strava</Pip>}
          {row.primary && <Pip>default</Pip>}
          {row.retired && <Pip>retired</Pip>}
          {row.acquired ? <T size={11} dim>{`since ${row.acquired}`}</T> : null}
          {row.lastUsed ? <T size={11} dim>{`last used ${row.lastUsed}`}</T> : null}
          {!row.lastUsed && !row.acquired && row.source === 'local' ? <T size={11} dim>not used yet</T> : null}
        </View>
        {/*
          * The mileage gap, said out loud rather than folded into one number.
          * Strava keeps its own odometer; anything logged here with no Strava
          * activity attached is a ride it cannot have seen. Adding them together
          * would double-count every ride that WAS on Strava.
          */}
        {row.source === 'strava' && row.unsyncedMiles > 0 ? (
          <T size={10.5} color={colors.warn}>{`+ ${fmt(row.unsyncedMiles)} mi logged here that Strava has not seen`}</T>
        ) : null}
      </View>

      <View style={st.rowNum}>
        <T size={19} weight={600} tabular lineHeight={21}>{String(fmt(head.value))}</T>
        <T size={11} faint lineHeight={14}>{head.unit}</T>
        {/* Weights measure reps, but the hours are worth having too. */}
        {kind.metric === 'reps' && row.minutes > 0 ? <T size={10.5} dim>{`${Math.round(row.minutes / 60)} hr`}</T> : null}
        {row.sessions > 0 ? <T size={10.5} dim>{`${row.sessions} session${row.sessions === 1 ? '' : 's'}`}</T> : null}
      </View>

      <View style={st.rowActs}>
        <Press haptic onPress={onEdit} style={st.act} accessibilityLabel={`Edit ${row.name}`}>
          <Icon name="NotebookPen" size={15} color={colors.inkFaint} />
        </Press>
        {onDelete ? (
          <Press haptic onPress={onDelete} style={st.act} accessibilityLabel={`Delete ${row.name}`}>
            <Icon name="Trash2" size={15} color={colors.inkFaint} />
          </Press>
        ) : null}
      </View>
    </View>
  )
}

/**
 * Add or edit.
 *
 * Strava-synced gear can be edited here only in the ways the app owns — whether it
 * is the default, and what it had done before. Its NAME and its odometer stay
 * Strava's, because two places to rename one bike is how they stop being the same
 * bike.
 */
function GearForm({ plan, row, onSave, onCancel }: any) {
  const synced = row?.source === 'strava'
  const [name, setName] = useState(row?.name || '')
  const [kind, setKind] = useState(row?.kind || 'climbing-shoes')
  const [acquired, setAcquired] = useState(row?.acquired || '')
  const [primary, setPrimary] = useState(Boolean(row?.primary))
  const [retired, setRetired] = useState(Boolean(row?.retired))
  const [prior, setPrior] = useState(
    String(row?.priorMiles || row?.priorMinutes || row?.priorReps || ''))
  const [notes, setNotes] = useState(row?.notes || '')

  const metric = kindOf(plan, kind)?.metric || 'time'
  const priorLabel = metric === 'miles' ? 'Miles already on it'
    : metric === 'reps' ? 'Reps already on it' : 'Hours already on it'

  const submit = () => {
    if (!synced && !name.trim()) return
    const n = Number(prior)
    const priorFields: any = {}
    if (Number.isFinite(n) && n > 0) {
      if (metric === 'miles') priorFields.priorMiles = n
      else if (metric === 'reps') priorFields.priorReps = n
      else priorFields.priorMinutes = n * 60
    }
    onSave(row?.id && row.source === 'local' ? row.id : newGearId(), {
      name: synced ? row.name : name.trim(),
      kind, primary, retired,
      acquired: acquired || undefined,
      notes: notes.trim() || undefined,
      ...priorFields,
    })
  }

  const pickKind = () => showMenu(
    (gearKinds(plan) as any[]).map(k => ({ label: k.name, onPress: () => setKind(k.key) })),
    { title: 'What is it' })

  return (
    <Modal
      title={row ? `Edit ${row.name}` : 'Add gear'}
      icon="ShoppingBag"
      onClose={onCancel}
      dismissable={false}
      footer={(
        <>
          <Btn kind="ghost" title="Cancel" flex onPress={onCancel} />
          <Btn title={row ? 'Save' : 'Add it'} flex onPress={submit} disabled={!synced && !name.trim()} />
        </>
      )}
    >
      {synced && (
        <T size={13} dim style={{ marginBottom: 12 }}>
          This one comes from Strava, which keeps its name and its odometer. What you
          can set here is whether it is your default and what it had done before.
        </T>
      )}

      {!synced && (
        <Field label="Name" style={st.field}>
          <Input value={name} onChangeText={setName} placeholder="Mammut 9.5 Crag Classic" />
        </Field>
      )}

      <Field label="What is it" style={st.field}>
        <Press haptic={!synced} disabled={synced} onPress={pickKind} style={st.select} accessibilityRole="button">
          <T size={16} style={{ flex: 1 }} numberOfLines={1}>{kindOf(plan, kind)?.name || kind}</T>
          <Icon name="ChevronDown" size={16} color={colors.inkFaint} />
        </Press>
      </Field>

      <Field label="Since" style={st.field}>
        {acquired ? (
          <View style={{ gap: 6 }}>
            <DayStepper value={acquired} max={localIso()} onChange={setAcquired} />
            <Press haptic onPress={() => setAcquired('')} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
              <T size={12} faint>Clear the date</T>
            </Press>
          </View>
        ) : (
          <Press haptic onPress={() => setAcquired(localIso())} style={st.select} accessibilityRole="button">
            <T size={16} faint style={{ flex: 1 }}>No date</T>
            <Icon name="CalendarDays" size={16} color={colors.inkFaint} />
          </Press>
        )}
      </Field>

      <Field label={priorLabel} style={st.field}>
        <Input value={prior} onChangeText={setPrior} placeholder="0" keyboardType="decimal-pad" />
      </Field>
      <T size={13} dim style={{ marginBottom: 12 }}>
        A rope with two hundred hours on it does not become new because you only
        just told the app about it.
      </T>

      <View style={st.toggle}>
        <T size={14} style={{ flex: 1 }}>{`Use this by default for ${kindOf(plan, kind)?.name?.toLowerCase() || 'this kind'}`}</T>
        <Toggle value={primary} onChange={setPrimary} />
      </View>
      <View style={st.toggle}>
        <T size={14} style={{ flex: 1 }}>Retired — keep the history, stop offering it</T>
        <Toggle value={retired} onChange={setRetired} />
      </View>

      <Field label="Notes" style={[st.field, { marginTop: 8 }]}>
        <Input value={notes} onChangeText={setNotes} placeholder="optional" />
      </Field>
    </Modal>
  )
}

const st = StyleSheet.create({
  card: { paddingBottom: 18 },
  cardRule: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  h2: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.line,
  },
  rowName: { flex: 1, minWidth: 0, gap: 3 },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pip: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: colors.line },
  rowNum: { alignItems: 'flex-end', gap: 1 },
  rowActs: { flexDirection: 'row', gap: 2 },
  act: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 10, minHeight: TAP, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 8,
  },
  field: { flexBasis: 'auto', marginBottom: 12 },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP, paddingHorizontal: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
  },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
})
