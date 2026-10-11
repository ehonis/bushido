/*
 * Which gear a workout was done on.
 *
 * Strava's model: gear has a default per kind, a logged ride picks it up with no
 * taps, and the tap is only for the day you rode the other bike. The rules live
 * in `lib/gear.js`; this is the control.
 *
 * It renders NOTHING when the workout's discipline uses no gear. An input that
 * can only ever be answered one way is not a question, and on a form this long
 * every row has to earn itself.
 */
import React, { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Press } from '../ui/kit'
import { Icon } from '../lib/icons'
import { useStrava } from '../lib/strava.jsx'
import { gearChoicesFor, defaultGearFor, gearOn, kindOf } from '../lib/gear.js'
import { usePlan } from '../lib/planctx.jsx'

export function GearPicker({ session, out, entries = [], onChange }: any) {
  const plan: any = usePlan()
  const { cache: strava } = useStrava() as any

  const choices: any[] = useMemo(
    () => (plan ? (gearChoicesFor as any)({ plan, entries, strava, opt: session, out }) : []),
    [plan, entries, strava, session, out])

  const picked: any[] = gearOn({ data: { out } } as any)

  /*
   * Default it in, once, and only while nothing has been chosen. `out.gear`
   * absent is "nobody has decided"; an empty array is "the user took the default
   * off", which must stick.
   */
  useEffect(() => {
    if (!plan || out?.gear !== undefined || !choices.length) return
    const def = (defaultGearFor as any)({ plan, entries, strava, opt: session, out })
    if (def.length) onChange(def)
  }, [plan, choices.length, out?.gear, session?.id])

  if (!choices.length) return null

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
    onChange(next)
  }

  return (
    <View style={{ gap: 7 }}>
      <View style={st.label}>
        <T size={13} dim>On what</T>
        {picked.length === 0 && <T size={17} weight={600} tabular>optional</T>}
      </View>
      <View style={st.chips}>
        {choices.map((g) => {
          const on = picked.includes(g.id)
          const c = on ? colors.accent : colors.inkDim
          return (
            <Press key={g.id} haptic onPress={() => toggle(g.id)} style={[st.chip, on && { borderColor: colors.accent }]}
              accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Icon name={kindOf(plan, g.kind)?.icon || 'ShoppingBag'} size={15} color={c} />
              <T size={13} color={c}>{g.name}</T>
            </Press>
          )
        })}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  label: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: TAP, paddingHorizontal: 12,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
})
