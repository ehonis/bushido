// A whole-app reload: the native form of the web's location.replace('/').
//
// Whose log is open is decided before the store mounts (lib/whoami.js), and a
// switch must never swap the log under a mounted store, so acting as someone
// (or the server answering 409 switched) restarts the JS from the top. A dev
// client without expo-updates' runtime falls back to the dev reload.
import { DevSettings } from 'react-native'
import * as Updates from 'expo-updates'

export function reloadApp() {
  Updates.reloadAsync().catch(() => { DevSettings.reload() })
}
