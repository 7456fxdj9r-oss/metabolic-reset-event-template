// Generates a unique slug + secret edit_token, then inserts a new event row.
// Optionally verifies a Cloudflare Turnstile token to keep bots out of the
// Build form — set TURNSTILE_SECRET_KEY in the Edge Function env to turn
// it on. Without that env, the function happily accepts requests with no
// token (good for local dev / before Turnstile is wired up).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (const b of arr) out += alphabet[b % alphabet.length];
  return out;
}

function slugify(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'event';
}

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // Turnstile disabled — accept everything
  if (!token) return false;
  try {
    const form = new FormData();
    form.set('secret', secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form },
    );
    const data = await res.json();
    return Boolean(data && data.success);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) {
    return new Response(JSON.stringify({ error: 'name is required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip') || null;
  const passed = await verifyTurnstile(String(body.turnstile_token || ''), ip);
  if (!passed) {
    return new Response(JSON.stringify({ error: 'captcha verification failed' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const baseSlug = slugify(name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: existing } = await supabase
      .from('events').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${randomToken(3).toLowerCase()}`;
  }

  // 16 chars from a 62-symbol alphabet ≈ 95 bits of entropy. Tokens are
  // scoped to a single event slug, never indexed, and timing-safe compared,
  // so brute-force is infeasible long before that number matters. The
  // previous 32-char tokens were overkill and added 16 chars to every
  // edit/cohost link.
  const edit_token = randomToken(16);
  const { error } = await supabase.from('events').insert({
    slug,
    edit_token,
    name,
    host_line: body.host_line || null,
    accent_color: body.accent_color || '#f39c12',
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ slug, edit_token }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
