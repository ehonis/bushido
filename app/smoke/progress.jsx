/* Smoke cases: Progress.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { ProgressView } from '../src/progress.jsx'
import { LogTab } from '../src/log.jsx'
import {
  plan, starter, entries, TODAY, back, rich, cfEntries, text, isoShift, LEGACY, noop,
} from './fixtures.jsx'

/** The chart groups' titles, in page order. */
const metricsGroups = (t) => [...t.matchAll(/<div class="card progcard"><h2>([^<]*)<\/h2>/g)].map(m => m[1])

export default [
  ['ProgressView(critical force)', <ProgressView plan={plan} entries={[...rich, ...cfEntries]} />],
  ['ProgressView(legacy entries are not workouts)', <ProgressView plan={plan} entries={LEGACY} />,
    (html) => {
      const t = text(html)
      if (!/Nothing logged yet/.test(t)) throw new Error('a legacy entry was counted as a workout')
      if (/Achievement/.test(t)) throw new Error('the achievement filter is back')
    }],
  ['ProgressView(rich)', <ProgressView plan={plan} entries={rich} />,
    html => {
      const t = text(html)
      /*
       * The three per-session grade charts — lead laps, fun bouldering, fun sport
       * — became TWO charts on 2026-09-15: hardest route and hardest boulder,
       * across whatever is in scope. What survives is the property those
       * assertions protected: a grade chart reads its axis off the LADDER, not
       * off the stored decimal. A hero that says "10.2" is a chart asking them
       * to decode their own log.
       */
      // "…sent" since #81: the hardest climb that went clean (F12).
      const hero = (title) => t.match(new RegExp(`${title}</h3>(?:<p class="viz-help">[^<]*</p>)?<div class="viz-hero">([^<]*)`))?.[1]
      if (!/Hardest route sent/.test(t)) throw new Error('the route-grade chart is missing')
      if (!/^5\.\d/.test(hero('Hardest route sent') || '')) throw new Error(`the route headline read "${hero('Hardest route sent')}", not a rung`)
      if (!/Hardest boulder sent/.test(t)) throw new Error('the boulder-grade chart is missing')
      if (!/^V\d/.test(hero('Hardest boulder sent') || '')) throw new Error(`the boulder headline read "${hero('Hardest boulder sent')}", not a V grade`)
    }],
  /*
   * Wave 2 (issue #43): Progress LEADS with the answer. Workouts and time for the
   * period, two numbers in one card, with the period as a segmented control
   * under them; the filter card, the "Since" row and the tiles went.
   */
  ['ProgressView(leads with workouts and time, the period under them)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      const head = t.indexOf('class="card proghead"')
      if (head < 0) throw new Error('no headline card')
      if (t.indexOf('<svg') >= 0 && t.indexOf('<svg') < head) throw new Error('a chart comes before the headline')
      const card = t.slice(head, t.indexOf('class="filters', head) > 0 ? t.indexOf('class="filters', head) : undefined)
      for (const w of ['Workouts', 'Time']) if (!card.includes(`>${w}<`)) throw new Error(`the headline has no ${w}`)
      if ((card.match(/class="proghead-value"/g) || []).length !== 2) throw new Error('the headline is two numbers')
      const seg = card.match(/class="seg proghead-seg"[^]*?<\/div>/)?.[0] || ''
      const segs = [...seg.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(m => m[1])
      if (segs.join('|') !== '4 wk|8 wk|6 mo|All') throw new Error(`the period should be 4 wk · 8 wk · 6 mo · All, got ${segs}`)
      if (!/aria-pressed="true"[^>]*>8 wk</.test(seg)) throw new Error('8 weeks is the default')
      // Gone from the old address: the filter card, its labels and the tiles.
      if (/scopebar|scoperow|class="tiles"|class="tile /.test(html)) throw new Error('the old filter card or tiles are back')
      if (/>Since<|>Category<|>Load<|RPE × minutes|Hours</.test(t)) throw new Error('an old label is back')
    }],
  // "Just one thing" moved from a labelled select in the filter card to a row.
  ['ProgressView("Just one thing" is a row that opens a list)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      const row = t.match(/<label class="list-row progpick-row">[^]*?<\/label>/)?.[0] || ''
      if (!/Just one thing/.test(row)) throw new Error('"Just one thing" is not a row')
      if (!/Any workout/.test(row)) throw new Error('the row should say what is picked')
      if (!/<select[^>]*aria-label="Just one thing"/.test(row)) throw new Error('the row opens no list')
      if (/scopesel/.test(html)) throw new Error('the old select is back')
    }],
  /*
   * #81: the first chip row is the KIND of thing (Climbing, Lift, Run, Bike…),
   * the plan's categories are a second row under the activity picked. Pinned
   * from both sides: the first row holds activities and no category, and the
   * categories appear beneath Climbing once it is picked.
   */
  ['ProgressView(the first chips are activities, not categories)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      const row = t.match(/<div class="filters progacts"[^>]*>([^]*?)<\/div>/)?.[1] || ''
      const chips = [...row.matchAll(/<button type="button" class="chip[^"]*"[^>]*>([^<]*)<\/button>/g)].map(m => m[1])
      if (chips[0] !== 'All' || chips.length < 3) throw new Error(`expected All and the activities: ${chips}`)
      if (chips.some(c => /\d/.test(c))) throw new Error(`a count in a chip: ${chips}`)
      const acts = ['Climbing', 'Lift', 'Run', 'Bike', 'Swim', 'Other']
      for (const c of chips.slice(1)) if (!acts.includes(c)) throw new Error(`"${c}" is not an activity`)
      if (!chips.includes('Climbing')) throw new Error('climbing is logged but not offered')
      // Gone from the first level: a training intent beside a sport.
      for (const cat of ['Fingers', 'Fun', 'Endurance', 'Power endurance']) {
        if (chips.includes(cat)) throw new Error(`"${cat}" is back beside Bike at the first level`)
      }
      if (/class="filters progcats"/.test(t)) throw new Error('categories shown before an activity is picked')
    }],
  ['ProgressView(under Climbing: its categories, and a grade)', <ProgressView plan={plan} entries={rich}
    initialScope={{ activity: 'climbing', category: null, session: null, exercise: null, band: null, weeks: null }} />,
    (html) => {
      const t = text(html)
      const cats = t.match(/<div class="filters progcats"[^>]*>([^]*?)<\/div>/)?.[1] || ''
      const names = [...cats.matchAll(/>([^<]+)<\/button>/g)].map(m => m[1])
      if (!names.includes('Fingers') || !names.includes('Fun')) throw new Error(`climbing's categories: ${names}`)
      if (names.includes('Bike') || names.includes('Run')) throw new Error(`a sport among climbing's categories: ${names}`)
      if (!/<select[^>]*aria-label="Grade"/.test(t)) throw new Error('no grade picker under Climbing')
      if (!/<option value="v:5">V5<\/option>/.test(t) || !/<option value="yds:10">5\.10<\/option>/.test(t)) throw new Error('the grade list lacks a logged grade')
      if (!/class="proghead-scope-what">Climbing</.test(t)) throw new Error('the headline does not say Climbing')
    }],
  /* The second level is a second level (#98, G r1 F5): labelled, nested behind a
     rule, outlined chips; never "Endurance" in the sport row's own style. Both platforms. */
  ['ProgressView(under Climbing the kinds are a labelled second level, not more sports)', <ProgressView plan={plan} entries={rich}
    initialScope={{ activity: 'climbing', category: null, session: null, exercise: null, band: null, weeks: null }} />,
    (html) => {
      const sub = html.match(/<div class="subfilter">([^]*?)<\/div><\/div>/)?.[1] || ''
      if (!/<span class="subfilter-label"[^>]*>Kind of climbing<\/span>/.test(sub)) throw new Error('the second row does not say what it narrows')
      if (!/<div class="filters progcats" role="group" aria-label="Kind of climbing">/.test(sub)) throw new Error('the kinds are not inside the labelled second level')
      if (!/class="chip sub/.test(sub) || /class="chip (?!sub)/.test(sub)) throw new Error('a kind is drawn as a sport chip')
      const acts = html.match(/<div class="filters progacts"[^>]*>([^]*?)<\/div>/)?.[1] || ''
      if (/chip sub/.test(acts)) throw new Error('the sport row is drawn as a second level')
      for (const f of ['../mobile/src/features/progress.tsx', '../mobile/src/features/log.tsx']) {
        const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
        if (!/<SubFilter label=\{subFilterLabel\(/.test(src) || !/<SubChip key=/.test(src)) throw new Error(`${f}: the kinds are not a SubFilter of SubChips`)
      }
    }],
  /* Log and Progress are titled, as Today is (#98, G r1 F6). */
  ['ProgressView, LogTab(titled at screen size, on both platforms)', null, () => {
    const prog = renderToString(<ProgressView plan={plan} entries={rich} />)
    if (!/^<h2 class="screen-title">Progress<\/h2>/.test(prog)) throw new Error('Progress has no title, or it is not first')
    const log = renderToString(<LogTab plan={plan} entries={rich} upsertEntry={noop} deleteEntry={noop} />)
    if (!/<h2 class="screen-title">Log<\/h2>/.test(log)) throw new Error('the Log has no title')
    for (const [f, w] of [['../mobile/src/features/progress.tsx', 'Progress'], ['../mobile/src/features/log.tsx', 'Log']]) {
      if (!new RegExp(`<ScreenTitle>${w}</ScreenTitle>`).test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))) throw new Error(`${f}: no title`)
    }
    if (!/\.screen-title \{[^}]*font-size: var\(--fs-screen\)/.test(readFileSync(new URL('../src/css/feed.css', import.meta.url), 'utf8'))) throw new Error('the title is not screen size')
  }],
  ['ProgressView(no grade picker outside Climbing)', <ProgressView plan={plan} entries={rich} />,
    (html) => { if (/aria-label="Grade"/.test(text(html))) throw new Error('a grade picker over the whole log') }],
  // D12: climbing by grade, sends against everything tried, on the same rows.
  ['ProgressView(the grade pyramids, sent of tried)', <ProgressView plan={plan} entries={rich}
    initialScope={{ activity: 'climbing', category: null, session: null, exercise: null, band: null, weeks: null }} />,
    (html) => {
      const t = text(html)
      for (const title of ['Boulders by grade', 'Routes by grade']) {
        const at = t.indexOf(`>${title}</h3>`)
        if (at < 0) throw new Error(`no "${title}" pyramid`)
        const chart = t.slice(at, t.indexOf('</svg>', at))
        if (!/sent of \d+ tried/.test(chart)) throw new Error(`${title} does not say sent of tried`)
        if (!/class="viz-pyr-label">(V\d+|5\.\d+)</.test(chart)) throw new Error(`${title} rows are not grades`)
        if (!/class="viz-pyr-count">\d+ \/ \d+</.test(chart)) throw new Error(`${title} rows do not say their numbers`)
      }
      // Rows hardest first: 5.10's row is the only one, V5 above V3.
      const b = t.slice(t.indexOf('>Boulders by grade</h3>'))
      if (b.indexOf('>V5<') > b.indexOf('>V3<')) throw new Error('the pyramid is not hardest first')
      const names = metricsGroups(t)
      // Climbing is PICKED here, so its charts lead the page (#97, F3), pyramids first.
      if (names[0] !== 'Climbing') throw new Error(`climbing is picked and not first: ${names}`)
      if (t.indexOf('>Boulders by grade</h3>') > t.indexOf('>Climbs per week</h3>')) throw new Error('volume leads the pyramids')
    }],
  // The other side of that move: on the whole page Climbing still comes last (§10.8).
  ['ProgressView(climbing follows the general charts on the whole page)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const names = metricsGroups(text(html))
      if (!names.includes('Climbing')) throw new Error(`no Climbing group: ${names}`)
      if (names.filter(n => n !== 'This session').at(-1) !== 'Climbing') throw new Error(`climbing is not last: ${names}`)
    }],
  // The filter chips are one sideways row, not a wrapped stack (#97, F3).
  ['ProgressView(the activity chips are one row)', null, () => {
    const css = readFileSync(new URL('../src/css/feed.css', import.meta.url), 'utf8')
    if (!/\.progacts, \.progcats, \.logfilters \{\s*flex-wrap: nowrap; overflow-x: auto/.test(css)) throw new Error('the filter chips wrap into a stack again')
  }],
  // F17: the body graph keeps to the period. Its two readings are in August; the
  // 8-week page (from the newest date's week back) holds none of them.
  ['ProgressView(bodyweight keeps to the period)', <ProgressView plan={plan} entries={[
    { id: 'r8', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 30 } } },
    { id: 'bwA', kind: 'bodyweight', date: isoShift(TODAY, -200), updatedAt: 'z', data: { lb: 186 } },
    { id: 'bwB', kind: 'bodyweight', date: isoShift(TODAY, -190), updatedAt: 'z', data: { lb: 185 } },
  ]} />,
    (html) => { if (/>Bodyweight</.test(text(html))) throw new Error('the body graph ignored the 8-week period') }],
  ['ProgressView(one category, no chips)', <ProgressView plan={plan} entries={[
    { id: 'p1', kind: 'daily', date: isoShift(TODAY, -2), updatedAt: 'z', data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 30, distance: 3, rpe: 5 } } },
    { id: 'p2', kind: 'daily', date: isoShift(TODAY, -9), updatedAt: 'z', data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 45, distance: 5, rpe: 6 } } },
  ]} />,
    (html) => {
      const t = text(html)
      if (/class="filters/.test(t)) throw new Error('a chip row with one category in it')
      if (!/>2<\/span><span class="proghead-label">Workouts/.test(t)) throw new Error('two runs should read as 2 workouts')
      if (!/>1\.3<span class="proghead-unit">h</.test(t)) throw new Error('75 minutes should read 1.3 h')
    }],
  // Charts titled in plain words; each still declares when it applies, keeps its
  // table view, and the critical-force chart keeps its noise band.
  ['ProgressView(charts in plain words, a table each, the noise band kept)', <ProgressView plan={plan} entries={[...rich, ...cfEntries]} />,
    (html) => {
      const t = text(html)
      for (const w of ['Workouts per week', 'Time per week', 'Effort per week']) {
        if (!t.includes(`>${w}</h3>`)) throw new Error(`no "${w}" chart`)
      }
      for (const w of ['Training load', 'Session RPE', 'Hours per week', 'sRPE', 'Volume —']) {
        if (t.includes(w)) throw new Error(`jargon back on Progress: ${w}`)
      }
      const charts = (t.match(/class="viz"/g) || []).length
      const toggles = (t.match(/class="viz-toggle"[^>]*>Table</g) || []).length
      if (!charts || toggles !== charts) throw new Error(`${charts} charts but ${toggles} table switches`)
      if (/\d{4}-\d{2}-\d{2}<\/text>/.test(t)) throw new Error('a bar is labelled with a raw date')
    }],
  ['ProgressView(no paragraph explaining the page)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      if (/Why these charts|blurb|progress-how/.test(t)) throw new Error('the explanatory blurb is back on Progress')
      if (/text-transform/.test(t)) throw new Error('small capitals on Progress')
    }],
  // The max hang series has to survive the split: two entries under the old id,
  // one under the new, and one continuous line.
  ['ProgressView(across the split)', <ProgressView plan={plan} entries={[
    ...rich,
    { id: 'sp1', kind: 'daily', date: '2026-08-17', updatedAt: 'z',
      data: { optId: 'max-hangs', level: 4, name: 'Max hangs', minutes: 15, done: true,
        out: { rpe: 7, fingers: 2, sets: { maxhang: [{ reps: 1, seconds: 7, weight: 47 }] }, signs: { maxhang: '+' } } } },
    { id: 'sp2', kind: 'daily', date: '2026-08-17', updatedAt: 'z',
      data: { slot: 'extra', optId: 'repeaters', level: 4, name: 'Repeaters', minutes: 20, done: true,
        out: { rpe: 7, fingers: 3, sets: { repeaters: [{ reps: 12, weight: 18 }] }, signs: { repeaters: '-' } } } },
  ]} />],
  ['ProgressView(empty)', <ProgressView plan={plan} entries={[]} />,
    (html) => {
      if (!/class="empty"/.test(html) || !/Nothing logged yet/.test(text(html))) throw new Error('an empty log should say so')
      if (/proghead/.test(html)) throw new Error('zeros and a period switch over nothing')
    }],
  ['ProgressView(one point)', <ProgressView plan={plan} entries={rich.slice(0, 3)} />],
  // A window with nothing in it offers the one way out, as a button.
  ['ProgressView(nothing in the period offers all time)', <ProgressView plan={plan} entries={[
    { id: 'old', kind: 'daily', date: '2024-01-08', updatedAt: 'z', data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 30 } } },
  ]} />,
    (html) => {
      const t = text(html)
      if (!/Nothing logged in these weeks/.test(t)) throw new Error('an empty period should say so')
      if (!/class="btn secondary"[^>]*>Show all time</.test(t)) throw new Error('no way out of an empty period')
    }],
  // Review of #46: the y-axis gutter is sized from its widest label, so "3000"
  // keeps its first digit, and a count axis never ticks at 0.5.
  ['ProgressView(axis numbers fit, counts tick in whole numbers)', <ProgressView plan={plan} entries={[...rich,
    ...[0, 1, 2, 3].map(i => ({ id: `big${i}`, kind: 'daily', date: isoShift(TODAY, -i), updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 300, rpe: 9 } } }))]} />,
    (html) => {
      const t = text(html)
      const chart = (title) => t.slice(t.indexOf(`>${title}</h3>`), t.indexOf('</svg>', t.indexOf(`>${title}</h3>`)))
      const effort = chart('Effort per week')
      const ticks = [...effort.matchAll(/text-anchor="end" class="viz-tick">([^<]+)</g)].map(m => m[1])
      const widest = Math.max(...ticks.map(x => x.length))
      const padL = Number(effort.match(/<line x1="([\d.]+)"/)?.[1])
      if (widest < 4) throw new Error(`expected a four-digit effort axis, got ${ticks}`)
      if (!(padL >= widest * 6.6 + 12)) throw new Error(`a ${widest}-digit label in a ${padL}px gutter is clipped`)
      for (const title of ['Workouts per week', 'Hard finger days per week']) {
        const c = chart(title)
        if (!c) throw new Error(`no ${title} chart`)
        const bad = [...c.matchAll(/text-anchor="end" class="viz-tick">([^<]+)</g)].map(m => m[1]).filter(x => !/^\d+$/.test(x))
        if (bad.length) throw new Error(`${title} ticks at ${bad}: a count has no fractions`)
      }
    }],
  // Narrowed from the row, the page says so: no chip claims "All", and the
  // headline names the pick beside a Clear. Unnarrowed, no such line.
  ['ProgressView(narrowed: the pick is named in the headline, with Clear, and All is not lit)', <ProgressView plan={plan} entries={rich}
    initialScope={{ category: null, session: 'subthreshold', exercise: null, weeks: null }} />,
    (html) => {
      const t = text(html)
      const scope = t.match(/<div class="proghead-scope">([^]*?)<\/div>/)?.[1] || ''
      const what = scope.match(/proghead-scope-what">([^<]*)</)?.[1]
      const picked = t.match(/progpick-value on">([^<]*)</)?.[1]
      if (!what || what === 'subthreshold' || what !== picked) throw new Error(`the headline does not name the pick: "${what}" vs the row's "${picked}"`)
      if (!/Clear<\/button>/.test(scope)) throw new Error('no way back from a narrowed page')
      if (/class="chip on"[^>]*>All</.test(t)) throw new Error('All is lit while one workout is picked')
    }],
  ['ProgressView(not narrowed: All lit, no scope line)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      if (/proghead-scope/.test(t)) throw new Error('a "narrowed to" line over the whole log')
      if (!/class="chip on"[^>]*>All</.test(t)) throw new Error('All should be lit when nothing is picked')
    }],
  ['starter: ProgressView', <ProgressView plan={starter} entries={[]} />],
]
