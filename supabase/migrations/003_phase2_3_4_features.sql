-- ════════════════════════════════════════════════════════════════════════════
-- 003: Phase 2/3/4 — heatmap, space notes, verified lots, streak tracking,
--      flag/dispute system, weekly leaderboard, pattern analytics, deep links
-- ════════════════════════════════════════════════════════════════════════════

-- ─── SPACE NOTES + VERIFIED ─────────────────────────────────────────────────────
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS notes      TEXT,
  ADD COLUMN IF NOT EXISTS verified   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ─── PROFILE STREAK ─────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS streak_days      INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_report_date DATE;

-- ─── SPACE FLAGS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS space_flags (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   UUID        NOT NULL REFERENCES spaces(id)   ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason     TEXT        NOT NULL CHECK (reason IN ('wrong_location','always_occupied','spam','other')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS space_flags_space ON space_flags(space_id);

ALTER TABLE space_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read flags"    ON space_flags;
DROP POLICY IF EXISTS "Auth users can flag"      ON space_flags;
DROP POLICY IF EXISTS "Users can delete own flags" ON space_flags;
CREATE POLICY "Anyone can read flags"      ON space_flags FOR SELECT USING (TRUE);
CREATE POLICY "Auth users can flag"        ON space_flags FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own flags" ON space_flags FOR DELETE  USING (auth.uid() = user_id);

-- ─── get_nearby_spaces (extended with notes + verified) ────────────────────────
CREATE OR REPLACE FUNCTION get_nearby_spaces(lat FLOAT, lng FLOAT, radius_m FLOAT DEFAULT 500)
RETURNS TABLE (
  id               UUID,
  status           TEXT,
  probability      FLOAT,
  report_count     INT,
  last_updated     TIMESTAMPTZ,
  last_reported_by UUID,
  distance_m       FLOAT,
  lat              FLOAT,
  lng              FLOAT,
  notes            TEXT,
  verified         BOOLEAN
) LANGUAGE SQL STABLE AS $$
  SELECT
    s.id,
    s.status,
    s.probability,
    s.report_count,
    s.last_updated,
    s.last_reported_by,
    ST_Distance(s.location, ST_MakePoint(lng, lat)::geography) AS distance_m,
    ST_Y(s.location::geometry)                                  AS lat,
    ST_X(s.location::geometry)                                  AS lng,
    s.notes,
    s.verified
  FROM spaces s
  WHERE ST_DWithin(s.location, ST_MakePoint(lng, lat)::geography, radius_m)
  ORDER BY distance_m ASC;
$$;

-- ─── get_weekly_leaderboard ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_weekly_leaderboard()
RETURNS TABLE (
  user_id          UUID,
  display_name     TEXT,
  badge            TEXT,
  weekly_confirmed BIGINT,
  credibility      FLOAT
) LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    p.id           AS user_id,
    p.display_name,
    p.badge,
    COUNT(r.id)    AS weekly_confirmed,
    p.credibility
  FROM profiles p
  JOIN reports r ON r.user_id = p.id
  WHERE r.consensus_result = 'correct'
    AND r.scored_at >= date_trunc('week', NOW())
  GROUP BY p.id, p.display_name, p.badge, p.credibility
  ORDER BY weekly_confirmed DESC
  LIMIT 20;
$$;

-- ─── get_space_pattern ──────────────────────────────────────────────────────────
-- Average probability by hour-of-day (Taipei time) for a space, last 30 days.
CREATE OR REPLACE FUNCTION get_space_pattern(p_space_id UUID)
RETURNS TABLE (hour_of_day INT, avg_probability FLOAT, sample_count BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Taipei')::INT AS hour_of_day,
    ROUND(AVG(CASE WHEN reported_status = 'empty' THEN 1.0 ELSE 0.0 END)::NUMERIC, 2)::FLOAT AS avg_probability,
    COUNT(*) AS sample_count
  FROM reports
  WHERE space_id = p_space_id
    AND created_at > NOW() - INTERVAL '30 days'
  GROUP BY hour_of_day
  ORDER BY hour_of_day;
$$;

-- ─── get_area_pattern ───────────────────────────────────────────────────────────
-- Average probability by hour-of-day across all spaces in a radius (analytics tab).
CREATE OR REPLACE FUNCTION get_area_pattern(p_lat FLOAT, p_lng FLOAT, p_radius_m FLOAT DEFAULT 500)
RETURNS TABLE (hour_of_day INT, avg_probability FLOAT, sample_count BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    EXTRACT(HOUR FROM r.created_at AT TIME ZONE 'Asia/Taipei')::INT AS hour_of_day,
    ROUND(AVG(CASE WHEN r.reported_status = 'empty' THEN 1.0 ELSE 0.0 END)::NUMERIC, 2)::FLOAT AS avg_probability,
    COUNT(*) AS sample_count
  FROM reports r
  JOIN spaces s ON s.id = r.space_id
  WHERE ST_DWithin(s.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
    AND r.created_at > NOW() - INTERVAL '30 days'
  GROUP BY hour_of_day
  ORDER BY hour_of_day;
$$;

-- ─── update_space_note ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_space_note(p_space_id UUID, p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT credibility FROM profiles WHERE id = auth.uid()) < 40 THEN
    RAISE EXCEPTION 'insufficient_credibility';
  END IF;
  UPDATE spaces SET notes = p_note WHERE id = p_space_id;
END;
$$;

-- ─── flag_space ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION flag_space(p_space_id UUID, p_reason TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_flag_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  INSERT INTO space_flags (space_id, user_id, reason, note)
  VALUES (p_space_id, v_user_id, p_reason, p_note)
  ON CONFLICT (space_id, user_id) DO UPDATE
    SET reason = EXCLUDED.reason, note = EXCLUDED.note, created_at = NOW();

  SELECT COUNT(*) INTO v_flag_count FROM space_flags WHERE space_id = p_space_id;

  -- 3+ flags → reset to uncertain so map shows ambiguity
  IF v_flag_count >= 3 THEN
    UPDATE spaces SET probability = 0.5 WHERE id = p_space_id;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'flag_count', v_flag_count);
END;
$$;

-- ─── submit_report (v3) ─────────────────────────────────────────────────────────
-- Adds: optional p_note param, streak tracking, auto-verify (5 high-cred reports).
CREATE OR REPLACE FUNCTION submit_report(
  p_lat      FLOAT,
  p_lng      FLOAT,
  p_status   TEXT,
  p_space_id UUID    DEFAULT NULL,
  p_note     TEXT    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_profile          profiles%ROWTYPE;
  v_space_id         UUID := p_space_id;
  v_space            spaces%ROWTYPE;
  v_distance_m       FLOAT;
  v_max_distance     FLOAT;
  v_rl               rate_limits%ROWTYPE;
  v_is_new           BOOLEAN := FALSE;
  v_base_weight      FLOAT;
  v_weight           FLOAT;
  v_today            DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v_high_cred_count  INT;
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

  -- Snap to nearest space within 25m if no explicit space given
  IF v_space_id IS NULL THEN
    SELECT id INTO v_space_id
    FROM spaces
    WHERE ST_DWithin(location, ST_MakePoint(p_lng, p_lat)::geography, 25)
    ORDER BY ST_Distance(location, ST_MakePoint(p_lng, p_lat)::geography) ASC
    LIMIT 1;
  END IF;

  IF v_space_id IS NOT NULL THEN
    SELECT * INTO v_space FROM spaces WHERE id = v_space_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'space_not_found');
    END IF;
    v_distance_m   := ST_Distance(v_space.location, ST_MakePoint(p_lng, p_lat)::geography);
    v_max_distance := 100;

    IF EXISTS (
      SELECT 1 FROM reports
      WHERE space_id = v_space_id AND user_id = v_user_id
        AND created_at > NOW() - INTERVAL '10 minutes'
    ) THEN
      RETURN jsonb_build_object('error', 'too_soon');
    END IF;
  ELSE
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

  IF v_distance_m > v_max_distance THEN
    RETURN jsonb_build_object('error', 'too_far', 'distance_m', v_distance_m);
  END IF;

  -- Update note if provided
  IF p_note IS NOT NULL AND p_note != '' THEN
    UPDATE spaces SET notes = p_note WHERE id = v_space_id;
  END IF;

  v_base_weight := CASE
    WHEN v_profile.credibility <= 30 THEN 0.5
    WHEN v_profile.credibility <= 60 THEN 1.0
    WHEN v_profile.credibility <= 80 THEN 1.5
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

  -- ── Streak tracking ──────────────────────────────────────────────────────
  IF v_profile.last_report_date IS NULL OR v_profile.last_report_date < v_today THEN
    IF v_profile.last_report_date = v_today - 1 THEN
      UPDATE profiles SET streak_days = streak_days + 1, last_report_date = v_today
        WHERE id = v_user_id;
    ELSE
      UPDATE profiles SET streak_days = 1, last_report_date = v_today
        WHERE id = v_user_id;
    END IF;
  END IF;

  -- ── Consensus window ─────────────────────────────────────────────────────
  INSERT INTO consensus_windows (space_id)
  SELECT v_space_id
  WHERE NOT EXISTS (
    SELECT 1 FROM consensus_windows
    WHERE space_id = v_space_id AND scored = FALSE AND window_end > NOW()
  );

  -- ── Auto-verify (5+ distinct high-credibility reporters) ────────────────
  SELECT COUNT(DISTINCT user_id) INTO v_high_cred_count
  FROM reports
  WHERE space_id = v_space_id AND credibility_snap >= 70;

  IF v_high_cred_count >= 5 AND NOT COALESCE(v_space.verified, FALSE) THEN
    UPDATE spaces SET verified = TRUE, verified_at = NOW() WHERE id = v_space_id;
  END IF;

  -- ── Probability recompute ────────────────────────────────────────────────
  PERFORM recompute_probability(v_space_id);

  RETURN jsonb_build_object('success', TRUE, 'space_id', v_space_id, 'is_new', v_is_new);
END;
$$;
