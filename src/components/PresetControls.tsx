import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCompanyPresets, type VisualizerPreset, type PersistedPreset } from "@/lib/presets";
import { useBillingAccess } from "@/lib/billingAccess";
import { useToast } from "@/lib/toast";
import PresetNameDialog from "./PresetNameDialog";

type Props = {
  companyName: string;
  customerKey: string;
  hasSavedCustomer: boolean;
  ensureCustomerId: () => Promise<string>;
  currentState: any;
  onApply: (preset: VisualizerPreset) => void;
};

type PresetStore = ReturnType<typeof useCompanyPresets>;

// Remount hook-owned list state on scope changes so an old save cannot populate a new tenant/customer list.
function PresetScope({ customerKey, children }: { customerKey: string; children: (store: PresetStore) => ReactNode }) {
  return children(useCompanyPresets(customerKey));
}

export default function PresetControls({ companyName, customerKey, hasSavedCustomer, ensureCustomerId, currentState, onApply }: Props) {
  const { companyAccountId, userId } = useBillingAccess();
  const scopeRef = useRef({ companyAccountId, userId, companyName, customerKey, version: 0 });
  if (scopeRef.current.companyAccountId !== companyAccountId || scopeRef.current.userId !== userId ||
      scopeRef.current.companyName !== companyName || scopeRef.current.customerKey !== customerKey) {
    scopeRef.current = { companyAccountId, userId, companyName, customerKey, version: scopeRef.current.version + 1 };
  }
  const scope = scopeRef.current;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = (value: typeof scope) => mounted.current && scopeRef.current === value;
  const [feedback, setFeedback] = useState<{ scope: typeof scope; message: string; createdCustomerId?: string } | null>(null);
  const followsCustomerCreation = (before: typeof scope, after: typeof scope, customerId: string) =>
    after.version === before.version + 1 && after.companyAccountId === before.companyAccountId &&
    after.userId === before.userId && after.companyName === before.companyName && after.customerKey === customerId;
  type SaveDialog = { scope: typeof scope; state: any; save: PresetStore["save"] };
  const [nameDialog, setNameDialog] = useState<SaveDialog | null>(null);
  const dialogRef = useRef<SaveDialog | null>(null);
  dialogRef.current = nameDialog?.scope === scope ? nameDialog : null;
  const saveButton = useRef<HTMLButtonElement>(null);
  const customerRequest = useRef<{ scope: typeof scope } | null>(null);
  const [checkingScope, setCheckingScope] = useState<typeof scope | null>(null);

  async function savePreset(save: PresetStore["save"]) {
    if (checkingScope === scope || dialogRef.current) return;
    const scopeAtStart = scope;
    const request = { scope };
    if (customerRequest.current?.scope === scope) return;
    customerRequest.current = request;
    setCheckingScope(scope);
    try {
      const customerId = await ensureCustomerId();
      if (!mounted.current || customerRequest.current !== request) return;
      const activeScope = scopeRef.current;
      // Customer creation can legitimately select its newly saved CRM customer.
      const selectedCreatedCustomer = !hasSavedCustomer && followsCustomerCreation(scopeAtStart, activeScope, customerId);
      if (!current(scopeAtStart) && !selectedCreatedCustomer) return;
      if (!customerId) { setFeedback({ scope: activeScope, message: "Save the customer before saving a preset." }); return; }
      if (!hasSavedCustomer) {
        setFeedback({ scope: activeScope, createdCustomerId: customerId, message: "Customer saved. Save the preset again now that it is assigned to this customer." });
        return;
      }
      setNameDialog({ scope: scopeAtStart, state: currentState, save });
    } catch {
      if (current(scopeAtStart) && customerRequest.current === request) {
        setFeedback({ scope: scopeAtStart, message: "Could not confirm the customer save. Check Customers before saving the preset again." });
      }
    } finally {
      if (customerRequest.current === request) {
        customerRequest.current = null;
        if (mounted.current) setCheckingScope(null);
      }
    }
  }

  async function saveNamedPreset(session: SaveDialog, name: string): Promise<string | void> {
    if (!current(session.scope) || dialogRef.current !== session) return;
    const result = await session.save({ id: "", name, state: session.state });
    if (!current(session.scope) || dialogRef.current !== session) return;
    if (result?.ok !== true || !result.preset?.id) {
      const message = result?.ok === false ? result.error : "Could not confirm preset creation.";
      return `${message} A preset may already have been saved. Check the preset list before retrying.`;
    }
    dialogRef.current = null;
    setNameDialog(previous => previous === session ? null : previous);
    setFeedback(null);
    useToast.getState().add("Preset saved.", "success");
  }

  async function deletePreset(preset: PersistedPreset, remove: PresetStore["remove"]) {
    const scopeAtStart = scope;
    const result = await remove(preset);
    if (current(scopeAtStart)) setFeedback({ scope: scopeAtStart, message: result.ok ? "Preset deleted." : result.error });
  }

  return <PresetScope key={scope.version} customerKey={customerKey}>{({ presets, loading, error, save, remove }) => <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4">
    <div className="flex items-center justify-between mb-3"><div><h3 className="font-semibold text-slate-900">Presets</h3><p className="text-xs text-slate-500">Save this exact setup for reuse.</p></div><div className="relative"><button ref={saveButton} type="button" disabled={checkingScope === scope} className="relative inline-flex items-center justify-between gap-1 rounded-lg px-3 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm whitespace-nowrap disabled:opacity-50" onClick={() => { void savePreset(save); }}>Save preset</button></div></div>
    {nameDialog?.scope === scope && <PresetNameDialog key={scope.version} returnFocus={saveButton.current}
      onCancel={() => { dialogRef.current = null; setNameDialog(null); }}
      onSave={name => saveNamedPreset(nameDialog, name)} />}
    {feedback && (feedback.scope === scope || (feedback.createdCustomerId && followsCustomerCreation(feedback.scope, scope, feedback.createdCustomerId))) &&
      <p role="status" className="mb-2 text-sm text-slate-600">{feedback.message}</p>}
    {loading ? <p className="text-sm text-slate-500">Loading presets...</p> : error ? <p className="text-sm text-rose-600">Could not load presets: {error}</p> : presets.length === 0 ? <p className="text-sm text-slate-500">No presets yet for this customer.</p> : <ul className="space-y-2">{presets.map(preset => <li key={preset.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"><div className="min-w-0"><div className="text-sm font-medium truncate text-slate-900">{preset.name}</div><div className="text-xs text-slate-500">{new Date(preset.createdAt).toLocaleString()}</div></div><div className="flex gap-2 shrink-0"><button onClick={() => onApply(preset)} className="rounded-lg px-2 py-1 text-xs bg-white ring-1 ring-slate-300 hover:bg-slate-100">Load</button><button onClick={() => void deletePreset(preset, remove)} className="rounded-lg px-2 py-1 text-xs bg-white ring-1 ring-rose-200 text-rose-600 hover:bg-rose-50">Delete</button></div></li>)}</ul>}
  </div>}</PresetScope>;
}