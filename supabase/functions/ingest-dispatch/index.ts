// Entrypoint: wire the real deps and serve. Deploy with:
//   supabase functions deploy ingest-dispatch --no-verify-jwt
// Required secrets (supabase secrets set): STORAGE_WEBHOOK_SECRET, GITHUB_DISPATCH_TOKEN,
// GITHUB_DISPATCH_REPO. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { type AdminClient, buildHandler, dispatchToGitHub } from './handler.ts'

const env = (k: string): string | undefined => Deno.env.get(k)

const admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
}) as unknown as AdminClient

Deno.serve(buildHandler({ env, admin, dispatch: dispatchToGitHub }))
