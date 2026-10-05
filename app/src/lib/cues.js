/*
 * Non-visual cues for workout mode: a beep, a buzz, and keeping the screen on.
 *
 * All three are best-effort by design. This app is used mid-session with chalky
 * hands on a phone that may be face-down on a crash pad, and every one of these
 * APIs is gated on something outside our control — an audio context needs a user
 * gesture, vibration is Android-only, and a wake lock needs a secure context, so
 * over the plain-http tailnet IP it silently does nothing. None of them may ever
 * throw into the timer, because a missing beep is a nuisance and a crashed
 * timer mid-hang is a ruined session.
 *
 * Every entry point is also safe to call during server rendering, where none of
 * these globals exist at all — the smoke suite renders workout mode in node.
 */

let ctx = null

/** Lazily built on the first real gesture; browsers refuse to start one before. */
function audio() {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  try { ctx = new AC() } catch { ctx = null }
  return ctx
}

/**
 * A short tone. Synthesised rather than loaded from a file so the app stays
 * installable and offline with no audio assets to cache.
 */
export function beep({ freq = 880, ms = 140, gain = 0.22 } = {}) {
  const ac = audio()
  if (!ac) return
  try {
    if (ac.state === 'suspended') ac.resume()
    const osc = ac.createOscillator()
    const amp = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // Ramped rather than switched, or every beep arrives with a click on iOS.
    const now = ac.currentTime
    amp.gain.setValueAtTime(0, now)
    amp.gain.linearRampToValueAtTime(gain, now + 0.01)
    amp.gain.linearRampToValueAtTime(0, now + ms / 1000)
    osc.connect(amp).connect(ac.destination)
    osc.start(now)
    osc.stop(now + ms / 1000 + 0.02)
  } catch { /* a silent timer still counts down */ }
}

export function buzz(pattern = 60) {
  try { navigator?.vibrate?.(pattern) } catch { /* iOS Safari has no vibrate */ }
}

/** Distinct enough to tell apart without looking at the phone. */
export const CUES = {
  // The workout mode fires one of these per second over the last three seconds
  // of any countdown, so a change of phase is heard coming rather than noticed
  // afterwards. Deliberately the quietest cue in the set.
  tick: () => { beep({ freq: 1180, ms: 55, gain: 0.16 }); buzz(20) },
  countIn: () => { beep({ freq: 660, ms: 90, gain: 0.22 }); buzz(30) },
  work: () => { beep({ freq: 990, ms: 220 }); buzz([0, 90]) },
  rest: () => { beep({ freq: 520, ms: 180 }); buzz(50) },
  setDone: () => { beep({ freq: 740, ms: 130 }); setTimeout(() => beep({ freq: 990, ms: 200 }), 150); buzz([0, 60, 80, 120]) },
  finished: () => {
    beep({ freq: 660, ms: 160 })
    setTimeout(() => beep({ freq: 880, ms: 160 }), 170)
    setTimeout(() => beep({ freq: 1320, ms: 320 }), 340)
    buzz([0, 100, 60, 100, 60, 240])
  },
}

/**
 * The audio context has to be created inside a real click, or every later beep
 * is silently dropped. Workout mode calls this from the Start button.
 */
export function primeAudio() {
  const ac = audio()
  if (!ac) return
  try {
    /*
     * An iPhone with the ring/silent switch flipped to silent mutes Web Audio
     * outright, which looks exactly like a broken timer: the clock runs, the
     * phases change, and nothing beeps. Declaring the session as playback opts
     * out of that the same way a music app does. Safari 17+ only, and a no-op
     * everywhere else — hence the optional chaining rather than a feature test.
     */
    if (navigator?.audioSession) navigator.audioSession.type = 'playback'
  } catch { /* older Safari, or a browser that has no opinion */ }
  try {
    if (ac.state === 'suspended') ac.resume()
    // A zero-gain blip is the standard way to mark the context as user-started.
    const osc = ac.createOscillator()
    const amp = ac.createGain()
    amp.gain.value = 0
    osc.connect(amp).connect(ac.destination)
    osc.start()
    osc.stop(ac.currentTime + 0.01)
  } catch { /* no audio, no problem */ }
}

/**
 * Take the audio back after the phone has been in a pocket.
 *
 * Backgrounding a tab suspends its audio context, and coming back does not
 * always resume it — the cues then go quiet for the rest of the session with
 * the timer still visibly running. Workout mode calls this on every return to
 * visibility, alongside retaking the wake lock.
 */
export function resumeAudio() {
  try { if (ctx?.state === 'suspended') ctx.resume() } catch { /* nothing to resume */ }
}

/**
 * Keep the screen awake while the timer runs. Needs a secure context: over
 * http://<tailnet-ip> this resolves to a no-op release and the phone will sleep
 * mid-set. Serve over the ts.net HTTPS name to get it (see README).
 */
export async function acquireWakeLock() {
  try {
    const lock = await navigator?.wakeLock?.request?.('screen')
    return lock || null
  } catch {
    return null
  }
}

export function releaseWakeLock(lock) {
  try { lock?.release?.() } catch { /* already gone */ }
}
