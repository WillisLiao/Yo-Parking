import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Called by pg_cron every 2 minutes to score closed consensus windows
serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Find all closed, unscored windows
  const { data: windows } = await supabase
    .from('consensus_windows')
    .select('id, space_id, window_start, window_end')
    .eq('scored', false)
    .lt('window_end', new Date().toISOString())
    .limit(50);

  if (!windows?.length) return new Response('no windows', { status: 200 });

  for (const win of windows) {
    await scoreWindow(supabase, win);
  }

  return new Response(JSON.stringify({ scored: windows.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function scoreWindow(
  supabase: ReturnType<typeof createClient>,
  win: { id: string; space_id: string; window_start: string; window_end: string },
) {
  const { data: reports } = await supabase
    .from('reports')
    .select('id, user_id, reported_status, credibility_snap, created_at')
    .eq('space_id', win.space_id)
    .gte('created_at', win.window_start)
    .lte('created_at', win.window_end);

  if (!reports?.length) {
    await supabase.from('consensus_windows').update({ scored: true }).eq('id', win.id);
    return;
  }

  // Determine consensus (weighted majority)
  let emptyWeight = 0;
  let occupiedWeight = 0;

  for (const r of reports) {
    const w = r.credibility_snap / 100;
    if (r.reported_status === 'empty') emptyWeight += w;
    else occupiedWeight += w;
  }

  // Need minimum 2 reporters for any scoring to happen
  if (reports.length < 2) {
    await supabase.from('consensus_windows').update({ scored: true }).eq('id', win.id);
    return;
  }

  const consensusStatus = emptyWeight >= occupiedWeight ? 'empty' : 'occupied';

  // Score each reporter
  const windowStartMs = new Date(win.window_start).getTime();

  for (const report of reports) {
    const reportAgeMs = new Date(report.created_at).getTime() - windowStartMs;
    const reportAgeMins = reportAgeMs / 60_000;

    // Time-gap multiplier: how much credibility change this report gets
    const timeMultiplier = timePenaltyMultiplier(reportAgeMins);

    const matchesConsensus = report.reported_status === consensusStatus;
    let credibilityDelta = 0;
    let consensusResult: string;

    if (matchesConsensus) {
      // Reward decreases as time gap grows (later confirms are worth less)
      credibilityDelta = 2.0 * (1 - timeMultiplier * 0.5);
      consensusResult = 'correct';
    } else {
      // Penalty shrinks with time gap — space may have changed
      credibilityDelta = -3.0 * timeMultiplier;
      consensusResult = timeMultiplier < 0.1 ? 'expired' : 'wrong';
    }

    // Apply credibility change, clamped to [0, 100]
    const { data: profile } = await supabase
      .from('profiles')
      .select('credibility, confirmed_reports, false_reports')
      .eq('id', report.user_id)
      .single();

    if (!profile) continue;

    const newCredibility = Math.max(0, Math.min(100, profile.credibility + credibilityDelta));
    const newBadge = credibilityToBadge(newCredibility);

    await supabase.from('profiles').update({
      credibility: newCredibility,
      badge: newBadge,
      confirmed_reports: matchesConsensus
        ? profile.confirmed_reports + 1
        : profile.confirmed_reports,
      false_reports: !matchesConsensus && credibilityDelta < 0
        ? profile.false_reports + 1
        : profile.false_reports,
    }).eq('id', report.user_id);

    await supabase.from('reports').update({
      confirmed: matchesConsensus,
      consensus_result: consensusResult,
      scored_at: new Date().toISOString(),
    }).eq('id', report.id);
  }

  await supabase.from('consensus_windows').update({ scored: true }).eq('id', win.id);
}

// Returns 0–1: how much weight to apply to the penalty/reward
// 0 = no effect (report is old, space likely changed)
// 1 = full effect (report is very recent, likely intentional)
function timePenaltyMultiplier(ageMinutes: number): number {
  if (ageMinutes < 5)  return 1.0;
  if (ageMinutes < 15) return 0.5;
  if (ageMinutes < 30) return 0.15;
  return 0.0;
}

function credibilityToBadge(score: number): string {
  if (score >= 100) return 'guardian';
  if (score >= 81)  return 'expert';
  if (score >= 61)  return 'reliable';
  if (score >= 31)  return 'regular';
  return 'newbie';
}
