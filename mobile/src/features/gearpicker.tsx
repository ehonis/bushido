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
import { font, space } from '../theme'
import { T } from '../ui/Text'
import { Chip } from '../ui/kit'
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

  // The answer chips every question on the form uses, selected in the accent tint.
  return (
    <View style={{ gap: space[2] }}>
      <View style={st.label}>
        <T size={font.small} dim>On what</T>
        {picked.length === 0 && <T size={font.small} faint>optional</T>}
      </View>
      <View style={st.chips}>
        {choices.map((g) => (
          <Chip key={g.id} out on={picked.includes(g.id)} onPress={() => toggle(g.id)}
            icon={kindOf(plan, g.kind)?.icon || 'ShoppingBag'} label={g.name} />
        ))}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  label: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
})
