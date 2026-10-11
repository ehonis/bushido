/*
 * How to actually do the exercise (app/src/howto.jsx).
 *
 * A session's protocol is a wall of accurate paragraphs, and the user read the
 * core and eccentrics ones several times without coming away knowing what the
 * movement was. That is a UI failure, not a reading failure: the instruction was
 * there and it did not land.
 *
 * So each exercise carries its own `how` in plan.json — a picture, one line that
 * says what the movement IS, three to five short steps, and the single error
 * most likely to ruin it. The prose is still there, one tap away.
 *
 * Three shapes, all built on the same body:
 *
 *   HowRow    a tappable row — figure, name, gist. Lists of exercises.
 *   HowBody   the card itself. Shown inline once a row is open.
 *   HowSheet  the same card as a page sheet, for mid-set, where a phone held at
 *             arm's length has room for exactly one thing.
 */
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, mix, radius } from '../theme'
import { Icon } from '../lib/icons'
import { Figure } from '../lib/figures'
import { T } from '../ui/Text'
import { Btn, Press } from '../ui/kit'
import { Modal } from '../ui/Sheet'

/** "3 × 8" — the prescription, short enough to sit in a row. */
export function doseLabel(ex: any) {
  if (!ex) return null
  const sets = Number(ex.defaultSets) || 1
  const d = ex.defaults || {}
  const each = d.reps ? `${d.reps}` : d.seconds ? `${d.seconds}s` : null
  if (!each) return sets > 1 ? `${sets} sets` : null
  return `${sets} × ${each}`
}

/**
 * The instructions themselves. Steps are numbered because they are ordered —
 * the free hand turns the weight BEFORE you lower it, and doing those two in
 * the other order is the whole mistake the eccentrics card exists to prevent.
 */
export function HowBody({ how, showFigure = true, style }: { how: any; showFigure?: boolean; style?: any }) {
  if (!how) return null
  return (
    <View style={style}>
      {showFigure && how.figure ? (
        <View style={s.fig}><Figure name={how.figure} color={colors.ink} /></View>
      ) : null}
      {how.gist ? <T size={15} weight={500} lineHeight={22} style={{ marginBottom: 12 }}>{how.gist}</T> : null}

      {how.steps?.length > 0 ? (
        <View style={s.steps}>
          {how.steps.map((step: string, i: number) => (
            <View key={i} style={s.step}>
              <View style={s.n}><T size={11} weight={700} color={colors.accent} lineHeight={13} tabular>{String(i + 1)}</T></View>
              <T size={14} lineHeight={21} style={{ flex: 1 }}>{step}</T>
            </View>
          ))}
        </View>
      ) : null}

      {how.watch ? (
        <View style={[s.note, s.noteWarn]}>
          <Icon name="TriangleAlert" size={15} color={colors.vizWarn} style={s.noteIcon} />
          <View style={{ flex: 1 }}>
            <T size={11} weight={700} caps color={colors.vizWarn} style={{ marginBottom: 2 }}>Most common mistake</T>
            <T size={13} dim lineHeight={20}>{how.watch}</T>
          </View>
        </View>
      ) : null}
      {how.easier ? (
        <View style={s.note}>
          <Icon name="Feather" size={15} color={colors.inkFaint} style={s.noteIcon} />
          <View style={{ flex: 1 }}>
            <T size={11} weight={700} caps style={{ marginBottom: 2 }}>Make it easier</T>
            <T size={13} dim lineHeight={20}>{how.easier}</T>
          </View>
        </View>
      ) : null}
    </View>
  )
}

/**
 * One exercise in a list: picture, name, prescription, and the one-line gist.
 * Tapping it opens the steps underneath rather than navigating anywhere — the
 * list is the map of the session and losing it costs you your place.
 */
export function HowRow({ exercise, open, onToggle, meta }: { exercise: any; open?: boolean; onToggle?: () => void; meta?: any }) {
  const how = exercise?.how
  const dose = meta ?? doseLabel(exercise)
  return (
    <View style={[s.row, open && s.rowOn]}>
      <Press haptic style={s.head} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: !!open }}>
        <View style={s.thumb}><Figure name={how?.figure} color={open ? colors.accent : colors.inkDim} /></View>
        <View style={s.heads}>
          <T size={15} weight={600} lineHeight={20}>{exercise.name}</T>
          {how?.gist ? <T size={12.5} dim lineHeight={17.5} numberOfLines={open ? 3 : 2}>{how.gist}</T> : null}
        </View>
        {dose ? <T size={12} faint tabular numberOfLines={1}>{dose}</T> : null}
        <View style={open ? { transform: [{ rotate: '180deg' }] } : null}>
          <Icon name="ChevronDown" size={17} color={open ? colors.accent : colors.inkFaint} />
        </View>
      </Press>
      {open && how ? <HowBody how={how} showFigure={false} style={s.body} /> : null}
      {open && !how ? (
        <T size={13} faint style={s.none}>
          No step-by-step for this one yet — the full protocol is in the sections above.
        </T>
      ) : null}
    </View>
  )
}

/**
 * The page-sheet version, for workout mode. Swipe down or the X closes it, and
 * "Got it" is a full-width bar at the bottom because this gets dismissed
 * one-handed with chalk on.
 */
export function HowSheet({ exercise, how, title, onClose }: { exercise?: any; how?: any; title?: string; onClose: () => void }) {
  const card = how || exercise?.how
  const name = title || exercise?.name
  if (!card) return null

  return (
    <Modal
      title={name}
      onClose={onClose}
      footer={<Btn title="Got it" onPress={onClose} flex style={{ minHeight: 52 }} />}
    >
      <View accessibilityLabel={`How to do ${name}`}>
        <HowBody how={card} />
      </View>
    </Modal>
  )
}

/**
 * "The moves" — the whole session as a list of exercises, which is the section
 * the session view now opens on. Everything else in a protocol is context; this
 * is the part you are standing there trying to execute.
 */
export function MovesList({ session }: { session: any }) {
  const exercises = session?.logSpec?.exercises || []
  // Open the first one by default: a list of collapsed rows with a picture in
  // each reads as decoration until you see that one of them opens.
  const [open, setOpen] = useState(exercises[0]?.key || null)
  if (!exercises.length) return null

  return (
    <View style={s.list}>
      {exercises.map((ex: any) => (
        <HowRow key={ex.key} exercise={ex} open={open === ex.key}
          onToggle={() => setOpen(open === ex.key ? null : ex.key)} />
      ))}
    </View>
  )
}

/** Does the plan give this session anything to show in "The moves"? */
export const hasMoves = (session: any) =>
  (session?.logSpec?.exercises || []).some((ex: any) => ex.how)

const s = StyleSheet.create({
  list: { gap: 8 },
  row: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    overflow: 'hidden',
  },
  rowOn: { borderColor: mix(colors.accent, 45, colors.line) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingVertical: 10, paddingHorizontal: 12 },
  thumb: { width: 50, height: 42 },
  heads: { flex: 1, minWidth: 0, gap: 2 },
  none: { paddingHorizontal: 14, paddingBottom: 14 },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
  fig: {
    height: 132, marginBottom: 14, padding: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 9,
  },
  steps: { gap: 9 },
  step: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  n: {
    width: 21, height: 21, marginTop: 1, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: mix(colors.accent, 18, colors.panel),
  },
  note: {
    flexDirection: 'row', gap: 9, alignItems: 'flex-start',
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 8,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  noteWarn: { borderColor: mix(colors.vizWarn, 35, colors.line) },
  noteIcon: { marginTop: 2 },
})
