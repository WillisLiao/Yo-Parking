# Yo車位 — Dev Log

Crowdsourced scooter parking app for Taiwan. Users report empty/occupied spaces at their GPS location. Everyone sees the map live. A credibility + probability engine filters false reports automatically — no manual moderation needed.

---

## 2026-06-04 — Phase 1: Core MVP

**Stack locked in.** React Native + Expo SDK 56, Supabase (PostgreSQL + PostGIS + Realtime), Expo Router v5, NativeWind v4, Zustand, TanStack Query v5.

Chose Supabase over Firebase specifically for PostGIS — `ST_DWithin()` gives native radius queries. Firebase would need GeoHash workarounds and makes credibility math painful.

**Auth** — Google OAuth via Supabase Auth. Onboarding gate in tab layout reads `AsyncStorage` flag so new users always see the intro before the map.

**Map** — `react-native-maps` with `PROVIDER_GOOGLE`. Custom map style hides POI clutter. Markers are coloured by probability: green (≥65%), amber (35–65%), red (<35%). Realtime channel on `spaces` table — live updates without polling.

**Critical gotcha discovered:** Supabase Realtime ships `GEOGRAPHY` columns as WKB hex, not GeoJSON. The client can't parse coordinates from the payload. Fixed by adding `STORED` generated columns `lat`/`lng` (`ST_Y/ST_X(location::geometry)`) to `spaces` — these come through verbatim in both `select('*')` and Realtime payloads.

**Report flow** — One-tap FAB, GPS captured on submit, sent to `submit_report` RPC. RPC enforces GPS proximity (30m for new spaces, 100m for existing), rate limits (5/hour), and 10-min duplicate guard. Pin dedup: snaps to nearest space within 25m instead of creating duplicate pins.

**Credibility system** — `profiles.credibility` (0–100), five badge tiers (新手→守護者). Report weight scales with credibility (0.5×–3.0×), capped by `report_weight_cap` for abuse prevention. `recompute_probability()` runs server-side inside `submit_report` with time decay (half-life ~1 hour) so probability updates live over Realtime without a webhook.

**Consensus windows** — 30-minute windows open on each report. `score-consensus` Edge Function closes them and adjusts credibility scores.

---

## 2026-06-04 — Phase 2: Intelligence

**Pattern chart** — `get_space_pattern()` RPC returns avg probability by hour-of-day (Taipei TZ) for the last 30 days. Rendered as a 24-bar chart in space detail with current hour highlighted and a "best time to park" insight pulled from the peak bar.

**Confirm flow** — Space detail already had the "現在有空 / 已停滿" buttons since MVP. These submit a new report against the existing `space_id`, so GPS is re-validated and credibility is updated.

**Heatmap toggle** — Added `Circle` overlays from `react-native-maps` coloured by probability. Works on both iOS (Google Maps provider) and Android. Markers remain tappable underneath via layered rendering.

**Analytics tab** — New 4th tab. Queries `get_area_pattern()` (area-wide hourly chart for the user's location, last 30 days). Shows current-moment probability card, best/worst hours summary, and a tips section.

**Push infrastructure** — `push_tokens` + `saved_locations` tables. `lib/notifications.ts` handles token registration and deep-link routing on tap. `notify-nearby` Edge Function fires when a space's probability crosses 0.65 upward. Settings screen lets users set a home location and toggle notifications. **Requires webhook wiring in Supabase Dashboard before it fires — see SETUP.md.**

---

## 2026-06-04 — Phase 3: Community

**Space notes** — `TEXT` column on `spaces`. Optional note field in report flow passed via `p_note` param to `submit_report`. Editable from space detail by users with credibility ≥ 40 (via `update_space_note()` RPC).

**Verified lots** — `spaces.verified BOOLEAN`. Auto-set to `TRUE` when 5+ distinct users with `credibility_snap ≥ 70` report the same space. Shown as a `check-decagram` badge on markers and space detail.

**Flag/dispute system** — `space_flags` table, one flag per user per space. `flag_space()` RPC. Four reasons: wrong location, always occupied, spam, other. Three or more flags resets the space to 0.5 probability to surface ambiguity on the map.

**Credibility streak** — `profiles.streak_days` + `profiles.last_report_date`. Incremented in `submit_report` when the user reports on a consecutive calendar day (Taipei TZ). Shown as a flame badge on profile. Visual bonus at 7+ days.

**Weekly leaderboard** — `get_weekly_leaderboard()` RPC counts `consensus_result = 'correct'` reports since `date_trunc('week', NOW())`. Leaderboard screen has a toggle between weekly and all-time views.

---

## 2026-06-04 — Phase 4: Power

**Deep link sharing** — `app.json` already had `scheme: "yo-parking"`. Share button on space detail uses React Native `Share` with `yo-parking://space/<id>`. Deep links route via Expo Router's file-based routing to `app/space/[id].tsx`.

**Directions** — "導航" button opens `maps://app?daddr=lat,lng` on iOS (falls back to Google Maps URL on Android or if Apple Maps unavailable).

**Parking analytics screen** — New tab using `get_area_pattern()` data. Shows hourly chart, best/worst hours card, current-moment probability, and contextual tips.

---

## 2026-06-21 — Phase 5: Discovery

**Nearby list view** (`/nearby-list`) — Alternative to map for users who prefer a list. Sortable by distance or probability. Filterable by all / empty-only / bookmarks. Shows distance, probability circle, notes, time-ago, report count. Accessible from a "列表" chip in the map toolbar.

**Bookmarks** — `bookmarked_spaces` table (user_id, space_id primary key). `toggle_bookmark()` RPC. Bookmark icon in space detail header. Bookmarks tab in the list view. Quick-access shortcut card on profile.

**Address search** — Search icon in map top bar. Expands an inline `TextInput`. On submit, calls `Location.geocodeAsync()` and animates the map to the result. No extra API key needed — uses platform geocoding.

---

## 2026-06-21 — Phase 6: Community+

**Space comments** — `space_comments` table. Collapsible thread at the bottom of space detail. `get_space_comments()` only loads when the section is expanded (lazy). `add_space_comment()` rate-limited to 5 per user per space per day. Own comments deletable. Shows display name, badge colour, and time-ago per comment.

---

## 2026-06-21 — Phase 7: Gamification

**Achievements** — 9 achievements across four categories (report count, correct reports, streak, credibility tier). `check_and_award_achievements()` called at the tail of every `submit_report` — returns newly earned IDs. If any are awarded, the app shows an inline "成就解鎖！" alert with the names. Full gallery at `/achievements` (earned = full colour + date, locked = faded).

**Daily missions** — 3 missions reset each calendar day (Taipei TZ): report an empty space, confirm 2 spaces, create a new space. Progress tracked in `user_daily_progress`. Mission cards with progress bars shown on the profile screen.

---

## Architecture notes

- **No mock data anywhere** — every screen talks directly to Supabase. Empty states are shown when data is absent, not faked.
- **Single source of truth for spaces** — `useMapStore` holds the in-memory map of spaces. Realtime upserts go through `upsertSpace()`; initial load and list views read from the same store or query directly.
- **Typecheck command** — the `.bin/tsc` shim is broken in this install. Use: `node node_modules/typescript/lib/tsc.js --noEmit`
- **PostGIS in migrations** — always use `ST_MakePoint(lng, lat)` (longitude first), then `::geography` cast. `ST_DWithin` on geography columns uses metres directly.
- **Edge Functions** — all four need `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` secrets set. See SETUP.md §5 for deploy commands.
