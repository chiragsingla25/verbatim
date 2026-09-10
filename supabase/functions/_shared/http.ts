// Shared HTTP helpers for the Edge Functions.

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

// A real UUID (v4-shaped hex-and-dashes). Replaces the loose /^[0-9a-fA-F-]{36}$/ that also
// matched e.g. 36 dashes.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function jsonResponse(status: number, body: unknown, opts: { cors?: boolean } = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(opts.cors ? CORS : {}) },
  })
}
