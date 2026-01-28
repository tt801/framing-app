import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Supabase credentials not configured. Multi-tenant features will not work.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper to get current user
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

// Helper to get user's API credentials
export const getUserCredentials = async (userId: string) => {
  const { data, error } = await supabase
    .from('user_api_credentials')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching credentials:', error);
  }

  return data;
};

// Helper to save user's API credentials
export const saveUserCredentials = async (userId: string, credentials: any) => {
  const { data, error } = await supabase
    .from('user_api_credentials')
    .upsert({
      user_id: userId,
      ...credentials,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error('Error saving credentials:', error);
    throw error;
  }

  return data;
};
