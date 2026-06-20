# Yo車位 — Configure & Test Checklist

Work through these sections in order. Each section has a clear "done when" line so you know when to move on.

---

## 1. Supabase — Run Migrations

Go to **Supabase Dashboard → SQL Editor** and run each file in order.

**Migration 001** — paste contents of `supabase/migrations/001_initial.sql`
**Migration 002** — paste contents of `supabase/migrations/002_realtime_probability_notifications.sql`
**Migration 003** — paste contents of `supabase/migrations/003_phase2_3_4_features.sql`

> Run them one at a time, confirm no errors before moving to the next.

✅ Done when: no red errors, and you can see `spaces`, `profiles`, `reports`, `saved_locations`, `push_tokens`, `space_flags` tables in the Table Editor.

---

## 2. Supabase — Enable Realtime

Dashboard → **Database → Replication** → make sure `spaces` table is checked under `supabase_realtime` publication.

If it's not there, run in SQL Editor:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE spaces;
```

✅ Done when: `spaces` appears in the replication list.

---

## 3. Supabase — Enable pg_cron (consensus scoring)

Dashboard → **Database → Extensions** → search `pg_cron` → enable it.

Then run in SQL Editor:
```sql
SELECT cron.schedule(
  'score-consensus-windows',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.edge_function_url') || '/score-consensus',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
```

> Note: after you deploy the `score-consensus` edge function in step 5, come back and set the two config values:
```sql
ALTER DATABASE postgres SET app.edge_function_url = 'https://<your-project-ref>.supabase.co/functions/v1';
ALTER DATABASE postgres SET app.service_role_key = '<your-service-role-key>';
```
Both values are in Dashboard → **Settings → API**.

✅ Done when: `SELECT * FROM cron.job;` shows the `score-consensus-windows` job.

---

## 4. Supabase Auth — Enable Google OAuth

Dashboard → **Authentication → Providers → Google**
- Enable it
- Paste your **Google OAuth Client ID** and **Client Secret**
- Add authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`

Get credentials from [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → your OAuth 2.0 client.

For iOS, also add: `yo-parking://` as an authorized redirect URI scheme.

✅ Done when: you can sign in with Google on the app.

---

## 5. Deploy Edge Functions

Install Supabase CLI if you haven't:
```bash
brew install supabase/tap/supabase
```

Login and link the project:
```bash
supabase login
supabase link --project-ref <your-project-ref>
```

Deploy all four functions:
```bash
supabase functions deploy notify-nearby
supabase functions deploy score-consensus
supabase functions deploy calculate-probability
supabase functions deploy pattern-detection
```

Set secrets for each function (Dashboard → **Edge Functions → your function → Secrets**, or via CLI):
```bash
supabase secrets set SUPABASE_URL=https://<your-project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

✅ Done when: each function shows "Active" in Dashboard → Edge Functions.

---

## 6. Supabase — Wire notify-nearby Webhook

Dashboard → **Database → Webhooks → Create a new hook**

| Field | Value |
|---|---|
| Name | `notify-nearby` |
| Table | `spaces` |
| Events | ✅ UPDATE only |
| Type | HTTP Request |
| URL | `https://<your-project-ref>.supabase.co/functions/v1/notify-nearby` |
| Headers | `Authorization: Bearer <your-service-role-key>` |

✅ Done when: webhook appears in the list with status Active.

---

## 7. Build to iOS Device (Xcode)

```bash
# In the project root
npx expo prebuild --platform ios --clean
```

Open `ios/yo-parking.xcworkspace` in Xcode.

- Select your iPhone as the target device (plug it in via USB)
- Go to **Signing & Capabilities** → Team → sign in with your Apple ID → select Personal Team
- Change **Bundle Identifier** if Xcode complains (add your initials: e.g. `com.yoparking.app.wl`)
- Press ▶ to build and run

> Free Apple ID builds expire after 7 days. Rebuild to re-install.

✅ Done when: the app launches on your phone and shows the map.

---

## 8. Test — Core Flow (Phase 1)

Do this on the physical device.

- [ ] Sign in with Google
- [ ] Map loads and centres on your location
- [ ] Tap **＋** → choose "有空位" → confirm GPS prompt → marker appears on map
- [ ] Open the app on a second device (or simulator) → marker appears without refresh (Realtime working)
- [ ] Tap a marker → space detail opens → probability % shown
- [ ] Tap "現在有空" or "已停滿" on space detail → confirmation sent

---

## 9. Test — Phase 2 Features

- [ ] Toggle "熱力圖" in map toolbar → circles appear over markers
- [ ] Toggle "只顯示有空" → occupied markers disappear
- [ ] Open space detail → "典型規律" chart shows (will be empty until there are 30 days of reports — that's expected)
- [ ] Analytics tab → if data exists, hourly chart shows; otherwise "資料不足" is shown

---

## 10. Test — Phase 3 Features

- [ ] Submit a report with a note typed in → open space detail → note appears under "現場備註"
- [ ] Tap pencil icon on notes → edit and save (requires credibility ≥ 40; your first account starts at 50 so this should work)
- [ ] Tap "檢舉這個車位" → flag modal opens → select a reason → submit → success alert
- [ ] Profile tab → if you've reported on two consecutive days, streak badge shows
- [ ] Leaderboard tab → toggle "本週" / "總排行" → both load without error

---

## 11. Test — Phase 4 Features

- [ ] Open space detail → tap "分享" → iOS share sheet appears with `yo-parking://space/<id>`
- [ ] Tap "導航" → Apple Maps opens with the space coordinates as destination
- [ ] Paste `yo-parking://space/<any-space-id>` into Safari and open → app opens to that space detail (deep link)

---

## 12. Test — Push Notifications (requires steps 5 + 6 complete)

- [ ] Go to **Settings** tab → Set Home Location → toggle "通知" on
- [ ] From another device, report a space as "有空位" near your home location
- [ ] If that space crosses the 65% probability threshold, you should receive a push notification within ~30 seconds

---

## Pre-Launch Checklist (before App Store submission)

These are not needed for testing but are required before going public:

- [ ] **Split Google Maps API key** — create one key restricted to iOS (bundle ID `com.yoparking.app`), one for Android. Currently using a single unrestricted key — Google only allows one platform restriction per key.
- [ ] **Add Apple Sign-In** — App Store requires this if any social login exists. Dashboard → Auth → Providers → Apple.
- [ ] **$99/year Apple Developer account** — required for TestFlight and App Store. Current free Apple ID builds expire every 7 days.
- [ ] **Service role key** — confirm it is only set in Edge Function secrets, never in the client app or `.env.local` committed to git.
- [ ] **EAS Build** — when you have the Apple Developer account, switch from Xcode direct install to `eas build --platform ios` for proper distribution.

---

## Quick Reference — Key Values You'll Need

All of these are in Supabase Dashboard → **Settings → API**:

| Value | Where to find it |
|---|---|
| Project ref | URL bar: `supabase.co/project/<ref>` |
| Supabase URL | Settings → API → Project URL |
| Anon key | Settings → API → `anon` `public` |
| Service role key | Settings → API → `service_role` `secret` |
