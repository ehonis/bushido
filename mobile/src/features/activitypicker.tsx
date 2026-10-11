/*
 * Picking what you did, out of ninety-one sports.
 *
 * The screen for `lib/activities.js`, and the sibling of the lift picker: a
 * searchable catalog beats a fixed row of buttons once the list outgrows a phone
 * screen. What it replaced was nine buttons, where "sport" covered pickleball and
 * jiu jitsu and a dance workout could not be logged as a dance workout at all.
 *
 * THREE THINGS IT DOES THAT A PLAIN SEARCH BOX DOES NOT.
 *
 * The user's sports are PINNED, one tap each. The catalog declares which
 * (`pinned`), so it is content and not a guess baked into this file.
 *
 * Search opens only when the user asks for it, so a pin is one tap, not two, and
 * the keyboard does not come up over the form. On the phone it opens as a page
 * sheet with the box focused.
 *
 * What the user picked is shown as ITSELF: once chosen, the picker collapses to
 * that one row, because it has stopped being a question.
 */
import React, { useMemo, useState } from 'react'
import { FlatList, SectionList, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { IconBtn, Input, Press } from '../ui/kit'
import { Popover } from '../ui/Sheet'
import { tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import {
  activityOf, activityLabel, pinnedActivities, groupedActivities, searchActivities,
} from '../lib/activities.js'
import { filledBy } from '../lib/outputs.js'

export function ActivityPicker({ field, value, onChange, out = null }: any) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const insets = useSafeAreaInsets()

  const picked: any = activityOf(field, value)
  const pins: any[] = useMemo(() => pinnedActivities(field), [field])
  const results: any[] | null = useMemo(() => (q.trim() ? searchActivities(field, q) : null), [field, q])
  const groups: any[] = useMemo(() => groupedActivities(field), [field])

  const choose = (key: string) => {
    tap()
    onChange(key)
    setOpen(false)
    setQ('')
  }
  const cancel = () => { setOpen(false); setQ('') }
  const startSearch = () => { tap(); setOpen(true) }

  /*
   * Which service chose this, if one did. The activity decides what the whole
   * rest of the form asks for, so a value the user did not give must never look
   * like one the user did.
   */
  const source = out ? filledBy(out, field.key) : null

  const sheet = open ? (
    <Popover label={field.label} onClose={cancel}>
      <View style={st.sheetHead}>
        <T size={13} dim style={{ flex: 1 }}>{field.label}</T>
        <IconBtn icon="X" size={16} label="Close" onPress={cancel} />
      </View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <Input
          autoFocus value={q} placeholder={field.hint || 'Search activities'}
          onChangeText={setQ}
          autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing"
          onSubmitEditing={() => { if (results?.length) choose(results[0].key) }}
          style={{ borderColor: colors.inkFaint, borderRadius: radius.md }}
        />
      </View>
      {results ? (
        <FlatList
          data={results}
          keyExtractor={(a) => a.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          renderItem={({ item: a }) => (
            <Press onPress={() => choose(a.key)} style={st.actrow} accessibilityRole="button">
              <Icon name={a.icon} size={16} color={colors.ink} />
              <T size={14} style={{ flex: 1, minWidth: 0 }}>{a.name}</T>
              <T size={11} faint>{a.group}</T>
            </Press>
          )}
          ListEmptyComponent={(
            <T size={12.5} dim lineHeight={19} style={{ marginVertical: 10, marginHorizontal: 2 }}>
              {`Nothing matches “${q}”. Log it as `}
              <T size={12.5} weight={700} dim>Something else</T>
              {' and it still counts — or add it to the catalog in '}
              <T size={12} mono dim>plan.json</T>
              {', which needs no rebuild.'}
            </T>
          )}
        />
      ) : (
        <SectionList
          sections={groups.map((g) => ({ title: g.name, data: g.items }))}
          keyExtractor={(a: any) => a.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          renderSectionHeader={({ section }) => (
            <View style={st.groupHead}><T size={11} faint caps>{section.title}</T></View>
          )}
          renderItem={({ item: a }: any) => (
            <Press onPress={() => choose(a.key)} style={st.actrow} accessibilityRole="button">
              <Icon name={a.icon} size={16} color={colors.ink} />
              <T size={14} style={{ flex: 1, minWidth: 0 }}>{a.name}</T>
            </Press>
          )}
        />
      )}
      {value ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(12, insets.bottom) }}>
          <Press onPress={cancel} style={st.cancel} accessibilityRole="button">
            <T size={13} dim>{`Keep ${activityLabel(field, value)}`}</T>
          </Press>
        </View>
      ) : null}
    </Popover>
  ) : null

  /* Picked, and not being changed: one row, and the fields below are the card. */
  if (picked) {
    return (
      <View style={st.picked}>
        <Icon name={picked.icon} size={18} color={colors.accent} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={15} weight={700}>{picked.name}</T>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <T size={11} dim>{picked.group}</T>
            {source ? <T size={10} caps color={colors.accent}>{`from ${source}`}</T> : null}
          </View>
        </View>
        <Press onPress={startSearch} style={st.change} accessibilityRole="button">
          <T size={12} dim style={{ textDecorationLine: 'underline' }}>Change</T>
        </Press>
        {sheet}
      </View>
    )
  }

  /*
   * An activity the catalog has forgotten still reads back as what the user
   * logged rather than as a blank card: the catalog may change, history may not.
   */
  if (value) {
    return (
      <View style={st.picked}>
        <Icon name="Sparkles" size={18} color={colors.inkFaint} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={15} weight={700}>{activityLabel(field, value)}</T>
          <T size={11} dim>no longer in the catalog</T>
        </View>
        <Press onPress={startSearch} style={st.change} accessibilityRole="button">
          <T size={12} dim style={{ textDecorationLine: 'underline' }}>Change</T>
        </Press>
        {sheet}
      </View>
    )
  }

  return (
    <View style={{ gap: 8 }}>
      <T size={13} dim>{field.label}</T>
      <View style={st.pins}>
        {pins.map((a) => {
          const on = value === a.key
          return (
            <Press key={a.key} onPress={() => choose(a.key)} style={[st.pin, on && { borderColor: colors.accent }]}
              accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Icon name={a.icon} size={17} color={on ? colors.accent : colors.ink} />
              <T size={13} color={on ? colors.accent : colors.ink}>{a.name}</T>
            </Press>
          )
        })}
      </View>
      <Press onPress={startSearch} style={st.more} accessibilityRole="button">
        <Icon name="Plus" size={15} color={colors.inkDim} />
        <T size={12} dim style={{ flex: 1 }}>{`Something else — ${(field.activities || []).length} to choose from`}</T>
      </Press>
      {sheet}
    </View>
  )
}

const st = StyleSheet.create({
  picked: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.panel2,
  },
  change: { minHeight: TAP, paddingHorizontal: 12, justifyContent: 'center', marginLeft: 'auto' },
  pins: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pin: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: TAP, paddingHorizontal: 12,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  more: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP, paddingHorizontal: 12,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  groupHead: { marginTop: 10, marginBottom: 2, paddingVertical: 4, backgroundColor: colors.panel },
  actrow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: TAP, paddingHorizontal: 8, borderRadius: radius.md },
  cancel: {
    minHeight: TAP, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
})
