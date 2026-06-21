# Yo車位 — Roadmap

> **Status as of 2026-06-21** — All feature phases are code-complete. Remaining work is configuration, device testing, and App Store submission.

---

## ✅ Phase 1 — Core MVP
*The minimum app that is actually useful.*

- [x] Google OAuth sign-in + onboarding gate
- [x] Map centred on user's GPS location
- [x] Live markers coloured by probability (green / amber / red)
- [x] One-tap report FAB — GPS-verified, rate-limited, de-duplicated
- [x] Supabase Realtime — markers update on all devices without refresh
- [x] Credibility score system (0–100, five badge tiers)
- [x] Server-side probability with time decay (`recompute_probability`)
- [x] Consensus windows — 30-min scoring windows, credibility updated on close
- [x] GPS proximity enforcement (30m new, 100m existing, 10-min duplicate guard)
- [x] Space detail screen — probability %, report count, confirm buttons

---

## ✅ Phase 2 — Intelligence
*The app gets smarter over time.*

- [x] "Still empty / Now occupied" confirm flow on existing pins
- [x] Server-side probability recompute on every report (no webhook dependency)
- [x] Heatmap toggle — Circle overlays coloured by probability
- [x] Empty-only filter toggle
- [x] Per-space hourly pattern chart (last 30 days, Taipei TZ)
- [x] "Best time to park" insight derived from pattern data
- [x] Analytics tab — area-wide hourly chart, best/worst hours, current-moment card
- [x] Push notification infrastructure — `push_tokens`, `saved_locations`, `notify-nearby` Edge Function
- [x] Settings screen — set home location, toggle notifications, sign out

---

## ✅ Phase 3 — Community
*Users build the dataset together.*

- [x] Space notes — optional free-text per space, editable by credibility ≥ 40
- [x] Verified permanent lots — auto-badge after 5 distinct high-credibility reporters
- [x] Verified badge on markers (`check-decagram`) and space detail
- [x] Flag / dispute system — 4 reasons, 3 flags resets probability to 0.5
- [x] Credibility streak — consecutive day counter, flame badge, 7-day visual bonus
- [x] Weekly leaderboard — toggle between this week / all-time

---

## ✅ Phase 4 — Power
*Makes the app feel complete.*

- [x] Deep link sharing — `yo-parking://space/<id>` via native Share sheet
- [x] Directions — opens Apple Maps / Google Maps with space as destination
- [x] Parking analytics screen (4th tab)

---

## ✅ Phase 5 — Discovery
*Finding spaces without staring at a map.*

- [x] Nearby spaces list view — sort by distance or probability, filter by empty/bookmarks
- [x] Bookmark spaces — toggle in space detail, separate tab in list view
- [x] Bookmarks quick-access card on profile
- [x] Address search — geocoded, animates map to result

---

## ✅ Phase 6 — Community+
*Conversations around specific spaces.*

- [x] Space comments — collapsible thread, lazy-loaded, rate-limited (5/day/space)
- [x] Delete own comments
- [x] Badge + display name shown per comment

---

## ✅ Phase 7 — Gamification
*Keeps people coming back.*

- [x] 9 achievements — auto-awarded on every report, inline unlock alert
- [x] Achievements gallery screen — earned (full colour + date) vs locked (faded)
- [x] Achievement preview pills on profile
- [x] 3 daily missions — reset each day (Taipei TZ), progress bars on profile
- [x] Daily mission progress tracked server-side (`user_daily_progress`)

---

## 🔧 Configuration Required (not code — your steps)

These are working but won't fire until you set them up. See **SETUP.md** for exact steps.

| Item | What it unlocks |
|---|---|
| Run migrations 001–004 in Supabase SQL Editor | Everything |
| Enable Realtime on `spaces` table | Live marker updates |
| Enable `pg_cron` + schedule `score-consensus` | Credibility updates after consensus |
| Enable Google OAuth in Supabase Auth | Sign-in |
| Deploy 4 Edge Functions | Push notifications, probability webhook, pattern detection |
| Wire `notify-nearby` DB webhook | Push notifications firing |
| Xcode build → device | Actually running on your phone |

---

## 🚀 Pre-Launch (before App Store)

- [ ] Split Google Maps API key — one restricted to iOS bundle ID, one for Android
- [ ] Add Apple Sign-In (App Store requires it if any social login exists)
- [ ] Buy $99/year Apple Developer account for TestFlight + App Store
- [ ] Switch from Xcode direct install to `eas build --platform ios`
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is only in Edge Function secrets, never in the client

---

## 💡 Future Ideas (not yet scheduled)

These are good ideas that aren't built yet. Add to a phase when ready.

- **Passive departure detection** — background location, prompt when GPS moves away from a space ("Did you just leave? Is it empty now?")
- **iOS home screen widget** — shows nearest bookmarked space probability
- **Siri Shortcuts** — "Hey Siri, find parking near me"
- **Offline mode** — cache nearby spaces for no-connection situations
- **Dark mode** — `Colors.dark` tokens are defined, just needs a `useColorScheme` wiring pass
- **Route integration** — enter a destination, get directions + predicted parking availability at arrival time
- **Official lot registration** — businesses can claim and update a lot with real sensor data
- **Social follows** — see reports from friends on the map
- **Apple Watch complication** — nearest space probability on wrist
