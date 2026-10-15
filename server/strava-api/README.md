# strava-api

Bushido's Strava connector: OAuth, the Strava v3 API, and the owner's full activity mirror.
It started as Totem's `strava/` and moved here when Bushido became the only holder of
Strava grants (2026-10-14). `server.js` keeps one client per person, with their tokens in
`strava-oauth.json` in their space.

Totem reads the owner's Strava through `POST /api/strava/owner`, which runs a method of the
owner's client and returns what it returns. Totem still keeps its own copies of
`shape.mjs` and `cache.mjs`, because its goals do arithmetic over the mirror that call
returns. Change those two in both places together.
