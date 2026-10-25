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
import { colors, font, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Chip, IconBtn, Input, Press } from '../ui/kit'
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
        <T size={font.small} dim style={{ flex: 1 }}>{field.label}</T>
        <IconBtn icon="X" size={16} label="Close" onPress={cancel} />
      </View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <Input
          autoFocus value={q} placeholder="Search activities" accessibilityLabel="Search activities"
          onChangeText={setQ}
          autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing"
          onSubmitEditing={() => { if (results?.length) choose(results[0].key) }}
          style={{ borderColor: colors.lineStrong, borderRadius: radius.control }}
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
              <Icon name={a.icon} size={18} color={colors.inkDim} />
              <T size={font.body} style={{ flex: 1, minWidth: 0 }}>{a.name}</T>
              <T size={font.small} dim>{a.group}</T>
            </Press>
          )}
          ListEmptyComponent={(
            <T size={font.small} dim style={{ marginVertical: space[2], marginHorizontal: 2 }}>
              {`Nothing matches “${q}”.`}
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
            <View style={st.groupHead}><T size={font.small} weight={600} dim>{section.title}</T></View>
          )}
          renderItem={({ item: a }: any) => (
            <Press onPress={() => choose(a.key)} style={st.actrow} accessibilityRole="button">
              <Icon name={a.icon} size={18} color={colors.inkDim} />
              <T size={font.body} style={{ flex: 1, minWidth: 0 }}>{a.name}</T>
            </Press>
          )}
        />
      )}
      {value ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(12, insets.bottom) }}>
          <Press onPress={cancel} style={st.cancel} accessibilityRole="button">
            <T size={font.small} dim>{`Keep ${activityLabel(field, value)}`}</T>
          </Press>
        </View>
      ) : null}
    </Popover>
  ) : null

  /*
   * Picked, and not being changed: one row that opens the picker, with the word
   * on it (the web's .list-row; it was an underlined "Change" inside a box), and
   * the fields below are the card. An activity the catalog has forgotten still
   * reads back as what the user logged: the catalog may change, history may not.
   */
  if (value) {
    const name = picked ? picked.name : activityLabel(field, value)
    return (
      <>
        <Press onPress={startSearch} style={st.picked} accessibilityRole="button" accessibilityLabel={`Activity: ${name}. Change`}>
          <Icon name={picked ? picked.icon : 'Sparkles'} size={20} color={picked ? colors.accent : colors.inkFaint} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T size={font.body} weight={500} numberOfLines={1}>{name}</T>
            <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
              <T size={font.small} dim>{picked ? 'Activity' : 'No longer in the catalog'}</T>
              {picked && source ? <T size={font.small} color={colors.accent}>{`from ${source}`}</T> : null}
            </View>
          </View>
          <T size={font.small} dim>Change</T>
          <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
        </Press>
        {sheet}
      </>
    )
  }

  return (
    <View style={{ gap: space[2] }}>
      <T size={font.small} dim>{field.label}</T>
      {/* The pinned sports, one tap each, as answer chips. */}
      <View style={st.pins}>
        {pins.map((a) => (
          <Chip key={a.key} out on={value === a.key} icon={a.icon} label={a.name} onPress={() => choose(a.key)} />
        ))}
      </View>
      <Press onPress={startSearch} style={st.more} accessibilityRole="button">
        <Icon name="Target" size={16} color={colors.inkDim} />
        <T size={font.small} dim style={{ flex: 1 }}>Something else</T>
      </Press>
      {sheet}
    </View>
  )
}

const st = StyleSheet.create({
  // The web's .list-row, with a hairline under it to close the row off from the fields.
  picked: {
    flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  pins: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  more: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP, paddingHorizontal: space[3],
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.control,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  groupHead: { marginTop: 10, marginBottom: 2, paddingVertical: 4, backgroundColor: colors.panel },
  actrow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: TAP, paddingHorizontal: space[2], borderRadius: radius.control },
  cancel: {
    minHeight: TAP, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.control,
  },
})
