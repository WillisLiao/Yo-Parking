-- Enable PostGIS for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── PROFILES ──────────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name      TEXT,
  avatar_url        TEXT,
  credibility       FLOAT   NOT NULL DEFAULT 50.0,
  total_reports     INT     NOT NULL DEFAULT 0,
  confirmed_reports INT     NOT NULL DEFAULT 0,
  false_reports     INT     NOT NULL DEFAULT 0,
  report_weight_cap FLOAT   NOT NULL DEFAULT 1.0,
  badge             TEXT    NOT NULL DEFAULT 'newbie'
                    CHECK (badge IN ('newbie','regular','reliable','expert','guardian')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read all profiles"   ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "Users can update own profile"  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on new auth user
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── SPACES ────────────────────────────────────────────────────────────────────
CREATE TABLE spaces (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  location         GEOGRAPHY(POINT, 4326) NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('empty','occupied')),
  probability      FLOAT       NOT NULL DEFAULT 0.5,
  report_count     INT         NOT NULL DEFAULT 1,
  last_updated     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reported_by UUID        REFERENCES profiles(id)
);

CREATE INDEX spaces_gist ON spaces USING GIST(location);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read spaces"   ON spaces FOR SELECT USING (TRUE);
CREATE POLICY "Auth users can insert"    ON spaces FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update"    ON spaces FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ─── REPORTS ───────────────────────────────────────────────────────────────────
CREATE TABLE reports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id         UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES profiles(id),
  reported_status  TEXT        NOT NULL CHECK (reported_status IN ('empty','occupied')),
  credibility_snap FLOAT       NOT NULL DEFAULT 50.0,
  weight           FLOAT       NOT NULL DEFAULT 1.0,
  confirmed        BOOLEAN,
  consensus_result TEXT        CHECK (consensus_result IN ('correct','wrong','expired','pending')),
  scored_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reports_space_time ON reports(space_id, created_at DESC);
CREATE INDEX reports_user       ON reports(user_id, created_at DESC);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read reports"  ON reports FOR SELECT USING (TRUE);
CREATE POLICY "Auth users can insert"    ON reports FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ─── CONSENSUS WINDOWS ─────────────────────────────────────────────────────────
CREATE TABLE consensus_windows (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id     UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_end   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  scored       BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX consensus_pending ON consensus_windows(window_end) WHERE scored = FALSE;

ALTER TABLE consensus_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read windows" ON consensus_windows FOR SELECT USING (TRUE);

-- ─── RATE LIMIT TRACKING ───────────────────────────────────────────────────────
CREATE TABLE rate_limits (
  user_id           UUID        NOT NULL REFERENCES profiles(id),
  reports_this_hour INT         NOT NULL DEFAULT 0,
  new_spaces_today  INT         NOT NULL DEFAULT 0,
  hour_reset_at     TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', NOW()) + INTERVAL '1 hour',
  day_reset_at      TIMESTAMPTZ NOT NULL DEFAULT date_trunc('day', NOW())  + INTERVAL '1 day',
  PRIMARY KEY (user_id)
);

-- ─── HELPER FUNCTION: get_nearby_spaces ────────────────────────────────────────
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
  lng              FLOAT
) LANGUAGE SQL STABLE AS $$
  SELECT
    s.id,
    s.status,
    s.probability,
    s.report_count,
    s.last_updated,
    s.last_reported_by,
    ST_Distance(s.location, ST_MakePoint(lng, lat)::geography)     AS distance_m,
    ST_Y(s.location::geometry)                                      AS lat,
    ST_X(s.location::geometry)                                      AS lng
  FROM spaces s
  WHERE ST_DWithin(s.location, ST_MakePoint(lng, lat)::geography, radius_m)
  ORDER BY distance_m ASC;
$$;

-- ─── HELPER FUNCTION: submit_report ────────────────────────────────────────────
-- Handles rate limiting, GPS proximity validation, upsert/create space,
-- insert report, open consensus window, trigger probability recalculation.
CREATE OR REPLACE FUNCTION submit_report(
  p_lat      FLOAT,
  p_lng      FLOAT,
  p_status   TEXT,
  p_space_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_profile       profiles%ROWTYPE;
  v_space_id      UUID := p_space_id;
  v_space         spaces%ROWTYPE;
  v_distance_m    FLOAT;
  v_max_distance  FLOAT;
  v_rl            rate_limits%ROWTYPE;
BEGIN
  -- Auth check
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;

  -- Rate limit check
  INSERT INTO rate_limits (user_id) VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_rl FROM rate_limits WHERE user_id = v_user_id;

  IF NOW() > v_rl.hour_reset_at THEN
    UPDATE rate_limits SET reports_this_hour = 0, hour_reset_at = date_trunc('hour', NOW()) + INTERVAL '1 hour'
    WHERE user_id = v_user_id;
    v_rl.reports_this_hour := 0;
  END IF;

  IF v_rl.reports_this_hour >= 5 THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  -- Determine target space
  IF v_space_id IS NOT NULL THEN
    SELECT * INTO v_space FROM spaces WHERE id = v_space_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'space_not_found');
    END IF;

    v_distance_m := ST_Distance(v_space.location, ST_MakePoint(p_lng, p_lat)::geography);
    v_max_distance := 100; -- known space max distance

    -- Duplicate report guard (same user, same space, within 10 min)
    IF EXISTS (
      SELECT 1 FROM reports
      WHERE space_id = v_space_id
        AND user_id = v_user_id
        AND created_at > NOW() - INTERVAL '10 minutes'
    ) THEN
      RETURN jsonb_build_object('error', 'too_soon');
    END IF;
  ELSE
    -- Creating new space — stricter 30m radius
    v_max_distance := 30;
    v_distance_m := 0; -- will be validated after creation

    -- Day rate limit for new space creation (3/day until credibility > 60)
    IF v_profile.credibility <= 60 THEN
      IF NOW() > v_rl.day_reset_at THEN
        UPDATE rate_limits SET new_spaces_today = 0, day_reset_at = date_trunc('day', NOW()) + INTERVAL '1 day'
        WHERE user_id = v_user_id;
        v_rl.new_spaces_today := 0;
      END IF;
      IF v_rl.new_spaces_today >= 3 THEN
        RETURN jsonb_build_object('error', 'new_space_limit_reached');
      END IF;
      UPDATE rate_limits SET new_spaces_today = new_spaces_today + 1 WHERE user_id = v_user_id;
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

  -- Compute report weight from credibility cap
  DECLARE
    v_base_weight FLOAT := CASE
      WHEN v_profile.credibility <= 30  THEN 0.5
      WHEN v_profile.credibility <= 60  THEN 1.0
      WHEN v_profile.credibility <= 80  THEN 1.5
      WHEN v_profile.credibility < 100  THEN 2.0
      ELSE 3.0
    END;
    v_weight FLOAT := LEAST(v_base_weight, v_profile.report_weight_cap);
  BEGIN
    -- Insert report
    INSERT INTO reports (space_id, user_id, reported_status, credibility_snap, weight)
    VALUES (v_space_id, v_user_id, p_status, v_profile.credibility, v_weight);

    -- Update space status + count
    UPDATE spaces SET
      status           = p_status,
      report_count     = report_count + 1,
      last_updated     = NOW(),
      last_reported_by = v_user_id
    WHERE id = v_space_id;

    -- Increment rate limit
    UPDATE rate_limits SET reports_this_hour = reports_this_hour + 1 WHERE user_id = v_user_id;

    -- Update profile total_reports
    UPDATE profiles SET total_reports = total_reports + 1 WHERE id = v_user_id;

    -- Open consensus window if none open for this space
    INSERT INTO consensus_windows (space_id)
    SELECT v_space_id
    WHERE NOT EXISTS (
      SELECT 1 FROM consensus_windows
      WHERE space_id = v_space_id AND scored = FALSE AND window_end > NOW()
    );

    RETURN jsonb_build_object('success', TRUE, 'space_id', v_space_id);
  END;
END;
$$;

-- Enable Realtime on spaces table
ALTER PUBLICATION supabase_realtime ADD TABLE spaces;
