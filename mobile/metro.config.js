// The ported lib/minutes.js, unlogged.js, whoop.jsx and strava.jsx import the
// server's pure WHOOP and Strava modules at the same relative path the web does
// (../../../server/whoop.js): one copy of "which workout is this session" for
// the server, the web and the phone. Metro only serves files it watches, so the
// server folder is added; the repo-root .easignore uploads those two files.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../server')]

module.exports = config
