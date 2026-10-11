// The web's "came back to the foreground" (document visibilitychange to
// visible, and window 'online'), as one native subscription: AppState turning
// active. The ported store and the WHOOP/Strava/coach providers re-read the
// server on it, exactly where the web does.
import { AppState } from 'react-native'

export function onForeground(fn: () => void): () => void {
  let last = AppState.currentState
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active' && last !== 'active') fn()
    last = next
  })
  return () => sub.remove()
}
