/*
 * The profile: the user, their gear, their numbers, and the reference material
 * (app/src/profile.jsx).
 *
 * It replaced the sync pill in the header with the user's name and Strava
 * picture. The sync state did not die with it; it moved onto the avatar as a dot
 * and into the panel, because "who am I and what do I own" is the more useful
 * thing for a corner of the screen to say.
 *
 * It also absorbed three tabs. Gear, Testing and Why were reference rather than
 * doing: none of them is touched mid-session, all three were taking space in a
 * bottom bar used with one chalky thumb.
 *
 * Reference is a popover; doing is a page (AGENTS.md §6.7). On a phone the web's
 * popover is a bottom sheet with the sections across the top (.pop-rail under
 * 640px); natively that is a page sheet with the same row of sections.
 *
 * Settings is native here: the server, how this phone signs in, sign-out and
 * changing server. The server's own Settings page (the owner's admin UI) is not
 * rebuilt; it opens in the browser. The web's "screen" card (screeninfo.jsx)
 * measures a Safari safe-area bug that does not exist in a native app, so it is
 * left out.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Animated, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Input, Press, Row } from '../ui/kit'
import { Popover } from '../ui/Sheet'
import { confirm } from '../ui/menu'
import { success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { pushError } from '../lib/toast'
import { useStrava } from '../lib/strava.jsx'
import { athleteOf, profileFacts, buildProfileEntry, factValue, PROFILE_GROUPS } from '../lib/profile.js'
import { usePrefs } from '../lib/prefs.jsx'
import { localIso } from '../lib/dates.js'
import { currentMe, actAs, cacheKeyFor, USER_HEADER } from '../lib/whoami.js'
import { signOutDevice } from '../lib/signout.js'
import { authHeaders, forgetCredential, getConnection, rawFetch, serverUrl, useConnection } from '../lib/connection'
import { reloadApp } from '../shell/reload'
import { GearSection } from './gear'
import { TestingTab, WhyTab } from './tabs'
import { NotificationsSection } from './notifications'

/* ---------------------------------------------------------- the menu */

const SECTIONS = [
  { key: 'you', label: 'You', icon: 'PersonStanding' },
  { key: 'gear', label: 'Gear', icon: 'ShoppingBag' },
  { key: 'testing', label: 'Testing', icon: 'Gauge' },
  { key: 'why', label: 'Why', icon: 'FlaskConical' },
  { key: 'alerts', label: 'Alerts', icon: 'Bell' },
  { key: 'settings', label: 'Settings', icon: 'Shield' },
]

/** The sync colours: green is fine, anything else is worth opening. */
const DOT: Record<string, string> = {
  synced: colors.good, syncing: colors.warn, loading: colors.warn, offline: colors.bad,
}

/**
 * The avatar in the header, and the panel it opens.
 *
 * The sync DOT lives on the avatar, because "is my log actually saved" is a real
 * question with a real failure mode and burying it entirely would be worse than
 * the pill it replaced. A dot rather than a sentence.
 */
export function ProfileMenu({ plan, entries, upsertEntry, deleteEntry, status, lastSync, me: who = currentMe() }: any) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('you')
  const { cache: strava, pull, pulling } = useStrava() as any
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // Strava's name and picture when connected; otherwise the name this person has on the install.
  const me = athleteOf(strava, who.name)
  const close = () => setOpen(false)
  const sub = who.acting ? `${who.real.name || 'You'}, logging for them`
    : me.connected ? 'via Strava' : who.features.strava ? 'Strava not connected' : ''

  return (
    <>
      <Press haptic onPress={() => setOpen(true)} style={st.mebtn} accessibilityRole="button"
        accessibilityLabel="You, your gear and your numbers" accessibilityState={{ expanded: open }}>
        <View style={st.av}>
          {me.avatar
            ? <Image source={{ uri: me.avatar }} style={st.avImg} contentFit="cover" />
            : (
              <View style={st.ini}>
                {me.initials
                  ? <T size={11} weight={600} dim lineHeight={13}>{me.initials}</T>
                  : <Icon name="PersonStanding" size={16} color={colors.inkDim} />}
              </View>
            )}
          <View style={[st.avDot, { backgroundColor: DOT[status] || colors.good }]} />
        </View>
        {/* The name drops on the narrowest phones (.mebtn-name, max-width 420px). */}
        {width > 420 ? <T size={13} numberOfLines={1} style={{ maxWidth: 80 }}>{me.firstName || me.name}</T> : null}
        <Icon name="ChevronDown" size={14} color={colors.inkFaint} />
      </Press>

      {open && (
        <Popover label={me.name} onClose={close}>
          <View style={st.head}>
            {me.avatar
              ? <Image source={{ uri: me.avatar }} style={st.headAv} contentFit="cover" />
              : <View style={[st.ini, st.headAv]}><T size={13} weight={600} dim>{me.initials || '?'}</T></View>}
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <T size={15} weight={600} numberOfLines={1}>{me.name}</T>
              {sub ? <T size={11} dim>{sub}</T> : null}
            </View>
            <Press haptic onPress={close} style={st.x} accessibilityLabel="Close">
              <Icon name="X" size={17} color={colors.inkFaint} />
            </Press>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.rail} contentContainerStyle={st.railIn}>
            {SECTIONS.map(sec => {
              const on = tab === sec.key
              return (
                <Press key={sec.key} onPress={() => { tap(); setTab(sec.key) }} style={[st.railBtn, on && st.railBtnOn]}
                  accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  <Icon name={sec.icon} size={15} color={on ? colors.accent : colors.inkDim} />
                  <T size={13} color={on ? colors.accent : colors.inkDim}>{sec.label}</T>
                </Press>
              )
            })}
          </ScrollView>

          <KeyboardAwareScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            bottomOffset={24}
          >
            {tab === 'you' && <YouSection plan={plan} entries={entries} strava={strava} upsertEntry={upsertEntry} />}
            {tab === 'gear' && (
              <GearSection plan={plan} entries={entries} strava={strava}
                upsertEntry={upsertEntry} deleteEntry={deleteEntry} />
            )}
            {tab === 'testing' && <TestingTab plan={plan} entries={entries} upsertEntry={upsertEntry} />}
            {tab === 'why' && <WhyTab plan={plan} />}
            {tab === 'alerts' && <NotificationsSection />}
            {tab === 'settings' && (
              <SettingsSection status={status} lastSync={lastSync} who={who}
                strava={strava} onPullStrava={pull} pulling={pulling} onLeave={close} />
            )}
          </KeyboardAwareScrollView>
        </Popover>
      )}
    </>
  )
}

/* ------------------------------------------------------------ the pieces */

/** `.pop-body .card`: inside the sheet a card is a section with a rule above it, not a box in a box. */
function PopCard({ first, children }: { first?: boolean; children: React.ReactNode }) {
  return <View style={[st.card, !first && st.cardRule]}>{children}</View>
}

function H2({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <View style={st.h2}>
      {icon ? <Icon name={icon} size={16} color={colors.ink} /> : null}
      <T size={14} weight={600}>{children}</T>
    </View>
  )
}

/** .restbtn: a dashed, quiet, full-width button. */
function RestBtn({ icon, label, onPress, disabled }: { icon: string; label: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <Press haptic onPress={onPress} disabled={disabled} style={st.restbtn} accessibilityRole="button">
      <Icon name={icon} size={16} color={colors.inkFaint} />
      <T size={14} faint>{label}</T>
    </Press>
  )
}

/* ------------------------------------------------------------------- you */

export function YouSection({ entries, strava, upsertEntry }: any) {
  const facts = profileFacts(entries)
  const save = (key: string, value: any) => {
    const next: any = { ...facts }
    if (value === '' || value === null || value === undefined) delete next[key]
    else next[key] = value
    upsertEntry(buildProfileEntry(next))
  }

  /*
   * Bodyweight writes to the SERIES, not to the profile.
   *
   * It is the one fact here with a history worth keeping, so typing a new number
   * logs a new point rather than overwriting a standing value. Same id shape the
   * quick-log used, so today's weight entered here and there is one entry.
   */
  const saveWeight = (lb: string) => {
    const n = Number(lb)
    if (!(n > 0)) return
    const date = localIso()
    upsertEntry({ id: `bodyweight-${date}`, kind: 'bodyweight', date, data: { lb: n } })
  }

  return (
    <>
      {PROFILE_GROUPS.map((group: any, gi: number) => (
        <PopCard key={group.key} first={gi === 0}>
          <H2 icon={group.icon}>{group.name}</H2>
          {group.blurb ? <T size={13} dim style={{ marginBottom: 8 }}>{group.blurb}</T> : null}
          <View style={{ gap: 12 }}>
            {group.fields.map((f: any) => {
              const { value, source, date } = (factValue as any)(f, { facts, strava, entries })
              const num = f.type === 'number'
              return (
                <View key={f.key} style={{ gap: 5 }}>
                  <View style={st.factLabel}>
                    <T size={12} dim>{f.label}</T>
                    {f.unit ? <T size={12} faint>{`(${f.unit})`}</T> : null}
                    {/* A value the user did not give must never look like one they did. */}
                    {source === 'strava' && <T size={10} caps color={colors.accent}>from Strava</T>}
                    {source === 'logged' && <T size={10} caps color={colors.accent}>{`logged ${date}`}</T>}
                  </View>
                  <Input
                    defaultValue={source === 'own' ? String(value) : ''}
                    keyboardType={num ? 'decimal-pad' : 'default'}
                    returnKeyType="done"
                    /*
                     * A number the app is only SHOWING on their behalf goes in the
                     * placeholder, never the value: it reads the same, and it does
                     * not silently become theirs the next time anything saves.
                     * Failing that, a short example; the explanation lives under
                     * the box.
                     */
                    placeholder={source !== 'own' && value !== null ? String(value) : (f.eg || '')}
                    onEndEditing={(e) => {
                      const v = e.nativeEvent.text
                      if (f.writes === 'bodyweight') saveWeight(v)
                      else save(f.key, num ? (v === '' ? '' : Number(v)) : v)
                    }}
                  />
                  {f.hint ? <T size={11} faint>{f.hint}</T> : null}
                </View>
              )
            })}
          </View>
        </PopCard>
      ))}
    </>
  )
}

/* -------------------------------------------------------------- settings */

/**
 * The owner's way into someone else's log, to mark their sets for them. A
 * reload into that person's log rather than a swap in place (lib/whoami.js), and
 * the banner under the header says whose it is until they switch back.
 */
export function PeopleCard({ who, first }: any) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!who.real.admin || who.people.length < 2) return null
  const go = (id: string | null) => {
    setBusy(id ?? 'me'); setError(null)
    ;(actAs as any)(id, { reload: reloadApp }).catch((e: any) => { setBusy(null); setError(e.message) })
  }
  return (
    <PopCard first={first}>
      <H2>People</H2>
      <T size={13} dim style={{ marginBottom: 10 }}>
        Open someone’s log to log sessions and mark sets for them. Everything you do there
        is theirs, until you switch back.
      </T>
      {who.people.map((p: any) => {
        const isOpen = p.id === who.id
        const isMe = p.id === who.real.id
        return (
          <RestBtn key={p.id} icon={isMe ? 'PersonStanding' : 'Users'} disabled={isOpen || Boolean(busy)}
            onPress={() => go(isMe ? null : p.id)}
            label={isOpen ? `${isMe ? 'Your log' : `${p.name}’s log`} (open)`
              : busy === (isMe ? 'me' : p.id) ? 'Switching…'
                : isMe ? 'Back to your log' : `Log for ${p.name}`} />
        )
      })}
      {error ? <T size={13} color={colors.bad}>{error}</T> : null}
    </PopCard>
  )
}

/** The sync dot, pulsing while it is saving or connecting (.dot.syncing / .dot.loading). */
function SyncDot({ status }: { status: string }) {
  const v = useRef(new Animated.Value(1)).current
  const pulsing = status === 'syncing' || status === 'loading'
  useEffect(() => {
    if (!pulsing) { v.setValue(1); return }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.3, duration: 550, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 550, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [pulsing, v])
  const bg = status === 'loading' ? colors.inkFaint : DOT[status] || colors.inkFaint
  return <Animated.View style={[st.dot, { backgroundColor: bg, opacity: v }]} />
}

const KIND_LABEL: Record<string, string> = {
  session: 'Password',
  token: 'API token',
  proxy: 'None (the proxy in front decides)',
}

/**
 * Take the log off this phone (lib/signout.js, the flow main.jsx runs on
 * /?signout=1). Only a password session is revoked on the server: a token or
 * proxy phone signing out must not sign the owner's browsers out, so its logout
 * call is answered here and never sent.
 */
async function leaveDevice({ revoke }: { revoke: boolean }) {
  // The raw fetch, as main.jsx uses: a 401 mid-flow means "already signed out",
  // not "go to Connect". It still needs the server's address and the credential,
  // which the raw fetch does not add.
  const authed = (path: string, init: any = {}) => {
    const headers = new Headers(init.headers)
    for (const [k, v] of Object.entries(authHeaders())) if (!headers.has(k)) headers.set(k, v)
    // Whose log the flush is for, as every other call says: without it an
    // act-as cookie would send this log into someone else's.
    if (String(path) === '/api/state') headers.set(USER_HEADER, currentMe().id)
    return rawFetch(serverUrl(path), { ...init, headers })
  }
  const fetchFn = (path: string, init?: any) => {
    if (!revoke && String(path) === '/api/auth/logout') return Promise.resolve(new Response('{}', { status: 200 }))
    return authed(path, init)
  }
  return (signOutDevice as any)({
    fetchFn,
    storage: localStorage,
    session: null,
    cachesApi: null,
    idb: null,
    confirmFn: (msg: string) => confirm('Not saved to the server', { message: msg, confirmLabel: 'Sign out' }),
    flagTarget: globalThis,
    channel: null,
    retirePush: null,
    cacheKey: cacheKeyFor(currentMe().id),
  })
}

export function SettingsSection({ status, lastSync, strava, onPullStrava, pulling, who = currentMe(), onLeave }: any) {
  const { allHidden, setAllHidden } = usePrefs() as any
  const conn = useConnection()
  const [leaving, setLeaving] = useState(false)
  const label = ({
    loading: 'connecting', syncing: 'saving',
    synced: lastSync ? `synced ${lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'synced',
    offline: 'offline — will retry',
  } as Record<string, string>)[status]

  const leave = async (changingServer: boolean) => {
    const ok = changingServer
      ? await confirm('Change server?', {
        message: 'Bushido saves your log to this server, takes it off this phone and goes back to the sign-in screen, where you can enter another address.',
        confirmLabel: 'Change server',
      })
      : await confirm('Sign out of this device?', {
        message: 'Bushido saves your log to the server, then takes it off this phone.',
        confirmLabel: 'Sign out',
      })
    if (!ok) return
    setLeaving(true)
    try {
      const out = await leaveDevice({ revoke: !changingServer && getConnection().kind === 'session' })
      if (out.signedOut) {
        success()
        onLeave?.()
        // Back to Connect: the root layout swaps the app out when the credential goes.
        await forgetCredential()
        return
      }
      if (out.error) pushError(out.error)
    } catch (e: any) {
      pushError(e?.message || String(e))
    }
    setLeaving(false)
  }

  const openSettings = () => {
    WebBrowser.openBrowserAsync(`${conn.baseUrl}/settings`).catch((e) => pushError(e?.message || String(e)))
  }

  const people = who.real.admin && who.people.length >= 2

  return (
    <>
      <PeopleCard who={who} first />

      <PopCard first={!people}>
        <H2>Server</H2>
        <T size={13} dim style={{ marginBottom: 6 }}>
          Sign-in, AI, the training plan and integrations are set on the server’s own
          Settings page.
        </T>
        <Row icon="Server" label="Address" value={conn.baseUrl.replace(/^https?:\/\//, '')} />
        <Row icon="Lock" label="Sign-in"
          value={conn.kind === 'session' && conn.user ? conn.user : KIND_LABEL[conn.kind] || '—'} />
        {who.real.admin && (
          <>
            <Row icon="Shield" label="Open Settings" onPress={openSettings}
              right={<Icon name="ExternalLink" size={16} color={colors.inkFaint} />} />
            <T size={12} faint style={{ marginBottom: 4 }}>
              It opens in the browser: that page is the server’s own and is not rebuilt in this app.
            </T>
          </>
        )}
        <Row icon="LogOut" label={leaving ? 'Signing out…' : 'Sign out of this device'} danger
          onPress={leaving ? undefined : () => leave(false)} />
        <Row icon="RefreshCw" label="Change server" onPress={leaving ? undefined : () => leave(true)} />
      </PopCard>

      <PopCard>
        <H2>Sync</H2>
        <T size={13} dim style={{ marginBottom: 10 }}>
          This is what the header used to say. Your log lives on your box and syncs
          across devices; an offline edit queues and pushes when the tailnet comes back.
        </T>
        <View style={st.setrow}>
          <SyncDot status={status} />
          <T size={14} weight={600}>{label || String(status || '')}</T>
        </View>
      </PopCard>

      {/* The owner's Strava, through the owner's bridge: not someone else's to refresh. */}
      {who.owner && (
        <PopCard>
          <H2>Strava</H2>
          <T size={13} dim style={{ marginBottom: 10 }}>
            {strava?.athlete
              ? `Connected as ${strava.athlete.name}. Your name, picture, bikes and shoes come from here.`
              : strava?.configured === false
                ? 'Not connected. Strava is read through a Totem bridge; set one up in Settings → Integrations.'
                : 'Not connected. Connect it in Totem — the credentials live there, never in this app.'}
          </T>
          <RestBtn icon="RotateCw" label={pulling ? 'Refreshing…' : 'Refresh now'} disabled={pulling}
            onPress={() => onPullStrava?.()} />
        </PopCard>
      )}

      <PopCard>
        <H2>Explanations</H2>
        <T size={13} dim style={{ marginBottom: 10 }}>
          The app explains itself a lot. Once you know why a thing is there, you can
          collapse every explainer to a one-line stub and tap any of them back.
        </T>
        <RestBtn icon={allHidden ? 'Eye' : 'EyeOff'}
          label={allHidden ? 'Show the explanations' : 'Hide the explanations'}
          onPress={() => setAllHidden(!allHidden)} />
      </PopCard>
    </>
  )
}

const st = StyleSheet.create({
  mebtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36,
    paddingVertical: 2, paddingLeft: 2, paddingRight: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill,
  },
  av: { width: 28, height: 28 },
  avImg: { width: 28, height: 28, borderRadius: 14 },
  ini: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  avDot: {
    position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: 5,
    borderWidth: 2, borderColor: colors.panel2,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 14, paddingRight: 8,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headAv: { width: 36, height: 36, borderRadius: 18 },
  x: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  rail: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.line },
  railIn: { flexDirection: 'row', gap: 4, padding: 8 },
  railBtn: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: TAP, paddingHorizontal: 10, borderRadius: 8 },
  railBtnOn: { backgroundColor: colors.panel2 },
  card: { paddingBottom: 18 },
  cardRule: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  h2: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
  factLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 },
  restbtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    marginBottom: 14, padding: 14, minHeight: TAP,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md,
  },
  setrow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
})
