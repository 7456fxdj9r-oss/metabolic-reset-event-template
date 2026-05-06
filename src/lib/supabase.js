// Tiny fetch-based Supabase client. No SDK dependency — keeps the bundle
// small. Reads (RLS allows public SELECT). Writes go through Edge Functions
// that verify the supplied edit_token; see docs/SUPABASE_SETUP.md.

const URL_VAR = 'PUBLIC_SUPABASE_URL';
const KEY_VAR = 'PUBLIC_SUPABASE_ANON_KEY';

function envFromImportMeta() {
  // Astro inlines PUBLIC_* vars at build/dev time via import.meta.env.
  // Fallback to window for runtime injection during local hacking.
  const meta = (import.meta && import.meta.env) || {};
  return {
    url: meta[URL_VAR] || (typeof window !== 'undefined' && window[URL_VAR]) || '',
    anonKey: meta[KEY_VAR] || (typeof window !== 'undefined' && window[KEY_VAR]) || '',
  };
}

export function isConfigured() {
  const { url, anonKey } = envFromImportMeta();
  return Boolean(url && anonKey);
}

export function getConfig() {
  return envFromImportMeta();
}

async function request(path, init = {}) {
  const { url, anonKey } = envFromImportMeta();
  if (!url || !anonKey) {
    throw new Error(
      `Supabase not configured. Set ${URL_VAR} and ${KEY_VAR} in .env. ` +
      `See docs/SUPABASE_SETUP.md.`
    );
  }
  const res = await fetch(url + path, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + anonKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function fetchHubBySlug(slug) {
  const rows = await request(
    `/rest/v1/hubs?slug=eq.${encodeURIComponent(slug)}&select=*`
  );
  return rows[0] || null;
}

export async function fetchTransformations(hubId) {
  return request(
    `/rest/v1/transformations?hub_id=eq.${hubId}&select=*&order=display_order.asc`
  );
}

export async function fetchTransformationBySlug(hubId, tslug) {
  const rows = await request(
    `/rest/v1/transformations?hub_id=eq.${hubId}&slug=eq.${encodeURIComponent(tslug)}&select=*`
  );
  return rows[0] || null;
}

export async function fetchDataPoints(transformationId) {
  return request(
    `/rest/v1/data_points?transformation_id=eq.${transformationId}&select=metric,date,value&order=date.asc`
  );
}

// Calls a Supabase Edge Function (writes go here so the function can verify
// the edit_token). See docs/SUPABASE_SETUP.md for the function templates.
export async function callFunction(name, body) {
  return request(`/functions/v1/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
