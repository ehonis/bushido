/* Render smoke test: mounts every tab against the real plan.json and real-shaped
 * entries, so a bad property access fails here instead of on the phone in a basement.
 * Run: npm run smoke
 *
 * One file of cases per area (app/smoke/<area>.jsx), shared fixtures in
 * fixtures.jsx, and this runner. A change to an area adds and edits cases only in its
 * own file; a PR that has to change a case in another area's file says so. Until #73
 * this was one 4,400-line app/smoke.jsx with a section per owner; the cases moved
 * unchanged, and the run prints how many there are so a lost one shows.
 */
import { renderToString } from 'react-dom/server'
import { text } from './fixtures.jsx'
import today from './today.jsx'
import sheet from './sheet.jsx'
import editor from './editor.jsx'
import planner from './planner.jsx'
import runner from './runner.jsx'
import workout from './workout.jsx'
import timer from './timer.jsx'
import log from './log.jsx'
import progress from './progress.jsx'
import profile from './profile.jsx'
import people from './people.jsx'
import misc from './misc.jsx'
import system from './system.jsx'

const AREAS = { today, sheet, editor, planner, runner, workout, timer, log, progress, profile, people, misc, system }

/* An element may be a spread of several cases, so the count is taken after it. */
const cases = Object.values(AREAS).flat()

let failed = 0
for (const [name, el, assert] of cases) {
  try {
    // A case with no element is a pure check on the content — that plan.json
    // and the app still agree about something — and has nothing to render.
    const html = el == null ? '' : renderToString(el)
    // The generic guard catches a component that silently rendered nothing. A case
    // that brought its own assertion has stated its contract already, and several
    // must render EMPTY — "no WHOOP data changes nothing on screen" is only
    // testable if a zero-length render can be the expected answer.
    if (el != null && !assert && html.length < 20) {
      throw new Error(`suspiciously empty output (${html.length} chars)`)
    }
    // A stray `)}` left behind in JSX is not a syntax error — it is TEXT, and it
    // rendered on a phone under the Strava block. Every case checks.
    if (/\)\}|\}\)/.test(text(html))) throw new Error('stray JSX brackets rendered as text')
    // Some cases care about WHAT rendered, not just that something did — a
    // training load that silently renders the wrong number still renders.
    if (assert) await assert(html)
    console.log(`  PASS  ${name.padEnd(20)} ${el == null ? 'checked' : `${html.length} chars`}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name.padEnd(20)} ${err.message}`)
  }
}

console.log(`\n${cases.length} cases: ${Object.entries(AREAS).map(([k, v]) => `${k} ${v.length}`).join(', ')}`)
console.log(failed ? `\n${failed} tab(s) failed to render` : '\nall tabs render')
process.exit(failed ? 1 : 0)
