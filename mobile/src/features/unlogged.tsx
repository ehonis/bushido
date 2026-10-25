/*
 * The card for `lib/unlogged.js` — workouts your watch knows about and your log
 * does not. The rules, and why each one is there, are documented in that file.
 * Ported from app/src/unlogged.jsx.
 *
 * Since wave 2 (#44) each workout is a row with one action, "Log it". Everything
 * else (just miles, warm-up, same as another session, not the same, dismiss) is
 * behind the row: tap it and the rest opens underneath, one row at a time.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Chip, H2, Press } from '../ui/kit'
import { success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { useWhoop } from '../lib/whoop.jsx'
import { useStrava } from '../lib/strava.jsx'
import {
  unloggedWorkouts, dismissedWorkouts, logCardOf, outWith, mergeTargets,
} from '../lib/unlogged.js'
import { withCasualName, withWarmupName } from '../lib/naming.js'
import { isDone } from '../lib/store.js'
import { optFor } from '../lib/menu.js'

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
 * The meridiem is written once where both ends share it: "1:10 PM–1:45 PM ·
 * 35 min · WHOOP" wraps on a phone to say PM twice.
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
  plan, entries, iso, onLog, onMerge = null, onClimb = null,
  skipped = [], onDismiss, onRestore, split = [], onSplit, initialOpen = null,
}: {
  plan: any
  entries: any[]
  iso: string
  onLog: (card: any, out: any, extra?: any) => void
  onMerge?: ((entry: any, out: any) => void) | null
  onClimb?: ((item: any) => void) | null
  skipped?: any[]
  onDismiss: (id: string) => void
  onRestore: (id: string) => void
  split?: any[]
  onSplit: (id: string) => void
  initialOpen?: string | null
}) {
  const { cache: whoop } = useWhoop() as any
  const { cache: strava } = useStrava() as any
  const [showGone, setShowGone] = useState(false)
  // Which row is asking "into which session?". One at a time — two open target
  // lists on a card this size is a card you cannot read.
  const [merging, setMerging] = useState<string | null>(null)
  // Which row has its other actions open. One at a time, for the same reason.
  const [openId, setOpenId] = useState<string | null>(initialOpen)

  const args = { plan, entries, iso, whoop, strava, skipped, split }
  // A climb is only offered where there is a climbing card to log it on.
  const items: any[] = useMemo(() => (unloggedWorkouts as any)(args).filter((i: any) => !i.climbing || onClimb),
    [plan, entries, iso, whoop, strava, skipped, split, onClimb])
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
    // optFor, not a raw find: a renamed card answers to its old id (AGENTS.md §6.2).
    const opt = (optFor as any)(plan?.dailyMenu || [], entry.data?.optId) || card
    success()
    onMerge!(entry, outWith(opt, entry.data?.out || {}, item))
    setMerging(null)
  }

  /*
   * "Just miles" — an activity, not a workout. `training: false` keeps the miles
   * on the bike and the day on the streak, and keeps a commute out of the load
   * chart. A BUTTON behind the row rather than a checkbox in the form, so a
   * commute is two taps. It names itself "Commute"
   * (lib/naming.js), marked as the app's name so unticking takes it back.
   */
  const takeAsMiles = (item: any) => {
    success()
    onLog(card, (withCasualName as any)(outFor(item), { plan, opt: card, on: true }), { training: false })
  }

  /*
   * "Warm-up" — it happened, but it was the front of something else. Ten minutes
   * on the rower before a lift is not a rowing workout: same disposition as a
   * commute (`training: false`), differing only in its name. A button rather
   * than a rename afterwards.
   */
  const takeAsWarmup = (item: any) => {
    success()
    onLog(card, (withWarmupName as any)(outFor(item), { plan, on: true }), { training: false })
  }

  /*
   * With everything dismissed there is no headline to write: the card once read
   * "0 workouts you have not logged". The dismissed line stands on its own.
   */
  const heading = items.length === 1 ? 'A workout not logged yet' : `${items.length} workouts not logged yet`

  return (
    <Card>
      {items.length > 0 ? <H2 style={{ marginBottom: space[2] }}>{heading}</H2> : null}

      {items.map((item, n) => {
        const when = span(item.start, item.end)
        const open = openId === item.id
        const targets = onMerge ? targetsFor(item) : []
        return (
          <View key={item.id} style={n > 0 && u.rule}>
            <View style={u.row}>
              <Press haptic onPress={() => { setOpenId(open ? null : item.id); setMerging(null) }}
                accessibilityRole="button" accessibilityState={{ expanded: open }} style={u.main}>
                <Icon name={item.activity?.icon || 'Activity'} size={20} color={colors.inkDim} />
                <View style={u.name}>
                  <T size={font.body} weight={500} numberOfLines={1}>{item.activity?.name || item.label}</T>
                  <T size={font.small} dim tabular>
                    {item.merged
                      /* Say the claim out loud, with the evidence for it: an
                         assertion the user cannot see is one they cannot correct. */
                      ? `${when ? `${when} · ` : ''}${item.sources.map((k: string) => SOURCE[k]).join(' + ')}, ${item.overlap} min in common`
                      : `${when ? `${when} · ` : ''}${item.minutes ? `${item.minutes} min · ` : ''}${SOURCE[item.source]}`}
                  </T>
                </View>
              </Press>
              {/* A climb goes to the climbing folders to pick its card, which asks
                  the hard-finger question (AGENTS.md §6.1). */}
              <Btn kind="secondary" title="Log it"
                onPress={() => (item.climbing ? onClimb?.(item) : take(item))} />
            </View>

            {open ? (
              <View style={u.more}>
                <View style={u.acts}>
                  {/* Never "just miles" or a warm-up for a climb: a climb that
                      skipped the finger question is what this card must not make. */}
                  {!item.climbing ? (
                    <>
                      <Chip label="Just miles" onPress={() => takeAsMiles(item)} />
                      <Chip label="Warm-up" onPress={() => takeAsWarmup(item)} />
                    </>
                  ) : null}
                  {/*
                    * `pairUp` folds two measurements into one offer only while BOTH
                    * are unlogged; when Strava syncs first and the ride is logged off
                    * it, WHOOP's copy arrives with nothing left to pair with. See
                    * `mergeTargets`.
                    */}
                  {targets.length > 0 ? (
                    <Chip label="Same as…" on={merging === item.id}
                      onPress={() => setMerging(merging === item.id ? null : item.id)} />
                  ) : null}
                  {item.merged ? <Chip label="Not the same" onPress={() => onSplit(item.id)} /> : null}
                  <Chip label="Dismiss" onPress={() => onDismiss(item.id)} />
                </View>

                {merging === item.id ? (
                  <View style={{ marginTop: space[2] }}>
                    {targets.map((e, i) => (
                      <Press key={e.id} haptic onPress={() => mergeInto(item, e)} accessibilityRole="button"
                        style={[u.pickRow, i > 0 && u.rule]}>
                        <View style={u.name}>
                          <T size={font.body} weight={500} numberOfLines={1}>{e.data?.name || 'Session'}</T>
                          <T size={font.small} dim tabular>
                            {[e.data?.minutes ? `${e.data.minutes} min` : '', !isDone(e) ? 'not done yet' : '']
                              .filter(Boolean).join(' · ') || 'Adds to it, nothing typed is replaced'}
                          </T>
                        </View>
                        <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
                      </Press>
                    ))}
                  </View>
                ) : null}
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
            <T size={font.small} dim>{`${gone.length} dismissed today`}</T>
            <Icon name={showGone ? 'ChevronUp' : 'ChevronDown'} size={14} color={colors.inkFaint} />
          </Press>
          {showGone ? gone.map((item, i) => (
            <View key={item.id} style={[u.row, i > 0 && u.rule]}>
              <Icon name={item.activity?.icon || 'Activity'} size={20} color={colors.inkDim} />
              <View style={u.name}>
                <T size={font.body} weight={500} numberOfLines={1}>{item.activity?.name || item.label}</T>
                <T size={font.small} dim tabular>
                  {[span(item.start, item.end), item.minutes ? `${item.minutes} min` : '']
                    .filter(Boolean).join(' · ')}
                </T>
              </View>
              <Btn kind="quiet" title="Bring it back" onPress={() => onRestore(item.id)} />
            </View>
          )) : null}
        </View>
      ) : null}
    </Card>
  )
}

const u = StyleSheet.create({
  rule: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[1] },
  // The row's name opens the rest; "Log it" beside it is the one action.
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: TAP },
  name: { flex: 1, minWidth: 0, gap: 2 },
  more: { paddingBottom: space[3], paddingLeft: 20 + space[3] },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2] },
  gone: { marginTop: space[2], borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space[1] },
  goneLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, alignSelf: 'flex-start' },
})
