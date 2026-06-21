-- ════════════════════════════════════════════════════════════════════════════
-- 004: Phase 5/6/7 — bookmarks, address search, space comments,
--      achievements, daily missions
-- ════════════════════════════════════════════════════════════════════════════

-- ─── BOOKMARKS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookmarked_spaces (
  user_id    UUID        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  space_id   UUID        NOT NULL REFERENCES spaces(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, space_id)
);
CREATE INDEX IF NOT EXISTS bookmarks_user ON bookmarked_spaces(user_id, created_at DESC);

ALTER TABLE bookmarked_spaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own bookmarks" ON bookmarked_spaces;
CREATE POLICY "own bookmarks" ON bookmarked_spaces
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── SPACE COMMENTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS space_comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   UUID        NOT NULL REFERENCES spaces(id)    ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS space_comments_space ON space_comments(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS space_comments_user  ON space_comments(user_id);

ALTER TABLE space_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read comments"     ON space_comments;
DROP POLICY IF EXISTS "Auth users can comment"       ON space_comments;
DROP POLICY IF EXISTS "Users can delete own comment" ON space_comments;
CREATE POLICY "Anyone can read comments"     ON space_comments FOR SELECT USING (TRUE);
CREATE POLICY "Auth users can comment"       ON space_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own comment" ON space_comments FOR DELETE  USING (auth.uid() = user_id);

-- ─── ACHIEVEMENTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0
);

INSERT INTO achievements (id, title, description, icon, sort_order) VALUES
  ('first_report',    '初次出擊',   '送出第一筆回報',               'map-marker-plus',      1),
  ('ten_reports',     '回報達人',   '累積10筆回報',                 'map-marker-multiple',  2),
  ('fifty_correct',   '社區支柱',   '累積50筆正確回報',             'account-group',        3),
  ('hundred_reports', '百戰老手',   '累積100筆回報',                'star-circle',          4),
  ('week_warrior',    '週週到',     '連續7天回報',                  'fire',                 5),
  ('month_warrior',   '月不間斷',   '連續30天回報',                 'calendar-check',       6),
  ('reach_reliable',  '可靠市民',   '達到「可靠」等級（可信賴度≥61）', 'shield-check',       7),
  ('reach_expert',    '停車達人',   '達到「達人」等級（可信賴度≥81）', 'trophy',             8),
  ('reach_guardian',  '守護者',     '達到最高「守護者」等級',       'shield-star',          9)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id TEXT        NOT NULL REFERENCES achievements(id),
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS user_achievements_user ON user_achievements(user_id, earned_at DESC);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read user achievements" ON user_achievements;
CREATE POLICY "Anyone can read user achievements" ON user_achievements FOR SELECT USING (TRUE);

-- ─── DAILY MISSIONS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_missions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  goal        INT  NOT NULL DEFAULT 1
);

INSERT INTO daily_missions (id, title, description, icon, goal) VALUES
  ('report_empty',   '回報空位',  '今天至少回報1個空的機車格',      'motorbike',            1),
  ('confirm_spaces', '確認現況',  '今天確認2個現有車格的即時狀況',   'check-circle-outline', 2),
  ('explore_new',    '探索新區',  '新增一個地圖上還沒有的車位',     'map-search',           1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_daily_progress (
  user_id    UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mission_id TEXT    NOT NULL REFERENCES daily_missions(id),
  date       DATE    NOT NULL DEFAULT CURRENT_DATE,
  progress   INT     NOT NULL DEFAULT 0,
  completed  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, mission_id, date)
);

ALTER TABLE user_daily_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own daily progress" ON user_daily_progress;
CREATE POLICY "own daily progress" ON user_daily_progress
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── toggle_bookmark ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION toggle_bookmark(p_space_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exists  BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  SELECT EXISTS(
    SELECT 1 FROM bookmarked_spaces WHERE user_id = v_user_id AND space_id = p_space_id
  ) INTO v_exists;
  IF v_exists THEN
    DELETE FROM bookmarked_spaces WHERE user_id = v_user_id AND space_id = p_space_id;
    RETURN jsonb_build_object('bookmarked', FALSE);
  ELSE
    INSERT INTO bookmarked_spaces (user_id, space_id) VALUES (v_user_id, p_space_id);
    RETURN jsonb_build_object('bookmarked', TRUE);
  END IF;
END;
$$;

-- ─── get_bookmarked_spaces ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_bookmarked_spaces()
RETURNS TABLE (
  id               UUID,
  status           TEXT,
  probability      FLOAT,
  report_count     INT,
  last_updated     TIMESTAMPTZ,
  last_reported_by UUID,
  lat              FLOAT,
  lng              FLOAT,
  notes            TEXT,
  verified         BOOLEAN
) LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT s.id, s.status, s.probability, s.report_count, s.last_updated, s.last_reported_by,
         ST_Y(s.location::geometry) AS lat,
         ST_X(s.location::geometry) AS lng,
         s.notes, s.verified
  FROM spaces s
  JOIN bookmarked_spaces b ON b.space_id = s.id AND b.user_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;

-- ─── get_space_comments ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_space_comments(p_space_id UUID)
RETURNS TABLE (
  id           UUID,
  body         TEXT,
  created_at   TIMESTAMPTZ,
  user_id      UUID,
  display_name TEXT,
  badge        TEXT
) LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT sc.id, sc.body, sc.created_at, sc.user_id, p.display_name, p.badge
  FROM space_comments sc
  JOIN profiles p ON p.id = sc.user_id
  WHERE sc.space_id = p_space_id
  ORDER BY sc.created_at ASC
  LIMIT 50;
$$;

-- ─── add_space_comment ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION add_space_comment(p_space_id UUID, p_body TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF char_length(trim(p_body)) < 1 THEN RETURN jsonb_build_object('error', 'empty_body'); END IF;
  -- Rate limit: max 5 comments per space per day per user
  IF (
    SELECT COUNT(*) FROM space_comments
    WHERE user_id = v_user_id AND space_id = p_space_id
      AND created_at > NOW() - INTERVAL '1 day'
  ) >= 5 THEN
    RETURN jsonb_build_object('error', 'too_many_comments');
  END IF;
  INSERT INTO space_comments (space_id, user_id, body) VALUES (p_space_id, v_user_id, trim(p_body));
  RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- ─── delete_space_comment ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_space_comment(p_comment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM space_comments WHERE id = p_comment_id AND user_id = auth.uid();
END;
$$;

-- ─── check_and_award_achievements ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_and_award_achievements(p_user_id UUID)
RETURNS SETOF TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_id      TEXT;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;

  -- total_reports milestones
  IF v_profile.total_reports >= 1 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'first_report')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'first_report'; END IF;
  END IF;
  IF v_profile.total_reports >= 10 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'ten_reports')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'ten_reports'; END IF;
  END IF;
  IF v_profile.total_reports >= 100 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'hundred_reports')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'hundred_reports'; END IF;
  END IF;

  -- confirmed_reports milestones
  IF v_profile.confirmed_reports >= 50 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'fifty_correct')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'fifty_correct'; END IF;
  END IF;

  -- streak milestones
  IF COALESCE(v_profile.streak_days, 0) >= 7 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'week_warrior')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'week_warrior'; END IF;
  END IF;
  IF COALESCE(v_profile.streak_days, 0) >= 30 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'month_warrior')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'month_warrior'; END IF;
  END IF;

  -- credibility milestones
  IF v_profile.credibility >= 61 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'reach_reliable')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'reach_reliable'; END IF;
  END IF;
  IF v_profile.credibility >= 81 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'reach_expert')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'reach_expert'; END IF;
  END IF;
  IF v_profile.credibility >= 100 THEN
    INSERT INTO user_achievements (user_id, achievement_id) VALUES (p_user_id, 'reach_guardian')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN RETURN NEXT 'reach_guardian'; END IF;
  END IF;
END;
$$;

-- ─── get_user_achievements ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_achievements(p_user_id UUID)
RETURNS TABLE (
  id          TEXT,
  title       TEXT,
  description TEXT,
  icon        TEXT,
  sort_order  INT,
  earned_at   TIMESTAMPTZ
) LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT a.id, a.title, a.description, a.icon, a.sort_order, ua.earned_at
  FROM achievements a
  LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = p_user_id
  ORDER BY a.sort_order ASC;
$$;

-- ─── get_daily_missions ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_daily_missions()
RETURNS TABLE (
  id          TEXT,
  title       TEXT,
  description TEXT,
  icon        TEXT,
  goal        INT,
  progress    INT,
  completed   BOOLEAN
) LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT dm.id, dm.title, dm.description, dm.icon, dm.goal,
         COALESCE(udp.progress, 0) AS progress,
         COALESCE(udp.completed, FALSE) AS completed
  FROM daily_missions dm
  LEFT JOIN user_daily_progress udp
    ON udp.mission_id = dm.id AND udp.user_id = auth.uid()
       AND udp.date = (NOW() AT TIME ZONE 'Asia/Taipei')::DATE
  ORDER BY dm.goal ASC;
$$;

-- ─── submit_report v4: adds achievement checks + daily mission progress ──────────
CREATE OR REPLACE FUNCTION submit_report(
  p_lat      FLOAT,
  p_lng      FLOAT,
  p_status   TEXT,
  p_space_id UUID  DEFAULT NULL,
  p_note     TEXT  DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id         UUID := auth.uid();
  v_profile         profiles%ROWTYPE;
  v_space_id        UUID := p_space_id;
  v_space           spaces%ROWTYPE;
  v_distance_m      FLOAT;
  v_max_distance    FLOAT;
  v_rl              rate_limits%ROWTYPE;
  v_is_new          BOOLEAN := FALSE;
  v_base_weight     FLOAT;
  v_weight          FLOAT;
  v_today           DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v_high_cred_count INT;
  v_new_achievements TEXT[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;

  -- Rate limit
  INSERT INTO rate_limits (user_id) VALUES (v_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_rl FROM rate_limits WHERE user_id = v_user_id;
  IF NOW() > v_rl.hour_reset_at THEN
    UPDATE rate_limits SET reports_this_hour = 0,
      hour_reset_at = date_trunc('hour', NOW()) + INTERVAL '1 hour'
    WHERE user_id = v_user_id;
    v_rl.reports_this_hour := 0;
  END IF;
  IF v_rl.reports_this_hour >= 5 THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  -- Snap to nearest space within 25m
  IF v_space_id IS NULL THEN
    SELECT id INTO v_space_id
    FROM spaces
    WHERE ST_DWithin(location, ST_MakePoint(p_lng, p_lat)::geography, 25)
    ORDER BY ST_Distance(location, ST_MakePoint(p_lng, p_lat)::geography) ASC
    LIMIT 1;
  END IF;

  IF v_space_id IS NOT NULL THEN
    SELECT * INTO v_space FROM spaces WHERE id = v_space_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'space_not_found'); END IF;
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
        UPDATE rate_limits SET new_spaces_today = 0,
          day_reset_at = date_trunc('day', NOW()) + INTERVAL '1 day'
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

  IF v_distance_m > v_max_distance THEN
    RETURN jsonb_build_object('error', 'too_far', 'distance_m', v_distance_m);
  END IF;

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

  UPDATE spaces SET status = p_status, report_count = report_count + 1,
    last_updated = NOW(), last_reported_by = v_user_id
  WHERE id = v_space_id;

  UPDATE rate_limits SET reports_this_hour = reports_this_hour + 1 WHERE user_id = v_user_id;
  UPDATE profiles SET total_reports = total_reports + 1 WHERE id = v_user_id;

  -- Streak
  IF v_profile.last_report_date IS NULL OR v_profile.last_report_date < v_today THEN
    IF v_profile.last_report_date = v_today - 1 THEN
      UPDATE profiles SET streak_days = streak_days + 1, last_report_date = v_today WHERE id = v_user_id;
    ELSE
      UPDATE profiles SET streak_days = 1, last_report_date = v_today WHERE id = v_user_id;
    END IF;
  END IF;

  -- Consensus window
  INSERT INTO consensus_windows (space_id)
  SELECT v_space_id
  WHERE NOT EXISTS (
    SELECT 1 FROM consensus_windows
    WHERE space_id = v_space_id AND scored = FALSE AND window_end > NOW()
  );

  -- Auto-verify
  SELECT COUNT(DISTINCT user_id) INTO v_high_cred_count
  FROM reports WHERE space_id = v_space_id AND credibility_snap >= 70;
  IF v_high_cred_count >= 5 AND NOT COALESCE(v_space.verified, FALSE) THEN
    UPDATE spaces SET verified = TRUE, verified_at = NOW() WHERE id = v_space_id;
  END IF;

  -- Daily mission progress
  IF p_status = 'empty' THEN
    INSERT INTO user_daily_progress (user_id, mission_id, date, progress, completed)
    VALUES (v_user_id, 'report_empty', v_today, 1, TRUE)
    ON CONFLICT (user_id, mission_id, date) DO UPDATE
      SET progress = LEAST(user_daily_progress.progress + 1, daily_missions.goal),
          completed = TRUE
    FROM daily_missions WHERE daily_missions.id = 'report_empty';
  END IF;

  IF NOT v_is_new AND v_space_id IS NOT NULL THEN
    INSERT INTO user_daily_progress (user_id, mission_id, date, progress, completed)
    VALUES (v_user_id, 'confirm_spaces', v_today, 1, FALSE)
    ON CONFLICT (user_id, mission_id, date) DO UPDATE
      SET progress = LEAST(user_daily_progress.progress + 1,
                           (SELECT goal FROM daily_missions WHERE id = 'confirm_spaces')),
          completed = (user_daily_progress.progress + 1) >=
                      (SELECT goal FROM daily_missions WHERE id = 'confirm_spaces');
  END IF;

  IF v_is_new THEN
    INSERT INTO user_daily_progress (user_id, mission_id, date, progress, completed)
    VALUES (v_user_id, 'explore_new', v_today, 1, TRUE)
    ON CONFLICT (user_id, mission_id, date) DO NOTHING;
  END IF;

  -- Check + award achievements
  SELECT ARRAY(SELECT check_and_award_achievements(v_user_id)) INTO v_new_achievements;

  PERFORM recompute_probability(v_space_id);

  RETURN jsonb_build_object(
    'success', TRUE,
    'space_id', v_space_id,
    'is_new', v_is_new,
    'new_achievements', v_new_achievements
  );
END;
$$;
