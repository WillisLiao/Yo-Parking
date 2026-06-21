import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Runs daily via pg_cron. Detects persistent false reporters and caps their weight.
serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Find users with > 55% contradiction rate over 10+ reports
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, total_reports, false_reports, report_weight_cap')
    .gt('total_reports', 10);

  if (!profiles?.length) return new Response('no profiles', { status: 200 });

  let capped = 0;
  let restored = 0;

  for (const p of profiles) {
    const rate = p.false_reports / p.total_reports;

    if (rate > 0.55 && p.report_weight_cap > 0.2) {
      // Cap persistent bad actor silently
      await supabase.from('profiles').update({ report_weight_cap: 0.2 }).eq('id', p.id);
      capped++;
    } else if (rate < 0.3 && p.report_weight_cap < 1.0) {
      // Restore good standing if they've improved
      await supabase.from('profiles').update({ report_weight_cap: 1.0 }).eq('id', p.id);
      restored++;
    }
  }

  return new Response(JSON.stringify({ capped, restored }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
