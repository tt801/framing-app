import type { User } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'

// The main app and the standalone admin app inject their own server-side
// authorization implementations. The data handlers remain a single code path.
export interface PlatformDependencies {
  // Each Vercel project installs its own Supabase SDK version. Keep this
  // narrow query-entry boundary structural instead of requiring nominal
  // compatibility between two different SupabaseClient class instances.
  getSupabaseAdmin: () => { from: (table: string) => any; rpc: any }
  requirePlatformAdmin: (req: VercelRequest) => Promise<User>
  platformAdminError: (err: unknown) => { status: number; message: string }
}
