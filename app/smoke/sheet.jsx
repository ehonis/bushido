/* Smoke cases: the session sheet: header, body, footer, the log form, details, how-to.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { isoShift, dayWords, dayPhrase } from '../src/lib/dates.js'
import { readFileSync } from 'node:fs'
import { Modal, isTextEntry, footerShown, sheetDismissable, EDIT_SETTLE_MS } from '../src/modal.jsx'
import { SessionSheet, planTalkWhere } from '../src/sheet.jsx'
import { LogSheet } from '../src/log.jsx'
import { sessionOps } from '../src/lib/sessionops.js'
import { WorkoutRunner } from '../src/runner.jsx'
import { climbingFolders } from '../src/lib/folders.js'
import { normalizePrescription, emptyRun, setCircuit, tickSet } from '../src/lib/prescription.js'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { SessionLog, NameField, SessionDetails, DetailsSheet, NOTE_HINTS, PriorNote } from '../src/sessionlog.jsx'
import { SetLog, withoutClimb, withClimbBack } from '../src/setlog.jsx'
import { ExerciseCard, implementPick } from '../src/exercises.jsx'
import { liftFieldOf } from '../src/lib/lifts.js'
import { SectionBody } from '../src/session.jsx'
import { HowSheet, MovesList, HowRow } from '../src/howto.jsx'
import { FIGURES, hasFigure } from '../src/lib/figures.jsx'
import { resolveCeiling, ceilingState } from '../src/lib/force.js'
import { hasWorkout } from '../src/lib/workout.js'
import { TimerHost, openTimer, closeTimer, timerRequestFor, TimerSetup } from '../src/timer.jsx'
import { ToastList, toastTop } from '../src/toast.jsx'
import { DoneChip, doneChipLabel } from '../src/sheetparts.jsx'
import { BUILT_INS } from '../src/lib/timer.js'
import {
  plan, example, entries, noop, otherCard, priorLifts, TODAY, back, rich, noteHistory,
  cfEntries, text, augOnly, uniWork, LIFT_FIELD, SQUAT, PRESCRIPTION, PLANNED_CARD,
  PLANNED_ENTRY, HELD_PLAN, noClimbing, starter,
} from './fixtures.jsx'

export default [
  /*
   * ABSENCES, which are the only thing a render test can say about a removal.
   *
   * The add-on pills and the "MAIN SESSION" strap came off the sheet as unused
   * clutter that got in the way. Putting either back is a
   * change that still renders, so asserting they are gone is the only way to
   * catch it — same argument as `TodayTab(empty day offers nothing)`.
   */
  ['SessionSheet(no add-ons, no strap)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'hard-home')
    const t = text(renderToString(
      <SessionSheet opt={opt} entry={null} tone="rec" entries={[]}
        onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />))
    if (/Add-ons for this session/.test(t)) throw new Error('the add-on pills are back')
    if (/Main session|Added session/.test(t)) throw new Error('the tone strap is back')
    if (!t.includes(opt.name)) throw new Error('the sheet is not about the session it was handed')
  }],
  /*
   * THE HEADER IS EDIT AND CLOSE; REMOVE IS IN EDIT (#94, C N13). The bin used
   * to sit in the header beside the pencil and the X (three 44px buttons 12px
   * apart), and on a day still to come, with no pencil, right beside the X. It
   * replaced two text links at the very foot of the form, a long scroll to do
   * something irreversible; it now sits at the foot of the pencil's panel, which
   * holds everything set once about the workout, two layers and a question from
   * the X. Pinned from both sides: no bin in the sheet's header, and Remove
   * workout in the panel, worded, asking first.
   */
  ['SessionSheet(the header is Edit and Close: no bin beside the X, on today or a day to come)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Ride', minutes: 45, out: { activity: 'bike' } } }
    const head = (html) => (html.match(/<header class="modal-head[^"]*">([\s\S]*?)<\/header>/) || [])[1] || ''
    const html = renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rec" entries={rich} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />)
    if (!/aria-label="Edit this workout"/.test(head(html))) throw new Error('no pencil in the header')
    if (/Trash2|Remove workout|modal-btn danger/.test(head(html))) throw new Error('the bin is back in the header beside the X')
    if (/linkbtn extra-rm/.test(html)) throw new Error('the footer remove link survived')
    const later = isoShift(TODAY, 2)
    const future = renderToString(<PlanProvider plan={plan}>
      <SessionSheet opt={PLANNED_CARD} entry={{ ...PLANNED_ENTRY, id: `daily-${later}`, date: later }} entries={rich} isFuture
        onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onRemove={noop} onClose={noop} />
    </PlanProvider>)
    if (/Remove workout|Trash2/.test(head(future))) throw new Error('a day still to come has the bin beside the X')
    if (!/aria-label="Edit this workout"/.test(head(future))) throw new Error('a day still to come has no way to its name and Remove')
  }],
  ['DetailsSheet(Remove workout at its foot, worded; no footer "Done"; the name hint is the title on the sheet)', null, () => {
    const draw = (props) => renderToString(<PlanProvider plan={plan}>
      <DetailsSheet session={PLANNED_CARD} entry={PLANNED_ENTRY} entries={rich} onSave={noop} onClose={noop} {...props} />
    </PlanProvider>)
    const html = draw({ onRemove: noop })
    if (!/class="details-remove"[\s\S]*Remove workout/.test(html)) throw new Error('no Remove workout in Edit this workout')
    if (/<footer/.test(html)) throw new Error('Edit this workout has a footer (its "Done" was a Close)')
    if (/>Done<\/button>/.test(html)) throw new Error('a second control called Done on the sheet')
    const head = (html.match(/<header[\s\S]*?<\/header>/) || [''])[0]
    if (/Remove|Trash2/.test(head)) throw new Error('Remove sits in the panel\u2019s header beside its X')
    if (/details-remove/.test(draw({}))) throw new Error('Remove offered where the caller cannot remove')
    const title = PRESCRIPTION.title
    if (!new RegExp(`class="out-name-box"[^>]*placeholder="${title}"`).test(html)) {
      throw new Error(`the name box's hint is not "${title}", the title the sheet shows`)
    }
    if (/placeholder="Planned workout"/.test(html)) throw new Error('the name box offers the card\u2019s name over the plan\u2019s')
    const future = draw({ onRemove: noop, future: true })
    if (/Time spent|out-casual/.test(future)) throw new Error('a day still to come asks how long it took')
  }],
  ['SessionLog(the note boxes hint, short and about no sport; never a climb written out as if logged)', null, () => {
    const lift = plan.dailyMenu.find(m => m.id === 'log-workout')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: lift.id, out: { activity: 'lift' } } }
    const html = renderToString(<SessionLog session={lift} entry={entry} entries={[]} onSave={noop} />)
    if (/rowed 10 min|knee grumbled|problem 3|chalking/.test(html)) throw new Error('the old example notes are back')
    for (const h of Object.values(NOTE_HINTS)) {
      if (!html.includes(`placeholder="${h}"`)) throw new Error(`no "${h}" hint`)
      if (h.length > 30 || /climb|grade|problem|run|ride|lift/i.test(h)) throw new Error(`"${h}" is long or about a sport`)
    }
    const css = readFileSync(new URL('../src/css/sheet.css', import.meta.url), 'utf8')
    if (!/\.notefield textarea::placeholder \{ font-size: var\(--fs-label\); \}/.test(css)) throw new Error('the hint is body-sized, like a note')
  }],
  ['DoneChip(named by what is true and what a tap does, never a bare "Done")', null, () => {
    const on = renderToString(<DoneChip done onToggle={noop} />)
    if (!/aria-label="Done, mark undone"/.test(on) || !/>Done</.test(on)) throw new Error('the done chip is not "Done, mark undone"')
    if (!/aria-label="Sam: Not done, mark done"/.test(renderToString(<DoneChip done={false} whose="Sam" onToggle={noop} />))) {
      throw new Error('someone else\u2019s chip does not say whose and what a tap does')
    }
    if (doneChipLabel(true) === 'Done') throw new Error('the chip is named "Done", like the menus\u2019 close')
  }],
  /*
   * TOASTS UNDER THE TOPMOST HEADER (#94, A F10, B F4). On the web the deck sat
   * at a fixed 60px, over an open sheet's header: its ✕ landed where the sheet's
   * Close is. The phone starts its deck under the sheet's header; the web now
   * measures the header on top and starts under it.
   */
  ['toastTop(under the last header laid out; nothing open, the CSS place) and ToastList(top)', null, () => {
    const head = (bottom, height = 60) => ({ getBoundingClientRect: () => ({ top: bottom - height, bottom, height }) })
    const doc = (heads) => ({ querySelectorAll: (sel) => (/\.modal-head/.test(sel) && /\.wk-head/.test(sel) && /\.it-head/.test(sel) ? heads : []) })
    const H = 844
    if (toastTop(doc([head(120)]), H)?.top !== 128) throw new Error('the deck does not start under the sheet\u2019s header')
    if (toastTop(doc([head(120), head(200)]), H)?.top !== 208) throw new Error('a sheet over a sheet: not under the top one')
    if (toastTop(doc([head(120), head(0, 0)]), H)?.top !== 128) throw new Error('a hidden header (a side not on screen) was measured')
    if (toastTop(doc([]), H) !== null || toastTop(null, H) !== null) throw new Error('with nothing open the deck is not left to the CSS')
    // Edit this workout at 390: a bottom panel whose header starts at 476 of 844. Under
    // it the deck covered the Name box; it goes above the panel instead (#101 review).
    const low = toastTop(doc([head(120), head(536, 60)]), H)
    if (low?.bottom !== H - 476 + 8 || low.top != null) throw new Error(`a low panel's deck is ${JSON.stringify(low)}, not above the panel`)
    const list = renderToString(<ToastList toasts={[{ id: 1, text: 'Removed Pull', kind: 'info', count: 1 }]} at={{ top: 128 }} />)
    if (!/class="toasts" style="top:128px"/.test(list)) throw new Error('the deck is not placed where it was measured')
    const above = renderToString(<ToastList toasts={[{ id: 1, text: 'x', kind: 'info', count: 1 }]} at={{ bottom: 376 }} />)
    if (!/class="toasts" style="top:auto;bottom:376px"/.test(above)) throw new Error('the deck is not placed above a low panel')
    if (/style=/.test(renderToString(<ToastList toasts={[{ id: 1, text: 'x', kind: 'info', count: 1 }]} />))) throw new Error('a deck with no header moved off the CSS place')
  }],
  // Every menu entry has to survive being read in all three viewers: the picker
  // dialog, the day-list sheet, and the fullscreen page. These are where a bad
  // property access in hand-written plan.json content actually shows up.
  ...plan.dailyMenu
    .filter(m => m.role !== 'adjunct' && m.role !== 'rest')
    .flatMap(m => {
      const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'main', optId: m.id, level: m.level, name: m.name, minutes: m.minutes, out: {} } }
      return [
        [`Sheet(${m.id})`,
          <SessionSheet opt={m} entry={entry} tone="rec" entries={rich} isFuture={false}
            onLog={noop} onSave={noop} onClose={noop} />],
      ]
    }),
  /*
   * "Log another workout today" came OFF the sheet on 2026-09-21. The day list's
   * own button (pinned separately, below) and the + button are
   * both one tap from here, and a third route at the foot of a form was part of
   * what made this screen read as a maze.
   *
   * Pinned as an absence, and pinned NEXT TO the day-list route deliberately: the
   * mistake to avoid is not "this button came back", it is removing a door and
   * leaving no door, which is exactly what happened to the climbing cards when
   * the swap list went.
   */
  ['Sheet(no second route to a second session)',
    <SessionSheet opt={otherCard} tone="extra" entries={rich} isFuture={false}
      entry={{ id: `daily-${TODAY}-log-workout`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Lift', minutes: 52,
          done: true, out: { activity: 'lift', duration: 52, rpe: 5 } } }}
      onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />,
    html => {
      if (/Log another workout today/.test(text(html))) {
        throw new Error('the sheet\u2019s "and another one" link is back')
      }
    }],
  /*
   * A rename is the HEADER's name too, not just a line inside the form.
   *
   * `titleFor` puts their words over the planner's title over the card's, and this
   * case is the wiring rather than the ordering (which `naming.test.js` pins):
   * every one of these headers used to read `pres?.title || nameFor(...)`, so a
   * renamed planned session would have kept announcing itself as "Legs".
   */
  ['Sheet(renamed, and the header says so)',
    <SessionSheet opt={otherCard} tone="extra" entries={rich} isFuture={false}
      entry={{ id: 'nm3', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Bike', minutes: 22,
          done: true, plan: { title: 'Zone 2 ride' },
          out: { activity: 'bike', duration: 22, title: 'Commute' } } }}
      onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />,
    html => {
      const t = text(html)
      if (!/Commute/.test(t)) throw new Error('the header ignored the rename')
      if (/>Zone 2 ride</.test(t)) throw new Error('the plan\'s title outranked his own words')
    }],
  // An unlogged main and an add-on both reach the sheet by different paths.
  ['Sheet(unlogged)', <SessionSheet opt={plan.dailyMenu[0]} entry={null} tone="rec" entries={rich}
    isFuture={false} onLog={noop} onSave={noop} onClose={noop} />],
  ['Sheet(adjunct, no log)', <SessionSheet opt={plan.dailyMenu.find(m => m.role === 'adjunct')} entry={null}
    tone="adj" entries={rich} isFuture={false} onLog={null} onSave={noop} onClose={noop} />],
  ['Sheet(extra, removable)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'x', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'fun-boulder', level: 3, name: 'Bouldering with friends', minutes: 90,
        out: { intensity: 3, rpe: 6 } } }}
    tone="extra" entries={rich} isFuture={false} onLog={noop} onSave={noop} onRemove={noop}
    onClose={noop} />],
  /* Workout mode is offered per SESSION, and the sessions that lost it must lose
   * only the timer — the set log, the done button and the notes are the whole
   * point of opening the sheet and are untouched. */
  ['Sheet(a session with no timer to run)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'lead-laps')}
      entry={{ id: 'll2', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'lead-laps', level: 3, minutes: 30, done: false, out: {} } }}
      tone="extra" entries={rich} isFuture={false} onLog={noop} onSave={noop}
      onStartWorkout={noop} onSetDone={noop} onClose={noop} />,
    html => {
      // Nobody stands at a wall driving a timer through doubled laps.
      if (/Start workout/.test(text(html))) throw new Error('doubled lead laps must not offer a timer')
      if (!/Doubles/.test(text(html))) throw new Error('but it still logs set by set')
    }],
  ['Sheet(a session that does run a clock)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'max-hangs')}
      entry={{ id: 'mh', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'main', optId: 'max-hangs', level: 4, minutes: 25, done: false, out: {} } }}
      tone="rec" entries={rich} isFuture={false} onLog={noop} onSave={noop}
      onStartWorkout={noop} onSetDone={noop} onClose={noop} />,
    html => {
      if (!/Start workout/.test(text(html))) throw new Error('a 7-second hang needs the countdown')
    }],
  // Per-session notes, and the repeat lookup that surfaces the previous one.
  ['SessionLog(notes + history)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'cur', kind: 'daily', date: '2026-10-01', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    entries={noteHistory} onSave={noop} bare />],
  /* Time spent is on EVERY session, and the estimate is a placeholder rather than
   * a pre-filled value — a pre-filled 150 is a number you confirm without
   * reading, and confirming the plan is what the field exists to stop. */
  ['SessionDetails(time spent, nothing said)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts', kind: 'daily', date: '2026-10-06', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      const est = plan.dailyMenu.find(m => m.id === 'four-by-four').minutes
      if (!/aria-label="Time spent, in minutes"/.test(html)) throw new Error('no time-spent field')
      if (!new RegExp(`placeholder="${est}"`).test(html)) throw new Error('the estimate is not the placeholder')
      if (new RegExp(`aria-label="Time spent, in minutes"[^>]*value="${est}"`).test(html)) {
        throw new Error('the estimate was pre-filled into the field')
      }
    }],
  ['SessionDetails(time spent, typed over everything)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts2', kind: 'daily', date: '2026-10-07', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80,
        out: { minutesSpent: 65, elapsedMin: 71, whoop: { minutes: 96 } } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      if (!/value="65"/.test(html)) throw new Error('the typed number is not in the field')
      // What the user typed has settled it, so nothing is being offered instead.
      const t = text(html)
      if (/use \d+ from/.test(t)) throw new Error('a typed number should not be second-guessed')
      // No jargon under it ("RPE", "training load"): the typed number needs no sentence (#41).
      if (/RPE|training-load/.test(t)) throw new Error('jargon under the time box')
    }],
  /* Attaching a WHOOP workout SETS the length — the whole point of the ordering.
   * Nothing to confirm, and the number in use is on screen rather than implied. */
  ['SessionDetails(time spent, from WHOOP)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts4', kind: 'daily', date: '2026-10-09', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80,
        out: { elapsedMin: 71, whoop: { minutes: 96, sport: 'rock-climbing' } } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      const t = text(html)
      if (!/Using the 96 min WHOOP recorded/.test(t)) throw new Error('the number in use is not stated')
      if (!/placeholder="96"/.test(html)) throw new Error("the field should show WHOOP's number")
      // Never pre-FILLED — a value the user did not give must not look like one the user did.
      if (/aria-label="Time spent, in minutes"[^>]*value="96"/.test(html)) {
        throw new Error('pre-filled a number he never typed')
      }
      // The losing measurement is the one thing the user cannot see, so it is a tap.
      if (!/use 71 from the timer instead/.test(t)) throw new Error("workout mode's clock is not offered")
    }],
  // Log a workout already asks for its own duration, so it must not grow a second box.
  ['SessionDetails(asks its own duration)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'log-workout')}
    entry={{ id: 'ts3', kind: 'daily', date: '2026-10-08', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, minutes: 38, out: { activity: 'run', duration: 38 } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('two boxes for one fact: it already asks for its duration')
      }
    }],
  /* ------------------------------------------------ the free-form card's form
   *
   * *Log a workout* is one card covering a run, a bike ride and a lift, so what
   * it ASKS follows what was picked — originally it asked a lifting day
   * for its distance and incline, and had nowhere at all to put six exercises.
   * These cases pin the three states, because a gate that stops matching renders
   * as a field silently missing rather than as an error.
   */
  ['SessionLog(other training, nothing picked yet)', <SessionLog session={otherCard}
    entry={{ id: 'ot0', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: {} } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (!/What did you do\?/.test(t)) throw new Error('the one question that is always a question')
      // Everything else is noise until it knows what the workout was.
      if (/Distance/.test(t)) throw new Error('an empty card is asking for a distance')
      if (/Incline/.test(t)) throw new Error('an empty card is asking for an incline')
      if (/search \d+ of them/.test(t)) throw new Error('an empty card is offering the lift catalog')
      if (/How hard was it/.test(t)) throw new Error('an empty card is asking how hard nothing was')
    }],
  ['SessionLog(other training, a run)', <SessionLog session={otherCard}
    entry={{ id: 'ot1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 3, out: { activity: 'run', duration: 38, distance: 3.1 } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (!/Distance/.test(t)) throw new Error('a run has no distance field')
      if (!/Elevation/.test(t)) throw new Error('an outdoor run records no elevation')
      // Incline is a treadmill setting. The old card gated it on `activity:
      // ["run", "walk"]`, so a road run was asked its incline and a treadmill was
      // asked its elevation gain — exactly backwards, for both.
      if (/Incline/.test(t)) throw new Error('a road run is being asked for its incline')
      if (/What did you lift/.test(t)) throw new Error('a run is being asked for its exercises')
      // Average speed is distance over time — arithmetic the user must never be asked
      // to do. Offered as a PLACEHOLDER, never as a value the user did not give.
      if (!/placeholder="4\.9"/.test(html)) throw new Error('the pace was not worked out for him')
      if (/aria-label[^>]*speed[^>]*value="4\.9"/i.test(html)) throw new Error('a computed number was pre-filled')
      if (!/Worked out from your distance and time/.test(t)) throw new Error('the derived number is unlabelled')
      // The card's example numbers ("450 ft") are not shown: in a number box they
      // read as guesses the app had made, and it had made none (#41).
      if (/placeholder="450"|placeholder="45"|placeholder="14\.2"/.test(html)) throw new Error('a content example is posing as a guess')
      // The activity is a row that opens the picker, not a "Change" link in a box.
      if (!/class="list-row actrow"/.test(html)) throw new Error('the activity is not a row')
      if (/actpick-change/.test(html)) throw new Error('the underlined "Change" link is back')
      // The form is open: no fold title over it.
      if (/Session logged|How did it go/.test(t)) throw new Error('the form is folded behind a title again')
    }],
  /*
   * RENAMING ONE WORKOUT.
   *
   * A single workout can be renamed, with quick-entry names as taps so typing is
   * only needed for a genuinely specific name. Three things are pinned here and
   * each has a way of failing silently. The box must be EMPTY with the session's
   * current name as its placeholder — a pre-filled "Bike" is a string the user
   * confirms without reading,
   * and clearing the box is how the default comes back. Every name the content
   * declares for the discipline has to be IN THE PAGE, folded or not, or a chip
   * is unreachable and no rendering test would notice. And a name the user gave has
   * to read back in the box rather than as a placeholder they might type over.
   *
   * Rendered as `NameField` directly, because that is where it
   * lives now: the box left the log form for a layer of its own behind the
   * pencil in the sheet's header, and a render suite cannot press a pencil. That
   * the pencil EXISTS is pinned separately, in SessionSheet.
   */
  ['NameField(an empty box, and every chip in the page)',
    <PlanProvider plan={plan}>
      <NameField session={otherCard} out={{ activity: 'bike', duration: 22 }} onChange={noop} />
    </PlanProvider>,
    html => {
      const t = text(html)
      if (!/class="out-name-box"[^>]*placeholder="Bike"/.test(html)) {
        throw new Error('the name it already has should be the box\'s placeholder')
      }
      if (/class="out-name-box"[^>]*value="Bike"/.test(html)) {
        throw new Error('a name he did not type must never be pre-filled')
      }
      for (const n of [...plan.quickNames.byDiscipline.bike, ...plan.quickNames.any]) {
        if (!t.includes(n)) throw new Error(`no chip for "${n}" — an unreachable quick name`)
      }
      if (!/Commute/.test(t)) throw new Error('the commute chip is the whole point')
      if (/Long run/.test(t)) throw new Error('a ride is being offered running names')
    }],
  ['NameField(his own name reads back)',
    <PlanProvider plan={plan}>
      <NameField session={otherCard} out={{ activity: 'bike', title: 'Lunch ride with the club' }} onChange={noop} />
    </PlanProvider>,
    html => {
      if (!/class="out-name-box"[^>]*value="Lunch ride with the club"/.test(html)) {
        throw new Error('a name he typed belongs in the box, not in the placeholder')
      }
      // The way back to the default, in the card's own words.
      if (!/use “Bike”/.test(text(html))) throw new Error('no way back to what the card calls it')
    }],
  /*
   * WHAT THE LOG FORM NO LONGER HOLDS, which is the only thing a render test can
   * say about the split. Everything below the WHOOP and Strava blocks, except the
   * notes and "how hard was it", moved to the edit modal. So the name, the gear,
   * "just miles" and time spent are all in
   * `SessionDetails` behind the pencil — and what STAYED is asserted here too,
   * because moving one field too many is the easy mistake and it renders fine.
   */
  ['SessionLog(the details moved out, the notes and the effort stayed)',
    <PlanProvider plan={plan}><SessionLog session={otherCard}
      entry={{ id: 'nm3', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, out: { activity: 'bike', duration: 22 } } }}
      entries={[]} onSave={noop} bare /></PlanProvider>,
    html => {
      const t = text(html)
      if (/out-name-box/.test(html)) throw new Error('the name box is back in the log form')
      if (/class="gear/.test(html)) throw new Error('the gear picker is back in the log form')
      if (/Just miles — not a workout/.test(t)) throw new Error('the just-miles box is back in the log form')
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('time spent is back in the log form')
      }
      // And what is meant to STAY there.
      if (!/Notes<\/span>/.test(html)) throw new Error('no plain notes box')
      if (!/What to improve next time/.test(t)) throw new Error('the improve box went with it')
      // The notes and the effort question are the two things that stay.
      if (!/How hard was it\?/.test(t)) {
        throw new Error('"how hard was it" was supposed to stay on the form')
      }
    }],
  /* And every one of them IS in the panel behind the pencil. A field that left
   * one screen and arrived on no other is indistinguishable from a deletion. */
  ['SessionDetails(name, gear, just miles and time spent, all in one place)',
    <PlanProvider plan={plan}><SessionDetails session={otherCard}
      entry={{ id: 'nm4', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, minutes: 22,
          out: { activity: 'bike', duration: 22 } } }}
      entries={[]} onSave={noop} training={undefined} onTraining={noop} /></PlanProvider>,
    html => {
      const t = text(html)
      if (!/out-name-box/.test(html)) throw new Error('no name box')
      if (!/Just miles, not a workout/.test(t)) throw new Error('no just-miles box')
      // This card asks for its own duration, so it must NOT also get the generic
      // box — two boxes for one fact is two answers. See asksItsOwnDuration.
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('a card that asks its own duration grew a second box')
      }
    }],
  /* The lift form: the exercise search, and a logged session reading back with
   * its implement, its sets and what the user lifted last time. */
  ['SessionLog(other training, a lift)', <SessionLog session={otherCard}
    entry={{ id: 'ot2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', duration: 52, lifts: [
        { uid: 'bent-over-row-1', key: 'bent-over-row', name: 'Bent-over row', group: 'Back',
          implement: 'dumbbell', implementLabel: 'Dumbbell',
          sets: [{ reps: 10, weight: 30 }, { reps: 10, weight: 30 }, { reps: 8, weight: 30 }] },
        { uid: 'external-rotation-1', key: 'external-rotation', name: 'Shoulder external rotation',
          group: 'Shoulders', implement: 'cable', implementLabel: 'Cable',
          sets: [{ reps: 15, weight: 7.5 }] },
      ] } } }}
    entries={priorLifts} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (/Distance/.test(t)) throw new Error('a lift day is being asked for its distance')
      if (/Elevation|Incline/.test(t)) throw new Error('a lift day is being asked about hills')
      if (!/Bent-over row/.test(t) || !/Shoulder external rotation/.test(t)) {
        throw new Error('the logged exercises did not render')
      }
      /*
       * THE SAME CARD THE PLANNER USES, because planning a workout and logging
       * one should look exactly the same. So: one card open (the
       * first), every other collapsed to its name and its summary line, implement
       * CHIPS rather than a native select, and steppers rather than a table of
       * bare inputs. `Sheet(a planned session)` pins the same shape from the other
       * side; if these two ever disagree, one of them has grown its own copy.
       */
      if ((html.match(/class="presc-sets"/g) || []).length !== 1) {
        throw new Error('exactly one exercise should open, as on the plan side')
      }
      if (/<select/.test(html)) throw new Error('the implement select survived the merge')
      if (!/class="stepper/.test(html)) throw new Error('the weight box is not a stepper')
      // What it was loaded with, and what the weight column therefore MEANS. The
      // cable's card is folded, so only the open one states its units.
      if (!/lb per hand/.test(t)) throw new Error('a dumbbell weight column must say per hand')
      if (!/class="implchip on"/.test(html)) throw new Error('the chosen implement is not marked')
      // Unequal sets read as themselves — the point of logging per set is that a
      // last set that dropped off shows up as one. On the HEADER now, so a folded
      // card still says what it was.
      if (!/10 @ 30 lb, 10 @ 30 lb, 8 @ 30 lb/.test(t)) throw new Error('the set summary is missing')
      if (!/1 × 15 @ 7\.5 lb/.test(t)) throw new Error('equal sets should collapse')
      // Spacing is at the mercy of how SSR splits the text nodes, so assert the
      // facts rather than the punctuation between them.
      if (!/Last time/.test(t) || !t.includes(dayWords('2026-09-02')) || !/1 × 5 @ 175 lb/.test(t)) {
        throw new Error("last time's numbers are not on screen")
      }
      if (!/4 sets/.test(t)) throw new Error('the session line is missing')
      // And the way in to the next exercise — behind the same dashed button the
      // plan side uses, rather than a search box always taking up the page.
      if (!/Add an exercise/.test(t)) throw new Error('no way to add an exercise')
    }],
  /* What the weight MEANS is switched ONCE, on the card (#58; moved off every
   * set's cell in #93, where a tap aimed at the number flipped its meaning): a
   * Bulgarian split squat with ONE dumbbell. The switch says what it is now and
   * one tap is the other meaning; the set's cell is the number and "lb". */
  ['SessionLog(a dumbbell lift: the card’s meaning switch, in the mode it was logged in; none in the set row)', <SessionLog session={otherCard}
    entry={{ id: 'ot58', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'bulgarian-split-squat-1', key: 'bulgarian-split-squat', name: 'Bulgarian split squat', group: 'Quads',
          implement: 'dumbbell', implementLabel: 'Dumbbell', weightMode: 'one', weightLabel: 'lb · one dumbbell',
          sets: [{ reps: 8, weight: 25 }, { reps: 8, weight: 25 }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      // Old address: the label under every set's weight. Absent.
      if (/stepper-swap/.test(html)) throw new Error('a set row still carries the meaning switch')
      const sets = (html.match(/<div class="presc-sets">([\s\S]*?)<div class="presc-itemfoot">/) || [])[1] || ''
      if (!sets || /<button/.test(sets.replace(/<button class="stepper-btn"/g, ''))) throw new Error('a button other than ± sits in a set row')
      // New address: one switch per exercise, on the card.
      if ((html.match(/class="modeswitch"/g) || []).length !== 1) throw new Error('not one meaning switch per exercise')
      const sw = (html.match(/<button[^>]*class="modeswitch"[^>]*>(.*?)<\/button>/) || [])[1] || ''
      if (sw.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim() !== 'one dumbbell') throw new Error(`the switch says "${sw}"`)
      if (!/aria-label="Weight is lb · one dumbbell\. Switch to lb per hand"/.test(html)) throw new Error('the switch does not say what a tap does')
      if ((html.match(/<span class="stepper-label" aria-hidden="true">lb<\/span>/g) || []).length !== 2) throw new Error('a set cell does not say just "lb"')
      // The header says the mode under the name, and keeps its summary short so a
      // long name is not squeezed on a phone (review of #60).
      if (!/<span class="presc-mode">one dumbbell<\/span>/.test(html)) throw new Error('the header does not say the meaning')
      if (!/<span class="presc-itemline">2 × 8 @ 25 lb<\/span>/.test(html)) throw new Error('the header summary is not the short one')
      if (/role="dialog"|<dialog/.test(html)) throw new Error('a dialog for a one-tap switch')
    }],
  ['SessionLog(a dumbbell lift in its default: the switch offers one dumbbell)', <SessionLog session={otherCard}
    entry={{ id: 'ot58b', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'bent-over-row-1', key: 'bent-over-row', name: 'Bent-over row', group: 'Back',
          implement: 'dumbbell', implementLabel: 'Dumbbell', sets: [{ reps: 10, weight: 30 }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const sw = (html.match(/<button[^>]*class="modeswitch"[^>]*>(.*?)<\/button>/) || [])[1] || ''
      if (sw.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim() !== 'per hand') throw new Error(`the default's switch says "${sw}"`)
      if (!/aria-label="Weight is lb per hand\. Switch to lb · one dumbbell"/.test(html)) {
        throw new Error('an old row with no mode is not in the default, or offers nothing')
      }
    }],
  /* And the absence: a machine has one meaning, so no switch is invented. */
  /* The chip already chosen does nothing (#58 follow-up): memory is applied when
   * an implement is PICKED, so tapping the chosen one again must not undo a
   * switch made since. */
  ['ExerciseCard(tapping the chosen implement again writes nothing)', null, () => {
    const field = liftFieldOf(plan)
    const dumbbell = field.implements.find(i => i.value === 'dumbbell')
    const barbell = field.implements.find(i => i.value === 'barbell')
    const log = [{ id: 'old', kind: 'daily', date: '2026-10-01', updatedAt: 'a', data: { out: { lifts: [
      { uid: 'bss-1', key: 'bulgarian-split-squat', implement: 'dumbbell', weightMode: 'one', weightLabel: 'lb · one dumbbell', sets: [{ reps: 8, weight: 25 }] }] } } }]
    // Memory says one dumbbell; this session the user switched back to per hand.
    const item = { kind: 'lift', exercise: 'bulgarian-split-squat', implement: 'dumbbell', weightLabel: 'lb per hand' }
    if (implementPick(field, item, dumbbell, log, 'today') !== null) throw new Error('the chosen chip re-applied memory over a switch made in this session')
    const toBar = implementPick(field, item, barbell, log, 'today')
    if (toBar?.implement !== 'barbell' || toBar.weightMode !== null || toBar.weightLabel !== 'lb on the bar') {
      throw new Error(`another implement did not write itself in its default: ${JSON.stringify(toBar)}`)
    }
    const fromBar = implementPick(field, { ...item, implement: 'barbell' }, dumbbell, log, 'today')
    if (fromBar?.weightMode !== 'one') throw new Error('picking the dumbbell lost the remembered mode')
  }],
  ['SessionLog(a machine lift: no switch, just its label)', <SessionLog session={otherCard}
    entry={{ id: 'ot58c', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'leg-extension-1', key: 'leg-extension', name: 'Leg extension', group: 'Quads',
          implement: 'machine', implementLabel: 'Machine', sets: [{ reps: 12, weight: 90 }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      if (!/class="presc-sets"/.test(html)) throw new Error('the card is not open, so this proves nothing')
      if (/stepper-swap|modeswitch|ArrowLeftRight|Switch to/.test(html)) throw new Error('a machine lift grew a weight switch')
      if (!/<span class="stepper-label" aria-hidden="true">lb<\/span>/.test(html)) throw new Error('the machine weight lost its plain label')
      if (/presc-mode/.test(html)) throw new Error('a machine lift says a weight mode')
    }],
  /* A number a service measured says so. Attaching is the whole point — time
   * should not need entering when WHOOP already measured it — and a value the
   * user did not type must never look like one they did. */
  ['SessionLog(other training, filled from WHOOP)', <SessionLog session={otherCard}
    entry={{ id: 'ot3', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: {
        activity: 'run', duration: 38, distance: 5, elevation: 210,
        whoop: { id: 'w', sport: 'running', minutes: 38, attachedAt: 'z',
          filled: { activity: 'run', duration: 38, distance: 5, elevation: 210 } } } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if ((t.match(/from WHOOP/g) || []).length < 3) throw new Error('the filled fields are not attributed')
      if (!/value="38"/.test(html)) throw new Error('the filled duration is not in the field')
    }],
  // A grade is entered from the ladder, per REP, and both of those are things a
  // rendered form can silently stop doing: a select whose value is off its own
  // option list goes blank, and a per-rep field is one `Array.isArray` away from
  // rendering nothing at all.
  ['SessionLog(a grade per lap)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'lead-laps')}
    entry={{ id: 'll', kind: 'daily', date: '2026-10-03', updatedAt: 'z',
      data: { optId: 'lead-laps', level: 3, minutes: 30,
        out: { sets: { doubles: [{ reps: 2, grades: [10.2, 10.2] }, { reps: 2, grades: [10.1, 10.2] }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      // One picker per lap across two sets, each one showing its own rung.
      const selected = [...html.matchAll(/<option value="([\d.]+)" selected=""/g)].map(m => m[1])
      if (selected.join() !== '10.2,10.2,10.1,10.2') {
        throw new Error(`the per-lap grades did not render as themselves: ${selected.join() || 'none'}`)
      }
      if (!text(html).includes('5.10−')) throw new Error('the ladder is not labelled')
      if (!/lap 1|rep 1/.test(text(html))) throw new Error('the laps are not numbered')
    }],
  // A session-level grade: same ladder, same control, one value.
  ['SessionLog(hardest route from the ladder)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-sport')}
    entry={{ id: 'fs', kind: 'daily', date: '2026-10-04', updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, minutes: 120, out: { intensity: 3, hardestYds: 11.1, rpe: 6 } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/<option value="11.1" selected=""/.test(html)) throw new Error('the logged rung is not selected')
      if (/enter as/.test(text(html))) throw new Error('still asking him to encode a grade as a decimal')
    }],
  // An old hand-written value that is not on the ladder keeps its own option, so
  // opening the picker cannot silently relabel what the user climbed.
  ['SessionLog(off-ladder grade survives)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-sport')}
    entry={{ id: 'fs2', kind: 'daily', date: '2026-10-05', updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, minutes: 120, out: { hardestYds: 10.4 } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/<option value="10.4" selected="">10.4</.test(html)) {
        throw new Error('an off-ladder grade was dropped or relabelled')
      }
    }],
  // The fun days' per-climb option: OFF is the default and a button offers it —
  // ten selects nobody asked for is how a twenty-second form stops being filled in.
  ['SessionLog(fun day, option off)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'fb0', kind: 'daily', date: '2026-10-06', updatedAt: 'z',
      data: { optId: 'fun-boulder', level: 2, minutes: 90, out: { sets: { problems: [{ reps: 10 }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/>Log each problem</.test(text(html).replace(/<svg.*?<\/svg>\s*/g, '>'))) throw new Error('the per-problem option is not offered as a button that says so')
      if (/logging each/.test(html)) throw new Error('the old display-looking toggle is back')
      if (/climblog/.test(html)) throw new Error('per-climb detail rendered before he asked for it')
      // With the detail off the count is an ordinary typed number, not a stepper.
      if (/repstep/.test(html)) throw new Error('the stepper belongs to the detail, not the plain log')
      const reps = html.match(/<input[^>]*aria-label="set 1 reps"[^>]*>/)?.[0] || ''
      if (/readonly/i.test(reps)) throw new Error('the plain reps box must stay typeable')
    }],
  /* ...and ON (#81): a climb already described is ONE readable row, the first
   * undescribed one is the current climb with its grade and how it went, and
   * the rest are one quiet line. Was: a row of pickers per climb, 2,968px tall
   * for five routes (2026-11-08 grading, E F13). */
  ['SessionLog(fun day, per-problem detail)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'fb1', kind: 'daily', date: '2026-10-07', updatedAt: 'z',
      data: { optId: 'fun-boulder', level: 3, minutes: 90,
        out: { sets: { problems: [{ reps: 5, climbs: [
          { grade: 4, fell: true, felt: 1, style: 'roof' },
          { grade: 5, fell: false, felt: '', style: '', outcome: 'flash' },
          { grade: '', fell: false, felt: '', style: '' },
          { grade: '', fell: false, felt: '', style: '' },
          { grade: '', fell: false, felt: '', style: '' },
        ] }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      const t = text(html)
      // The two described problems read as rows, in words, with their grades.
      const done = [...html.matchAll(/class="climb-done"[\s\S]*?<\/button>/g)].map(m => m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      if (done.length !== 2) throw new Error(`expected 2 described rows, got ${done.length}`)
      if (!/problem 1 V4 Fell · roof · a touch stiff/.test(done[0])) throw new Error(`problem 1 reads "${done[0]}"`)
      if (!/problem 2 V5 Flash/.test(done[1])) throw new Error(`problem 2 reads "${done[1]}"`)
      // One editor: problem 3, its V ladder (to V17) and the outcomes a boulder has.
      if ((html.match(/class="climb-edit"/g) || []).length !== 1) throw new Error('one climb has controls at a time')
      if ((html.match(/class="gradesel"/g) || []).length !== 1) throw new Error('a grade picker per climb is back')
      if (!/aria-label="problem 3 grade"/.test(html)) throw new Error('the current climb is not the first undescribed one')
      if (!/>V17</.test(html)) throw new Error('the V ladder stops short of V17')
      for (const o of ['Flash', 'Sent', 'Fell']) if (!new RegExp(`>${o}<`).test(html)) throw new Error(`no ${o} outcome`)
      if (/>Onsight</.test(html)) throw new Error('onsight is a route word, not a boulder one')
      if (!/Same as last: V5/.test(t)) throw new Error('no one-tap repeat of the last grade')
      // And one rung either side of it (#97, F9c), so a pick rarely starts at V0.
      if (!/aria-label="problem 3: one easier, V4"/.test(html) || !/aria-label="problem 3: one harder, V6"/.test(html)) throw new Error('no one-tap rung either side of the last grade')
      // The rest of the evening is one line, and the next one is a tap beside the current.
      // They are the count standing in, and the line says so (#97, F1).
      if (!/2 more problems, not described, so not counted/.test(t)) throw new Error('the undescribed problems are not one honest line')
      if (!/>Next problem</.test(t.replace(/<svg.*?<\/svg>\s*/g, '>'))) throw new Error('no Next problem beside the current one')
      // Style, felt, tries and Remove wait behind Details.
      if (!/<details class="climb-more"><summary>[\s\S]*?More details<\/summary>/.test(html)) throw new Error('the optional detail is not folded behind a control that says it opens')
      if (/<summary>Details<\/summary>/.test(html)) throw new Error('the bare "Details" label is back (#97, F9a)')
      if (!/Remove problem/.test(t)) throw new Error('no way to remove a problem')
      // Two described of five listed: the foot counts the two (#97, F1).
      if (!/1 sent/.test(t) || !/fell on 1/.test(t) || !/2 problems/.test(t)) throw new Error('the footer must count problems, sends and falls')
      if (/5 problems/.test(t)) throw new Error('the prefilled count is read as problems climbed')
      // The count is the list now: no reps box, no stepper, no table.
      if (/aria-label="set 1 reps"/.test(html) || /one more problem/.test(html)) throw new Error('the count is typed or stepped beside the list')
      if (/exlog-table/.test(html)) throw new Error('a one-column table for a list of climbs')
      if (/>Count only</.test(t)) {} else throw new Error('no way back to a plain count')
      // Boulders have no route-grade switch.
      if (/gradesys/.test(html)) throw new Error('a boulder card offers the route grade switch')
    }],
  // Turning the detail off with answers in it ASKS, in place (#81, E F1): it
  // used to strip every grade in one tap on a control that looked like a label.
  ['SetLog(turning the detail off asks first)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'fun-sport')
    const html = renderToString(<SetLog session={opt} onSave={noop} initialConfirm="routes"
      out={{ sets: { routes: [{ reps: 2, climbs: [{ grade: 10.2, fell: false, felt: '', style: '' }, { grade: '', fell: false, felt: '', style: '' }] }] } }} />)
    const t = text(html)
    if (!/Remove what you logged for 1 route\?/.test(t)) throw new Error('the question is missing')
    if (!/>Keep it</.test(t) || !/class="btn destructive"[^>]*>Remove</.test(html)) throw new Error('both answers must be offered')
    if (/>Count only</.test(t)) throw new Error('the control stays while its question is open')
    // A route card offers the letters / plus-minus switch, and routes are named as routes.
    if (!/class="seg tap gradesys"/.test(html) || !/>5\.10a</.test(html) || !/>5\.10\+</.test(html)) throw new Error('no route grade switch')
    if (!/Onsight/.test(t)) throw new Error('a route offers onsight')
    if (!/>5\.15</.test(html)) throw new Error('the route ladder stops short of 5.15')
  }],
  // Removing a lap takes its grade with it, and Undo puts both back where they
  // were: the doubles log a grade per lap beside the climb records.
  ['SetLog(a removed lap and its grade come back together)', null, () => {
    const row = { reps: 3, grades: [10.1, 10.2, 10.3], climbs: [
      { grade: '', fell: false, felt: '', style: 'vert', down: '' },
      { grade: '', fell: true, felt: '', style: '', down: '' },
      { grade: '', fell: false, felt: '', style: 'roof', down: '' },
    ] }
    const gone = withoutClimb(row, 1, true)
    if (gone.reps !== 2 || gone.grades.join() !== '10.1,10.3') throw new Error(`the grade did not leave with its lap: ${gone.grades}`)
    if (gone.climbs.map(c => c.style).join() !== 'vert,roof') throw new Error('the wrong lap went')
    const back = withClimbBack(gone, 1, row.climbs[1], 10.2, true)
    if (back.reps !== 3 || back.grades.join() !== '10.1,10.2,10.3') throw new Error(`Undo misplaced the grade: ${back.grades}`)
    if (back.climbs[1].fell !== true) throw new Error('Undo did not bring the lap back where it was')
    // A count of 25 survives switching the detail on: no cap at twenty (E F8).
    const html = renderToString(<SetLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')} onSave={noop}
      out={{ sets: { problems: [{ reps: 25, climbs: Array.from({ length: 25 }, () => ({ grade: '', fell: false, felt: '', style: '' })) }] } }} />)
    if (!/24 more problems, not described/.test(text(html)) || !/25 problems/.test(text(html))) throw new Error('a 25-problem evening was cut short')
    // Nothing described yet: the count stands, and nothing says otherwise (#97).
    if (/not counted/.test(text(html))) throw new Error('a count nobody has described into is called not counted')
  }],
  // Sets come off from the foot, with Undo, never from an X beside the number
  // being typed (#81, E F1: a 30px X removed a whole evening's routes).
  ['SetLog(no remove beside the numbers)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'repeaters')
    const html = renderToString(<SetLog session={opt} out={{}} onSave={noop} />)
    if (/Remove set \d/.test(html) || /exlog-x/.test(html)) throw new Error('the per-row X is back')
    // Any set, chosen in the foot (#97, F9d), not only the last.
    if (!/>Remove a set</.test(html)) throw new Error('no way to take a set off')
    if (/Remove last set/.test(html)) throw new Error('only the last set can be removed')
    if (/type="number"/.test(html)) throw new Error('a controlled number input eats the trailing dot')
    if (/log each/i.test(html)) throw new Error('a hangboard set offers per-climb detail')
  }],
  ['SessionLog(a rest day)', <SessionLog session={plan.dailyMenu.find(m => m.role === 'rest')}
    entry={{ id: 'r', kind: 'daily', date: '2026-10-02', updatedAt: 'z',
      data: { optId: 'off', level: 1, minutes: 0, out: {} } }}
    entries={noteHistory} onSave={noop} bare />],
  ['Sheet(with prior note)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'cur', kind: 'daily', date: '2026-10-01', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    tone="rec" entries={noteHistory} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // A suggestion opened from the day list: no entry behind it yet, so it offers
  // "add to today" and "not doing this today" rather than a log.
  ['Sheet(also recommended)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'lead-laps')} entry={null} tone="also"
      entries={rich} isFuture={false} recWhy="Not done yet this week."
      onLog={noop} onSave={noop} onDismiss={noop} onClose={noop} />],
  // The unilateral block resolves its dose from the ceiling — with a test...
  ['Sheet(unilateral, dose resolved)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'unilateral')}
    entry={{ id: 'u1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'unilateral', level: 2, minutes: 12, out: {} } }}
    tone="rec" entries={cfEntries} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // ...and without one, where it must say so rather than invent a number.
  ['Sheet(unilateral, never tested)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'unilateral')}
    entry={{ id: 'u2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'unilateral', level: 2, minutes: 12, out: {} } }}
    tone="rec" entries={[]} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // The dose line itself. The sheet opens on the setup section, so this is the
  // only place the resolved kilograms actually render.
  ['SectionBody(dose from Aug 8)',
    <SectionBody section={uniWork} max={null} ceiling={resolveCeiling(augOnly)} />,
    html => {
      // CF 18.2 -> ceiling 12.2 -> target 10.2, the fixture's first result.
      if (!text(html).includes('10.2 kg on the gauge')) throw new Error('the resolved target is missing')
      if (!text(html).includes('12.2 kg')) throw new Error('the ceiling is missing')
    }],
  ['SectionBody(newest test wins)',
    <SectionBody section={uniWork} max={null} ceiling={resolveCeiling(cfEntries)} />,
    html => {
      // The September retest supersedes August: CF 20.4, CFmin 19.1 -> 14.4 -> 12.4.
      if (!text(html).includes('12.4 kg on the gauge')) throw new Error('did not use the newest test')
    }],
  ['SectionBody(never tested)',
    <SectionBody section={uniWork} max={null} ceiling={null} />,
    html => {
      if (!/run the 4-min all-out test/i.test(html)) throw new Error('no prompt to test')
      if (/\d+(\.\d+)? kg on the gauge/.test(text(html))) throw new Error('invented a number with no test')
    }],
  /* #76: a CF at or under the 6 kg correction is a measurement, so the dose
     says why there is no number instead of asking for a test that was run. */
  ['SectionBody(a CF under the correction says why there is no ceiling)',
    <SectionBody section={uniWork} max={null} ceiling={null}
      {...ceilingState([{ id: 'low', kind: 'test', date: '2026-09-01', updatedAt: 'z',
        data: { testId: 'critical-force', cfKg: 5 } }])} />,
    html => {
      const t = text(html)
      if (/run the 4-min all-out test/i.test(t)) throw new Error('asked for a test that was run')
      if (!/No ceiling from your last test/.test(t) || !/5 kg, at or under the 6 kg correction/.test(t)) throw new Error('say why: CF 5 kg is under the correction')
      if (/kg on the gauge/.test(t)) throw new Error('invented a number')
    }],
  ['SectionBody(CFmin binds)',
    <SectionBody section={uniWork} max={null}
      ceiling={resolveCeiling([{ id: 'x', kind: 'test', date: '2026-08-08', updatedAt: 'z',
        data: { testId: 'critical-force', cfKg: 18.2, cfMinKg: 11.5, mvcKg: 48.6 } }])} />,
    html => {
      if (!text(html).includes('9.5 kg on the gauge')) throw new Error('CFmin did not bind (expected 11.5 - 2)')
      if (!/CFmin from/.test(text(html))) throw new Error('did not say which rule bound')
    }],
  /* The how-to layer. A figure name that plan.json can write but the app cannot
   * draw renders as an empty box, which on a phone in a basement is worse than
   * no picture at all — it reads as "this is broken" mid-set. */
  ['every figure the plan names exists', null, () => {
    const missing = []
    for (const m of plan.dailyMenu) {
      for (const ex of m.logSpec?.exercises || []) {
        if (ex.how && !hasFigure(ex.how.figure)) missing.push(`${m.id}/${ex.key} → ${ex.how.figure}`)
      }
    }
    if (missing.length) throw new Error(`no such figure: ${missing.join(', ')}`)
  }],
  ['no figure is drawn that nothing uses', null, () => {
    const used = new Set(plan.dailyMenu.flatMap(m => (m.logSpec?.exercises || []).map(e => e.how?.figure)))
    const spare = Object.keys(FIGURES).filter(k => !used.has(k))
    if (spare.length) throw new Error(`unused figures: ${spare.join(', ')}`)
  }],
  // Every figure has to survive being drawn, including the ones a rarely-picked
  // session owns. They are hand-written SVG; a stray undefined renders blank.
  ...Object.keys(FIGURES).map(name => [`Figure(${name})`,
    <HowRow exercise={{ name, how: { figure: name, gist: 'x' } }} open onToggle={noop} />,
    html => { if (!html.includes('<svg')) throw new Error('drew nothing') }]),
  // The moves list on every session that has one, and the mid-set sheet.
  ...plan.dailyMenu.filter(m => m.logSpec?.exercises?.length)
    .map(m => [`Moves(${m.id})`, <MovesList session={m} />]),
  ['HowSheet(eccentrics)', <HowSheet
    exercise={plan.dailyMenu.find(m => m.id === 'eccentrics').logSpec.exercises[0]}
    onClose={noop} />,
    html => {
      // The specific confusion this whole layer was built for: the free hand
      // lifts, the working hand only lowers. If that sentence stops reaching
      // the screen, the card is decoration.
      if (!/free hand/i.test(text(html))) throw new Error('lost the free-hand instruction')
    }],
  // An exercise with no how-to written yet must degrade, not crash.
  ['HowRow(no card)', <HowRow exercise={{ key: 'x', name: 'Something new' }} open onToggle={noop} />],
  ['HowSheet(nothing to show)',
    <div className="probe"><HowSheet exercise={{ name: 'x' }} onClose={noop} /></div>,
    html => { if (html.includes('how-sheet')) throw new Error('opened a sheet with nothing in it') }],
  /* The planned session, read from the day rather than run: the sheet shows the
   * prescription instead of the card's protocol, because the card has none. */
  ['Sheet(a planned session)',
    <SessionSheet opt={PLANNED_CARD} entry={PLANNED_ENTRY} tone="rec" entries={rich} isFuture={false}
      onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
      onClose={noop} />,
    (html) => {
      const t = text(html)
      if (!t.includes(PRESCRIPTION.title)) throw new Error('the sheet is not titled by the plan')
      // This one has a bike piece in it, so there is a clock to run.
      if (!/Start workout/.test(t)) throw new Error('no way into the runner from the sheet')
      // Asking the model is planning: on the day it is done it is behind the pencil
      // (#79, `planTalkWhere`), not above the first set.
      if (/Why this session|Ask the model/.test(t)) throw new Error('the model panel is back above the sets while doing')
      // Every exercise open at once is four screens of steppers before the one the user
      // is about to do. Only the first opens.
      if ((html.match(/class="presc-sets"/g) || []).length > 1) {
        throw new Error('more than one exercise opened')
      }
    }],
  /*
   * A LIFT-ONLY session gets no runner: workout mode makes no sense for lifting,
   * which has no timed parts. Once rest came off a lift set there is nothing for a
   * clock to run, so the sheet is the whole screen — and it must not grow a start
   * button back, which is the only thing a render test can say about it.
   */
  ['Sheet(a lift-only session offers no clock)', null, () => {
    const pres = normalizePrescription({
      title: 'Push day', category: 'lift', minutes: 45, why: 'w',
      blocks: [{ name: 'Main', category: 'lift', items: [{
        kind: 'lift', name: 'squat', exercise: SQUAT.key, implement: 'barbell',
        sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }],
      }] }],
    }, { liftField: LIFT_FIELD })
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'planned', name: pres.title, minutes: 45, level: 2,
        done: false, plan: pres, out: {} } }
    const html = renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={entry} tone="rec" entries={rich} isFuture={false}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
          onClose={noop} />
      </PlanProvider>)
    const t = text(html)
    if (/Start workout/.test(t)) throw new Error('a lift session is offering a clock again')
    // The chip by the title (#77), never a footer under the sets.
    const chip = (h) => (h.match(/<button[^>]*class="done-chip[^"]*"[^>]*>/) || [''])[0]
    if (/<footer class="modal-foot">/.test(html)) throw new Error('a lift session with nothing to start has a footer (a Close?) under its sets')
    // Kept for today and untouched, it is not done yet (D10, #74): the chip says so and its tap is Mark done.
    if (!/aria-checked="false"/.test(chip(html)) || !/title="Mark done"/.test(chip(html)) || !/>Not done</.test(t)) {
      throw new Error('an untouched plan for today does not read "Not done" with Mark done on its chip')
    }
    const typed = { ...pres, blocks: pres.blocks.map(b => ({ ...b, items: b.items.map(it => ({ ...it, sets: it.sets.map((x, i) => (i ? x : { ...x, typed: true })) })) })) }
    const doneHtml = renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={{ ...entry, data: { ...entry.data, plan: typed } }} tone="rec" entries={rich} isFuture={false}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
          onClose={noop} />
      </PlanProvider>)
    if (!/aria-checked="true"/.test(chip(doneHtml)) || !/title="Mark undone"/.test(chip(doneHtml))) {
      throw new Error('with no runner, a set typed in has to make it done, and its chip offer to undo it')
    }
    // And no rest box anywhere in the editor.
    if (/rest sec/.test(t)) throw new Error('lifting grew a rest interval back')
  }],
  /*
   * THE FOOTER (#77): a real action or nothing. Close was the lime primary
   * 0px under the first set's weight stepper and the owner hit it over and over
   * mid-workout; the header X closes, so the footer holds Start (where there is
   * something to run), putting a card on the day, or nothing at all. Pinned
   * absent: Close and the done toggle in the footer. Pinned present: Start, the
   * card's own action and the header X.
   */
  ['SessionSheet(no Close in the footer: Start, the card’s action, or no footer; the X closes)', null, () => {
    const sheet = (entry, isFuture = false, opt = PLANNED_CARD) => renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={opt} entry={entry} tone="rec" entries={rich} isFuture={isFuture}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
          onClose={noop} />
      </PlanProvider>)
    const foot = (html) => (html.match(/<footer class="modal-foot">([\s\S]*?)<\/footer>/) || [])[1] ?? null
    const today = sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: true } })
    if (!/Start workout/.test(foot(today) || '')) throw new Error('a runnable session lost its Start')
    if (/>Close</.test(foot(today) || '')) throw new Error('Close is back in the footer beside Start')
    if (/Mark (un)?done/.test(foot(today) || '')) throw new Error('the done toggle is back in the footer')
    if (!/class="modal-btn close"[^>]*aria-label="Close"/.test(today)) throw new Error('the header X is gone: no way to close')
    // A plan for today is done once something is done on it (D10, #74). Untouched, it still
    // offers Start in the footer and its chip (not the footer) reads "Not done".
    const kept = sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: false } })
    if (!/Start workout/.test(foot(kept) || '') || /Mark (un)?done|>Close</.test(foot(kept) || '')) throw new Error('an untouched plan for today: the footer is not just Start')
    if (!/class="done-chip "[^>]*aria-checked="false"/.test(kept)) throw new Error('an untouched plan for today reads as done')
    const logged = sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: false, out: { ...(PLANNED_ENTRY.data.out || {}), rpe: 6 } } })
    if (!/class="done-chip on"[^>]*aria-checked="true"/.test(logged)) throw new Error('a plan with something logged on it today does not read as done')
    // A run finished today is reopened by Start (#75); on an earlier day, once
    // done, nothing is left to start: no footer at all, rather than a Close.
    const finished = foot(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: true, run: { startedAt: 1, endedAt: 2 } } }))
    // A run under way or finished is carried on, not started again (#79).
    if (!/Carry on/.test(finished || '') || /Start workout/.test(finished || '') || />Close</.test(finished || '')) throw new Error('a run finished today cannot be reopened as Carry on, or Close came back')
    const past = sheet({ ...PLANNED_ENTRY, date: '2026-01-05', data: { ...PLANNED_ENTRY.data, done: true, run: { startedAt: 1, endedAt: 2 } } })
    if (foot(past) !== null) throw new Error(`a sheet with nothing to start still has a footer: ${text(foot(past))}`)
    const later = sheet({ ...PLANNED_ENTRY, date: '2999-01-01', data: { ...PLANNED_ENTRY.data, done: false } }, true)
    if (foot(later) !== null) throw new Error('a later day grew a footer')
    if (/done-chip|Mark (un)?done/.test(later)) throw new Error('a session on a later day offers a done control')
    if (/Preview only/.test(text(later))) throw new Error('the explanatory preview line is back')
    // A card with nothing on the day yet: putting it there is the footer's one action.
    const card = foot(renderToString(<SessionSheet opt={otherCard} entry={null} tone="rec" entries={[]}
      onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />)) || ''
    if (!/Add to Today/.test(card) || />Close</.test(card)) throw new Error(`the unplaced card's footer reads "${text(card)}"`)
  }],
  /*
   * DONE IS A CHIP BY THE TITLE (#77), at its new address: `.modal-status` in
   * the header, a switch that says the state ("Done" / "Not done"). Done by
   * default (AGENTS.md §4) still holds; the chip only reads `isDone`.
   */
  ['SessionSheet(done is a chip under the title: "Done" lit, "Not done" once undone)', null, () => {
    const sheet = (entry) => renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={entry} tone="rec" entries={rich} isFuture={false}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop} onClose={noop} />
      </PlanProvider>)
    const status = (html) => (html.match(/<div class="modal-status">([\s\S]*?)<\/div>/) || [])[1] || ''
    const done = status(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: true } }))
    if (!/class="done-chip on"[^>]*role="switch"[^>]*aria-checked="true"/.test(done)) throw new Error('a done session has no lit chip')
    if (!/>Done</.test(done)) throw new Error('the chip does not say "Done"')
    const undone = status(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: false, undone: true } }))
    if (!/class="done-chip "[^>]*aria-checked="false"/.test(undone) || !/>Not done</.test(undone)) {
      throw new Error('a session marked undone does not say "Not done"')
    }
    // The chip sits in the header, above every input: never in the body or the foot.
    const html = sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: true } })
    if (html.indexOf('done-chip') > html.indexOf('class="modal-body"')) throw new Error('the done chip left the header')
    if (/Done · Mark undone|tap to undo|Mark as done/.test(text(html))) throw new Error('an old done toggle is back')
  }],
  /*
   * NO FOOTER WHILE TYPING (#77), the shell's policy for every sheet and the
   * planner's sticky bar. SSR cannot focus a box, so the parts are pinned: what
   * counts as typing, the rule that a sheet hides its footer then, and the
   * full screen's CSS. The footer renders when nothing is focused.
   */
  ['Modal(the footer steps aside while a box has focus; a switch or a button is not typing)', null, () => {
    const el = (tagName, extra = {}) => ({ tagName, ...extra })
    const typing = [el('INPUT'), el('INPUT', { type: 'text' }), el('INPUT', { type: 'number' }), el('TEXTAREA'), el('DIV', { isContentEditable: true })]
    const not = [null, el('BUTTON'), el('INPUT', { type: 'checkbox' }), el('INPUT', { type: 'range' }), el('INPUT', { readOnly: true }), el('TEXTAREA', { disabled: true }), el('DIV')]
    for (const e of typing) if (!isTextEntry(e)) throw new Error(`${e.tagName}${e.type ? `[${e.type}]` : ''} is not counted as typing`)
    for (const e of not) if (isTextEntry(e)) throw new Error(`${e?.tagName} counted as typing`)
    if (footerShown({ footer: 'x', editing: true })) throw new Error('a sheet keeps its footer while a box has focus')
    if (footerShown({ footer: 'x', confirming: true })) throw new Error('the footer shows over the delete confirmation')
    if (!footerShown({ footer: 'x' })) throw new Error('a sheet at rest lost its footer')
    // Focusing a box holds the scrim and Escape while it has focus, but is not a change:
    // once it lets go, an untouched sheet closes the fast way again. A real edit locks it.
    if (sheetDismissable({ editing: true })) throw new Error('the scrim closes a sheet while a box has focus')
    if (!sheetDismissable({ editing: false, touched: false })) throw new Error('focusing a box (no change) locked the sheet to its X')
    if (sheetDismissable({ touched: true })) throw new Error('a sheet with something typed in it closes on the scrim')
    if (sheetDismissable({ dismissable: false })) throw new Error('the caller\u2019s dirty flag is ignored')
    if (!(EDIT_SETTLE_MS >= 250)) throw new Error('the footer can slide back under a finger that just blurred a box')
    const html = renderToString(<Modal title="t" onClose={noop} footer={<button className="btn">Go</button>}>body</Modal>)
    if (!/<footer class="modal-foot">/.test(html) || /data-editing/.test(html)) throw new Error('a sheet at rest renders no footer, or starts out editing')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    if (!/\.fs\[data-editing\] \.plan-actions\.sticky \{ display: none; \}/.test(css)) throw new Error('the planner’s sticky bar stays up while typing')
  }],
  /*
   * THE HEADER AT 390 (#82, from #91's review). For any day older than yesterday
   * the line under the title ("Wed, Nov 4 · 3 exercises") wrapped beside the bin,
   * the pencil and the X, and the done chip and "with Sam · in sync" stacked
   * under it: a 190px header. Now the title row holds the title, ONE line of
   * context that ellipsizes rather than wraps, and the buttons; the state row is
   * the header's own row, the full width under it; and on a phone the icon well
   * gives way when the bin and the pencil are both there. SSR cannot measure, so
   * the structure and the rules that make it so are what is pinned.
   */
  ['SessionSheet(header at 390 on an older day: one meta line, the chips across the width)', null, () => {
    const day = isoShift(TODAY, -5)
    const entry = { ...PLANNED_ENTRY, id: `daily-${day}`, date: day }
    const html = renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={entry} tone="rec" entries={rich} isFuture={false}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onRemove={noop} onRename={noop} onClose={noop} />
      </PlanProvider>)
    // The bin went into Edit (#94), so the header is the pencil and the X, and the
    // icon well stays: there is room for it at 390 beside two buttons.
    const head = (html.match(/<header class="modal-head">([\s\S]*?)<\/header>/) || [])[1]
    if (!head) throw new Error('the header is marked full with only the pencil and the X')
    const row = (head.match(/^<div class="modal-headrow">([\s\S]*?)<\/div><div class="modal-status">/) || [])[1]
    if (!row) throw new Error('the state row is not its own row under the title row')
    if (/done-chip/.test(row)) throw new Error('the done chip is squeezed into the title row')
    if (!/class="modal-status"[\s\S]*done-chip/.test(head)) throw new Error('no done chip in the state row')
    const sub = text((row.match(/<div class="modal-sub">(.*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, '')
    if (!sub.startsWith(dayWords(day)) || sub.split(' · ').length > 2) throw new Error(`the context line is "${sub}"`)
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const rule = (sel) => (css.match(new RegExp(`${sel.replace(/[.\[\]]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || ''
    if (!/white-space: nowrap/.test(rule('.modal-sub')) || !/text-overflow: ellipsis/.test(rule('.modal-sub'))) throw new Error('the context line can wrap')
    if (!/flex-direction: column/.test(rule('.modal-head'))) throw new Error('the header is one row again')
    if (!/@media \(max-width: 479px\) \{\s*\.modal-head\.full \.modal-ico \{ display: none; \}/.test(css)) throw new Error('the icon well still takes the phone’s width')
  }],
  /*
   * THE HEADER (#41): the name, then the day and the time as typed. It used to
   * say the card's "45 min · any sport · counts anyway" over a typed 29.
   */
  ['SessionSheet(header: day · time as typed, no tier, no estimate)', null, () => {
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 2, name: 'Run', minutes: 45, done: true,
        out: { activity: 'run', duration: 29, distance: 3.1 } } }
    const html = renderToString(<SessionSheet opt={otherCard} entry={entry} entries={rich} isFuture={false}
      onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />)
    const sub = text((html.match(/<div class="modal-sub">(.*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, '')
    if (sub !== 'Today · 29 min') throw new Error(`the header reads "${sub}"`)
    if (/any sport|counts anyway/.test(text(html))) throw new Error('the card\u2019s tier is back in the header')
    // The form is open, and the timer is a row at the foot rather than a big button.
    if (/Session logged|How did it go/.test(text(html))) throw new Error('the form is folded behind a title again')
    if (!/class="list sheet-tools"/.test(html) || !/Interval timer/.test(html)) throw new Error('the interval timer is not a row in the sheet')
    if (/wo-cta|done-btn/.test(html)) throw new Error('the old footer buttons are back')
  }],
  /* An unanswered slider is a placeholder (AGENTS.md §6.4): nothing lit, until moved or tapped. */
  ['SessionLog(an unanswered slider looks unanswered)', null, () => {
    const entry = (out) => ({ id: 'sl', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'log-workout', out } })
    const blank = renderToString(<SessionLog session={otherCard} entry={entry({ activity: 'run' })} entries={[]} onSave={noop} bare />)
    if (!/class="slider unset"/.test(blank)) throw new Error('an unanswered slider is drawn lit, as if answered')
    if (!/class="out-value guess"/.test(blank)) throw new Error('its number is not a placeholder')
    const set = renderToString(<SessionLog session={otherCard} entry={entry({ activity: 'run', rpe: 4 })} entries={[]} onSave={noop} bare />)
    if (/slider unset|out-value guess/.test(set)) throw new Error('an answered slider still reads as unanswered')
  }],
  ['SessionSheet(an ordinary workout opens the interval timer)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    if (hasWorkout(opt)) throw new Error('the test card is supposed to have no timer of its own')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      // Done, as today's entries are by default since #34: the timer must not hang off `!done`.
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Run', minutes: 30, done: true, out: { activity: 'run' } } }
    const sheet = text(renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rec" entries={[]} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} onStartWorkout={noop} />))
    if (!sheet.includes('Interval timer')) throw new Error('no timer on an ordinary workout\'s sheet')
    // What the button asks for, answered by the host the app mounts.
    const req = timerRequestFor(opt, entry)
    if (req.title !== 'Run') throw new Error(`the timer is titled ${req.title}`)
    if (req.presets.some(Boolean)) throw new Error('an ordinary card invented a plan timer')
    openTimer(req)
    try {
      const html = renderToString(<TimerHost entries={[]} upsertEntry={noop} deleteEntry={noop} />)
      const t = text(html)
      for (const w of ['Interval timer', 'Run', 'Start', 'Work', 'Rest', 'Rounds', BUILT_INS[0].name]) {
        if (!t.includes(w)) throw new Error(`the timer opened without "${w}"`)
      }
    } finally { closeTimer() }
    if (renderToString(<TimerHost entries={[]} upsertEntry={noop} deleteEntry={noop} />) !== '') {
      throw new Error('the host shows a timer nobody asked for')
    }
  }],
  ['SessionSheet(no interval timer on a rest day)', null, () => {
    const opt = plan.dailyMenu.find(m => m.role === 'rest')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 1, name: 'Rest day', minutes: 0, done: true, out: {} } }
    const t = text(renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rest" entries={[]} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />))
    if (t.includes('Interval timer')) throw new Error('a timer for resting')
  }],
  // A plan with no climbing cards has no climbing folders (the starter and the
  // example carry two plain ones since #97, so the plan here is the example less them).
  ['a plan with no climbing: no climbing folders', null, () => {
    const keys = climbingFolders(noClimbing).map(f => f.key)
    if (keys.join() !== 'plan') throw new Error(`a plan with no climbing is foldered as ${keys.join(', ')}`)
  }],
  // The starter's two climbing cards file under the two doors (#97, F4).
  ['starter: its climbing cards are in Bouldering and Rock climbing', null, () => {
    const folders = climbingFolders(starter)
    const count = (key) => folders.find(f => f.key === key)?.count || 0
    if (count('bouldering') !== 1 || count('rock-climbing') !== 1) throw new Error(`the starter is foldered as ${folders.map(f => `${f.key} ${f.count}`).join(', ')}`)
  }],
  /*
   * Start on a circuit: a plan that is nothing but a circuit runs on the timer's
   * screen straight away (open, Start, it runs), with the exercise to do now as
   * big as the screen allows, where it is in the round, and what comes next.
   * A lift-only block switched to Circuit offers Start (a plain one does not,
   * `Sheet(a lift-only session offers no clock)`).
   */
  ['SessionSheet + WorkoutRunner(a circuit entry: Start, then the timer with the exercise on it)', null, () => {
    const pres = setCircuit(normalizePrescription({ title: 'Abs', blocks: [{ name: 'Core', category: 'lift', items: [
      { kind: 'lift', name: 'crunch', exercise: 'crunch', sets: [{ reps: 15 }, { reps: 15 }, { reps: 15 }] },
      { kind: 'lift', name: 'plank', exercise: 'plank', sets: [{ seconds: 45 }] },
    ] }] }, { liftField: LIFT_FIELD }), 'b0', true)
    const pres2 = { ...pres, blocks: [{ ...pres.blocks[0], items: pres.blocks[0].items.map(i => ({ ...i, sets: [{ ...i.sets[0], reps: null }] })) }] }
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'planned', name: 'Abs', done: true, plan: pres2, out: {} } }
    const sheet = text(renderToString(<PlanProvider plan={HELD_PLAN}>
      <SessionSheet opt={PLANNED_CARD} entry={entry} tone="rec" entries={[entry]} isFuture={false}
        onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop} onClose={noop} />
    </PlanProvider>))
    if (!/Start workout/.test(sheet)) throw new Error('a lift block switched to Circuit is not runnable')
    // Started: no run on the entry yet, so it opens in the count-in, with the first exercise up next.
    const fresh = renderToString(<PlanProvider plan={HELD_PLAN}><WorkoutRunner session={PLANNED_CARD} entry={entry}
      entries={[]} onRun={noop} onExit={noop} /></PlanProvider>)
    if (!/class="it it-run k-countin it-circuit"/.test(fresh)) throw new Error('Start on a circuit did not open the timer')
    if (!/Up next/.test(text(fresh)) || !/<strong class="it-exnext">Crunch/.test(fresh)) throw new Error('the count-in does not say what is coming')
    // Running: 5 s into the crunch, its name big, where it is, the plank next.
    const now = Date.now()
    const running = { ...entry, data: { ...entry.data, run: { ...emptyRun(now - 15000), circuit: { block: 'b0',
      timer: { startedAt: now - 15000, index: 1, lap: 1, at: now - 5000, extra: 0, pausedAt: null, pausedMs: 0, finishedAt: null } } } } }
    const html = renderToString(<PlanProvider plan={HELD_PLAN}><WorkoutRunner session={PLANNED_CARD} entry={running}
      entries={[]} onRun={noop} onExit={noop} /></PlanProvider>)
    const t = text(html)
    if (!/class="it it-run k-work it-circuit"/.test(html)) throw new Error('the work segment is not on screen')
    if (!/<span class="it-exname">Crunch<\/span>/.test(html)) throw new Error('the exercise to do now is not the big name')
    for (const w of ['Round 1 of 3', 'Exercise 1 of 2', 'Next:', 'Plank', 'Pause', 'Skip']) {
      if (!t.includes(w)) throw new Error(`no "${w}" on the circuit's run screen`)
    }
    if (!/aria-label="Stop the circuit"/.test(html)) throw new Error('the stop does not say it stops the circuit')
  }],
  /*
   * DOING MODE (#79, D9). Lift workouts are done on the sheet, so a planned
   * workout on its day opens on the work: the first exercise with a set still to
   * do is the one open card (the row, all ticked, is folded with its check), every
   * set has a ✓, and what is planning has moved. Pinned on both sides: absent from
   * the body (the Circuit switch, the split fold, the implement chips, the model's
   * panel, the second "What did you lift?" list), present at the new address (each
   * block's ⋯, the implement switch, the pencil for the model: `planTalkWhere`).
   */
  ['SessionSheet(doing: a planned Pull opens on the first exercise not done, a ✓ per set, the planning behind the ⋯)', null, () => {
    const lift = (exercise, n, w) => ({ kind: 'lift', exercise, implement: 'cable', sets: Array.from({ length: n }, () => ({ reps: 10, weight: w })) })
    let pres = normalizePrescription({ title: 'Pull', category: 'lift', activity: 'lift', blocks: [
      { name: 'Warm-up', note: 'Five minutes on the rower, then band pull-aparts.', items: [] },
      { name: 'Main', category: 'lift', items: [lift('lat-pulldown', 2, 100), lift('barbell-curl', 3, 50), lift('face-pull', 3, 30)] },
    ] }, { liftField: LIFT_FIELD })
    pres = tickSet(tickSet(pres, 'b1i0', 'b1i0s0', true), 'b1i0', 'b1i0s1', true)
    const entry = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plan: pres, name: 'Pull' } }
    const html = renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={entry} entries={rich} isFuture={false}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop} onSaveEntry={null} onClose={noop} />
      </PlanProvider>)
    const t = text(html)
    const open = html.match(/class="presc-sets doing"/g) || []
    if (open.length !== 1) throw new Error(`one card should be open, the next to do; ${open.length} are`)
    const curl = html.indexOf('Barbell curl')
    const sets = html.indexOf('class="presc-sets doing"')
    if (!(curl > 0 && sets > curl && sets < html.indexOf('Face pull'))) throw new Error('the open card is not the first exercise with a set to do')
    if ((html.match(/aria-label="Set \d done"/g) || []).length !== 3) throw new Error('the open exercise does not have a ✓ per set')
    if (!/role="checkbox" aria-checked="false" aria-label="Set 1 done"/.test(html)) throw new Error('a set’s ✓ is not a checkbox that says which set')
    if (!/aria-label="All sets done"/.test(html)) throw new Error('the finished exercise does not say it is done')
    if (!/2 sets/.test(t) && !/Lat pulldown/.test(t)) throw new Error('the finished exercise vanished')
    // Old addresses: nothing that is planning sits between the head and the first set.
    for (const [what, re] of [['the Circuit switch', /class="cx-switch"/], ['the split fold', /class="blockquota/],
      ['the implement chips', /class="presc-impl"/], ['the model’s panel', /Why this session|Ask the model/],
      ['the second lift list', /What did you lift\?/], ['muscles in words', /class="presc-muscles"/]]) {
      if (re.test(html)) throw new Error(`${what} is still on the doing sheet`)
    }
    // New addresses.
    if (!/aria-label="Main: block options"/.test(html) || !/aria-label="Warm-up: block options"/.test(html)) throw new Error('a block lost its ⋯')
    if (!/class="implswitch/.test(html)) throw new Error('no implement switch on the open card')
    if (!/<p class="presc-blocknote">Five minutes on the rower/.test(html)) throw new Error('the warm-up’s note is not shown')
    if (!/Add a block/.test(t)) throw new Error('no way to add a block')
    if (planTalkWhere({ ai: true, doing: true }) !== 'details') throw new Error('the model is not behind the pencil while doing')
  }],
  /* A done plan's earlier day is the log as written (D11, `liftsDone`): its sets
     read as done, the ✓s are not toggles, and no card opens (all done). */
  ['SessionSheet(an earlier, done planned day: every numbered set reads done, nothing to tick)', null, () => {
    const day = back(2)
    const html = renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={{ ...PLANNED_ENTRY, id: `daily-${day}`, date: day, data: { ...PLANNED_ENTRY.data, done: true } }}
          entries={rich} isFuture={false} onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop} onClose={noop} />
      </PlanProvider>)
    if (/role="checkbox"[^>]*aria-label="Set \d done"/.test(html)) throw new Error('a past day\u2019s sets are toggles')
    if (/class="presc-sets doing"/.test(html)) throw new Error('a card opened on a day where everything is done')
    if (!/aria-label="All sets done"/.test(html)) throw new Error('the exercises do not read as done')
  }],
  ['planTalkWhere(the model: nowhere without one, behind the pencil while doing, inline while planning)', null, () => {
    if (planTalkWhere({ ai: false, doing: true }) !== null || planTalkWhere({ ai: false, doing: false }) !== null) throw new Error('offered with no model')
    if (planTalkWhere({ ai: true, doing: false }) !== 'sheet') throw new Error('a day still to come lost its inline panel')
  }],
  ['SessionSheet(a day still to come is still planning: no ✓, no doing)', null, () => {
    const html = renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={{ ...PLANNED_ENTRY, date: back(-3) }} entries={rich} isFuture
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={null} onClose={noop} />
      </PlanProvider>)
    if (/presc-tick|presc-sets doing/.test(html)) throw new Error('a plan for a later day has ✓s to tick')
    if (!/class="presc-sets"/.test(html)) throw new Error('the plan is not editable')
  }],
  /*
   * ONE SHEET (#79, G F1). The Log mounted a bare form, so the same planned
   * workout opened from the Log showed "What did you lift?" and none of its
   * exercises. Now it is the same SessionSheet: the plan, its ⋯s, the done chip.
   */
  ['LogSheet(the Log opens the same sheet as Today: the plan, its blocks, the done chip; no second lift list)', null, () => {
    const ops = sessionOps({ plan, entries: rich, upsertEntry: noop, deleteEntry: noop })
    const entry = { ...PLANNED_ENTRY, date: back(2), id: `daily-${back(2)}` }
    const fromLog = renderToString(<PlanProvider plan={plan}>
      <LogSheet opt={PLANNED_CARD} entry={entry} entries={rich} ops={ops} upsertEntry={noop} onClose={noop} />
    </PlanProvider>)
    const fromToday = renderToString(<PlanProvider plan={plan}>
      <SessionSheet opt={PLANNED_CARD} entry={entry} entries={rich} isFuture={false}
        onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop} onClose={noop} />
    </PlanProvider>)
    const exercise = PRESCRIPTION.blocks.flatMap(b => b.items).find(it => it.kind === 'lift')?.name
    for (const [where, html] of [['the Log', fromLog], ['Today', fromToday]]) {
      if (!html.includes(exercise)) throw new Error(`${where}: the planned exercises are not on the sheet`)
      if (!/: block options"/.test(html)) throw new Error(`${where}: no block menu`)
      if (!/class="done-chip/.test(html)) throw new Error(`${where}: no done chip`)
      if (/What did you lift\?/.test(html)) throw new Error(`${where}: a second, empty lift list`)
      if (!/aria-label="Edit this workout"/.test(html)) throw new Error(`${where}: no pencil`)
    }
    // Running is Today's: history offers no Start.
    if (/Start workout|Carry on/.test(fromLog)) throw new Error('the Log offers to start a workout')
    if (/from today/.test(fromLog)) throw new Error('an earlier day’s remove says "from today"')
  }],
  ['SessionLog(a planned entry: no second "What did you lift?"; rows a run logged still show)', null, () => {
    const bare = renderToString(<SessionLog session={PLANNED_CARD} entry={PLANNED_ENTRY} entries={[]} onSave={noop} />)
    if (/What did you lift\?/.test(bare)) throw new Error('the empty second lift list is back under the plan')
    const logged = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, out: { ...PLANNED_ENTRY.data.out, lifts: [
      { uid: 'b1i0', key: SQUAT.key, name: SQUAT.name, implement: 'barbell', sets: [{ reps: 5, weight: 185 }] }] } } }
    const kept = renderToString(<SessionLog session={PLANNED_CARD} entry={logged} entries={[]} onSave={noop} />)
    if (!kept.includes(SQUAT.name)) throw new Error('logged rows on a planned entry were hidden')
    // A free-form lift (no plan) still asks.
    const free = renderToString(<SessionLog session={otherCard} entry={{ id: 'f', kind: 'daily', date: TODAY, data: { optId: 'log-workout', out: { activity: 'lift' } } }} entries={[]} onSave={noop} />)
    if (!/What did you lift\?/.test(free)) throw new Error('a free-form lift lost its lift list')
  }],
  // "Last time you did this" on a climbing card answers what was climbed, and an
  // old date is in words (#97, F2): it said "2026-10-19" and nothing else.
  ['PriorNote(a climbing night reads as what was climbed)', <PriorNote session={plan.dailyMenu.find(m => m.id === 'fun-sport')}
    excludeId="now" entries={[{ id: 'daily-2026-08-19', kind: 'daily', date: '2026-08-19', updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, done: true, out: { sets: { routes: [{ reps: 2, climbs: [
        { grade: 10.2, outcome: 'send' }, { grade: 11.2, outcome: 'fell' }] }] } } } }]} />,
    (html) => {
      const t = text(html)
      if (!/2 routes · hardest 5\.10/.test(t)) throw new Error(`last time reads: ${t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`)
      if (/\d sets?, \d+ reps/.test(t)) throw new Error('last time counts sets and reps on a climbing card')
      if (/2026-08-19/.test(t)) throw new Error('an old date is printed as ISO')
    }],
  // The typed "hardest" field under a list of graded climbs is a second answer
  // nothing reads; it goes while climbs are graded, and its unit is said once (#97, F9b).
  ['SessionLog(the typed hardest is moot under graded climbs)', null, () => {
    const card = plan.dailyMenu.find(m => m.id === 'fun-boulder')
    const at = (out) => text(renderToString(<SessionLog session={card} onSave={noop} entries={[]} bare
      entry={{ id: 'b', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'fun-boulder', level: 2, out } }} />))
    const count = at({ sets: { problems: [{ reps: 6 }] } })
    if (!/Hardest thing you climbed \(V\)/.test(count)) throw new Error('a count-only night lost its hardest field')
    if (/\(V\) \(V\)/.test(count)) throw new Error('the unit is printed twice')
    const graded = at({ hardest: 6, sets: { problems: [{ reps: 2, climbs: [{ grade: 4, outcome: 'send' }, { grade: 5, outcome: 'fell' }] }] } })
    if (/Hardest thing you climbed/.test(graded)) throw new Error('the typed hardest sits under the graded climbs')
  }],
  // A climbing card being logged opens on its log; the protocol and evidence are
  // one fold under it (#97, F5). Before, the log began about 1,070px down.
  ['Sheet(a climbing card opens on its log, protocol folded)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'fun-boulder', level: 2, out: {} } }}
    entries={[]} isFuture={false} onLog={noop} onSave={noop} onClose={noop} />,
    (html) => {
      const log = html.indexOf('class="setlog"')
      const about = html.indexOf('class="sess-about"')
      if (log < 0) throw new Error('no set log on the sheet')
      if (about < 0 || about < log) throw new Error('the protocol is not folded under the log')
      const firstProtocol = Math.min(...['class="sess ', 'class="ev-note"', 'class="sect-nav"'].map(k => html.indexOf(k)).filter(i => i >= 0))
      if (firstProtocol < about) throw new Error('protocol prose sits above the log, outside its fold')
      if (!/rec-dose/.test(html.slice(0, log))) throw new Error('the dose line left the top of the card')
    }],
  // The other side: a climbing card on a day still to come is planning, protocol open.
  ['Sheet(a climbing card on a later day keeps its protocol open)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={null} entries={[]} isFuture onLog={noop} onSave={noop} onClose={noop} />,
    (html) => {
      if (/sess-about/.test(html)) throw new Error('a future day folds the protocol it is being planned from')
      if (!/class="sess /.test(html)) throw new Error('no protocol on a future day')
    }],
  // A card that counts no climbs keeps its order: protocol, then the log.
  ['Sheet(a hangboard card keeps protocol then log)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'repeaters')}
    entry={{ id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'repeaters', level: 3, out: {} } }}
    entries={[]} isFuture={false} onLog={noop} onSave={noop} onClose={noop} />,
    (html) => {
      if (/sess-about/.test(html)) throw new Error('a hangboard card folded its protocol')
      if (html.indexOf('class="sess ') > html.indexOf('class="setlog"')) throw new Error('the hangboard log moved above its protocol')
    }],
  // "Pre-filled from the plan" only where the plan filled something in (#97 review):
  // the starter's Bouldering card has no default count and opens on an empty box.
  ['SetLog(the pre-filled note only when the plan pre-fills)', null, () => {
    const note = /Pre-filled from the plan/
    const bare = renderToString(<SetLog session={starter.dailyMenu.find(m => m.id === 'climb-bouldering')} out={{}} onSave={noop} />)
    if (note.test(bare)) throw new Error('an empty box is said to be pre-filled')
    const filled = renderToString(<SetLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')} out={{}} onSave={noop} />)
    if (!note.test(filled)) throw new Error('a pre-filled count no longer says where it came from')
  }],
]
