/*
 * The card for `lib/unlogged.js` — workouts your watch knows about and your log
 * does not. The rules, and why each one is there, are documented in that file.
 * Ported from app/src/unlogged.jsx.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, mix, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Card, Press } from '../ui/kit'
import { success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { useWhoop } from '../lib/whoop.jsx'
import { useStrava } from '../lib/strava.jsx'
import {
  unloggedWorkouts, dismissedWorkouts, logCardOf, outWith, mergeTargets,
} from '../lib/unlogged.js'
import { withCasualName, withWarmupName } from '../lib/naming.js'
import { isDone } from '../lib/store.js'

const SOURCE: Record<string, string> = { whoop: 'WHOOP', strava: 'Strava' }

/*
 * WHEN it happened, in the user's own timezone.
 *
 * A duration is the one thing on this row that does not identify the workout —
 * two rides of 22 minutes are the same row twice — and the whole question the
 * card raises is which of the day's efforts each one is. Formatted from the
 * absolute instant (both services publish UTC), so the clock reads local.
 */
const clock = (iso: any) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * "6:05–7:33 PM", or just the start where there is no end.
 *
 * The meridiem is written once where both ends share it: this row is three
 * buttons wide on a phone, and "1:10 PM–1:45 PM · 35 min · WHOOP" wraps.
 */
const span = (a: any, b: any) => {
  const start = clock(a)
  if (!start) return ''
  const end = clock(b)
  if (!end || end === start) return start
  const meridiem = /\s?[AP]M$/i.exec(start)?.[0]
  const same = meridiem && end.toUpperCase().endsWith(meridiem.trim().toUpperCase())
  return `${same ? start.slice(0, -meridiem!.length) : start}–${end}`
}

export function UnloggedWorkouts({
  plan, entries, iso, onLog, onMerge = null,
  skipped = [], onDismiss, onRestore, split = [], onSplit,
}: {
  plan: any
  entries: any[]
  iso: string
  onLog: (card: any, out: any, extra?: any) => void
  onMerge?: ((entry: any, out: any) => void) | null
  skipped?: any[]
  onDismiss: (id: string) => void
  onRestore: (id: string) => void
  split?: any[]
  onSplit: (id: string) => void
}) {
  const { cache: whoop } = useWhoop() as any
  const { cache: strava } = useStrava() as any
  const [showGone, setShowGone] = useState(false)
  // Which row is asking "into which session?". One at a time — two open target
  // lists on a card this size is a card you cannot read.
  const [merging, setMerging] = useState<string | null>(null)

  const args = { plan, entries, iso, whoop, strava, skipped, split }
  const items: any[] = useMemo(() => (unloggedWorkouts as any)(args),
    [plan, entries, iso, whoop, strava, skipped, split])
  const gone: any[] = useMemo(() => (dismissedWorkouts as any)(args),
    [plan, entries, iso, whoop, strava, skipped, split])

  if (!items.length && !gone.length) return null

  const card = logCardOf(plan)
  const targetsFor = (item: any): any[] =>
    (mergeTargets as any)({ entries, iso, item, menu: plan?.dailyMenu || [] })

  /*
   * Log it, with the measurement already attached — through the same `attachTo`
   * the manual attach uses, so what lands is indistinguishable from an entry
   * built by hand, `filled` bookkeeping and all. A merged pair lands as ONE entry
   * carrying BOTH snapshots (see `mergedOut`).
   */
  const outFor = (item: any) => outWith(card, {}, item)

  const take = (item: any) => { success(); onLog(card, outFor(item)) }

  /*
   * Merge it into a session already on the day. The measurement is attached to
   * the TARGET's own card, not the generic workout card — a planned lift and a
   * ride declare different fields. Both attach helpers only fill BLANKS.
   */
  const mergeInto = (item: any, entry: any) => {
    const opt = (plan?.dailyMenu || []).find((m: any) => m.id === entry.data?.optId) || card
    success()
    onMerge!(entry, outWith(opt, entry.data?.out || {}, item))
    setMerging(null)
  }

  /*
   * "Just miles" — an activity, not a workout. `training: false` keeps the miles
   * on the bike and the day on the streak, and keeps a commute out of the load
   * chart, the week's quotas and the recommender. A second BUTTON rather than a
   * checkbox, because logging a ride here is one tap. It names itself "Commute"
   * (lib/naming.js), marked as the app's name so unticking takes it back.
   */
  const takeAsMiles = (item: any) => {
    success()
    onLog(card, (withCasualName as any)(outFor(item), { plan, opt: card, on: true }), { training: false })
  }

  /*
   * "Warm-up" — it happened, but it was the front of something else. Ten minutes
   * on the rower before a lift is not a rowing workout: same disposition as a
   * commute (`training: false`), differing only in its name. A third button
   * rather than a rename afterwards, because the cheap case costs one tap.
   */
  const takeAsWarmup = (item: any) => {
    success()
    onLog(card, (withWarmupName as any)(outFor(item), { plan, on: true }), { training: false })
  }

  /*
   * With everything dismissed there is no headline to write: the card once read
   * "0 workouts you have not logged / Recorded by ." The dismissed line stands
   * on its own.
   */
  const heading = items.length === 1
    ? 'A workout you have not logged'
    : `${items.length} workouts you have not logged`
  const sources = [...new Set(items.flatMap(i => (i.merged ? i.sources : [i.source])))] as string[]

  return (
    <Card>
      {items.length > 0 ? (
        <>
          <View style={u.h2}>
            <Icon name="HeartPulse" size={15} color={colors.ink} />
            <T size={14} weight={600} style={{ letterSpacing: 0.15, flexShrink: 1 }}>{heading}</T>
          </View>
          <T size={13} dim style={{ marginBottom: 8 }}>
            Recorded by {sources.map(k => SOURCE[k]).join(' and ')}.
            One tap logs it with the time and distance already filled in.
          </T>
        </>
      ) : null}

      {items.map(item => {
        const when = span(item.start, item.end)
        const targets = onMerge ? targetsFor(item) : []
        return (
          <View key={item.id} style={[u.row, item.merged && u.merged]}>
            <View style={u.line}>
              <View style={u.ico}><Icon name={item.activity?.icon || 'Activity'} size={17} color={colors.accent} /></View>
              <View style={u.name}>
                <T size={14} weight={700} numberOfLines={2}>{item.activity?.name || item.label}</T>
                {item.merged ? (
                  <>
                    <View style={u.srcs}>
                      {item.sources.map((k: string) => (
                        <View key={k} style={[u.pip, { borderColor: mix(k === 'whoop' ? colors.series1 : colors.series2, 45, colors.line) }]}>
                          <T size={10} dim lineHeight={13} style={{ letterSpacing: 0.2 }}>{SOURCE[k]}</T>
                        </View>
                      ))}
                    </View>
                    {/* Say the claim out loud, with the evidence for it: an
                        assertion the user cannot see is one they cannot correct.
                        The clock leads, because it tells them which effort it was. */}
                    <T size={10.5} color={colors.series3} tabular style={{ marginTop: 2 }}>
                      {when ? `${when} · ` : ''}{item.overlap} min in common — logged as one
                    </T>
                  </>
                ) : (
                  <T size={11} dim tabular>
                    {when ? `${when} · ` : ''}
                    {item.minutes ? `${item.minutes} min · ` : ''}{SOURCE[item.source]}
                  </T>
                )}
              </View>
              <View style={u.acts}>
                <Press onPress={() => take(item)} accessibilityRole="button" style={u.take}>
                  <T size={13} color={colors.accent}>Log it</T>
                </Press>
                <Press onPress={() => takeAsMiles(item)} accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }}
                  accessibilityHint="Counts the miles and the streak — not the quota, not as training" style={u.miles}>
                  <T size={11} dim numberOfLines={1}>Just miles</T>
                </Press>
                <Press onPress={() => takeAsWarmup(item)} accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }}
                  accessibilityHint="The front of another session — counts the minutes, not the quota" style={u.miles}>
                  <T size={11} dim numberOfLines={1}>Warm-up</T>
                </Press>
                {/*
                  * `pairUp` folds two measurements into one offer only while BOTH
                  * are unlogged; when Strava syncs first and the ride is logged off
                  * it, WHOOP's copy arrives with nothing left to pair with. See
                  * `mergeTargets`.
                  */}
                {onMerge && targets.length > 0 ? (
                  <Press haptic onPress={() => setMerging(merging === item.id ? null : item.id)}
                    accessibilityRole="button" accessibilityState={{ expanded: merging === item.id }} style={u.merge}>
                    <T size={12} dim numberOfLines={1}>{merging === item.id ? 'Never mind' : 'Same as…'}</T>
                  </Press>
                ) : null}
                {item.merged ? (
                  <Press haptic onPress={() => onSplit(item.id)} accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }} style={u.split}>
                    <T size={11} faint numberOfLines={1} style={{ textDecorationLine: 'underline' }}>Not the same</T>
                  </Press>
                ) : null}
              </View>
              <Press haptic onPress={() => onDismiss(item.id)} accessibilityRole="button" accessibilityLabel="not this one" style={u.no}>
                <Icon name="X" size={15} color={colors.inkFaint} />
              </Press>
            </View>

            {merging === item.id ? (
              <View style={u.pick}>
                <T size={12} dim lineHeight={18} style={{ marginBottom: 9 }}>
                  Which session on today is this the same activity as? Its heart rate, time
                  and distance get added to that one — nothing you have already typed is
                  overwritten.
                </T>
                {targets.map((e, n) => (
                  <Press key={e.id} onPress={() => mergeInto(item, e)} accessibilityRole="button"
                    style={[u.pickRow, n === targets.length - 1 && { marginBottom: 0 }]}>
                    <T size={13.5} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                      {e.data?.name || 'Session'}
                      {!isDone(e) ? <T size={12} faint> · not done yet</T> : null}
                    </T>
                    <T size={12} faint tabular>{e.data?.minutes ? `${e.data.minutes} min` : ''}</T>
                    <Icon name="ChevronRight" size={14} color={colors.inkDim} />
                  </Press>
                ))}
              </View>
            ) : null}
          </View>
        )
      })}

      {/* Waved off, not gone. A dismissal means "not now" — and the only way to
          undo one used to be hand-editing a skip entry. */}
      {gone.length > 0 ? (
        <View style={u.gone}>
          <Press haptic onPress={() => setShowGone(v => !v)} accessibilityRole="button"
            accessibilityState={{ expanded: showGone }} style={u.goneLine}>
            <Icon name={showGone ? 'EyeOff' : 'Eye'} size={13} color={colors.inkFaint} />
            <T size={12} faint>{gone.length} dismissed today</T>
            <Icon name={showGone ? 'ChevronUp' : 'ChevronDown'} size={13} color={colors.inkFaint} style={{ marginLeft: 'auto' }} />
          </Press>
          {showGone ? gone.map(item => (
            <View key={item.id} style={[u.row, { opacity: 0.6 }]}>
              <View style={u.line}>
                <View style={u.ico}><Icon name={item.activity?.icon || 'Activity'} size={16} color={colors.accent} /></View>
                <View style={u.name}>
                  <T size={14} weight={700} numberOfLines={2}>{item.activity?.name || item.label}</T>
                  <T size={11} dim tabular>
                    {[span(item.start, item.end), item.minutes ? `${item.minutes} min` : '']
                      .filter(Boolean).join(' · ')}
                  </T>
                </View>
                <Press haptic onPress={() => onRestore(item.id)} accessibilityRole="button" hitSlop={8} style={u.split}>
                  <T size={11} faint numberOfLines={1} style={{ textDecorationLine: 'underline' }}>Bring it back</T>
                </Press>
              </View>
            </View>
          )) : null}
        </View>
      ) : null}
    </Card>
  )
}

const u = StyleSheet.create({
  h2: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
  row: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  // One activity, two instruments: the app SHOWING its claim, with "Not the same" beside it.
  merged: { borderLeftWidth: 2, borderLeftColor: colors.series3, paddingLeft: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ico: { width: 22, alignItems: 'center' },
  name: { flex: 1, minWidth: 0, gap: 1 },
  srcs: { flexDirection: 'row', gap: 4, marginTop: 2 },
  pip: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: colors.line },
  acts: { gap: 4, alignItems: 'stretch' },
  take: {
    minHeight: TAP, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md,
  },
  miles: {
    minHeight: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: 6,
  },
  merge: {
    minHeight: 32, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: 8,
  },
  split: { minHeight: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  no: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  pick: {
    marginTop: 10, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, paddingHorizontal: 11, minHeight: TAP,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 9,
  },
  gone: { marginTop: 6, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 },
  goneLine: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34, paddingHorizontal: 2 },
})
