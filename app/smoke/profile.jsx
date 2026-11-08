import { readFileSync } from 'node:fs'
/* Smoke cases: the profile: Testing, Why, gear, WHOOP, Strava, the screen probe, People.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { TestingTab, WhyTab, TestRunner } from '../src/testing.jsx'
import { ScreenCard, describeScreen } from '../src/screeninfo.jsx'
import { GearSection, GearForm } from '../src/gear.jsx'
import { gearUsage } from '../src/lib/gear.js'
import { ProfileMenu, ProfilePanel, PeopleCard, homePages } from '../src/profile.jsx'
import { PrefsProvider } from '../src/lib/prefs.jsx'
import { SessionLog } from '../src/sessionlog.jsx'
import { WhoopProvider } from '../src/lib/whoop.jsx'
import { WhoopWorkouts } from '../src/whoop.jsx'
import { WhoopReadiness, WhoopSleep, sleepSeries, sleepStats } from '../src/whoopday.jsx'
import { StravaProvider } from '../src/lib/strava.jsx'
import { StravaActivities } from '../src/strava.jsx'
import { UnloggedWorkouts } from '../src/unlogged.jsx'
import {
  plan, starter, example, STRAVA_CACHE, entries, noop, TODAY, back, cfEntries, text,
  isoShift,
} from './fixtures.jsx'

export default [
  ['TestingTab', <TestingTab plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} />],
  ['GearSection(empty)', <GearSection plan={plan} entries={[]} strava={null} upsertEntry={noop} deleteEntry={noop} />],
  ['GearSection(strava bikes and shoes)', <GearSection plan={plan} entries={[]}
    strava={STRAVA_CACHE} upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      if (!/Strava/.test(text(html))) throw new Error('synced gear is not labelled as synced')
    }],
  ['GearSection(local gear with use on it)', <GearSection plan={plan}
    strava={STRAVA_CACHE}
    entries={[
      { id: 'gear-rope', kind: 'gear', data: { name: 'Mammut 9.5', kind: 'rope', primary: true, acquired: '2025-03-01' } },
      { id: 'gear-plates', kind: 'gear', data: { name: 'Cast iron', kind: 'weights' } },
      { id: `daily-${TODAY}-board`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'board', level: 4, done: true, minutes: 120, out: { gear: ['gear-rope'] } } },
    ]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      if (!/Mammut/.test(t)) throw new Error('local gear is missing')
      // Two units on one page, which is the point: the metric belongs to the KIND,
      // so a bike reads in miles and a rope reads in hours without either
      // item having to declare it.
      if (!/\bhr\b/.test(t)) throw new Error('a rope should read in hours')
      if (!/\bmi\b/.test(t)) throw new Error('a bike should still read in miles')
    }],
  ['GearSection(retired gear keeps its hours)', <GearSection plan={plan} strava={null}
    entries={[{ id: 'g1', kind: 'gear', data: { name: 'Worn rope', kind: 'rope', retired: true, priorMinutes: 12000 } }]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      if (!/200/.test(text(html))) throw new Error('the hours on a retired rope are why you retired it')
    }],
  /* #76: the form's "already on it" box is in the unit it is labelled in. It
     showed the stored MINUTES under "Hours already on it", so 2 hours reopened
     as 120 and saving made it 120 hours. */
  ['GearForm(time gear reopens in hours, not minutes)', <GearForm plan={plan}
    row={gearUsage({ plan, entries: [{ id: 'g-shoe', kind: 'gear', data: { name: 'Review shoes', kind: 'climbing-shoes', priorMinutes: 120 } }] })[0]}
    onSave={noop} onCancel={noop} onDelete={noop} />,
    (html) => {
      if (!/Hours already on it/.test(text(html))) throw new Error('a climbing shoe is counted in hours')
      if (!/value="2"/.test(html)) throw new Error('2 hours should reopen as 2')
      if (/value="120"/.test(html)) throw new Error('the stored minutes are in the hours box')
    }],
  ['GearForm(a weight shows its reps, never its minutes)', <GearForm plan={plan}
    row={gearUsage({ plan, entries: [{ id: 'g-w', kind: 'gear', data: { name: 'Plates', kind: 'weights', priorReps: 300, priorMinutes: 40 } }] })[0]}
    onSave={noop} onCancel={noop} onDelete={noop} />,
    (html) => {
      if (!/Reps already on it/.test(text(html)) || !/value="300"/.test(html)) throw new Error('300 reps should show as 300')
    }],
  /* #76: Strava's gear is read here, not edited. Its Save wrote a NEW local item
     under the bike's name, a second row for the same bike. Absent at the old
     place (Save, Cancel), present at the new one (Done). */
  ['GearForm(Strava gear has Done, not Save)', <GearForm plan={plan}
    row={gearUsage({ plan, entries: [], strava: STRAVA_CACHE }).find(r => r.source === 'strava')}
    onSave={noop} onCancel={noop} onDelete={null} />,
    (html) => {
      const t = text(html)
      if (!/From Strava/.test(t)) throw new Error('say where it comes from')
      if (!/>Done</.test(html)) throw new Error('Done closes a synced form')
      if (/>Save</.test(html) || />Cancel</.test(html)) throw new Error('a synced item has nothing to save')
    }],
  ['ProfileMenu(with a picture)', <StravaProvider initial={{ cache: STRAVA_CACHE, status: 'ok' }}>
    <ProfileMenu plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced" />
  </StravaProvider>,
    (html) => {
      if (!/Sam/.test(text(html))) throw new Error('the header does not say who the athlete is')
      // Closed by default: the panel is a menu, not a page, and mounting it open
      // would put a gear editor over the app on every load.
      if (/Connections|Add gear/.test(text(html))) throw new Error('the menu should start closed')
      // On a phone the button is a face and nothing else, so it needs a name.
      if (!/class="mebtn"[^>]*aria-label="Profile: [^"]+"/.test(html)) throw new Error('the avatar button has no accessible name')
    }],
  ['ProfileMenu(no strava at all)', <ProfileMenu plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} status="offline" />,
    (html) => {
      if (!/You/.test(text(html))) throw new Error('a header saying null is worse than one saying nothing')
    }],
  /*
   * The profile is a list of sections (#44), not six tabs in a strip that cut
   * off on a phone. Pinned from both sides: the list and its order at the new
   * address, and Testing and Why gone from the top level (they are under
   * Climbing, where a climbing plan fills them).
   */
  ...(() => {
    const owner = { id: 'owner', name: 'Alex', owner: true, acting: false,
      real: { id: 'owner', name: 'Alex', admin: true }, people: [],
      features: { ai: true, whoop: true, strava: true, stravaConnect: true, whoopConnect: true, notifications: true } }
    const nobody = { ...owner, features: { ...owner.features, whoop: false, strava: false, stravaConnect: false, whoopConnect: false } }
    const panel = (props) => renderToString(
      <ProfilePanel plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} status="synced"
        who={owner} onClose={noop} {...props} />)
    const rowTitles = (html) => [...html.matchAll(/class="list-row-title">([^<]+)</g)].map(m => m[1])
    return [
      /* Grades are picked off the ladder, never typed (§6.4, #98, G r1 F9); one typed
         before shows on its rung, or is said when it is none, and is not rewritten (§4). Both platforms. */
      ['ProfilePanel(Climbing: your grades off the ladder; a grade typed before is kept and said)', null, () => {
        const typed = { id: 'profile', kind: 'profile', updatedAt: 'z', data: { facts: { redpoint: '5.11b', flash: 'mid 5.10s', boulder: 5 } } }
        const html = renderToString(<ProfilePanel plan={plan} entries={[...entries.filter(e => e.id !== 'profile'), typed]} upsertEntry={noop} deleteEntry={noop}
          status="synced" who={owner} onClose={noop} initialPage="climbing" />)
        for (const label of ['Redpoint grade', 'Flash / onsight', 'Boulder grade']) {
          if (!new RegExp(`<select class="gradesel" aria-label="${label.replace('/', '\\/')}"`).test(html)) throw new Error(`${label} is not a grade picker`)
          if (new RegExp(`${label.replace('/', '\\/')}[^]*?<input type="text"`).test(html.slice(0, html.indexOf('Ape index')))) throw new Error(`${label} is a text box again`)
        }
        const boulder = html.match(/<select class="gradesel" aria-label="Boulder grade">([^]*?)<\/select>/)?.[1] || ''
        if (!/<option value="5" selected="">V5<\/option>/.test(boulder)) throw new Error('the boulder grade is not on the V ladder, or not picked')
        if (/5\.1/.test(boulder)) throw new Error('route grades in the boulder picker')
        // Typed text that is exactly a rung shows on it; anything else is said, never guessed.
        const red = html.match(/<select class="gradesel" aria-label="Redpoint grade">([^]*?)<\/select>/)?.[1] || ''
        if (!/<option value="11\.15" selected="">5\.11b<\/option>/.test(red)) throw new Error('a typed 5.11b is not shown on its rung')
        if (/You wrote “5\.11b”/.test(text(html))) throw new Error('a typed grade that is a rung is said as if it were not')
        if (!/You wrote “mid 5\.10s”/.test(text(html))) throw new Error('a typed grade that is no rung is not said')
        if (!/value="" selected=""/.test(html.match(/<select class="gradesel" aria-label="Flash \/ onsight">([^]*?)<\/select>/)?.[1] || '')) throw new Error('text that is no rung was guessed onto one')
        const native = readFileSync(new URL('../../mobile/src/features/profile.tsx', import.meta.url), 'utf8')
        if (!/<ScaleGradeSelect scale=\{f\.scale\}/.test(native) || !/You wrote “\$\{typed\}”/.test(native) || !/gradeFromText\(typed, f\.scale\)/.test(native)) throw new Error('the phone types its grades')
      }],
      ['ProfilePanel(a list of sections, Climbing holding Testing and Why)', null, () => {
        const home = rowTitles(panel({}))
        const want = ['You', 'Gear', 'Notifications', 'Connections', 'Climbing', 'Settings']
        if (home.join() !== want.join()) throw new Error(`home rows: ${home.join(', ')}`)
        if (/>Alerts</.test(panel({}))) throw new Error('the old "Alerts" tab is back')
        if (/role="tablist"|pop-rail/.test(panel({}))) throw new Error('the sideways strip of tabs is back')
        for (const gone of ['Testing', 'Why']) {
          if (home.includes(gone)) throw new Error(`${gone} is at the top level again; it lives under Climbing`)
        }
        const climbing = panel({ initialPage: 'climbing' })
        const sub = rowTitles(climbing)
        if (!sub.includes('Testing') || !sub.includes('Why')) throw new Error(`Climbing should open Testing and Why: ${sub.join(', ')}`)
        if (!/Your grades/.test(text(climbing))) throw new Error('the climbing numbers moved here from You')
        if (!/aria-label="Back to your profile"/.test(climbing)) throw new Error('no way back from a page')
        if (!/aria-label="Back to Climbing"/.test(panel({ initialPage: 'testing' }))) throw new Error('Testing goes back to Climbing')
        // You keeps the body numbers and nothing about climbing.
        const you = text(panel({ initialPage: 'you' }))
        if (!/Bodyweight/.test(you)) throw new Error('bodyweight is missing from You')
        if (/Redpoint grade/.test(you)) throw new Error('climbing grades are still on You')
        // No example numbers in placeholder grey, which read as their own (#55).
        const youHtml = panel({ initialPage: 'you' }) + panel({ initialPage: 'climbing' })
        if (/placeholder="(186|71|48|190|220|5\.11c|V6|\+2)"/.test(youHtml)) throw new Error('an example number is back as a placeholder')
        // Yes/no settings are switches, as on the iPhone (Toggle), not bare checkboxes.
        const settings = panel({ initialPage: 'settings' })
        if (!/role="switch"/.test(settings) || /type="checkbox"(?![^>]*role="switch")/.test(settings)) throw new Error('Show explanations is not a switch')
      }],
      ['ProfilePanel(nothing to connect, nothing behind Testing)', null, () => {
        // No Strava or WHOOP app on the server: no Connections row at all, as before.
        if (homePages(nobody).includes('connections')) throw new Error('a Connections row with nothing to connect')
        if (homePages({ ...owner, acting: true }).includes('connections')) throw new Error('acting as someone offers their connections')
        // The starter defines no tests and no evidence: Climbing has the grades and no empty doors.
        const starterClimb = rowTitles(renderToString(
          <ProfilePanel plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced"
            who={owner} onClose={noop} initialPage="climbing" />))
        if (starterClimb.length) throw new Error(`the starter's Climbing offers empty pages: ${starterClimb.join(', ')}`)
      }],
      ['ProfilePanel(connections: one service, one action)', null, () => {
        const on = text(panel({ initialPage: 'connections', who: { ...owner, features: { ...owner.features, whoop: false } } }))
        if (!/Strava/.test(on) || !/Disconnect/.test(on)) throw new Error('a connected Strava can be disconnected')
        if (!/WHOOP.*Not connected.*Connect/.test(on)) throw new Error('an unconnected WHOOP offers to connect')
        // Two services, neither connected: two Connect buttons, and neither is the accent.
        const both = panel({ initialPage: 'connections', who: { ...nobody, features: { ...nobody.features, stravaConnect: true, whoopConnect: true } } })
        if ((both.match(/>Connect</g) || []).length !== 2) throw new Error('each service offers to connect')
        if (/class="btn"[ >]/.test(both)) throw new Error('two primaries on one page')
        const someone = text(panel({ initialPage: 'connections', who: { ...owner, owner: false, real: { id: 'sam', admin: false } } }))
        if (/WHOOP/.test(someone)) throw new Error('WHOOP is the owner\'s grant, not everyone\'s')
      }],
      ['ProfilePanel(settings: sync, explanations, the server page)', null, () => {
        const t = text(panel({ initialPage: 'settings' }))
        if (!/Synced/.test(t)) throw new Error('the sync state is not shown')
        if (!/Show explanations/.test(t)) throw new Error('the explanations switch is missing')
        if (!/Server settings/.test(t)) throw new Error('the owner has no way to the server Settings page')
        if (/This is what the header used to say/.test(t)) throw new Error('the explanatory paragraph came back')
        const someone = text(panel({ initialPage: 'settings', who: { ...owner, owner: false, real: { id: 'sam', admin: false } } }))
        if (/Server settings/.test(someone)) throw new Error('only the owner opens server Settings')
      }],
    ]
  })(),
  ['WhyTab', <WhyTab plan={plan} />],
  ['TestingTab(empty)', <TestingTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  // Trip mode: the four days the whole block points at.

  // Critical force: the ceiling readout, the charts, and the resolved dose on
  // the session it drives, from the calibration-day fixture above.
  ['TestingTab(critical force)', <TestingTab plan={plan} entries={cfEntries} upsertEntry={noop} />],
  /* #76: an empty result cannot be saved, and the button says why. */
  ['TestRunner(an empty result cannot be saved)', <TestRunner test={plan.tests.find(t => t.id === 'critical-force')}
    onSave={noop} onDone={noop} />,
    (html) => {
      if (!/<button[^>]*disabled=""[^>]*>Save result<\/button>/.test(html)) throw new Error('Save result should be disabled with nothing typed')
      if (!/Type at least one result to save it/.test(text(html))) throw new Error('say what Save is waiting for')
      if (/type="number"/.test(html)) throw new Error('result boxes are text boxes that own their text (NumInput)')
    }],
  /* #97 F8: Cancel is quiet, not beside Save, and leaving with numbers typed asks. */
  ['TestRunner(Cancel is quiet and away from Save)', <TestRunner test={plan.tests.find(t => t.id === 'critical-force')}
    onSave={noop} onDone={noop} />,
    (html) => {
      if (/class="prof-actions"[^>]*>(?:(?!<\/div>).)*Cancel/s.test(html)) throw new Error('Cancel sits beside Save again')
      if (!/class="btn quiet test-cancel"[^>]*>Cancel</.test(html)) throw new Error('no quiet way out of the test')
    }],
  ['TestRunner(leaving with results typed asks first)', <TestRunner test={plan.tests.find(t => t.id === 'critical-force')}
    onSave={noop} onDone={noop} initialAsk />,
    (html) => {
      const t = text(html)
      if (!/Discard the results you typed\?/.test(t)) throw new Error('the question is missing')
      if (!/>Keep them</.test(t) || !/class="btn destructive"[^>]*>Discard</.test(html)) throw new Error('both answers must be offered')
      if (/test-cancel/.test(html)) throw new Error('Cancel stays while its question is open')
    }],
  /* #97 F9f: one result is a number and a date; the chart starts at two. */
  ['TestingTab(one result is a number, not a one-dot chart)', <TestingTab plan={plan} upsertEntry={noop}
    entries={[{ id: 'cf-one', kind: 'test', date: '2026-08-08', updatedAt: 'z', data: { testId: 'critical-force', cfKg: 18.2 } }]} />,
    (html) => {
      const card = html.slice(html.indexOf('Critical force'))
      if (!/class="test-one"/.test(card) || !/18\.2/.test(text(card)) || !/2026/.test(text(card))) throw new Error('the one result is not said with its date')
    }],
  ['TestingTab(two results draw the line)', <TestingTab plan={plan} entries={cfEntries} upsertEntry={noop} />,
    (html) => { if (!/class="viz"/.test(html)) throw new Error('two results drew no chart') }],
  /* #76: the newest result being empty never hides the last usable ceiling,
     and a result without a metric is no point on its chart. */
  ['TestingTab(an empty newer CF result does not hide the ceiling)', <TestingTab plan={plan} upsertEntry={noop}
    entries={[
      { id: 'cf-ok', kind: 'test', date: '2026-08-08', updatedAt: 'z', data: { testId: 'critical-force', cfKg: 18.2 } },
      { id: 'cf-empty', kind: 'test', date: '2026-09-01', updatedAt: 'z', data: { testId: 'critical-force' } },
    ]} />,
    (html) => {
      const t = text(html)
      if (!/Your ceiling/.test(t)) throw new Error('the ceiling vanished behind an empty result')
      if (!/12\.2/.test(t)) throw new Error('the ceiling is CF 18.2 − 6')
      if (!/2026-09-01 result has no critical force/.test(t)) throw new Error('say which result is being used, and why')
    }],
  ['TestingTab(a CF under the correction gives no ceiling, and says so)', <TestingTab plan={plan} upsertEntry={noop}
    entries={[{ id: 'cf-low', kind: 'test', date: '2026-09-01', updatedAt: 'z', data: { testId: 'critical-force', cfKg: 5 } }]} />,
    (html) => {
      const t = text(html)
      if (/Your ceiling/.test(t)) throw new Error('no ceiling from a CF of 5')
      if (/kg ceiling|unilateral target/.test(t)) throw new Error('a ceiling number was drawn (it was −1 kg)')
      if (!/gives no ceiling/.test(t)) throw new Error('say why there is none')
    }],
  ['TestingTab(CF, no max logged)', <TestingTab plan={plan} upsertEntry={noop}
    entries={[{ id: 'cf1', kind: 'test', date: '2026-08-08', updatedAt: 'z',
      data: { testId: 'critical-force', cfKg: 18.2 } }]} />],
  ['TestingTab(CF, CFmin binds)', <TestingTab plan={plan} upsertEntry={noop}
    entries={[{ id: 'cf2', kind: 'test', date: '2026-08-08', updatedAt: 'z',
      data: { testId: 'critical-force', cfKg: 18.2, cfMinKg: 11.5, mvcKg: 48.6 } }]} />],
  /* WHOOP.
   *
   * The state that matters most is the EMPTY one: with no band, no grant or no
   * cache, every one of these must render nothing at all, because "the app behaves
   * exactly as it did before WHOOP existed" is the whole safety argument for
   * letting an external service near a training log. After that, the risk is a
   * wrong match written into the log, so the suggestion rules are pinned on screen
   * as well as in server/whoop.test.js.
   */
  ...(() => {
    const day = '2026-08-20'
    const t = (hhmm, mins) => {
      const start = Date.parse(`${day}T${hhmm}:00.000Z`)
      return { start: new Date(start).toISOString(), end: new Date(start + mins * 60000).toISOString(), minutes: mins }
    }
    const climb = { id: 'w-climb', sport: 'rock-climbing', date: day, ...t('18:05', 88),
      strain: 11.4, avgHr: 132, maxHr: 168, calories: 640, percentRecorded: 98,
      zones: { zero: 6, one: 22, two: 34, three: 18, four: 7, five: 1 } }
    const lift = { id: 'w-lift', sport: 'Weightlifting', date: day, ...t('17:10', 35),
      strain: 4.1, avgHr: 118, maxHr: 141, calories: 210, percentRecorded: 71,
      zones: { zero: 9, one: 15, two: 8, three: 3, four: 0, five: 0 } }
    const cache = {
      fetchedAt: `${day}T20:00:00.000Z`, maxHeartRate: 195,
      workouts: [climb, lift],
      recovery: [
        { date: day, recovery: 31, hrv: 42, restingHr: 58, strain: 8.2 },
        { date: '2026-08-19', recovery: 62, hrv: 55, restingHr: 52 },
        { date: '2026-08-18', recovery: 58, hrv: 51, restingHr: 53 },
        { date: '2026-08-17', recovery: 70, hrv: 58, restingHr: 51 },
        { date: '2026-08-16', recovery: 49, hrv: 47, restingHr: 54 },
      ],
    }
    const session = plan.dailyMenu.find(m => m.id === 'four-by-four')
    const entryOf = (out) => ({
      id: `daily-${day}`, kind: 'daily', date: day, updatedAt: 'z',
      data: { optId: 'four-by-four', name: 'Bouldering 4×4s', minutes: 96, out },
    })
    const wrap = (initial, el) => <WhoopProvider initial={initial}>{el}</WhoopProvider>
    const workouts = (out, initial = { cache }) =>
      wrap(initial, <WhoopWorkouts session={session} entry={entryOf(out)} entries={[]} onSave={noop} />)

    return [
      // The timed session: workout mode stamped startedAt, so the overlap is real
      // and the climb — not the lift before it — is the one marked.
      ['Whoop(timed session, overlap)',
        workouts({ startedAt: `${day}T18:00:00.000Z`, elapsedMin: 96 }),
        html => {
          const t2 = text(html)
          if (!/rock-climbing/.test(t2) || !/Weightlifting/.test(t2)) throw new Error('both workouts should be listed')
          // Exactly one suggestion, and it is the climb.
          const tags = (html.match(/class="wh-tag"/g) || []).length
          if (tags !== 1) throw new Error(`expected one likely tag, got ${tags}`)
          const climbFirst = t2.indexOf('rock-climbing') < t2.indexOf('Weightlifting')
          if (!climbFirst) throw new Error('the overlapping workout should rank first')
          // Why, as text on the row: a tooltip is invisible on a phone.
          if (!/class="list-row-meta wh-why">Overlaps this session by \d+ min</.test(html)) throw new Error('the reason for Likely is not on the row')
          if (/class="wh-tag" title=/.test(html)) throw new Error('the reason went back into a tooltip')
          // Heart rate against their own max, and the partial recording called out.
          if (!/avg 132 \(68%\)/.test(t2)) throw new Error('no percentage of max heart rate')
          if (!/26 min zone 3\+/.test(t2)) throw new Error('hard minutes missing')
          if (!/only 71% recorded/.test(t2)) throw new Error('a partly-recorded workout must say so')
          if (!/>Attach</.test(html)) throw new Error('nothing to tap')
        }],
      /* No clock on the session at all — logged by hand — and the sport decides it:
       * four-by-four declares `whoopSport: climbing` in plan.json, one of the two
       * workouts is titled rock-climbing, and that is two sources agreeing about
       * what happened rather than a coincidence of length. */
      ['Whoop(untimed session, the sport decides)', workouts({}),
        html => {
          const tags = (html.match(/class="wh-tag"/g) || []).length
          if (tags !== 1) throw new Error(`expected the climb to be picked, got ${tags} tags`)
          const t2 = text(html)
          if (t2.indexOf('rock-climbing') > t2.indexOf('Weightlifting')) {
            throw new Error('the mismatched sport should sink below the climb')
          }
          // The sport decided it, so that is the reason given, not "the only workout today".
          if (!/The only workout of this sport today/.test(t2)) throw new Error('the reason does not name the sport')
          if ((html.match(/>Attach</g) || []).length !== 2) throw new Error('both should still be attachable')
        }],
      // Two climbs is ambiguous again, and the app goes quiet rather than guessing.
      ['Whoop(two climbs, no claim)',
        wrap({ cache: { ...cache, workouts: [climb, { ...climb, id: 'w-b', sport: 'bouldering', ...t('19:40', 50) }] } },
          <WhoopWorkouts session={session} entry={entryOf({})} entries={[]} onSave={noop} />),
        html => {
          if (/class="wh-tag"/.test(html)) throw new Error('"the only climb tonight" stopped being true')
        }],
      // Attached: the snapshot renders from the entry, and detaching is offered.
      ['Whoop(attached)', workouts({ whoop: {
        id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), strain: 11.4,
        avgHr: 132, maxHr: 168, pctAvgHr: 68, pctMaxHr: 86, calories: 640, percentRecorded: 98,
        maxHeartRate: 195, zones: { three: 18, four: 7, five: 1 }, attachedAt: 'z' } }),
        html => {
          const t2 = text(html)
          if (!/Detach/.test(t2)) throw new Error('no way to undo a wrong attachment')
          if (!/Saved with this session, so it stays if WHOOP goes away/.test(t2)) {
            throw new Error('the snapshot has to say it is durable')
          }
          /*
           * AND IT STILL OFFERS THE OTHERS. Reversed later: several Strava and
           * WHOOP activities can be attached to one session at once.
           * One session can be two measured pieces — a lift and then a row —
           * and the version that stopped offering after the first made the
           * second unreachable rather than merely unattached.
           */
          if (!/>Attach</.test(html)) {
            throw new Error('a second workout must still be attachable')
          }
          if (!/Also on this day/.test(t2)) throw new Error('the rest of the day is unlabelled')
          // The already-attached one must not be offered to itself.
          if ((t2.match(/rock-climbing/g) || []).length > 1) {
            throw new Error('the attached workout is still in the candidate list')
          }
        }],
      /* TWO workouts on one session, which is the case the list exists for. The
       * minutes are the SUM — that is what the weekly load chart multiplies. */
      ['Whoop(two on one session)', workouts({
        whoop: { id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), strain: 11.4, attachedAt: 'z' },
        whoopMore: [{ id: 'w-lift', sport: 'Weightlifting', ...t('19:45', 30), strain: 6.1, attachedAt: 'z' }],
      }),
        html => {
          const t2 = text(html)
          if ((html.match(/wh-item attached/g) || []).length !== 2) {
            throw new Error('both attached workouts should render')
          }
          if (!/2 workouts on this session/.test(t2)) throw new Error('the total is not stated')
          if (/load chart multiplies/.test(t2)) throw new Error('the jargon about the load chart is back')
          if (!/118 min/.test(t2)) throw new Error('the minutes should add up, not replace each other')
        }],
      /* ONE GYM VISIT, TWO SESSIONS.
       *
       * WHOOP records the evening as a single climb; the board and the laps are
       * two logged sessions inside it. The failure this pins is silent and
       * arithmetical: the same 88-minute workout sitting whole on both makes the
       * day read as 176 minutes, and the weekly load chart is RPE x minutes. */
      ...(() => {
        const snap = {
          id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), strain: 11.4,
          avgHr: 132, maxHr: 168, pctAvgHr: 68, pctMaxHr: 86, calories: 640,
          percentRecorded: 98, maxHeartRate: 195, zones: { three: 18, four: 7, five: 1 },
          attachedAt: 'z',
        }
        const other = (whoop) => ({
          id: 'e-laps', kind: 'daily', date: day, updatedAt: 'z',
          data: { optId: 'arc', name: 'ARC laps', minutes: 55, out: { whoop } },
        })
        const shared = (mine, theirs) => wrap({ cache },
          <WhoopWorkouts session={session} entry={entryOf({ whoop: mine })}
            entries={[entryOf({ whoop: mine }), other(theirs)]} onSave={noop} />)
        return [
          // Both sessions claiming the whole workout: the day is being counted twice
          // and the card has to SAY so rather than quietly adding it up.
          ['Whoop(same workout on two sessions, unsplit)', shared(snap, snap),
            html => {
              const t2 = text(html)
              if (!/ARC laps/.test(t2)) throw new Error('it must name the other session')
              if (!/counts these 88 minutes twice/.test(t2)) throw new Error('the double count is not called out')
              if (!/class="wh-err"/.test(html)) throw new Error('and it should read as a problem, not a note')
              // The row and its editor open themselves when there is something to fix.
              if (!/<details class="wh-item attached" open/.test(html)) throw new Error('the row should be open')
              if (!/<details class="wh-splitwrap" open/.test(html)) throw new Error('the fix should be open')
            }],
          // Split: this session shows ITS minutes, says which numbers are the whole
          // workout's, and names what the rest of the evening was.
          ['Whoop(split across two sessions)',
            shared({ ...snap, part: { start: t('18:05', 0).start, end: t('19:00', 0).start, minutes: 55 } },
              { ...snap, part: { start: t('19:05', 0).start, end: t('19:33', 0).start, minutes: 28 } }),
            html => {
              const t2 = text(html)
              if (!/55 min/.test(t2)) throw new Error("the session's own share is missing")
              if (/counts these/.test(t2)) throw new Error('a split day is not double counted')
              if (!/whole workout/.test(t2)) throw new Error('the borrowed numbers must be labelled')
              if (!/Shared with/.test(t2)) throw new Error('it should name the other session')
              if (!/type="time"/.test(html)) throw new Error('no way to change the times')
            }],
          // The ordinary night — one workout, one session — must be untouched by
          // all of the above: the split is folded away and nothing warns.
          ['Whoop(attached, split offered but folded away)', workouts({ whoop: snap }),
            html => {
              if (!/Was this session only part of that workout\?/.test(text(html))) {
                throw new Error('the offer should exist')
              }
              if (/<details class="wh-splitwrap" open/.test(html)) throw new Error('...but stay shut')
              if (/<details class="wh-item attached" open/.test(html)) throw new Error('...and so does the row')
              if (/wh-err/.test(html)) throw new Error('nothing is wrong on an ordinary night')
            }],
        ]
      })(),
      // An attached snapshot with NO cache at all: it is their log by then, so it
      // must still render with WHOOP unplugged.
      ['Whoop(attached, WHOOP gone)', workouts({ whoop: {
        id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), avgHr: 132, minutes: 88 } }, { cache: null }),
        html => {
          if (!/rock-climbing/.test(text(html))) throw new Error('an attached snapshot must survive the cache going away')
        }],
      // Nothing configured: not a word on screen.
      ['Whoop(no data at all)', workouts({}, { cache: null }),
        html => { if (html.length > 0) throw new Error(`expected nothing, got ${html.length} chars`) }],
      ['Whoop(nothing recorded that day)', workouts({}, { cache: { ...cache, workouts: [] } }),
        html => {
          if (!/Nothing recorded on this day/.test(text(html))) throw new Error('should say the day is empty')
        }],
      // A stale grant: the FIX is on screen, not "failed".
      ['Whoop(scope not granted)', workouts({}, { cache: null,
        status: { ok: false, detail: 'this WHOOP connection was authorized without read:workout — click Connect WHOOP again to grant it' } }),
        html => { if (html.length > 0) throw new Error('with no cache the session log stays silent') }],
      /* The failure the tunnel caused once: there is a Cloudflare Access gate in
       * front of this app, so a restart mid-pull answers with someone else's HTML
       * and the status code is THEIR opinion, not a reason. The server remembers
       * the real one, and it is the real one that has to be on screen. */
      ['Whoop(a remembered failure states its fix)',
        workouts({}, { cache: { ...cache, workouts: [] },
          status: { ok: false, detail: 'click Connect WHOOP again to grant it' } }),
        html => {
          const t2 = text(html)
          if (!/click Connect WHOOP again to grant it/.test(t2)) {
            throw new Error('the remembered reason is not shown')
          }
          if (/HTTP \d\d\d/.test(t2)) throw new Error('a status code is not a reason')
        }],

      /* STRAVA. Same contract as WHOOP — nothing on screen when there is nothing,
       * one likely at most, the tap is their — plus the thing that is new: on the
       * Other-training card the attach fills the card's own fields, and the
       * attached snapshot carries the whole ride (laps included). */
      ...(() => {
        const ride = { id: 1234, name: 'Example loop', sport: 'GravelRide', family: 'ride', date: day,
          ...t('14:47', 95), movingMin: 82, distanceMi: 18.3, elevationFt: 512, avgMph: 13.9, avgHr: 142, avgWatts: 156, sufferScore: 61, gearId: 'b1' }
        const walk = { id: 5678, name: 'Evening walk', sport: 'Walk', family: 'walk', date: day,
          ...t('21:00', 40), movingMin: 38, distanceMi: 3, paceLabel: '12:40 /mi' }
        const scache = { fetchedAt: `${day}T22:00:00.000Z`, activities: [ride, walk], gear: { b1: { id: 'b1', name: 'Test Gravel Bike', distanceMi: 1234.5 } } }
        const other = plan.dailyMenu.find(m => m.id === 'log-workout')
        if (!other) throw new Error('plan.json has no log-workout card')
        const sEntry = (out) => ({ id: `daily-${day}-x`, kind: 'daily', date: day, updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Log a workout', minutes: 45, out } })
        const swrap = (initial, el) => <StravaProvider initial={initial}>{el}</StravaProvider>
        const acts = (out, initial = { cache: scache }) =>
          swrap(initial, <StravaActivities session={other} entry={sEntry(out)} entries={[]} onSave={noop} />)
        return [
          ['Strava(no data at all)', acts({}, { cache: null }),
            html => { if (html.length > 0) throw new Error(`expected nothing, got ${html.length} chars`) }],
          ['Strava(two activities, nothing picked: no claim)', acts({}),
            html => {
              const t2 = text(html)
              if (!/Example loop/.test(t2) || !/Evening walk/.test(t2)) throw new Error('both should be listed')
              if (/class="wh-tag"/.test(html)) throw new Error('with nothing declared there is no likely')
              if (!/18\.3 mi/.test(t2) || !/13\.9 mph/.test(t2) || !/512 ft/.test(t2)) throw new Error('the ride\'s numbers are missing')
              if (!/12:40 \/mi/.test(t2)) throw new Error('a walk shows pace, not speed')
              if ((html.match(/>Attach</g) || []).length !== 2) throw new Error('one action per row')
            }],
          ['Strava(picked Bike: the ride is likely, the walk sinks)', acts({ activity: 'bike' }),
            html => {
              const tags = (html.match(/class="wh-tag"/g) || []).length
              if (tags !== 1) throw new Error(`expected one likely tag, got ${tags}`)
              const t2 = text(html)
              if (!/The sport you picked/.test(t2)) throw new Error('the reason for Likely is not on the row')
              if (t2.indexOf('Towpath') > t2.indexOf('Evening walk')) throw new Error('the ride should rank first')
            }],
          ['Strava(attached, with laps and the bike)', acts({ activity: 'bike', duration: 82, distance: 18.3, strava: {
            id: 1234, name: 'Example loop', sport: 'GravelRide', family: 'ride', ...t('14:47', 95), minutes: 82, elapsedMinutes: 95,
            distanceMi: 18.3, elevationFt: 512, avgMph: 13.9, avgHr: 142, avgWatts: 156, calories: 812, sufferScore: 61,
            gear: { id: 'b1', name: 'Test Gravel Bike', distanceMi: 1234.5 }, url: 'https://www.strava.com/activities/1234',
            laps: [{ index: 1, distanceMi: 10, movingMin: 40, avgMph: 15, avgHr: 140 }, { index: 2, distanceMi: 10.1, movingMin: 42, avgMph: 14.4, avgHr: 145 }],
            attachedAt: 'z', filled: { activity: 'bike', duration: 82, distance: 18.3 } } }),
            html => {
              const t2 = text(html)
              if (!/Detach/.test(t2)) throw new Error('no way to undo a wrong attachment')
              // Still offers the rest of the day — a brick is a ride and a run
              // and one session. See the WHOOP case above.
              if (!/>Attach</.test(html)) {
                throw new Error('a second activity must still be attachable')
              }
              if (!/Saved with this session, so it stays if Strava goes away/.test(t2)) throw new Error('the snapshot has to say it is durable')
              if (!/Test Gravel Bike/.test(t2)) throw new Error('the bike should be named')
              if (!/812 cal/.test(t2)) throw new Error('the detail\'s calories are missing')
              if (!/2 laps/.test(t2)) throw new Error('laps should be offered')
              if (!/filled in activity, duration, distance/.test(t2)) throw new Error('it must say what it filled')
              if (!/Open on Strava/.test(t2)) throw new Error('a link back to the source')
            }],
          // An attached snapshot with no cache: their log by then.
          ['Strava(attached, Strava gone)', acts({ strava: { id: 1234, name: 'Example loop', sport: 'GravelRide', ...t('14:47', 95), minutes: 82, distanceMi: 18.3 } }, { cache: null }),
            html => { if (!/Example loop/.test(text(html))) throw new Error('an attached snapshot must survive the cache going away') }],
          ['Strava(nothing that day)', acts({}, { cache: { ...scache, activities: [] } }),
            html => { if (!/Nothing on Strava for this day/.test(text(html))) throw new Error('should say the day is empty') }],
          ['Strava(a remembered failure states its fix)',
            acts({}, { cache: { ...scache, activities: [] }, status: { ok: false, detail: 'Strava is not connected yet — connect it from Settings → Connections' } }),
            html => {
              const t2 = text(html)
              if (!/connect it from Settings/.test(t2)) throw new Error('the remembered reason is not shown')
              if (/HTTP \d\d\d/.test(t2)) throw new Error('a status code is not a reason')
            }],
          // The Other-training sheet as a whole, with a ride attached: the field
          // the attach filled reads back, and time spent names Strava as its source
          // only where the card does not ask for its own duration (it does), so
          // the declared field wins and the sentence says so.
          ['SessionLog(other training, ride attached)',
            swrap({ cache: scache }, <SessionLog session={other} entries={[]} onSave={noop} bare entry={sEntry({
              activity: 'bike', duration: 82, distance: 18.3, speed: 13.9, elevation: 512,
              strava: { id: 1234, name: 'Example loop', sport: 'GravelRide', ...t('14:47', 95), minutes: 82, distanceMi: 18.3, attachedAt: 'z', filled: { duration: 82 } } })} />),
            html => {
              if (!/value="18\.3"/.test(html)) throw new Error('the filled distance should be in the field')
              if (!/Example loop/.test(text(html))) throw new Error('the attached ride should render inside the sheet')
            }],

          /*
           * The card that offers what neither service's log has an entry for.
           *
           * Pinned here for two things. The row says WHEN, not only how long —
           * a duration does not identify a workout, so a clock is the only thing
           * that tells two 22-minute rides apart. And "Just miles" never mentions
           * a quota, because there are none any more; the button's own
           * words are the only place the user ever
           * reads what it means, so the copy is worth a test.
           *
           * The expected clock is COMPUTED with the same locale call the row
           * makes, so the case pins the instant rather than the runner's
           * timezone — this suite runs wherever it is run.
           */
          ...(() => {
            const bothWrap = (el) => (
              <WhoopProvider initial={{ cache }}>
                <StravaProvider initial={{ cache: scache }}>{el}</StravaProvider>
              </WhoopProvider>
            )
            const at = (iso) => new Date(Date.parse(iso))
              .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            return [
              ['UnloggedWorkouts(when it happened, not only how long)',
                bothWrap(<UnloggedWorkouts plan={plan} entries={[]} iso={day} onLog={noop}
                  skipped={[]} onDismiss={noop} onRestore={noop} split={[]} onSplit={noop} />),
                html => {
                  const t2 = text(html)
                  // The strap's climb resolves to no catalog activity on purpose,
                  // so the strava ride, the strava walk and the whoop lift is all
                  // there is to offer.
                  if (!/3 workouts not logged yet/.test(t2)) {
                    throw new Error(`expected three offers, got: ${t2.slice(0, 120)}`)
                  }
                  // The start without its meridiem, because the row writes that
                  // once for a span that does not cross noon — asserting the
                  // clock, not the formatting.
                  for (const iso of [ride.start, walk.start, lift.start]) {
                    const hhmm = at(iso).replace(/\s?[AP]M$/, '')
                    if (!t2.includes(hhmm)) throw new Error(`no start time for ${iso} (${hhmm})`)
                  }
                  if (!t2.includes(at(ride.end))) throw new Error('a row should say when it ended too')
                  if (!/82 min/.test(t2)) throw new Error('the duration should still be there')
                  if (/quota/i.test(html)) {
                    throw new Error('"just miles" still talks about a quota, which the app no longer has')
                  }
                  /*
                   * One action per row (#44): "Log it" on every row, and the rest
                   * behind the row rather than four small buttons beside it. A
                   * warm-up takes the same disposition as a commute — it happened,
                   * it is not a workout of its own — so the only thing that
                   * distinguishes them is what they are called, which is why it
                   * is a button and not a rename.
                   */
                  if ((html.match(/>Log it</g) || []).length !== 3) throw new Error('every row has its one action')
                  for (const label of ['Just miles', 'Warm-up', 'Dismiss']) {
                    if (t2.includes(label)) throw new Error(`"${label}" should be behind the row, not on it`)
                  }
                  if (/aria-label="not this one"/.test(html)) throw new Error('the unlabelled dismiss X is back')
                }],
              ['UnloggedWorkouts(the rest is behind the row)',
                bothWrap(<UnloggedWorkouts plan={plan} entries={[]} iso={day} onLog={noop}
                  skipped={[]} onDismiss={noop} onRestore={noop} split={[]} onSplit={noop}
                  initialOpen={`strava:${ride.id}`} />),
                html => {
                  const t2 = text(html)
                  if (!/aria-expanded="true"/.test(html)) throw new Error(`the row did not open: check the item id`)
                  for (const label of ['Just miles', 'Warm-up', 'Dismiss']) {
                    if (!t2.includes(label)) throw new Error(`no "${label}" behind the row`)
                  }
                  // Only the opened row's: one at a time.
                  if ((t2.match(/Just miles/g) || []).length !== 1) throw new Error('more than one row is open')
                }],
            ]
          })(),
        ]
      })(),

      ['WhoopReadiness(a bad day)', wrap({ cache }, <WhoopReadiness date={day} />),
        html => {
          const t2 = text(html)
          // Read against the user's own median (HRV 42 vs median 53 = -21%), never a population.
          if (!/-21%/.test(t2)) throw new Error('no deviation from his own baseline')
          if (!/vs your 53 ms/.test(t2)) throw new Error('the baseline itself should be shown')
          if (!/\+5\.5 vs your 52\.5/.test(t2)) throw new Error('resting heart rate delta missing')
          // The recommender this card once nudged is gone (2026-10-25), and so is the
          // paragraph about it.
          if (/hard finger day|nudges the ranking/.test(t2)) throw new Error('the card talks about a ranking that no longer exists')
          if (!/Refresh/.test(t2)) throw new Error('no way to pull again')
        }],
      // Not enough history for a baseline: the raw numbers, no invented trend.
      ['WhoopReadiness(no baseline yet)',
        wrap({ cache: { ...cache, recovery: cache.recovery.slice(0, 2) } }, <WhoopReadiness date={day} />),
        html => {
          const t2 = text(html)
          if (!/42/.test(t2)) throw new Error('the raw HRV should still show')
          if (/vs your/.test(t2)) throw new Error('two days is not a baseline and must not read as one')
        }],
      ['WhoopReadiness(WHOOP still calibrating)',
        wrap({ cache: { ...cache, recovery: [{ date: day, recovery: 44, hrv: 40, calibrating: true }] } },
          <WhoopReadiness date={day} />),
        html => {
          if (html.length > 0) throw new Error('WHOOP saying it does not trust its own number is taken at its word')
        }],
      /*
       * Sleep over time, as Totem drew it (2026-10-07): a range to choose, the
       * score and recovery on one panel, each night on a clock beneath. The old
       * last-night breakdown is gone on purpose; the absence is pinned.
       */
      ['WhoopSleep(over time, not last night in depth)',
        wrap({ cache: {
          sleep: [
            { date: day, score: 88, asleepMin: 452, neededMin: 480, efficiency: 91, debtMin: 28,
              stages: { deep: 95, rem: 110, light: 247, awake: 31 }, bedtime: `${isoShift(day, -1)}T23:14`, wake: `${day}T07:16` },
            { date: isoShift(day, -1), score: 70, asleepMin: 400,
              stages: { deep: 80, rem: 90, light: 230 }, bedtime: `${isoShift(day, -2)}T22:40`, wake: `${isoShift(day, -1)}T06:10` },
          ],
          recovery: [{ date: day, recovery: 74 }, { date: isoShift(day, -1), recovery: 30 }],
        } }, <WhoopSleep date={day} />),
        html => {
          const t2 = text(html)
          for (const r of ['30d', '90d', '1y']) if (!t2.includes(r)) throw new Error(`no ${r} range`)
          if (!/88%.*latest/.test(t2)) throw new Error('the latest score is not the headline')
          if (!/7-day avg/.test(t2) || !/average/.test(t2)) throw new Error('no averages')
          if (!/goal 85%/.test(t2)) throw new Error('no goal line')
          if (!/8h02m/.test(t2)) throw new Error('a night is not labelled with its length')
          if (!/Recovery · red 0–33/.test(t2)) throw new Error('recovery is not on the graph')
          for (const st of ['Deep', 'REM', 'Light', 'Awake']) if (!t2.includes(st)) throw new Error(`no ${st} in the legend`)
          if (/of 8:00 needed|efficiency/.test(t2)) throw new Error('the in-depth last-night block came back')
          if (!/11 PM|10 PM/.test(t2)) throw new Error('the clock axis is not labelled')
          if ((html.match(/class="sleep-today"/g) || []).length !== 2) throw new Error('the viewed day is not marked on both panels')
          if (!/sleep-today-tick/.test(html)) throw new Error('the viewed day\'s date is not marked on the axis')
          if (!/sleep-readout[^>]*><strong class="sleep-today-tick">/.test(html) || !/88%/.test(text(html.split('sleep-readout')[1]))) throw new Error('the readout does not open on the viewed night')
        }],
      ['WhoopSleep(series keeps the gaps, stats compare weeks)', null, () => {
        const nights = []
        for (let i = 0; i < 14; i++) if (i !== 3) nights.push({ date: isoShift(day, -i), score: i < 7 ? 90 : 70, bedtime: `${isoShift(day, -i - 1)}T23:00`, wake: `${isoShift(day, -i)}T07:00` })
        const series = sleepSeries({ sleep: nights }, day, 30)
        if (series.length !== 30) throw new Error('one row per day of the range')
        if (series[series.length - 1].date !== day) throw new Error('the range does not end on the day viewed')
        if (series.find(r => r.date === isoShift(day, -3)).night) throw new Error('a missed night was filled in')
        const span = series[series.length - 1].span
        if (!span || span.to - span.from !== 480) throw new Error(`an 11 PM to 7 AM night is not eight hours: ${JSON.stringify(span)}`)
        const midnight = sleepSeries({ sleep: [{ date: day, bedtime: `${day}T00:30`, wake: `${day}T08:00` }] }, day, 1)[0].span
        if (!midnight || midnight.from <= span.from) throw new Error('a 12:30 AM bedtime is not later than an 11 PM one')
        const st = sleepStats(series)
        if (Math.round(st.recent) !== 90 || Math.round(st.prior) !== 70 || Math.round(st.delta) !== 20) throw new Error(`week on week: ${JSON.stringify(st)}`)
      }],
      ['WhoopSleep(nothing)', wrap({ cache: { sleep: [] } }, <WhoopSleep date={day} />),
        html => { if (html.length > 0) throw new Error('no nights must render nothing') }],
      ['WhoopReadiness(nothing)', wrap({ cache: null }, <WhoopReadiness date={day} />),
        html => { if (html.length > 0) throw new Error('no reading must render nothing') }],
      ['WhoopReadiness(broken, with the fix)',
        wrap({ cache: null, status: { ok: false, detail: 'click Connect WHOOP again to grant it' } },
          <WhoopReadiness date={day} />),
        html => {
          if (!/Connect WHOOP again/.test(text(html))) throw new Error('a failure has to carry its fix')
          if (!/Try again/.test(text(html))) throw new Error('and something to press')
        }],
    ]
  })(),
  // Blurbs collapsed: the stub path must render everywhere the full card does.
  ['TestingTab(blurbs hidden)',
    <PrefsProvider settings={{ blurbs: { allHidden: true, hidden: {}, shown: {} } }} saveSettings={noop}>
      <TestingTab plan={plan} entries={entries} upsertEntry={noop} />
    </PrefsProvider>],
  ['GearSection(blurbs hidden)',
    <PrefsProvider settings={{ blurbs: { allHidden: true, hidden: {}, shown: {} } }} saveSettings={noop}>
      <GearSection plan={plan} entries={[]} strava={null} upsertEntry={noop} deleteEntry={noop} />
    </PrefsProvider>],
  ['WhyTab(blurbs hidden)',
    <PrefsProvider settings={{ blurbs: { allHidden: true, hidden: {}, shown: {} } }} saveSettings={noop}>
      <WhyTab plan={plan} />
    </PrefsProvider>],
  /* The screen probe is a diagnostic, not a setting (#82, G-visual-ia F11): folded under Troubleshooting. */
  ['SettingsPage(the screen probe is behind Troubleshooting)', null, () => {
    const src = readFileSync(new URL('../src/profile.jsx', import.meta.url), 'utf8')
    if (!/<details className="prof-trouble">[\s\S]*Troubleshooting[\s\S]*<ScreenCard \/>[\s\S]*<\/details>/.test(src)) throw new Error('the screen probe is shown as an ordinary setting')
  }],
  ['ScreenCard(renders before it can measure)', <ScreenCard />,
    (html) => { if (!/Measuring/.test(text(html))) throw new Error('no placeholder before measurement') }],
  ['describeScreen(names the iOS 26 short viewport)', null, () => {
    // An installed iOS 26.0 web app: page 806 on an 874 screen, top inset 68.
    const bug = describeScreen({ standalone: true, inner: { w: 402, h: 806 }, screen: { w: 402, h: 874 },
      insets: { top: 68, bottom: 34 }, ua: '' })
    if (!/iOS 26 bug/.test(bug)) throw new Error(`not diagnosed: ${bug}`)
    if (!/68px shorter/.test(bug)) throw new Error('the gap is not sized')
    const fine = describeScreen({ standalone: true, inner: { w: 402, h: 874 }, screen: { w: 402, h: 874 },
      insets: { top: 68, bottom: 34 }, ua: '' })
    if (!/fills the screen/.test(fine)) throw new Error('a full page reads as a bug')
    const tab = describeScreen({ standalone: false, inner: { w: 402, h: 700 }, screen: { w: 402, h: 874 },
      insets: { top: 0, bottom: 0 }, ua: '' })
    if (!/Home Screen/.test(tab)) throw new Error('a browser tab is not told to install')
  }],
  ['PeopleCard(the owner can open anyone\'s log; nobody else sees it)', null, () => {
    const people = [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
    const owner = { id: 'owner', real: { id: 'owner', admin: true }, people }
    const html = renderToString(<PeopleCard who={owner} />)
    const t = text(html)
    if (!/Log for Sam/.test(t)) throw new Error('no door into Sam\'s log')
    if (!/Your log<\/span><\/span><span class="list-row-meta">Open</.test(html)) throw new Error('the open log is not marked')
    const acting = text(renderToString(<PeopleCard who={{ ...owner, id: 'sam' }} />))
    if (!/Back to your log/.test(acting)) throw new Error('no way back from Sam\'s log')
    if (renderToString(<PeopleCard who={{ id: 'sam', real: { id: 'sam', admin: false }, people: [] }} />) !== '') throw new Error('someone who is not the owner can switch logs')
    if (renderToString(<PeopleCard who={{ ...owner, people: [people[0]] }} />) !== '') throw new Error('a switcher with nobody to switch to')
  }],
  ['starter: TestingTab', <TestingTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['starter: WhyTab', <WhyTab plan={starter} />],
  ['starter: ProfileMenu', <ProfileMenu plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced" />],
  ['example: TestingTab', <TestingTab plan={example} entries={[]} upsertEntry={noop} deleteEntry={noop} />,
    (html) => { if (!text(html).includes('5 km time trial')) throw new Error('the example test does not render') }],
]
