import { createClient } from '@supabase/supabase-js';

type VercelRequest = {
  headers?: Record<string, string | undefined>;
};

const TRIAL_DAYS = 14;

type CompanyAccountRecord = {
  id: string;
  owner_user_id: string;
  trial_ends_at: string;
  plan_status: 'trialing' | 'active' | 'expired';
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

const ensureActiveTrialForUser = async (userId: string) => {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('company_accounts')
    .select('id, owner_user_id, trial_ends_at, plan_status')
    .eq('owner_user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  let record = data as CompanyAccountRecord | null;

  if (!record) {
    const now = new Date();
    const trialEnds = new Date(now);
    trialEnds.setDate(trialEnds.getDate() + TRIAL_DAYS);

    const { data: created, error: createError } = await supabase
      .from('company_accounts')
      .insert({
        owner_user_id: userId,
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnds.toISOString(),
        plan_status: 'trialing',
      })
      .select('id, owner_user_id, trial_ends_at, plan_status')
      .single();

    if (createError) {
      throw createError;
    }

    record = created as CompanyAccountRecord;
  }

  if (record.plan_status === 'active') {
    return;
  }

  const expiredByDate = new Date(record.trial_ends_at).getTime() < Date.now();
  const expiredByStatus = record.plan_status === 'expired';

  if (expiredByDate || expiredByStatus) {
    if (record.plan_status !== 'expired') {
      await supabase
        .from('company_accounts')
        .update({ plan_status: 'expired' })
        .eq('id', record.id);
    }

    throw new Error('Trial expired');
  }
};

export const requireActiveTrialUserId = async (req: VercelRequest): Promise<string> => {
  const userId = await requireAuthenticatedUserId(req);
  await ensureActiveTrialForUser(userId);
  return userId;
};
