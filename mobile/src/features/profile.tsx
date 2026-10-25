/*
 * The profile: the user, their gear, their connections, and the reference
 * material (app/src/profile.jsx).
 *
 * It replaced the sync pill in the header with the user's name and Strava
 * picture. The sync state did not die with it; it moved onto the avatar as a dot
 * and into Settings, because "who am I and what do I own" is the more useful
 * thing for a corner of the screen to say.
 *
 * Reference is a popover; doing is a page (AGENTS.md §6.7): natively, a page
 * sheet. Since wave 2 (#44) it opens on a list of sections (You, Gear,
 * Notifications, Connections, Climbing, Settings), each row opening its page with
 * a back button in the header, as the web does; Testing and Why live under
 * Climbing (docs/DESIGN.md D6). It was six tabs in a sideways strip.
 *
 * Settings is native here: the server, how this phone signs in, sign-out and
 * changing server. The server's own Settings page (the owner's admin UI) is not
 * rebuilt; it opens in the browser. The web's "screen" card (screeninfo.jsx)
 * measures a Safari safe-area bug that does not exist in a native app, so it is
 * left out. Connecting Strava or WHOOP is the web's: it leaves for the service's
 * consent page and comes back to the web app, so here Connections shows the state.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, IconBtn, Input, Press, Row, SectionHeader, Sub, Toggle } from '../ui/kit'
import { Popover } from '../ui/Sheet'
import { confirm } from '../ui/menu'
import { success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { pushError } from '../lib/toast'
import { useStrava } from '../lib/strava.jsx'
import { athleteOf, profileFacts, buildProfileEntry, factValue, PROFILE_GROUPS } from '../lib/profile.js'
import { usePrefs } from '../lib/prefs.jsx'
import { localIso } from '../lib/dates.js'
import { currentMe, actAs, cacheKeyFor, USER_HEADER } from '../lib/whoami.js'
import { MyAbout } from './trainer'
import { signOutDevice } from '../lib/signout.js'
import { authHeaders, forgetCredential, getConnection, rawFetch, serverUrl, useConnection } from '../lib/connection'
import { reloadApp } from '../shell/reload'
import { gearUsage } from '../lib/gear.js'
import { GearSection } from './gear'
import { TestingTab, WhyTab, hasTests, hasEvidence } from './testing'
import { NotificationsSection } from './notifications'

/* ---------------------------------------------------------- the pages */

/* Every page the panel can show, and the page its back button returns to (profile.jsx PAGES). */
export const PAGES: Record<string, { label: string; icon: string; parent?: string }> = {
  you: { label: 'You', icon: 'PersonStanding' },
  gear: { label: 'Gear', icon: 'ShoppingBag' },
  notifications: { label: 'Notifications', icon: 'Bell' },
  connections: { label: 'Connections', icon: 'Waypoints' },
  climbing: { label: 'Climbing', icon: 'Mountain' },
  settings: { label: 'Settings', icon: 'Shield' },
  testing: { label: 'Testing', icon: 'Gauge', parent: 'climbing' },
  why: { label: 'Why', icon: 'FlaskConical', parent: 'climbing' },
}

/* Whether this person has anything to connect: Strava is everyone's own, WHOOP the owner's. */
export function canConnect(who: any) {
  if (who.acting) return false
  const strava = who.features.stravaConnect || who.features.strava
  const whoop = who.owner && (who.features.whoopConnect || who.features.whoop)
  return Boolean(strava || whoop)
}

/** The home rows, in order. Connections only where there is something to connect. */
export function homePages(who: any) {
  return ['you', 'gear', 'notifications', ...(canConnect(who) ? ['connections'] : []), 'climbing', 'settings']
}

/** The sync colours: green is fine, anything else is worth opening. */
const DOT: Record<string, string> = {
  synced: colors.good, syncing: colors.warn, loading: colors.warn, offline: colors.bad,
}

const syncLabel = (status: string, lastSync?: Date | null) => ({
  loading: 'Connecting',
  syncing: 'Saving',
  synced: lastSync ? `Synced ${lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Synced',
  offline: 'Offline, will retry',
} as Record<string, string>)[status] || ''

/**
 * The avatar in the header, and the panel it opens.
 *
 * The sync DOT lives on the avatar, because "is my log actually saved" is a real
 * question with a real failure mode and burying it entirely would be worse than
 * the pill it replaced. A dot rather than a sentence.
 */
export function ProfileMenu({ plan, entries, upsertEntry, deleteEntry, status, lastSync, me: who = currentMe() }: any) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<string | null>(null)
  const { cache: strava, pull, pulling } = useStrava() as any
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // Strava's name and picture when connected; otherwise the name this person has on the install.
  const me = athleteOf(strava, who.name)
  const close = () => { setOpen(false); setPage(null) }
  const sub = who.acting ? `${who.real.name || 'You'}, logging for them` : me.connected ? 'via Strava' : ''
  const sec = page ? PAGES[page] : null

  return (
    <>
      <Press haptic onPress={() => setOpen(true)} style={st.mebtn} accessibilityRole="button"
        accessibilityLabel={`Profile: ${me.name || 'you'}`} accessibilityState={{ expanded: open }}>
        <View style={st.av}>
          {me.avatar
            ? <Image source={{ uri: me.avatar }} style={st.avImg} contentFit="cover" />
            : (
              <View style={st.ini}>
                {me.initials
                  ? <T size={font.caption} weight={600} lineHeight={14}>{me.initials}</T>
                  : <Icon name="PersonStanding" size={16} color={colors.inkDim} />}
              </View>
            )}
          <View style={[st.avDot, { backgroundColor: DOT[status] || colors.good }]} />
        </View>
        {/* The name and chevron come back only where there is room (.mebtn-name, over 420px). */}
        {width > 420 ? <T size={font.small} numberOfLines={1} style={{ maxWidth: 80 }}>{me.firstName || me.name}</T> : null}
        {width > 420 ? <Icon name="ChevronDown" size={14} color={colors.inkFaint} /> : null}
      </Press>

      {open && (
        <Popover label={me.name} onClose={close}>
          <View style={st.head}>
            {sec ? (
              <>
                <IconBtn icon="ChevronLeft" size={22} onPress={() => setPage(sec.parent || null)}
                  label={`Back to ${sec.parent ? PAGES[sec.parent].label : 'your profile'}`} />
                <T size={font.title} weight={600} numberOfLines={1} style={{ flex: 1 }}>{sec.label}</T>
              </>
            ) : (
              <>
                {me.avatar
                  ? <Image source={{ uri: me.avatar }} style={st.headAv} contentFit="cover" />
                  : <View style={[st.ini, st.headAv]}><T size={font.body} weight={600}>{me.initials || '?'}</T></View>}
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <T size={font.title} weight={600} numberOfLines={1}>{me.name}</T>
                  {sub ? <T size={font.caption} dim>{sub}</T> : null}
                </View>
              </>
            )}
            <IconBtn icon="X" size={18} onPress={close} label="Close" />
          </View>

          <KeyboardAwareScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + space[6] }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            bottomOffset={24}
          >
            {!page && (
              <HomeList who={who} plan={plan} entries={entries} strava={strava}
                status={status} lastSync={lastSync} onOpen={setPage} />
            )}
            {page === 'you' && <MyAbout me={who} />}
            {page === 'you' && <FactsForm groups={['body']} entries={entries} strava={strava} upsertEntry={upsertEntry} />}
            {page === 'gear' && (
              <GearSection plan={plan} entries={entries} strava={strava}
                upsertEntry={upsertEntry} deleteEntry={deleteEntry} />
            )}
            {page === 'notifications' && <NotificationsSection />}
            {page === 'connections' && <ConnectionsSection who={who} strava={strava} onPullStrava={pull} pulling={pulling} />}
            {page === 'climbing' && (
              <ClimbingSection plan={plan} entries={entries} strava={strava} upsertEntry={upsertEntry} onOpen={setPage} />
            )}
            {page === 'testing' && <TestingTab plan={plan} entries={entries} upsertEntry={upsertEntry} />}
            {page === 'why' && <WhyTab plan={plan} />}
            {page === 'settings' && (
              <SettingsSection status={status} lastSync={lastSync} who={who} onLeave={close} />
            )}
          </KeyboardAwareScrollView>
        </Popover>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ home */

function PageRow({ page, meta, onOpen }: { page: string; meta?: string; onOpen: (p: string) => void }) {
  const sec = PAGES[page]
  return <Row icon={sec.icon} label={sec.label} value={meta || undefined} onPress={() => onOpen(page)} />
}

function HomeList({ who, plan, entries, strava, status, lastSync, onOpen }: any) {
  const facts: any = profileFacts(entries)
  const weightField = (PROFILE_GROUPS as any[]).flatMap((g: any) => g.fields).find((f: any) => f.key === 'weightLb')
  const weight = weightField ? (factValue as any)(weightField, { facts, strava, entries }).value : null
  const gearCount = React.useMemo(
    () => (gearUsage as any)({ plan, entries, strava }).filter((g: any) => !g.retired).length,
    [plan, entries, strava])
  const connected = [who.features.strava && 'Strava', who.owner && who.features.whoop && 'WHOOP'].filter(Boolean)
  const meta: Record<string, string> = {
    you: weight != null ? `${weight} lb` : '',
    gear: gearCount ? `${gearCount} item${gearCount === 1 ? '' : 's'}` : '',
    connections: connected.length ? connected.join(' and ') : 'Not connected',
    climbing: facts.redpoint || facts.boulder || '',
    settings: syncLabel(status, lastSync),
  }
  return (
    <View style={st.list}>
      {homePages(who).map((p, i) => (
        <View key={p} style={i > 0 && st.rule}><PageRow page={p} meta={meta[p]} onOpen={onOpen} /></View>
      ))}
    </View>
  )
}

/* ------------------------------------------------------------ the pieces */

/** A group on a page: divided from the one above by a hairline, not boxed (a card in a sheet is a box in a box). */
function Sec({ first, children }: { first?: boolean; children: React.ReactNode }) {
  return <View style={[st.sec, !first && st.secRule]}>{children}</View>
}

/* ------------------------------------------------------- your numbers */

/* Helper text only where a field is not obvious from its label (D7). */
const HINTED = new Set(['apeIndex'])

/** The standing facts of the named PROFILE_GROUPS: body on You, grades on Climbing. */
export function FactsForm({ groups, entries, strava, upsertEntry }: any) {
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
      {(PROFILE_GROUPS as any[]).filter((g: any) => groups.includes(g.key)).map((group: any, gi: number) => (
        <Sec key={group.key} first={gi === 0}>
          <SectionHeader title={group.key === 'climbing' ? 'Your grades' : group.name} style={{ marginTop: 0 }} />
          <View style={{ gap: space[3] }}>
            {group.fields.map((f: any) => {
              const { value, source, date } = (factValue as any)(f, { facts, strava, entries })
              const num = f.type === 'number'
              return (
                <View key={f.key} style={{ gap: 6 }}>
                  <View style={st.factLabel}>
                    <T size={font.small} dim>{f.unit ? `${f.label} (${f.unit})` : f.label}</T>
                    {/* A value the user did not give must never look like one they did. */}
                    {source === 'strava' && <T size={font.caption} faint>from Strava</T>}
                    {source === 'logged' && <T size={font.caption} faint>{`logged ${date}`}</T>}
                  </View>
                  <Input
                    defaultValue={source === 'own' ? String(value) : ''}
                    keyboardType={num ? 'decimal-pad' : 'default'}
                    returnKeyType="done"
                    /*
                     * A number the app is only SHOWING on their behalf goes in the
                     * placeholder, never the value: it reads the same, and it does
                     * not silently become theirs the next time anything saves.
                     * Failing that, a short example.
                     */
                    placeholder={source !== 'own' && value !== null ? String(value) : ''}
                    onEndEditing={(e) => {
                      const v = e.nativeEvent.text
                      if (f.writes === 'bodyweight') saveWeight(v)
                      else save(f.key, num ? (v === '' ? '' : Number(v)) : v)
                    }}
                  />
                  {f.hint && HINTED.has(f.key) ? <T size={font.caption} faint>{f.hint}</T> : null}
                </View>
              )
            })}
          </View>
        </Sec>
      ))}
    </>
  )
}

/* ------------------------------------------------------------- climbing */

/*
 * Climbing: the grades, then Testing and Why as rows. Those two are filled only
 * by a plan that defines tests or evidence, so a row with nothing behind it is
 * left out rather than opening onto an apology (D7).
 */
function ClimbingSection({ plan, entries, strava, upsertEntry, onOpen }: any) {
  const tests = (hasTests as any)(plan)
  const why = (hasEvidence as any)(plan)
  return (
    <>
      <FactsForm groups={['climbing']} entries={entries} strava={strava} upsertEntry={upsertEntry} />
      {(tests || why) && (
        <Sec>
          {tests && <PageRow page="testing" meta={`${(plan?.tests || []).length} in this plan`} onOpen={onOpen} />}
          {tests && why && <View style={st.rule} />}
          {why && <PageRow page="why" meta="The evidence" onOpen={onOpen} />}
        </Sec>
      )}
    </>
  )
}

/* ---------------------------------------------------------- connections */

/*
 * Each service's state. Connecting is the web's (Profile → Connections there): it
 * leaves for the service's consent page and returns to the web app, which a page
 * sheet on this phone cannot follow. Strava refreshes from here.
 */
export function ConnectionsSection({ who, strava, onPullStrava, pulling }: any) {
  const showStrava = !who.acting && (who.features.stravaConnect || who.features.strava)
  const showWhoop = who.owner && !who.acting && (who.features.whoopConnect || who.features.whoop)
  const off = (showStrava && !who.features.strava) || (showWhoop && !who.features.whoop)
  return (
    <>
      {showStrava && (
        <Sec first>
          <Row icon="Bike" label="Strava"
            value={who.features.strava ? (strava?.athlete?.name ? `Connected as ${strava.athlete.name}` : 'Connected') : 'Not connected'} />
          {who.features.strava && (
            <View style={st.actions}>
              <Btn kind="secondary" title={pulling ? 'Refreshing…' : 'Refresh'} disabled={pulling} onPress={() => onPullStrava?.()} />
            </View>
          )}
        </Sec>
      )}
      {showWhoop && (
        <Sec first={!showStrava}>
          <Row icon="HeartPulse" label="WHOOP" value={who.features.whoop ? 'Connected' : 'Not connected'} />
        </Sec>
      )}
      {off ? <Sub style={{ marginTop: space[3] }}>Connect from Profile → Connections in the web app.</Sub> : null}
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
    <Sec first={first}>
      <SectionHeader title="Whose log" style={{ marginTop: 0 }} />
      {who.people.map((p: any, i: number) => {
        const isOpen = p.id === who.id
        const isMe = p.id === who.real.id
        const label = busy === (isMe ? 'me' : p.id) ? 'Switching…'
          : isMe ? (isOpen ? 'Your log' : 'Back to your log') : (isOpen ? `${p.name}’s log` : `Log for ${p.name}`)
        return (
          <View key={p.id} style={i > 0 && st.rule}>
            <Row icon={isMe ? 'PersonStanding' : 'Users'} label={label} value={isOpen ? 'Open' : undefined}
              onPress={isOpen || busy ? undefined : () => go(isMe ? null : p.id)} />
          </View>
        )
      })}
      {error ? <T size={font.small} color={colors.bad}>{error}</T> : null}
    </Sec>
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
  proxy: 'By the proxy',
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

export function SettingsSection({ status, lastSync, who = currentMe(), onLeave }: any) {
  const { allHidden, setAllHidden } = usePrefs() as any
  const conn = useConnection()
  const [leaving, setLeaving] = useState(false)

  const leave = async (changingServer: boolean) => {
    const ok = changingServer
      ? await confirm('Change server?', {
        message: 'Your log is saved to this server and taken off this phone, then you can enter another address.',
        confirmLabel: 'Change server',
      })
      : await confirm('Sign out of this device?', {
        message: 'Your log is saved to the server, then taken off this phone.',
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

      <Sec first={!people}>
        <View style={st.static}>
          <View style={st.dotWell}><SyncDot status={status} /></View>
          <T size={font.body} weight={500} style={{ flex: 1 }}>{syncLabel(status, lastSync) || 'Sync'}</T>
        </View>
        <View style={st.rule} />
        <Row icon="Info" label="Show explanations"
          right={<Toggle value={!allHidden} onChange={(v) => setAllHidden(!v)} />} />
      </Sec>

      <Sec>
        <SectionHeader title="This phone" style={{ marginTop: 0 }} />
        <Row icon="Server" label="Server" value={conn.baseUrl.replace(/^https?:\/\//, '')} />
        <View style={st.rule} />
        <Row icon="Lock" label="Sign-in"
          value={conn.kind === 'session' && conn.user ? conn.user : KIND_LABEL[conn.kind] || '—'} />
        {who.real.admin && (
          <>
            <View style={st.rule} />
            {/* The server's own page, in the browser: it is not rebuilt in this app. */}
            <Row icon="Shield" label="Server settings" onPress={openSettings}
              right={<Icon name="ExternalLink" size={16} color={colors.inkFaint} />} />
          </>
        )}
        <View style={st.rule} />
        <Row icon="RefreshCw" label="Change server" onPress={leaving ? undefined : () => leave(true)} />
        <View style={st.rule} />
        <Row icon="LogOut" label={leaving ? 'Signing out…' : 'Sign out of this device'} danger
          onPress={leaving ? undefined : () => leave(false)} />
      </Sec>
    </>
  )
}

const st = StyleSheet.create({
  // The avatar: a 44pt target around a 32pt face (.mebtn), the name only where there is room.
  mebtn: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP, minWidth: TAP,
    justifyContent: 'center', paddingHorizontal: 6, borderRadius: radius.pill,
  },
  av: { width: 32, height: 32 },
  avImg: { width: 32, height: 32, borderRadius: 16 },
  ini: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel3, borderWidth: 1, borderColor: colors.lineStrong,
  },
  avDot: {
    position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5,
    borderWidth: 2, borderColor: colors.bg,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 64,
    paddingVertical: space[2], paddingLeft: space[4], paddingRight: space[2],
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headAv: { width: 40, height: 40, borderRadius: 20 },
  list: { marginBottom: space[3] },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  sec: { paddingBottom: space[2] },
  secRule: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: space[3], paddingTop: space[4] },
  factLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], marginTop: space[1] },
  static: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52 },
  dotWell: { width: 20, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
})
