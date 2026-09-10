// Entrypoint: wire the real deps and serve. Deploy WITH jwt verification (default):
//   supabase functions deploy ingest-trigger
// Required secrets (already set for ingest-dispatch): GITHUB_DISPATCH_TOKEN,
// GITHUB_DISPATCH_REPO. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
// are auto-injected.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { dispatchToGitHub } from '../_shared/github.ts'
import { type AdminClient, buildHandler, type Caller } from './handler.ts'

const env = (k: string): string | undefined => Deno.env.get(k)

const admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
}) as unknown as AdminClient

// Resolve the signed-in caller from the request's bearer token, plus their profiles.role.
async function getCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null

  const url = env('SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY')
  if (!url || !anon) return null

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) return null

  // deno-lint-ignore no-explicit-any
  const { data: prof } = await (admin as any)
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle()
  return { id: data.user.id, role: (prof?.role as string | undefined) ?? 'student' }
}

Deno.serve(buildHandler({ env, admin, getCaller, dispatch: dispatchToGitHub }))
