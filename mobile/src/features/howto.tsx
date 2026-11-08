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
import { colors, mix, radius, font, space } from '../theme'
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
      {how.gist ? <T size={font.body} weight={500} style={{ marginBottom: space[3] }}>{how.gist}</T> : null}

      {how.steps?.length > 0 ? (
        <View style={s.steps}>
          {how.steps.map((step: string, i: number) => (
            <View key={i} style={s.step}>
              <View style={s.n}><T size={font.caption} weight={700} color={colors.accent} lineHeight={13} tabular>{String(i + 1)}</T></View>
              <T size={font.label} style={{ flex: 1 }}>{step}</T>
            </View>
          ))}
        </View>
      ) : null}

      {how.watch ? (
        <View style={[s.note, s.noteWarn]}>
          <Icon name="TriangleAlert" size={15} color={colors.vizWarn} style={s.noteIcon} />
          <View style={{ flex: 1 }}>
            <T size={font.label} weight={600} color={colors.vizWarn} style={{ marginBottom: 2 }}>Most common mistake</T>
            <T size={font.label} dim>{how.watch}</T>
          </View>
        </View>
      ) : null}
      {how.easier ? (
        <View style={s.note}>
          <Icon name="Feather" size={15} color={colors.inkFaint} style={s.noteIcon} />
          <View style={{ flex: 1 }}>
            <T size={font.label} weight={600} style={{ marginBottom: 2 }}>Make it easier</T>
            <T size={font.label} dim>{how.easier}</T>
          </View>
        </View>
      ) : null}
      {how.harder ? (
        <View style={s.note}>
          <Icon name="TrendingUp" size={15} color={colors.inkFaint} style={s.noteIcon} />
          <View style={{ flex: 1 }}>
            <T size={font.label} weight={600} style={{ marginBottom: 2 }}>Make it harder</T>
            <T size={font.label} dim>{how.harder}</T>
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
          <T size={font.body} weight={600}>{exercise.name}</T>
          {how?.gist ? <T size={font.caption} dim numberOfLines={open ? 3 : 2}>{how.gist}</T> : null}
        </View>
        {dose ? <T size={font.caption} faint tabular numberOfLines={1}>{dose}</T> : null}
        <View style={open ? { transform: [{ rotate: '180deg' }] } : null}>
          <Icon name="ChevronDown" size={17} color={open ? colors.accent : colors.inkFaint} />
        </View>
      </Press>
      {open && how ? <HowBody how={how} showFigure={false} style={s.body} /> : null}
      {open && !how ? (
        <T size={font.label} faint style={s.none}>
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
  list: { gap: space[2] },
  row: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
    overflow: 'hidden',
  },
  rowOn: { borderColor: mix(colors.accent, 45, colors.line) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 62, paddingVertical: space[2], paddingHorizontal: space[3] },
  thumb: { width: 50, height: 42 },
  heads: { flex: 1, minWidth: 0, gap: 2 },
  none: { paddingHorizontal: space[4], paddingBottom: space[4] },
  body: { paddingHorizontal: space[4], paddingBottom: space[4] },
  fig: {
    height: 132, marginBottom: space[4], padding: space[2],
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
  },
  steps: { gap: space[2] },
  step: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  n: {
    width: 21, height: 21, marginTop: 1, borderRadius: radius.card,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: mix(colors.accent, 18, colors.panel),
  },
  note: {
    flexDirection: 'row', gap: space[2], alignItems: 'flex-start',
    marginTop: space[3], paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.control,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  noteWarn: { borderColor: mix(colors.vizWarn, 35, colors.line) },
  noteIcon: { marginTop: 2 },
})
