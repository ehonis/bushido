/*
 * The gear page — what the user owns and what it has done (app/src/gear.jsx).
 *
 * The logic is `lib/gear.js`; this is the page. It shows USE rather than price,
 * and the things in it are things the user owns rather than things somebody
 * thought they should buy.
 *
 * Grouped by kind rather than by origin. Where an item came from — Strava, or the
 * user's own typing — is a word on the row, not a heading: "my bikes" is the
 * question. Since wave 2 (#44) each kind is one card of rows, a row opens its
 * edit form, and removing lives in that form behind the sheet's confirm.
 *
 * Native: the form opens as a page sheet over the profile rather than replacing
 * the list, so editing the first row does not lose your place; "Kind" is a
 * system action sheet; "Since" is a day stepper.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Empty, Field, Input, Press, SectionHeader, Toggle } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { showMenu } from '../ui/menu'
import { success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { localIso } from '../lib/dates.js'
import { DayStepper } from '../ui/DayStepper'
import {
  gearUsage, gearKinds, kindOf, headlineFor, buildGearEntry, newGearId,
} from '../lib/gear.js'

const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : Math.round(n * 10) / 10)

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

  const close = () => { setAdding(false); setEditing(null) }
  const save = (id: string, data: any) => {
    upsertEntry(buildGearEntry(id, data)); success(); close()
  }

  const form = (adding || editing) ? (
    <GearForm plan={plan} row={editing} onSave={save} onCancel={close}
      onDelete={editing?.source === 'local' ? () => { deleteEntry?.(editing.id); close() } : null} />
  ) : null

  if (!groups.length) {
    return (
      <>
        <Empty icon="ShoppingBag">
          <T dim size={font.body} align="center">No gear yet. Bikes and shoes arrive from Strava; add anything else.</T>
          <Btn title="Add gear" onPress={() => setAdding(true)} />
        </Empty>
        {form}
      </>
    )
  }

  return (
    <>
      {groups.map(({ kind, items }) => (
        <Card key={kind.key}>
          <SectionHeader title={kind.name} style={{ marginTop: 0 }} />
          {items.map((row, i) => (
            <GearRow key={row.id} row={row} kind={kind} first={i === 0} onOpen={() => setEditing(row)} />
          ))}
        </Card>
      ))}
      <Btn kind="secondary" icon="Plus" title="Add gear" onPress={() => setAdding(true)} />
      {form}
    </>
  )
}

function GearRow({ row, kind, first, onOpen }: any) {
  const head = headlineFor(row)
  const facts = [
    row.source === 'strava' && 'Strava',
    row.primary && 'Default',
    row.retired && 'Retired',
    row.lastUsed ? `Last used ${row.lastUsed}` : row.acquired ? `Since ${row.acquired}` : row.source === 'local' && 'Not used yet',
    row.sessions > 0 && `${row.sessions} workout${row.sessions === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return (
    <Press haptic onPress={onOpen} style={[st.row, !first && st.rowRule]} accessibilityRole="button"
      accessibilityLabel={`Edit ${row.name}`}>
      <Icon name={kind.icon || 'ShoppingBag'} size={20} color={colors.inkDim} />
      <View style={st.rowName}>
        <T size={font.body} weight={500} numberOfLines={1} color={row.retired ? colors.inkDim : colors.ink}>{row.name}</T>
        <T size={font.small} dim>{facts.join(' · ')}</T>
        {/*
          * The mileage gap, said out loud rather than folded into one number.
          * Strava keeps its own odometer; anything logged here with no Strava
          * activity attached is a ride it cannot have seen. Adding them together
          * would double-count every ride that WAS on Strava.
          */}
        {row.source === 'strava' && row.unsyncedMiles > 0 ? (
          <T size={font.small} color={colors.warn}>{`+ ${fmt(row.unsyncedMiles)} mi logged here that Strava has not seen`}</T>
        ) : null}
      </View>
      <View style={st.rowNum}>
        <T size={font.small} dim tabular>
          <T size={font.title} weight={600} tabular color={row.retired ? colors.inkDim : colors.ink}>{String(fmt(head.value))}</T>
          {` ${head.unit}`}
        </T>
        {/* Weights measure reps, but the hours are worth having too. */}
        {kind.metric === 'reps' && row.minutes > 0 ? <T size={font.caption} dim>{`${Math.round(row.minutes / 60)} hr`}</T> : null}
      </View>
    </Press>
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
function GearForm({ plan, row, onSave, onCancel, onDelete }: any) {
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
    { title: 'Kind' })

  return (
    <Modal
      title={row ? row.name : 'Add gear'}
      icon="ShoppingBag"
      onClose={onCancel}
      dismissable={false}
      onDelete={onDelete}
      deleteLabel={row ? `Remove ${row.name}` : 'Remove'}
      deleteBody="Workouts logged with it keep their history."
      footer={(
        <>
          <Btn kind="ghost" title="Cancel" flex onPress={onCancel} />
          <Btn title={row ? 'Save' : 'Add it'} flex onPress={submit} disabled={!synced && !name.trim()} />
        </>
      )}
    >
      {synced && (
        <T size={font.small} dim style={{ marginBottom: space[3] }}>From Strava, which keeps its name and odometer.</T>
      )}

      {!synced && (
        <Field label="Name" style={st.field}>
          <Input value={name} onChangeText={setName} placeholder="Mammut 9.5 Crag Classic" />
        </Field>
      )}

      <Field label="Kind" style={st.field}>
        <Press haptic={!synced} disabled={synced} onPress={pickKind} style={st.select} accessibilityRole="button">
          <T size={font.input} style={{ flex: 1 }} numberOfLines={1}>{kindOf(plan, kind)?.name || kind}</T>
          <Icon name="ChevronDown" size={16} color={colors.inkFaint} />
        </Press>
      </Field>

      <Field label="Since" style={st.field}>
        {acquired ? (
          <View style={{ gap: 6 }}>
            <DayStepper value={acquired} max={localIso()} onChange={setAcquired} />
            <Press haptic onPress={() => setAcquired('')} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
              <T size={font.caption} dim>Clear the date</T>
            </Press>
          </View>
        ) : (
          <Press haptic onPress={() => setAcquired(localIso())} style={st.select} accessibilityRole="button">
            <T size={font.input} faint style={{ flex: 1 }}>No date</T>
            <Icon name="CalendarDays" size={16} color={colors.inkFaint} />
          </Press>
        )}
      </Field>

      <Field label={priorLabel} style={st.field}>
        <Input value={prior} onChangeText={setPrior} placeholder="0" keyboardType="decimal-pad" />
      </Field>
      <View style={st.toggle}>
        <T size={font.body} style={{ flex: 1 }}>{`Default for ${kindOf(plan, kind)?.name?.toLowerCase() || 'this kind'}`}</T>
        <Toggle value={primary} onChange={setPrimary} />
      </View>
      <View style={st.toggle}>
        <View style={{ flex: 1 }}>
          <T size={font.body}>Retired</T>
          <T size={font.small} dim>Keeps its history, stops being offered</T>
        </View>
        <Toggle value={retired} onChange={setRetired} />
      </View>

      <Field label="Notes" style={[st.field, { marginTop: space[2] }]}>
        <Input value={notes} onChangeText={setNotes} />
      </Field>
    </Modal>
  )
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2] },
  rowRule: { borderTopWidth: 1, borderTopColor: colors.line },
  rowName: { flex: 1, minWidth: 0, gap: 2 },
  rowNum: { alignItems: 'flex-end' },
  field: { flexBasis: 'auto', marginBottom: space[3] },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP, paddingHorizontal: space[3],
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
  },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: TAP, paddingVertical: space[1] },
})
