import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client with service role key (for API endpoints)
export const createSupabaseServerClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase credentials not configured on server');
  }

  return createClient(url, serviceRoleKey);
};

// Get user's API credentials from database
export const getUserApiCredentials = async (userId: string) => {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('user_api_credentials')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No credentials found
      return null;
    }
    throw error;
  }

  return data;
};

// Verify user token and get their ID
export const verifyUserToken = async (token: string) => {
  const supabase = createSupabaseServerClient();

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error('Invalid or expired token');
  }

  return user;
};
