/* Is this request him? (2026-10-04)

   The platform's JWT check is not an access control here: the gateway also
   accepts the publishable key, and that key ships in the public bundle, so
   "JWT on" let anyone read the calendar. The auth users are shared with his
   other apps too, so a valid session is not enough either. This asks for his
   session, by email. MC_OWNER_EMAIL is a Supabase secret, not in this repo. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const OWNER_EMAIL = Deno.env.get('MC_OWNER_EMAIL') ?? ''

export async function isOwner(req: Request): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!OWNER_EMAIL || !token) return false
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data } = await sb.auth.getUser(token)
  return data.user?.email === OWNER_EMAIL
}
