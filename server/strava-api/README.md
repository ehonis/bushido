# strava-api

A copy of Totem's Strava connector (`strava/client.mjs`, `shape.mjs`, `cache.mjs` in the
Totem repo, taken at Totem commit `12fd258`). Bushido uses it only for people other than
the owner: each one connects their own Strava account, and `server.js` keeps one client
per person, with its tokens in `data/users/<id>/strava-oauth.json`.

The owner's Strava still comes through the Totem bridge. `training()` and `activity()`
here return what the bridge's `/api/strava/training` and `/api/strava/activity` return,
so both paths fill the same cache and snapshots.

Don't edit these files here. Change them in Totem and copy them over again, so the two
don't drift apart.
