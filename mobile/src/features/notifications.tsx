/*
 * Notifications, in the profile panel (app/src/notifications.jsx).
 *
 * On the web these are web push: a service worker and a VAPID subscription from
 * the Home Screen web app. A native app can only be reached through APNs, and the
 * server has no APNs sender, so there is nothing for this screen to subscribe
 * to. lib/push.js is not ported on purpose. The page keeps its place in the
 * profile (its title is the page header's) and says where notifications still work.
 */
import React from 'react'
import { View } from 'react-native'
import { space } from '../theme'
import { NotYet } from '../ui/NotYet'

export function NotificationsSection() {
  return (
    <View style={{ paddingBottom: space[4] }}>
      <NotYet what="Notifications" icon="BellOff">
        They are web push, so they reach the web app added to your Home Screen, not this app.
      </NotYet>
    </View>
  )
}
