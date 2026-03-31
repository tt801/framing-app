/* eslint-disable @typescript-eslint/no-explicit-any */
// src/components/admin/AdminIntegrationsPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useCatalog } from "@/lib/store";
import { useToast } from "@/lib/toast";
import { getAccessToken } from "@/lib/supabase";

type ProviderKey = "quickbooks" | "xero" | "marketing-automation";

interface ProviderConfig {
  key: ProviderKey;
  label: string;
  tagline: string;
  description: string;
  docsUrl: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    key: "quickbooks",
    label: "QuickBooks Online",
    tagline: "Sync invoices directly to your QuickBooks company.",
    description:
      "When connected, you can send invoices from FrameIT into QuickBooks with a single click on the Invoices page.",
    docsUrl: "https://quickbooks.intuit.com/",
  },
  {
    key: "xero",
    label: "Xero",
    tagline: "Sync invoices to your Xero organisation.",
    description:
      "Use Xero for accounting? Connect here and later we can add a 'Send to Xero' button on the Invoices page.",
    docsUrl: "https://www.xero.com/",
  },
  {
    key: "marketing-automation",
    label: "Marketing Automation",
    tagline: "Automate review requests and quote follow-ups via WhatsApp, Email, or Mailchimp.",
    description:
      "Send automated campaigns via WhatsApp (Twilio), Outlook Email (Microsoft Graph), or Mailchimp. Requires API credentials.",
    docsUrl: "/AUTOMATION_SETUP.md",
  },
];

type ConnectionStatus = "connected" | "disconnected" | "pending" | "error";

interface IntegrationState {
  enabled?: boolean;
  connectionStatus?: ConnectionStatus;
  lastConnectedAt?: string;
  provider?: string;
  realmId?: string; // QuickBooks
  orgId?: string; // Xero
  lastError?: string | null;
  // you can extend this with whatever your backend returns
  [key: string]: any;
}

type IntegrationsSettings = {
  [P in ProviderKey]?: IntegrationState;
};

type LoadingMap = Record<ProviderKey, boolean>;

const AdminIntegrationsPanel: React.FC = () => {
  const { catalog, updateSettings, setCatalog, set } = useCatalog() as any;
  const { add: toast } = useToast();

  const settings = catalog?.settings || {};
  const initialIntegrations = useMemo<IntegrationsSettings>(() => {
    return (settings.integrations as IntegrationsSettings) || {};
  }, [settings.integrations]);

  const [integrations, setIntegrations] = useState<IntegrationsSettings>(
    initialIntegrations
  );
  const [loading, setLoading] = useState<LoadingMap>({
    quickbooks: false,
    xero: false,
    "marketing-automation": false,
  });
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Keep local state in sync if settings change elsewhere
  useEffect(() => {
    setIntegrations(initialIntegrations);
  }, [initialIntegrations]);

  const saveSettings = (nextIntegrations: IntegrationsSettings) => {
    const nextSettings = {
      ...settings,
      integrations: nextIntegrations,
    };

    try {
      if (typeof updateSettings === "function") {
        updateSettings(nextSettings);
      } else if (typeof setCatalog === "function") {
        setCatalog((prev: any) => ({
          ...(prev || {}),
          settings: nextSettings,
        }));
      } else if (typeof set === "function") {
        set((prev: any) => ({
          ...(prev || {}),
          settings: nextSettings,
        }));
      } else {
        console.warn(
          "[AdminIntegrationsPanel] No catalog update fn; integrations will not persist."
        );
      }
    } catch (err) {
      console.error("Failed to save integrations settings:", err);
    }
  };

  const setProviderLoading = (provider: ProviderKey, value: boolean) => {
    setLoading((prev) => ({ ...prev, [provider]: value }));
  };

  const upsertIntegration = (
    provider: ProviderKey,
    patch: Partial<IntegrationState>
  ) => {
    setIntegrations((prev) => {
      const existing = prev[provider] || {};
      const nextProviderState: IntegrationState = {
        ...existing,
        ...patch,
        provider,
      };
      const next: IntegrationsSettings = {
        ...prev,
        [provider]: nextProviderState,
      };
      // Persist to catalog settings
      saveSettings(next);
      return next;
    });
  };

  const refreshFromServer = async (provider: ProviderKey) => {
    if (typeof fetch === "undefined") {
      console.warn("fetch is not available; cannot call /status.");
      return;
    }

    setProviderLoading(provider, true);
    setGlobalError(null);
    setGlobalMessage(null);

    try {
      const res = await fetch(`/api/integrations/${provider}/status`, {
        method: "GET",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text || `Status endpoint returned HTTP ${res.status}`
        );
      }

      const data = (await res.json().catch(() => ({}))) as any;

      upsertIntegration(provider, {
        enabled: data.enabled ?? true,
        connectionStatus:
          (data.connectionStatus as ConnectionStatus) ?? "connected",
        realmId: data.realmId ?? data.companyId ?? undefined,
        orgId: data.orgId ?? data.tenantId ?? undefined,
        lastConnectedAt:
          data.lastConnectedAt ??
          data.updatedAt ??
          new Date().toISOString(),
        lastError: data.lastError ?? null,
      });

      setGlobalMessage(
        `${providerLabel(provider)} status refreshed from server.`
      );
    } catch (err: any) {
      console.error(`Failed to refresh ${provider} status:`, err);
      setGlobalError(
        err?.message ||
          `Failed to refresh ${providerLabel(provider)} status.`
      );
      upsertIntegration(provider, {
        connectionStatus: "error",
        lastError: err?.message ?? String(err),
      });
    } finally {
      setProviderLoading(provider, false);
    }
  };

  const connectProvider = async (provider: ProviderKey) => {
    if (typeof fetch === "undefined") {
      console.warn("fetch is not available; cannot call /connect.");
      return;
    }

    setProviderLoading(provider, true);
    setGlobalError(null);
    setGlobalMessage(null);

    try {
      const res = await fetch(
        `/api/integrations/${provider}/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text || `Connect endpoint returned HTTP ${res.status}`
        );
      }

      const data = (await res.json().catch(() => ({}))) as any;

      upsertIntegration(provider, {
        enabled: true,
        connectionStatus:
          (data.connectionStatus as ConnectionStatus) ?? "connected",
        realmId: data.realmId ?? data.companyId ?? undefined,
        orgId: data.orgId ?? data.tenantId ?? undefined,
        lastConnectedAt: new Date().toISOString(),
        lastError: null,
      });

      setGlobalMessage(
        `${providerLabel(provider)} connected successfully.`
      );
    } catch (err: any) {
      console.error(`Failed to connect ${provider}:`, err);
      setGlobalError(
        err?.message ||
          `Failed to connect ${providerLabel(provider)}.`
      );
      upsertIntegration(provider, {
        enabled: false,
        connectionStatus: "error",
        lastError: err?.message ?? String(err),
      });
    } finally {
      setProviderLoading(provider, false);
    }
  };

  const disconnectProvider = async (provider: ProviderKey) => {
    if (typeof fetch === "undefined") {
      console.warn("fetch is not available; cannot call /disconnect.");
      return;
    }

    const ok = window.confirm(
      `Disconnect ${providerLabel(
        provider
      )}? You can reconnect later.`
    );
    if (!ok) return;

    setProviderLoading(provider, true);
    setGlobalError(null);
    setGlobalMessage(null);

    try {
      const res = await fetch(
        `/api/integrations/${provider}/disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text || `Disconnect endpoint returned HTTP ${res.status}`
        );
      }

      upsertIntegration(provider, {
        enabled: false,
        connectionStatus: "disconnected",
        lastError: null,
      });

      setGlobalMessage(
        `${providerLabel(provider)} disconnected.`
      );
    } catch (err: any) {
      console.error(`Failed to disconnect ${provider}:`, err);
      setGlobalError(
        err?.message ||
          `Failed to disconnect ${providerLabel(provider)}.`
      );
      upsertIntegration(provider, {
        connectionStatus: "error",
        lastError: err?.message ?? String(err),
      });
    } finally {
      setProviderLoading(provider, false);
    }
  };

  const providerLabel = (key: ProviderKey) =>
    PROVIDERS.find((p) => p.key === key)?.label ?? key;

  const statusText = (state?: IntegrationState): string => {
    const st = state?.connectionStatus ?? "disconnected";
    switch (st) {
      case "connected":
        return "Connected";
      case "pending":
        return "Pending authorisation";
      case "error":
        return "Error";
      default:
        return "Disconnected";
    }
  };

  const statusBadgeClass = (state?: IntegrationState): string => {
    const st = state?.connectionStatus ?? "disconnected";
    switch (st) {
      case "connected":
        return "bg-emerald-50 text-emerald-700 ring-emerald-200";
      case "pending":
        return "bg-amber-50 text-amber-700 ring-amber-200";
      case "error":
        return "bg-rose-50 text-rose-700 ring-rose-200";
      default:
        return "bg-slate-50 text-slate-600 ring-slate-200";
    }
  };

  return (
    <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 md:p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg md:text-xl font-semibold">
            Accounting integrations
          </h2>
          <p className="text-xs md:text-sm text-slate-500">
            Connect FrameIT to your accounting system. Once connected,
            you can send invoices directly from the Invoices page.
          </p>
        </div>
      </header>

      {globalMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {globalMessage}
        </div>
      )}
      {globalError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {globalError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const state = integrations[provider.key];
          const isLoading = loading[provider.key];
          const isConnected = state?.connectionStatus === "connected";
          const hasError = state?.connectionStatus === "error";

          return (
            <article
              key={provider.key}
              className="rounded-2xl ring-1 ring-slate-200 bg-slate-50/40 p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">
                    {provider.label}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {provider.tagline}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${statusBadgeClass(
                    state
                  )}`}
                >
                  <span className="mr-1 h-1.5 w-1.5 rounded-full bg-current" />
                  {statusText(state)}
                </span>
              </div>

              <p className="text-xs text-slate-600">
                {provider.description}{" "}
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-800 underline underline-offset-2"
                >
                  Learn more
                </a>
                .
              </p>

              {state?.lastConnectedAt && (
                <p className="text-[11px] text-slate-500">
                  Last connected:{" "}
                  {new Date(
                    state.lastConnectedAt
                  ).toLocaleString()}
                </p>
              )}

              {state?.lastError && hasError && (
                <p className="text-[11px] text-rose-600">
                  Last error: {state.lastError}
                </p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-2">
                {!isConnected ? (
                  <button
                    type="button"
                    onClick={() => connectProvider(provider.key)}
                    disabled={isLoading}
                    className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black disabled:opacity-50"
                  >
                    {isLoading ? "Connecting…" : "Connect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => disconnectProvider(provider.key)}
                    disabled={isLoading}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {isLoading ? "Disconnecting…" : "Disconnect"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => refreshFromServer(provider.key)}
                  disabled={isLoading}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {isLoading ? "Refreshing…" : "Refresh status"}
                </button>
              </div>

              {provider.key === "quickbooks" && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Note: QuickBooks app credentials (client ID/secret)
                  live on the server. This panel just manages the
                  connection and displays status.
                </p>
              )}
              {provider.key === "xero" && (
                <p className="mt-1 text-[11px] text-slate-500">
                  When you’re ready, we can add a “Send to Xero”
                  button on the Invoices page using this connection.
                </p>
              )}              {provider.key === "marketing-automation" && (
                <MarketingAutomationConfig
                  state={state}
                  upsertIntegration={upsertIntegration}
                  toast={toast}
                />
              )}            </article>
          );
        })}
      </div>
    </section>
  );
};

/* Marketing Automation Configuration Component */
interface MarketingAutomationConfigProps {
  state?: IntegrationState;
  upsertIntegration: (provider: ProviderKey, patch: Partial<IntegrationState>) => void;
  toast: (message: string, type: "success" | "error" | "warning" | "info") => void;
}

const MarketingAutomationConfig: React.FC<MarketingAutomationConfigProps> = ({
  state,
  upsertIntegration,
  toast,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState({
    channel: (state?.channel as "whatsapp" | "email" | "mailchimp") || "email",
    reviewRequestEnabled: state?.reviewRequestEnabled !== false,
    quoteFollowupEnabled: state?.quoteFollowupEnabled !== false,
    twilioConfigured: !!state?.twilioConfigured,
    microsoftConfigured: !!state?.microsoftConfigured,
    mailchimpConfigured: !!state?.mailchimpConfigured,
  });

  const [showEnvGuide, setShowEnvGuide] = useState(false);

  const updateConfig = (updates: Partial<typeof config>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    upsertIntegration("marketing-automation", newConfig);
  };

  const testAPI = async (type: "review" | "followup") => {
    try {
      const token = await getAccessToken();
      if (!token) {
        toast("Please sign in before testing automations.", "error");
        return;
      }

      const endpoint =
        type === "review"
          ? "/api/automations/send-review-request"
          : "/api/automations/send-quote-followup";

      const testData =
        type === "review"
          ? {
              customerName: "Test Customer",
              customerEmail: "test@example.com",
              customerPhone: "+1234567890",
              jobCompletedDate: new Date().toISOString(),
              channel: config.channel,
              reviewLinks: {
                google: "https://g.page/r/test",
                facebook: "https://facebook.com/test",
              },
            }
          : {
              customerName: "Test Customer",
              customerEmail: "test@example.com",
              customerPhone: "+1234567890",
              quotedItem: "Sample Frame",
              quoteDate: new Date().toISOString(),
              daysOld: 7,
              channel: config.channel,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(testData),
      });

      const result = await response.json();

      if (response.ok) {
        toast(`✓ Test ${type === "review" ? "review request" : "quote follow-up"} sent successfully!`, "success");
        // Mark the appropriate API as configured
        if (config.channel === "whatsapp") {
          updateConfig({ twilioConfigured: true });
        } else if (config.channel === "email") {
          updateConfig({ microsoftConfigured: true });
        } else if (config.channel === "mailchimp") {
          updateConfig({ mailchimpConfigured: true });
        }
      } else {
        toast(result.error || "Test failed. Check API configuration in environment variables.", "error");
      }
    } catch {
      toast("Test failed. Make sure serverless functions are deployed and environment variables are set.", "error");
    }
  };

  const viewLogs = () => {
    const automationLogs = localStorage.getItem("marketing.automation.logs.v1");
    if (automationLogs) {
      const logs = JSON.parse(automationLogs);
      console.table(logs);
      toast(`${logs.length} automation logs found. Check browser console.`, "info");
    } else {
      toast("No automation logs found yet.", "info");
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
      >
        {expanded ? "▼ Hide Configuration" : "▶ Show Configuration & Setup Guide"}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          {/* Channel Selection */}
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-2">Preferred Channel</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="marketing-channel"
                  value="email"
                  checked={config.channel === "email"}
                  onChange={(e) => updateConfig({ channel: e.target.value as "email" })}
                  className="w-4 h-4"
                />
                <span className="text-xs">
                  📧 Email (Outlook) {config.microsoftConfigured && <span className="text-green-600">✓</span>}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="marketing-channel"
                  value="whatsapp"
                  checked={config.channel === "whatsapp"}
                  onChange={(e) => updateConfig({ channel: e.target.value as "whatsapp" })}
                  className="w-4 h-4"
                />
                <span className="text-xs">
                  💬 WhatsApp (Twilio) {config.twilioConfigured && <span className="text-green-600">✓</span>}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="marketing-channel"
                  value="mailchimp"
                  checked={config.channel === "mailchimp"}
                  onChange={(e) => updateConfig({ channel: e.target.value as "mailchimp" })}
                  className="w-4 h-4"
                />
                <span className="text-xs">
                  📬 Mailchimp {config.mailchimpConfigured && <span className="text-green-600">✓</span>}
                </span>
              </label>
            </div>
          </div>

          {/* Automation Types */}
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-2">Automation Types</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.reviewRequestEnabled}
                  onChange={(e) => updateConfig({ reviewRequestEnabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-xs">Auto-review requests (3 days after completion)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.quoteFollowupEnabled}
                  onChange={(e) => updateConfig({ quoteFollowupEnabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-xs">Auto quote follow-ups (7+ days pending)</span>
              </label>
            </div>
          </div>

          {/* Testing & Management */}
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-2">Testing & Management</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => testAPI("review")}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700"
              >
                🧪 Test Review Request
              </button>
              <button
                onClick={() => testAPI("followup")}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                🧪 Test Quote Follow-up
              </button>
              <button
                onClick={viewLogs}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-purple-600 text-white hover:bg-purple-700"
              >
                📋 View Logs
              </button>
              <button
                onClick={() => setShowEnvGuide(!showEnvGuide)}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-600 text-white hover:bg-slate-700"
              >
                📖 {showEnvGuide ? "Hide" : "Show"} Setup Guide
              </button>
            </div>
          </div>

          {/* Setup Guide */}
          {showEnvGuide && (
            <div className="bg-slate-50 rounded-lg border border-slate-300 p-4 text-xs space-y-3">
              <div className="font-semibold text-slate-900">🔧 Environment Variables Setup</div>
              
              <div className="space-y-2">
                <div className="font-semibold text-slate-700">1. Twilio (WhatsApp)</div>
                <div className="bg-white rounded p-2 font-mono text-[10px] space-y-1">
                  <div>TWILIO_ACCOUNT_SID=your_account_sid</div>
                  <div>TWILIO_AUTH_TOKEN=your_auth_token</div>
                  <div>TWILIO_WHATSAPP_NUMBER=+14155238886</div>
                </div>
                <div className="text-slate-600">
                  Get from: <a href="https://www.twilio.com/console" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Twilio Console</a>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-slate-700">2. Microsoft Graph (Outlook)</div>
                <div className="bg-white rounded p-2 font-mono text-[10px] space-y-1">
                  <div>MICROSOFT_CLIENT_ID=your_client_id</div>
                  <div>MICROSOFT_CLIENT_SECRET=your_secret</div>
                  <div>MICROSOFT_TENANT_ID=your_tenant_id</div>
                </div>
                <div className="text-slate-600">
                  Get from: <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Azure Portal</a> → App Registrations
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-slate-700">3. Mailchimp</div>
                <div className="bg-white rounded p-2 font-mono text-[10px] space-y-1">
                  <div>MAILCHIMP_API_KEY=your_api_key</div>
                  <div>MAILCHIMP_SERVER=us1</div>
                </div>
                <div className="text-slate-600">
                  Get from: <a href="https://mailchimp.com/account/api" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Mailchimp API Keys</a>
                </div>
              </div>

              <div className="border-t border-slate-300 pt-3 space-y-2">
                <div className="font-semibold text-slate-700">📅 Automated Scheduling</div>
                <div className="text-slate-600">
                  Cron job runs daily at 9 AM (configured in vercel.json). The <code className="bg-white px-1 rounded">scheduled-check.ts</code> function automatically:
                </div>
                <ul className="list-disc list-inside text-slate-600 space-y-1">
                  <li>Finds jobs completed 3 days ago → sends review requests</li>
                  <li>Finds quotes pending 7+ days → sends follow-ups</li>
                  <li>Logs all activity for monitoring</li>
                </ul>
              </div>

              <div className="border-t border-slate-300 pt-3 space-y-2">
                <div className="font-semibold text-slate-700">🔄 Managing Automations</div>
                <div className="text-slate-600 space-y-1">
                  <div><strong>View sent messages:</strong> Click "View Logs" button above</div>
                  <div><strong>Pause automations:</strong> Uncheck automation types</div>
                  <div><strong>Change channel:</strong> Select different radio button</div>
                  <div><strong>Monitor failures:</strong> Check Vercel logs dashboard</div>
                  <div><strong>Update templates:</strong> Go to Marketing page → Communication Templates</div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-slate-700">
                <strong>⚠️ Important:</strong> Add environment variables in Vercel Dashboard (Settings → Environment Variables) and redeploy for changes to take effect.
              </div>
            </div>
          )}

          <div className="text-[11px] text-slate-500">
            💡 <strong>Tip:</strong> Manage automation settings from Marketing page or here. Changes sync automatically.
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminIntegrationsPanel;
