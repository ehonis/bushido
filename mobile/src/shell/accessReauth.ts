// Cloudflare Access sessions end (24 hours by default). When Access starts
// answering instead of Bushido, offer to sign in again rather than letting every
// card fail; the login page usually remembers the user, so it is a tap.
import { useEffect, useRef } from 'react'
import { getConnection, saveAccessToken, useConnection } from '../lib/connection'
import { accessTokenExpiry, probeAccess, signInWithAccess } from '../lib/cfAccess'
import { pushToast, pushError, dismissToast } from '../lib/toast'

let signingIn = false

export async function reauthAccess(after?: () => void) {
  if (signingIn) return
  signingIn = true
  try {
    const { baseUrl } = getConnection()
    const guard = await probeAccess(baseUrl)
    if (!guard.protected) return
    const token = await signInWithAccess(baseUrl, guard.aud)
    if (!token) return
    await saveAccessToken(token)
    after?.()
  } catch (e: any) {
    pushError(`Cloudflare sign-in failed: ${e?.message || e}`)
  } finally {
    signingIn = false
  }
}

/** Mounted once in the signed-in app. `after` re-reads whatever failed (the store's pull). */
export function useAccessReauth(after?: () => void) {
  const { accessNeeded, accessToken } = useConnection()
  const toastId = useRef<number | null>(null)

  useEffect(() => {
    if (!accessNeeded) {
      if (toastId.current) { dismissToast(toastId.current); toastId.current = null }
      return
    }
    if (toastId.current) return
    toastId.current = pushToast('Cloudflare Access needs you to sign in again.', 'info', {
      duration: 0,
      action: { label: 'Sign in', icon: null, onClick: () => { toastId.current = null; void reauthAccess(after) } },
    })
  }, [accessNeeded])

  // A token that has already lapsed: ask now rather than after the first failure.
  useEffect(() => {
    if (accessToken && accessTokenExpiry(accessToken) && accessTokenExpiry(accessToken) < Date.now()) void reauthAccess(after)
  }, [accessToken])
}
