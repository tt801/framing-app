// src/components/admin/AdminIntegrationsPanel.tsx
import React, { useEffect, useState } from "react";
import { useCatalog } from "@/lib/store";

type ProviderKey = "quickbooks" | "xero";

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

  const settings = catalog?.settings || {};
  const initialIntegrations: IntegrationsSettings =
    (settings.integrations as IntegrationsSettings) || {};

  const [integrations, setIntegrations] = useState<IntegrationsSettings>(
    initialIntegrations
  );
  const [loading, setLoading] = useState<LoadingMap>({
    quickbooks: false,
    xero: false,
  });
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Keep local state in sync if settings change elsewhere
  useEffect(() => {
    setIntegrations(initialIntegrations);
  }, [catalog?.settings?.integrations]);

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
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default AdminIntegrationsPanel;
