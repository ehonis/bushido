/*
 * Achievements — the tab. (app/src/achievements.jsx)
 *
 * Moved here 2026-09-15 from two places at once: the progress card sat on Today
 * and the editor sat in the profile panel, so seeing where something stood and
 * changing it were three taps and a different mental mode apart.
 *
 * ONE CARD PER ACHIEVEMENT, and it does both jobs. The weekly bars say what this
 * week asked for and what has filled it; Edit opens the editor for that card.
 *
 * NOT Totem's goals. Those have their own tab (see goals.tsx) because they are a
 * genuinely different thing — a week or a quarter with metrics that expire.
 *
 * Native: the editor is a page sheet rather than a card at the foot of the list,
 * so the keyboard never sits over the field being typed in.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, mix, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, H2, Input, Press, Sub } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { impact, success, warn } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { DayStepper } from './app'
import { progress as quotaProgress } from '../lib/quota.js'
import { localIso } from '../lib/dates.js'
import { profileFacts } from '../lib/profile.js'
import {
  achievements, buildEntry, buildTombstone, idFor, blank as blankAchievement,
} from '../lib/achievements.js'

/*
 * A short, opinionated icon list rather than all of lucide. Every one is in the
 * registry and means something in a training app; a free-text field would let
 * them type a name that renders as the fallback dot.
 */
const ACH_ICONS = [
  'Mountain', 'Waves', 'Bike', 'Footprints', 'Dumbbell', 'Hand',
  'Target', 'Flame', 'Timer', 'Route', 'Activity', 'Infinity',
  'Sprout', 'Feather', 'Flag', 'HeartPulse',
]

export function AchievementsTab({ plan, entries, upsertEntry }: any) {
  const today = (localIso as any)()
  const facts = useMemo(() => (profileFacts as any)(entries), [entries])
  const list = useMemo(() => (achievements as any)(plan, entries, facts), [plan, entries, facts])
  const week = useMemo(() => (quotaProgress as any)({ plan, entries, iso: today }), [plan, entries, today])
  const cats = plan?.quotaCategories || []

  // `null` is closed, an object is the one being edited. A brand new one has a
  // null id, which is what tells `save` to mint one.
  const [editing, setEditing] = useState<any>(null)

  const save = () => {
    const name = String(editing.name || '').trim()
    if (!name) return
    const id = editing.id || (idFor as any)(name, list.map((a: any) => a.id))
    upsertEntry((buildEntry as any)({ ...editing, id }))
    success()
    setEditing(null)
  }

  const remove = (a: any) => { warn(); upsertEntry((buildTombstone as any)(a.id)); setEditing(null) }

  const field = (k: string, v: any) => setEditing((e: any) => ({ ...e, [k]: v }))
  const toggleCat = (key: string) => setEditing((e: any) => ({
    ...e,
    categories: e.categories.includes(key)
      ? e.categories.filter((c: string) => c !== key)
      : [...e.categories, key],
  }))

  return (
    <>
      {!list.length && !editing && (
        <Card>
          <H2>Nothing yet</H2>
          <Sub style={{ marginBottom: 0 }}>
            An achievement is a standing thing you are training for — climb a grade, finish
            a race. It groups the quota categories that count toward it, and the Week tab is
            where you say how many of each you want.
          </Sub>
        </Card>
      )}

      {list.map((a: any) => {
        const rows = week.categories.filter((c: any) => a.categories.includes(c.key))
        const planned = rows.reduce((n: number, c: any) => n + c.planned, 0)
        const done = rows.reduce((n: number, c: any) => n + Math.min(c.done, c.planned), 0)
        return (
          <Card key={a.id}>
            <View style={st.head}>
              <Icon name={a.icon} size={16} />
              <T size={15} weight={600} style={{ flexShrink: 1 }}>{a.name}</T>
              <T size={11} dim style={{ marginLeft: 'auto' }}>
                {planned ? `${done}/${planned} this week` : 'nothing asked for'}
              </T>
            </View>

            {a.blurb ? <Sub style={{ marginTop: 8 }}>{a.blurb}</Sub> : null}

            {rows.length > 0 && (
              <View style={st.bars}>
                {rows.map((c: any) => {
                  const state = c.complete ? 'done' : c.planned ? 'open' : 'none'
                  const tint = state === 'done' ? colors.good : null
                  return (
                    <View key={c.key}
                      accessibilityLabel={`${c.name}: ${c.done} of ${c.planned || '–'}`}
                      style={[st.bar,
                        state === 'done' && { borderColor: colors.good },
                        state === 'open' && { borderColor: colors.accent },
                        state === 'none' && { opacity: 0.45 }]}>
                      <T size={11} color={tint || colors.ink} lineHeight={15}>{c.name}</T>
                      <T size={11} tabular lineHeight={15} color={tint || (state === 'open' ? colors.ink : colors.inkDim)}>
                        {c.planned ? `${c.done}/${c.planned}` : String(c.done || '–')}
                      </T>
                    </View>
                  )
                })}
              </View>
            )}

            {/* Claiming no category means no bars, and without this it renders as
                a name and nothing else — which reads as broken, not unfinished. */}
            {!rows.length && (
              <Sub size={11} style={{ marginTop: 8 }}>
                No quota categories yet, so nothing counts toward it. Press Edit to pick some.
              </Sub>
            )}

            <Sub style={{ marginTop: 10 }}>
              {a.date
                ? `Target ${a.date}. The board can start leaning toward it as the weeks run down.`
                : 'No date, so there is no taper and no countdown — the quotas ARE the plan.'}
            </Sub>

            <View style={st.acts}>
              <Btn icon="NotebookPen" title="Edit" onPress={() => setEditing({ ...a })} />
              <Press haptic onPress={() => remove(a)} accessibilityRole="button" style={st.danger}>
                <Icon name="Trash2" size={14} color={colors.bad} />
                <T size={15} weight={600} color={colors.bad}>Delete</T>
              </Press>
            </View>

            {/* Deleting a seeded one is a different act from deleting one the user
                typed: plan.json still has it, and it comes back if the tombstone is
                ever lost. Saying so beats them discovering it. */}
            {a.seeded ? <T size={11} faint style={{ marginTop: 8 }}>Came with the app.</T> : null}
          </Card>
        )
      })}

      {!editing && (
        <Press onPress={() => { impact(); setEditing((blankAchievement as any)()) }}
          accessibilityRole="button" style={st.addBtn}>
          <Icon name="Plus" size={17} color={colors.inkFaint} />
          <T size={14} faint>Add an achievement</T>
        </Press>
      )}

      {editing && (
        <Modal
          title={editing.id ? `Edit ${editing.name || 'achievement'}` : 'New achievement'}
          icon={editing.icon || 'Flag'}
          onClose={() => setEditing(null)}
          // Locked once something is typed, the way the web's sheet locks its scrim.
          dismissable={!String(editing.name || '').trim()}
          footer={<>
            <Btn kind="ghost" title="Cancel" flex onPress={() => setEditing(null)} />
            <Btn title={editing.id ? 'Save' : 'Add it'} flex onPress={save}
              disabled={!String(editing.name || '').trim()} />
          </>}
        >
          <EdField label="Name">
            <Input value={editing.name} autoFocus placeholder="Climb 5.12a"
              onChangeText={(v) => field('name', v)} />
          </EdField>

          <EdField label="Short name" hint="for filters and charts">
            <Input value={editing.short} placeholder={editing.name || '12a'}
              onChangeText={(v) => field('short', v)} />
          </EdField>

          <EdField label="Target date" hint="optional">
            {editing.date ? (
              <View style={{ gap: 6 }}>
                <DayStepper value={editing.date} onChange={(v) => field('date', v || null)} />
                <Btn kind="quiet" small icon="X" title="No date" onPress={() => field('date', null)}
                  style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : (
              <Btn kind="ghost" icon="CalendarDays" title="Set a date" style={{ alignSelf: 'flex-start' }}
                onPress={() => field('date', today)} />
            )}
          </EdField>

          <EdField label="Icon">
            <View style={st.wrap}>
              {ACH_ICONS.map(name => {
                const on = editing.icon === name
                return (
                  <Press key={name} haptic accessibilityRole="button" accessibilityLabel={name}
                    accessibilityState={{ selected: on }}
                    onPress={() => field('icon', name)}
                    style={[st.icon, on && { borderColor: colors.accent }]}>
                    <Icon name={name} size={17} color={on ? colors.accent : colors.inkDim} />
                  </Press>
                )
              })}
            </View>
          </EdField>

          <EdField label="Quota categories" hint="what counts toward it">
            <View style={st.wrap}>
              {cats.map((c: any) => {
                const on = editing.categories.includes(c.key)
                const fg = on ? colors.accent : colors.inkDim
                return (
                  <Press key={c.key} haptic accessibilityRole="button" accessibilityState={{ selected: on }}
                    onPress={() => toggleCat(c.key)}
                    style={[st.pick, on && { borderColor: colors.accent }]}>
                    <Icon name={c.icon} size={13} color={fg} />
                    <T size={11} color={fg}>{c.name}</T>
                  </Press>
                )
              })}
            </View>
          </EdField>

          <EdField label="Notes" hint="optional">
            <Input multiline value={editing.blurb} placeholder="What it actually takes."
              onChangeText={(v) => field('blurb', v)} />
          </EdField>
        </Modal>
      )}

      <Card>
        <H2>How these work</H2>
        <Sub style={{ marginBottom: 0 }}>
          An achievement groups <T size={13} weight={700}>quota categories</T> — a category belongs to at
          most one, and anything none of them claims still counts and still shows up. You set
          the weekly counts on the <T size={13} weight={700}>Week</T> tab. These are not Totem’s
          goals: those are a week or a quarter with metrics that expire, and they have their
          own <T size={13} weight={700}>Goals</T> tab.
        </Sub>
      </Card>
    </>
  )
}

/** .acheditor .field: a dim label (with an inline hint) over its control. */
function EdField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 5, marginBottom: 12 }}>
      <T size={12} dim>
        {label}
        {hint ? <T size={11} dim>{` ${hint}`}</T> : null}
      </T>
      {children}
    </View>
  )
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bars: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  bar: {
    flexDirection: 'row', alignItems: 'baseline', gap: 5, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.md, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  // button.btn.danger: the only red in the card, and it still has to be pressed.
  danger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: TAP, paddingHorizontal: 16, borderRadius: 8,
    borderWidth: 1, borderColor: mix(colors.bad, 35, colors.line),
  },
  // .restbtn: the dashed "add" row.
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    minHeight: TAP, padding: 14, marginBottom: 14,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  icon: {
    width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  pick: {
    flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: TAP, paddingHorizontal: 8,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
})
