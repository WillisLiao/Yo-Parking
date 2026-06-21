import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Triggered via Supabase Database Webhook on reports INSERT
serve(async (req) => {
  const { space_id } = await req.json();
  if (!space_id) return new Response('missing space_id', { status: 400 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: reports, error } = await supabase
    .from('reports')
    .select('reported_status, credibility_snap, weight, created_at')
    .eq('space_id', space_id)
    .gte('created_at', twoHoursAgo)
    .order('created_at', { ascending: false });

  if (error || !reports?.length) {
    // No recent reports — reset to neutral
    await supabase.from('spaces').update({ probability: 0.5 }).eq('id', space_id);
    return new Response('ok', { status: 200 });
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const report of reports) {
    const hoursOld =
      (Date.now() - new Date(report.created_at).getTime()) / 3_600_000;
    // Time decay: halves every ~1 hour
    const timeDecay = Math.exp(-0.7 * hoursOld);
    const reportWeight = (report.credibility_snap / 100) * timeDecay * report.weight;
    const vote = report.reported_status === 'empty' ? 1 : 0;

    weightedSum += vote * reportWeight;
    totalWeight += reportWeight;
  }

  const probability = totalWeight === 0 ? 0.5 : weightedSum / totalWeight;

  await supabase
    .from('spaces')
    .update({ probability: Math.round(probability * 100) / 100 })
    .eq('id', space_id);

  return new Response(JSON.stringify({ probability }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
