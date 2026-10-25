// First run, or signed out: where the server is and how to get in. Built from the
// kit (Card, Field, Input, Btn) on the tokens, like the server's own sign-in page
// (server/pages.js), which copies the same values. Two steps, because the
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
import { colors, font, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Field, Input, Sub } from '../ui/kit'
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
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <View style={st.mark}>
          <Image source={require('../../assets/images/bushido-mark.png')} style={{ width: 22, height: 22 }} tintColor={colors.accent} />
          <T size={font.title} weight={600}>Bushido</T>
        </View>

        {!step2 ? (
          <>
            <T size={font.heading} weight={600} style={st.title}>Connect to Bushido</T>
            <Sub style={st.lead}>The machine running Bushido. A Tailscale IP or name works.</Sub>
            <Card>
              <Field label="Server address">
                <Input
                  value={address}
                  onChangeText={setAddress}
                  placeholder="100.x.y.z or bushido.example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  onSubmitEditing={findServer}
                />
              </Field>
              <T size={font.caption} faint style={st.help}>
                {`An IP or Tailscale name uses port ${DEFAULT_PORT}; a domain uses https.`}
              </T>
              {stage ? <Sub style={st.msg}>{stage}</Sub> : null}
              {error ? <T color={colors.bad} size={font.small} style={st.msg}>{error}</T> : null}
              <Btn title="Continue" loading={busy} disabled={!address.trim()} onPress={findServer} style={st.go} />
            </Card>
          </>
        ) : (
          <>
            <T size={font.heading} weight={600} style={st.title}>Sign in</T>
            <T size={font.small} dim style={st.lead} numberOfLines={1}>{server!.baseUrl.replace(/^https?:\/\//, '')}</T>
            <Card>
              {useToken ? (
                <Field label="API token">
                  <Input
                    value={token}
                    onChangeText={setToken}
                    placeholder="BUSHIDO_API_TOKEN"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={() => canSignIn && signIn()}
                  />
                </Field>
              ) : (
                <View style={{ gap: space[3] }}>
                  <Field label="Username">
                    <Input
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="username"
                      autoComplete="username"
                      returnKeyType="next"
                      onSubmitEditing={() => passRef.current?.focus()}
                    />
                  </Field>
                  <Field label="Password">
                    <Input
                      ref={passRef}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      textContentType="password"
                      autoComplete="current-password"
                      returnKeyType="go"
                      onSubmitEditing={() => canSignIn && signIn()}
                    />
                  </Field>
                </View>
              )}
              {error ? <T color={colors.bad} size={font.small} style={st.msg}>{error}</T> : null}
              <Btn title="Sign in" loading={busy} disabled={!canSignIn} onPress={signIn} style={st.go} />
            </Card>
            <View style={st.links}>
              <Btn kind="quiet" title="Another server" onPress={() => { setServer(null); setError('') }} />
              <Btn kind="quiet" title={useToken ? 'Use a password' : 'Use an API token'}
                onPress={() => { setUseToken(!useToken); setError('') }} />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: space[5], maxWidth: 440, width: '100%', alignSelf: 'center' },
  mark: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[6] },
  title: { marginBottom: space[1] },
  lead: { marginBottom: space[4] },
  help: { marginTop: 6 },
  msg: { marginTop: space[3] },
  go: { marginTop: space[4] },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
})
