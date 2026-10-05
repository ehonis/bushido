/*
 * Push notifications for Bushido.
 *
 * Bushido is its own app on the phone with its own icon, its own permission and its
 * own VAPID identity, so a health notification says Bushido and opens Bushido. That
 * is the whole reason it does not just post into Totem's notifier.
 *
 * What it does NOT own is the machinery. The queue, the RFC 8291 encryption, the
 * VAPID signing, the plan/ranking and the feedback weights live in Totem's
 * `notify/` and are loaded from there by path — the same way this server already
 * reads Totem's BRIDGE_SECRET and the user's brain. A copy would drift, and the
 * one bug that has actually bitten this system in production (a Topic header
 * Apple rejects) was fixed in exactly one file. Two copies would have meant two
 * fixes, and the second one found weeks later by silence.
 *
 * Everything here is best effort. Bushido's job is the training log; a notifier
 * that cannot start must never stop a workout being saved.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUSHIDO_CATEGORIES } from './notify-categories.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const noop = () => {}

/*
 * Bushido's own VAPID identity, generated once and kept in data/.
 *
 * Generated rather than configured because there is nothing for a human to
 * decide here and a setup step that can be skipped is a feature that silently
 * does not work. Deleting this file rotates the keys and EVERY subscription
 * stops working with no error — the phone simply goes quiet — so it is written
 * once and never rewritten.
 */
async function loadVapid(push, log, DATA) {
  const VAPID_FILE = path.join(DATA, 'vapid.json')
  try {
    const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'))
    if (saved.publicKey && saved.privateKey) return saved
  } catch { /* first run */ }

  const keys = push.generateVapidKeys()
  // The subject is baked into the keys file on first run and read back from it
  // ever after, so changing this default never touches an existing install.
  // Push services want a real contact here: set BUSHIDO_VAPID_SUBJECT.
  const vapid = { ...keys, subject: process.env.BUSHIDO_VAPID_SUBJECT || 'mailto:admin@example.com', createdAt: new Date().toISOString() }
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid, null, 2))
  log('[bushido] generated a new VAPID identity in data/vapid.json — every device must subscribe again')
  return vapid
}

/**
 * Build the notifier, or return null if the shared core is not reachable.
 *
 * Async because the core is ESM and this server is CommonJS. That is also why it
 * is loaded once at startup rather than per request.
 */
export async function createBushidoNotify({ log = noop, core = null, dataDir = path.join(ROOT, 'data') } = {}) {
  // Off unless a core is configured (Settings, or BUSHIDO_NOTIFY_CORE). A fresh
  // install has none, and says nothing about it: no core is not an error.
  if (!core) return null
  const CORE = core
  const DATA = dataDir
  let push, store, notifier, httpHandler, plan, schedule
  try {
    ;[push, store, notifier, httpHandler, plan, schedule] = await Promise.all([
      import(path.join(CORE, 'push.mjs')),
      import(path.join(CORE, 'store.mjs')),
      import(path.join(CORE, 'notifier.mjs')),
      import(path.join(CORE, 'http.mjs')),
      import(path.join(CORE, 'plan.mjs')),
      import(path.join(CORE, 'schedule.mjs')),
    ])
  } catch (e) {
    log(`[bushido] notifications are off: cannot load the notify core from ${CORE} (${e.message})`)
    return null
  }

  const vapid = await loadVapid(push, log, DATA)

  const notifyStore = store.createNotifyStore({
    queueFile: path.join(DATA, 'notification-queue.json'),
    subscriptionsFile: path.join(DATA, 'push-subscriptions.json'),
    ledgerFile: path.join(DATA, 'notification-ledger.json'),
    feedbackFile: path.join(DATA, 'notification-feedback.jsonl'),
    categories: BUSHIDO_CATEGORIES,
    log,
  })

  const bushidoNotifier = notifier.createNotifier({ store: notifyStore, vapid, log })

  const handler = httpHandler.createPushHttpHandler({
    store: notifyStore,
    notifier: bushidoNotifier,
    vapidPublicKey: vapid.publicKey,
    categories: BUSHIDO_CATEGORIES,
  })

  return {
    store: notifyStore,
    notifier: bushidoNotifier,
    handler,
    publicPaths: httpHandler.PUSH_PUBLIC_PATHS,
    plan,
    schedule,
    categories: BUSHIDO_CATEGORIES,
    vapidPublicKey: vapid.publicKey,
  }
}

export { BUSHIDO_CATEGORIES }
