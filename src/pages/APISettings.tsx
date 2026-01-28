import React, { useState, useEffect } from 'react';
import { useToast } from '@/lib/toast';
import { supabase, getCurrentUser, getUserCredentials, saveUserCredentials } from '@/lib/supabase';

export default function APISettingsPage() {
  const { add: toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState({
    twilio_account_sid: '',
    twilio_auth_token: '',
    twilio_whatsapp_number: '',
    mailchimp_api_key: '',
    mailchimp_server: '',
    microsoft_client_id: '',
    microsoft_client_secret: '',
    microsoft_tenant_id: '',
    outlook_from_email: '',
  });

  useEffect(() => {
    const loadUserAndCredentials = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          window.location.hash = '#/login';
          return;
        }
        
        setUser(currentUser);
        
        const userCreds = await getUserCredentials(currentUser.id);
        if (userCreds) {
          setCredentials(userCreds);
        }
      } catch (error) {
        console.error('Error loading credentials:', error);
        toast('Failed to load API settings');
      } finally {
        setLoading(false);
      }
    };

    loadUserAndCredentials();
  }, []);

  const handleChange = (field: string, value: string) => {
    setCredentials(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (!user) return;

    try {
      setSaving(true);
      await saveUserCredentials(user.id, credentials);
      toast('API credentials saved successfully!');
    } catch (error) {
      console.error('Error saving credentials:', error);
      toast('Failed to save API credentials');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-600">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="pb-6 border-b border-slate-200">
        <h1 className="text-3xl font-bold text-slate-900 mb-1">🔑 API Settings</h1>
        <p className="text-sm text-slate-600">
          Configure your API credentials for WhatsApp, Email, and Marketing integrations.
        </p>
      </header>

      <div className="grid gap-8 max-w-2xl">
        {/* Twilio Section */}
        <section className="rounded-lg border border-slate-200 p-6 bg-white">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">WhatsApp (Twilio)</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Account SID
              </label>
              <input
                type="text"
                placeholder="Your Twilio Account SID"
                value={credentials.twilio_account_sid}
                onChange={(e) => handleChange('twilio_account_sid', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Auth Token
              </label>
              <input
                type="password"
                placeholder="Your Auth Token"
                value={credentials.twilio_auth_token}
                onChange={(e) => handleChange('twilio_auth_token', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                WhatsApp Number
              </label>
              <input
                type="text"
                placeholder="+1234567890"
                value={credentials.twilio_whatsapp_number}
                onChange={(e) => handleChange('twilio_whatsapp_number', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Mailchimp Section */}
        <section className="rounded-lg border border-slate-200 p-6 bg-white">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Email Marketing (Mailchimp)</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                API Key
              </label>
              <input
                type="password"
                placeholder="Your Mailchimp API Key"
                value={credentials.mailchimp_api_key}
                onChange={(e) => handleChange('mailchimp_api_key', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Server (e.g., us1, us5)
              </label>
              <input
                type="text"
                placeholder="us1"
                value={credentials.mailchimp_server}
                onChange={(e) => handleChange('mailchimp_server', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Microsoft/Outlook Section */}
        <section className="rounded-lg border border-slate-200 p-6 bg-white">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Email (Microsoft/Outlook)</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Client ID
              </label>
              <input
                type="text"
                placeholder="Your Microsoft Client ID"
                value={credentials.microsoft_client_id}
                onChange={(e) => handleChange('microsoft_client_id', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Client Secret
              </label>
              <input
                type="password"
                placeholder="Your Client Secret"
                value={credentials.microsoft_client_secret}
                onChange={(e) => handleChange('microsoft_client_secret', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tenant ID
              </label>
              <input
                type="text"
                placeholder="Your Tenant ID"
                value={credentials.microsoft_tenant_id}
                onChange={(e) => handleChange('microsoft_tenant_id', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                From Email Address
              </label>
              <input
                type="email"
                placeholder="noreply@yourcompany.com"
                value={credentials.outlook_from_email}
                onChange={(e) => handleChange('outlook_from_email', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-lg bg-blue-600 text-white px-4 py-3 font-medium hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition"
        >
          {saving ? 'Saving...' : 'Save API Credentials'}
        </button>

        {/* Info Box */}
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
          <p className="text-sm text-blue-800">
            💡 Your API credentials are encrypted and stored securely. Only you can see and use them.
          </p>
        </div>
      </div>
    </div>
  );
}
