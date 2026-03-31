import { createClient } from '@supabase/supabase-js';

type VercelRequest = {
  headers?: Record<string, string | undefined>;
};

const createSupabaseServerClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase not configured');
  }

  return createClient(url, serviceRoleKey);
};

export const getBearerToken = (req: VercelRequest): string | null => {
  const header = req?.headers?.authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
};

export const requireAuthenticatedUserId = async (req: VercelRequest): Promise<string> => {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error('Missing bearer token');
  }

  const supabase = createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error('Invalid or expired token');
  }

  return user.id;
};
