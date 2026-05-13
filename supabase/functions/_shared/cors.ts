// CORS preflight handling shared across every Edge Function. The
// frontend always calls these via fetch from a different origin
// (GH Pages / Cloudflare Pages → *.supabase.co), so the preflight
// reply MUST include the headers below for the browser to allow the
// real POST through.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Returns a 200 'ok' preflight response when the request is OPTIONS,
// otherwise null so the caller can continue with its real handler.
export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return null;
}
