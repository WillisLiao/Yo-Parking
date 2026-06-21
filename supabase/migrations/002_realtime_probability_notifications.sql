-- ════════════════════════════════════════════════════════════════════════════
-- 002: Realtime lat/lng fix, server-side probability, pin dedup,
--      saved locations + push notifications (Phase 2)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── FIX: Realtime markers rendered at (0,0) ────────────────────────────────────
-- Supabase Realtime ships the `location` GEOGRAPHY column as WKB hex, NOT GeoJSON,
-- so the client could not read lat/lng from realtime payloads. Generated columns
-- are included verbatim in realtime row payloads and in `select('*')`.
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION
    GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION
    GENERATED ALWAYS AS (ST_X(location::geometry)) STORED;

-- ─── Server-side probability recompute ──────────────────────────────────────────
-- Mirrors the calculate-probability edge function so probability updates the
-- instant a report lands (and propagates over Realtime) without depending on an
-- external webhook being wired up. Time decay halves roughly every hour.
CREATE OR REPLACE FUNCTION recompute_probability(p_space_id UUID)
RETURNS FLOAT LANGUAGE plpgsql AS $$
DECLARE
  v_weighted_sum FLOAT := 0;
  v_total_weight FLOAT := 0;
  v_prob         FLOAT;
  v_hours        FLOAT;
  v_decay        FLOAT;
  v_rw           FLOAT;
  r              RECORD;
BEGIN
  FOR r IN
    SELECT reported_status, credibility_snap, weight, created_at
    FROM reports
    WHERE space_id = p_space_id
      AND created_at > NOW() - INTERVAL '2 hours'
  LOOP
    v_hours := EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 3600.0;
    v_decay := EXP(-0.7 * v_hours);
    v_rw    := (r.credibility_snap / 100.0) * v_decay * r.weight;
    IF r.reported_status = 'empty' THEN
      v_weighted_sum := v_weighted_sum + v_rw;
    END IF;
    v_total_weight := v_total_weight + v_rw;
  END LOOP;

  v_prob := CASE WHEN v_total_weight = 0 THEN 0.5
                 ELSE v_weighted_sum / v_total_weight END;
  v_prob := ROUND(v_prob::NUMERIC, 2);

  UPDATE spaces SET probability = v_prob WHERE id = p_space_id;
  RETURN v_prob;
END;
$$;

-- ─── submit_report (rewritten) ──────────────────────────────────────────────────
-- Adds: snap-to-nearby-space dedup (<=25m), immediate probability recompute.
CREATE OR REPLACE FUNCTION submit_report(
  p_lat      FLOAT,
  p_lng      FLOAT,
  p_status   TEXT,
  p_space_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_profile      profiles%ROWTYPE;
  v_space_id     UUID := p_space_id;
  v_space        spaces%ROWTYPE;
  v_distance_m   FLOAT;
  v_max_distance FLOAT;
  v_rl           rate_limits%ROWTYPE;
  v_is_new       BOOLEAN := FALSE;
  v_base_weight  FLOAT;
  v_weight       FLOAT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;

  -- Rate limit init / hourly reset
  INSERT INTO rate_limits (user_id) VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_rl FROM rate_limits WHERE user_id = v_user_id;

  IF NOW() > v_rl.hour_reset_at THEN
    UPDATE rate_limits
      SET reports_this_hour = 0,
          hour_reset_at = date_trunc('hour', NOW()) + INTERVAL '1 hour'
      WHERE user_id = v_user_id;
    v_rl.reports_this_hour := 0;
  END IF;

  IF v_rl.reports_this_hour >= 5 THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  -- If no explicit space, snap to the nearest existing space within 25m so we
  -- don't litter the map with duplicate pins for the same physical spot.
  IF v_space_id IS NULL THEN
    SELECT id INTO v_space_id
    FROM spaces
    WHERE ST_DWithin(location, ST_MakePoint(p_lng, p_lat)::geography, 25)
    ORDER BY ST_Distance(location, ST_MakePoint(p_lng, p_lat)::geography) ASC
    LIMIT 1;
  END IF;

  IF v_space_id IS NOT NULL THEN
    -- Reporting against a known space
    SELECT * INTO v_space FROM spaces WHERE id = v_space_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'space_not_found');
    END IF;

    v_distance_m   := ST_Distance(v_space.location, ST_MakePoint(p_lng, p_lat)::geography);
    v_max_distance := 100;

    IF EXISTS (
      SELECT 1 FROM reports
      WHERE space_id = v_space_id
        AND user_id = v_user_id
        AND created_at > NOW() - INTERVAL '10 minutes'
    ) THEN
      RETURN jsonb_build_object('error', 'too_soon');
    END IF;
  ELSE
    -- Creating a brand new space (stricter 30m radius, daily cap for low cred)
    v_is_new       := TRUE;
    v_max_distance := 30;
    v_distance_m   := 0;

    IF v_profile.credibility <= 60 THEN
      IF NOW() > v_rl.day_reset_at THEN
        UPDATE rate_limits
          SET new_spaces_today = 0,
              day_reset_at = date_trunc('day', NOW()) + INTERVAL '1 day'
          WHERE user_id = v_user_id;
        v_rl.new_spaces_today := 0;
      END IF;
      IF v_rl.new_spaces_today >= 3 THEN
        RETURN jsonb_build_object('error', 'new_space_limit_reached');
      END IF;
      UPDATE rate_limits SET new_spaces_today = new_spaces_today + 1
        WHERE user_id = v_user_id;
    END IF;

    INSERT INTO spaces (location, status, last_reported_by)
    VALUES (ST_MakePoint(p_lng, p_lat)::geography, p_status, v_user_id)
    RETURNING * INTO v_space;
    v_space_id := v_space.id;
  END IF;

  -- GPS proximity enforcement
  IF v_distance_m > v_max_distance THEN
    RETURN jsonb_build_object('error', 'too_far', 'distance_m', v_distance_m);
  END IF;

  -- Report weight from credibility, capped by anti-abuse weight cap
  v_base_weight := CASE
    WHEN v_profile.credibility <= 30  THEN 0.5
    WHEN v_profile.credibility <= 60  THEN 1.0
    WHEN v_profile.credibility <= 80  THEN 1.5
    WHEN v_profile.credibility < 100  THEN 2.0
    ELSE 3.0
  END;
  v_weight := LEAST(v_base_weight, v_profile.report_weight_cap);

  INSERT INTO reports (space_id, user_id, reported_status, credibility_snap, weight)
  VALUES (v_space_id, v_user_id, p_status, v_profile.credibility, v_weight);

  UPDATE spaces SET
    status           = p_status,
    report_count     = report_count + 1,
    last_updated     = NOW(),
    last_reported_by = v_user_id
  WHERE id = v_space_id;

  UPDATE rate_limits SET reports_this_hour = reports_this_hour + 1
    WHERE user_id = v_user_id;
  UPDATE profiles SET total_reports = total_reports + 1
    WHERE id = v_user_id;

  -- Open a consensus window if none is currently open for this space
  INSERT INTO consensus_windows (space_id)
  SELECT v_space_id
  WHERE NOT EXISTS (
    SELECT 1 FROM consensus_windows
    WHERE space_id = v_space_id AND scored = FALSE AND window_end > NOW()
  );

  -- Recompute probability now so Realtime clients see the fresh value
  PERFORM recompute_probability(v_space_id);

  RETURN jsonb_build_object('success', TRUE, 'space_id', v_space_id, 'is_new', v_is_new);
END;
$$;

-- ─── SAVED LOCATIONS (Phase 2: notify near home) ────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT 'home',
  location   GEOGRAPHY(POINT, 4326) NOT NULL,
  radius_m   INT  NOT NULL DEFAULT 300,
  notify     BOOLEAN NOT NULL DEFAULT TRUE,
  lat        DOUBLE PRECISION GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  lng        DOUBLE PRECISION GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS saved_locations_gist ON saved_locations USING GIST(location);
CREATE INDEX IF NOT EXISTS saved_locations_user ON saved_locations(user_id);

ALTER TABLE saved_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own saved locations" ON saved_locations;
CREATE POLICY "own saved locations" ON saved_locations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── PUSH TOKENS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own push tokens" ON push_tokens;
CREATE POLICY "own push tokens" ON push_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── users_to_notify ────────────────────────────────────────────────────────────
-- For a given space, return push tokens of users who saved a location within its
-- radius, have notifications on, and are not the person who just reported it.
CREATE OR REPLACE FUNCTION users_to_notify(p_space_id UUID)
RETURNS TABLE (user_id UUID, token TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT pt.user_id, pt.token
  FROM spaces s
  JOIN saved_locations sl
    ON ST_DWithin(sl.location, s.location, sl.radius_m)
  JOIN push_tokens pt
    ON pt.user_id = sl.user_id
  WHERE s.id = p_space_id
    AND sl.notify = TRUE
    AND sl.user_id IS DISTINCT FROM s.last_reported_by;
$$;
