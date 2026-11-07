import { withAck } from './store.js'

/**
 * Writes to someone else's copy of a shared workout, one request at a time
 * (`usePersonCopy` in sharedwith.jsx, and the phone's).
 *
 * Every tap used to send its own request at once, so a stepper tapped five times
 * had five writes on the way together, each carrying the base the copy was
 * opened with. The server read the last ones as changes from that old base and
 * applied the earlier taps a second time: a set added on screen became two a few
 * seconds later. Now one write is out at a time. Edits made meanwhile wait, and
 * the next write sends the copy as it stands THEN (`current`), which by then has
 * taken the first write's receipt as its base (lib/store.js `withAck`).
 *
 * `send(personId, entry)` resolves `{ entry, ack }` (lib/peopleapi.js
 * `sendPersonEntry`). `current(personId, entry)` is the copy to send for a
 * write queued as `entry`: the newest edit of it, or `entry` itself. A write
 * waiting for the same copy takes each landed write's receipt here, so it is
 * right even when nothing on screen is that copy any more.
 * `landed(personId, sent, reply)` and `failed(personId, sent, err)` say how
 * each write went. `push` resolves true once a write carrying the edit landed,
 * false if it did not.
 */
export function createCopyQueue({ send, current, landed, failed }) {
  const jobs = []
  let busy = false
  let out = null // the job whose write is on the way

  const run = async () => {
    if (busy) return
    busy = true
    try {
      while (jobs.length) {
        const job = jobs.shift()
        const entry = current(job.personId, job.entry) || job.entry
        out = { personId: job.personId, entry }
        let ok = false
        try {
          const reply = await send(job.personId, entry)
          // A write still waiting for this copy goes on from this one's receipt,
          // whatever the screen now shows (the sheet may have switched sides).
          for (const w of jobs) if (w.personId === job.personId) w.entry = withAck(w.entry, entry, reply?.ack)
          landed(job.personId, entry, reply)
          ok = true
        } catch (err) {
          failed(job.personId, entry, err)
        }
        out = null
        for (const done of job.done) done(ok)
      }
    } finally {
      busy = false
      out = null
    }
  }

  return {
    /** Queue `entry` (the newest edit of a copy); a write still waiting for the same copy takes it instead. */
    push(personId, entry) {
      return new Promise((resolve) => {
        const waiting = jobs.find(j => j.personId === personId && j.entry?.id === entry?.id)
        if (waiting) { waiting.entry = entry; waiting.done.push(resolve) } else jobs.push({ personId, entry, done: [resolve] })
        run()
      })
    },
    /** A write is out or waiting: a re-read must not land over it. */
    get busy() { return busy || jobs.length > 0 },
    /**
     * The newest edit of a copy not yet answered for (waiting, else on the way), or
     * null. A sheet that reopens the copy meanwhile shows this, never an older read.
     */
    newest(personId, entryId) {
      const waiting = jobs.find(j => j.personId === personId && j.entry?.id === entryId)
      if (waiting) return waiting.entry
      return out && out.personId === personId && out.entry?.id === entryId ? out.entry : null
    },
  }
}

/**
 * The copy a sheet opens on (`usePersonCopy`'s first read): an edit still
 * unanswered for (`pending`, the queue's `newest`), else whichever is newer of the
 * read and an answer that landed while it was on the way (`landed`): a write can
 * finish after the read left and before it came back, and the older read must not
 * replace what was just saved.
 */
export function openedCopy(read, pending, landed) {
  if (pending) return pending
  if (landed && (!read || String(landed.updatedAt || '') > String(read.updatedAt || ''))) return landed
  return read
}
