// First run, or signed out: where the server is and how to get in. Styled after
// the server's own sign-in page (server/pages.js). Two steps, because the
// server says which kind of sign-in it uses (GET /api/health -> `auth`):
//
//   1. The address. A server behind Cloudflare Access gets Access's login first
//      (cfAccess.ts), then the health check.
//   2. `password`: the owner's username and password, exchanged for a session
//      (POST /api/auth/session), or BUSHIDO_API_TOKEN instead.
//      `proxy`: nothing to ask; whatever is in front already decided.
//
// The credential goes to the keychain (connection.ts). Every rule about it lives
// there; this screen only collects it.
import React, { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInput } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Btn, Input, Press } from '../ui/kit'
import { DEFAULT_PORT, getConnection, normalizeBaseUrl, saveConnection, type AuthKind } from '../lib/connection'
import { probeAccess, signInWithAccess } from '../lib/cfAccess'
import { success } from '../ui/haptics'

type Mode = 'password' | 'proxy'

/** fetch with an 8 second ceiling and a message a person can act on. */
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } catch (e: any) {
    throw new Error(e?.name === 'AbortError'
      ? 'No answer after 8 seconds. On Tailscale? Use the address your phone can reach.'
      : `Could not reach ${url.replace(/\/api\/.*$/, '')}: ${e?.message || e}`)
  } finally {
    clearTimeout(timer)
  }
}

const accessHeader = (t?: string): Record<string, string> => (t ? { 'cf-access-token': t } : {})

export default function Connect() {
  const insets = useSafeAreaInsets()
  const saved = getConnection()
  const [address, setAddress] = useState(() => saved.baseUrl.replace(/^http:\/\//, '').replace(`:${DEFAULT_PORT}`, ''))
  const [server, setServer] = useState<{ baseUrl: string; mode: Mode; accessToken?: string } | null>(null)
  const [useToken, setUseToken] = useState(saved.kind === 'token')
  const [username, setUsername] = useState(saved.user || '')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stage, setStage] = useState('')
  const passRef = useRef<TextInput>(null)

  const finish = async (kind: AuthKind, credential: string, user?: string) => {
    success()
    await saveConnection({ baseUrl: server!.baseUrl, kind, credential, user, accessToken: server!.accessToken })
  }

  /** Step 1: find the server, get past Access if it is there, and learn its sign-in. */
  const findServer = async () => {
    const baseUrl = normalizeBaseUrl(address)
    if (!baseUrl) return
    setBusy(true)
    setError('')
    let accessToken: string | undefined
    try {
      const guard = await probeAccess(baseUrl).catch((e: any) => {
        // Unreachable is reported by the health check below, with a clearer message.
        if (e?.name === 'AbortError' || /Network request failed|fetch|abort/i.test(e?.message || '')) return { protected: false as const }
        throw e
      })
      if (guard.protected) {
        setStage('Sign in to Cloudflare Access to reach this server…')
        accessToken = (await signInWithAccess(baseUrl, guard.aud)) || undefined
        setStage('')
        if (!accessToken) throw new Error('Cloudflare sign-in was closed before it finished.')
      }
      const health = await call(`${baseUrl}/api/health`, { headers: accessHeader(accessToken) })
      const doc = await health.json().catch(() => null)
      if (!health.ok || !doc?.ok) throw new Error(`The server answered ${health.status}. Is this Bushido?`)
      // Signed out, the server answers `auth: 'password'`; in proxy mode every
      // request is signed in, so the full health doc answers `auth: { mode }`.
      const mode: Mode = (typeof doc.auth === 'string' ? doc.auth : doc.auth?.mode) === 'proxy' ? 'proxy' : 'password'
      setServer({ baseUrl, mode, accessToken })
      if (mode === 'proxy') {
        // Nothing to ask, but prove the API answers before saving it.
        const me = await call(`${baseUrl}/api/auth/me`, { headers: accessHeader(accessToken) })
        if (!me.ok) throw new Error(`The server answered ${me.status} to a signed-in request.`)
        success()
        await saveConnection({ baseUrl, kind: 'proxy', credential: '', accessToken })
      }
    } catch (e: any) {
      setStage('')
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Step 2, password mode: a session for the username and password, or the API token checked. */
  const signIn = async () => {
    if (!server) return
    setBusy(true)
    setError('')
    try {
      if (useToken) {
        const r = await call(`${server.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token.trim()}`, ...accessHeader(server.accessToken) } })
        if (r.status === 401) throw new Error('That token was refused. It is BUSHIDO_API_TOKEN from the server’s environment.')
        if (!r.ok) throw new Error(`The server answered ${r.status}.`)
        await finish('token', token.trim())
        return
      }
      const r = await call(`${server.baseUrl}/api/auth/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...accessHeader(server.accessToken) },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const doc = await r.json().catch(() => ({}))
      if (r.status === 404) throw new Error('This server is older than the iPhone app. Update Bushido on the server, or sign in with an API token.')
      if (!r.ok || !doc.session) throw new Error(doc.error ? cap(doc.error) : `The server answered ${r.status}.`)
      await finish('session', doc.session, doc.user || username.trim())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const step2 = server?.mode === 'password'
  const canSignIn = useToken ? token.trim().length >= 16 : Boolean(username.trim() && password)

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[st.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={st.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Image source={require('../../assets/images/bushido-mark.png')} style={{ width: 22, height: 22 }} tintColor={colors.accent} />
            <T size={17} weight={600} style={{ letterSpacing: 0.3 }}>Bushido</T>
          </View>

          {!step2 ? (
            <>
              <T size={22} weight={700} style={{ marginBottom: 6 }}>Connect to Bushido</T>
              <T dim size={14} style={{ marginBottom: 16 }}>
                The address of the machine running Bushido. A Tailscale IP or name works.
              </T>
              <Input
                value={address}
                onChangeText={setAddress}
                placeholder="100.x.y.z or bushido.example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={findServer}
                style={{ marginBottom: 12, backgroundColor: colors.bg }}
              />
              {stage ? <T dim size={14} style={{ marginBottom: 12 }}>{stage}</T> : null}
              {error ? <T color={colors.bad} size={14} style={{ marginBottom: 12 }}>{error}</T> : null}
              <Btn title="Continue" loading={busy} disabled={!address.trim()} onPress={findServer} />
              <T faint size={12.5} style={{ marginTop: 14 }}>
                {`An IP or Tailscale name uses port ${DEFAULT_PORT}; a domain uses https (Cloudflare Access sign-in is handled).`}
              </T>
            </>
          ) : (
            <>
              <T size={22} weight={700} style={{ marginBottom: 6 }}>Sign in</T>
              <T dim size={14} style={{ marginBottom: 16 }} numberOfLines={1}>{server!.baseUrl.replace(/^https?:\/\//, '')}</T>
              {useToken ? (
                <Input
                  value={token}
                  onChangeText={setToken}
                  placeholder="BUSHIDO_API_TOKEN"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => canSignIn && signIn()}
                  style={{ marginBottom: 12, backgroundColor: colors.bg }}
                />
              ) : (
                <>
                  <Input
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Username"
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="username"
                    autoComplete="username"
                    returnKeyType="next"
                    onSubmitEditing={() => passRef.current?.focus()}
                    style={{ marginBottom: 12, backgroundColor: colors.bg }}
                  />
                  <Input
                    ref={passRef}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    secureTextEntry
                    textContentType="password"
                    autoComplete="current-password"
                    returnKeyType="go"
                    onSubmitEditing={() => canSignIn && signIn()}
                    style={{ marginBottom: 12, backgroundColor: colors.bg }}
                  />
                </>
              )}
              {error ? <T color={colors.bad} size={14} style={{ marginBottom: 12 }}>{error}</T> : null}
              <Btn title="Sign in" loading={busy} disabled={!canSignIn} onPress={signIn} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
                <Press onPress={() => { setServer(null); setError('') }} style={st.link}>
                  <T faint size={13}>Another server</T>
                </Press>
                <Press onPress={() => { setUseToken(!useToken); setError('') }} style={st.link}>
                  <T faint size={13}>{useToken ? 'Use a password' : 'Use an API token'}</T>
                </Press>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 24 },
  link: { minHeight: 36, justifyContent: 'center' },
})
