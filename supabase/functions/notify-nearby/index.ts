import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ────────────────────────────────────────────────────────────────────────────
// Triggered via a Supabase Database Webhook on `spaces` UPDATE.
// When a space transitions into "likely empty" (probability crosses the 0.65
// threshold upward), push a notification to users whose saved location is within
// range. Wiring (Dashboard → Database → Webhooks):
//   Table: spaces · Events: UPDATE · Type: HTTP Request
//   URL: https://<project>.functions.supabase.co/notify-nearby
//   Header: Authorization: Bearer <SERVICE_ROLE_KEY>
// ────────────────────────────────────────────────────────────────────────────

const EMPTY_THRESHOLD = 0.65;

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  record: { id: string; probability: number; status: string } | null;
  old_record: { probability: number } | null;
}

serve(async (req) => {
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad payload', { status: 400 });
  }

  const record = payload.record;
  if (!record) return new Response('no record', { status: 200 });

  const newProb = record.probability ?? 0;
  const oldProb = payload.old_record?.probability ?? 0;

  // Only fire on an upward crossing of the threshold — avoids spamming on every
  // report once a space is already known-empty.
  const crossedUp = oldProb < EMPTY_THRESHOLD && newProb >= EMPTY_THRESHOLD;
  if (!crossedUp) {
    return new Response(JSON.stringify({ skipped: 'no upward crossing' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: targets, error } = await supabase.rpc('users_to_notify', {
    p_space_id: record.id,
  });

  if (error) {
    console.error('users_to_notify failed', error);
    return new Response('rpc error', { status: 500 });
  }
  if (!targets?.length) {
    return new Response(JSON.stringify({ notified: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Expo accepts up to 100 messages per push request.
  const messages = (targets as { token: string }[]).map((t) => ({
    to: t.token,
    sound: 'default',
    title: '附近有空位了！🛵',
    body: '你儲存的地點附近出現空的機車格，快去看看！',
    data: { spaceId: record.id },
    channelId: 'default',
  }));

  const chunks: typeof messages[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
  }

  return new Response(JSON.stringify({ notified: messages.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
