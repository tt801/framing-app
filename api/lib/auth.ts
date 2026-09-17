import { createClient } from '@supabase/supabase-js';

type VercelRequest = { headers?: Record<string, string | string[] | undefined>; body?: unknown };
export type CompanyWriteAccess = { userId: string; companyAccountId: string; role: string };
type CompanyAccount = { id: string; owner_user_id: string; trial_ends_at: string | null; plan_status: string; stripe_price_id?: string | null };
type Membership = { company_account_id: string; role: string; status: string };

const createSupabaseServerClient = () => {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
};

export const getBearerToken = (req: VercelRequest): string | null => {
  const header = req?.headers?.authorization; const value = Array.isArray(header) ? header[0] : header;
  if (!value || typeof value !== 'string') return null;
  const [scheme, token] = value.split(' '); return scheme === 'Bearer' && token ? token : null;
};

const requestedCompanyId = (req: VercelRequest): string | null => {
  const header = req.headers?.['x-company-account-id'];
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : req.body || {};
  return (Array.isArray(header) ? header[0] : header) || (body as any).companyAccountId || null;
};

export const requireAuthenticatedUserId = async (req: VercelRequest): Promise<string> => {
  const token = getBearerToken(req); if (!token) throw new Error('Missing bearer token');
  const supabase = createSupabaseServerClient(); const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired token'); return user.id;
};

export const requireCompanyWriteAccess = async (req: VercelRequest): Promise<CompanyWriteAccess> => {
  const userId = await requireAuthenticatedUserId(req); const supabase = createSupabaseServerClient();
  const [{ data: owned, error: ownedError }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase.from('company_accounts').select('id, owner_user_id, trial_ends_at, plan_status, stripe_price_id').eq('owner_user_id', userId),
    supabase.from('company_members').select('company_account_id, role, status').eq('user_id', userId).eq('status', 'active'),
  ]);
  if (ownedError || membershipError) throw new Error('Company authorization lookup failed');
  const contexts = new Map<string, { role: string }>();
  for (const account of (owned || []) as CompanyAccount[]) contexts.set(account.id, { role: 'owner' });
  for (const member of (memberships || []) as Membership[]) if (!contexts.has(member.company_account_id)) contexts.set(member.company_account_id, { role: member.role });
  if (!contexts.size) throw new Error('No active company access');
  const selected = requestedCompanyId(req);
  if (contexts.size > 1 && !selected) throw new Error('Company selection required');
  const companyAccountId = selected || [...contexts.keys()][0]; const context = contexts.get(companyAccountId);
  if (!context) throw new Error('Unauthorized company access');
  const { data: account, error: accountError } = await supabase.from('company_accounts').select('id, owner_user_id, trial_ends_at, plan_status, stripe_price_id').eq('id', companyAccountId).single();
  if (accountError || !account) throw new Error('Company authorization lookup failed');
  const record = account as CompanyAccount;
  if (record.stripe_price_id === 'founder_lifetime' || record.plan_status === 'active') return { userId, companyAccountId, role: context.role };
  if (record.plan_status === 'past_due') throw new Error('Account is read-only');
  if (record.plan_status !== 'trialing' || !record.trial_ends_at || new Date(record.trial_ends_at).getTime() <= Date.now()) throw new Error('Trial expired');
  return { userId, companyAccountId, role: context.role };
};

export const requireActiveTrialUserId = async (req: VercelRequest): Promise<string> => (await requireCompanyWriteAccess(req)).userId;
