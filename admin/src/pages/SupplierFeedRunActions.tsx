import { useState } from 'react';
import { mutateSupplierFeedRun } from '@/lib/api';
import type { RunDetail } from '@/lib/supplierFeedTypes';

const labels = [['create', 'Create'], ['update', 'Update'], ['unchanged', 'Unchanged'], ['review', 'Review'], ['reject', 'Reject'], ['potential_missing', 'Potential Missing'], ['cost_changes', 'Cost Changes']] as const;

export function RunActions({ detail, supplierFeed, onChange, refresh }: {
  detail: RunDetail; supplierFeed: string; onChange: (detail: RunDetail) => void; refresh: () => void;
}) {
  const [confirm, setConfirm] = useState<'approve' | 'apply' | null>(null);
  const [busy, setBusy] = useState<'approve' | 'apply' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { run, control } = detail;
  // A missing/old read model fails closed. Eligibility is exclusively supplied
  // by the server; the browser never derives it from status or plan counts.
  const actionable = control && !control.synthetic && !uncertain;
  async function execute() {
    if (!confirm || busy) return;
    const action = confirm;
    setConfirm(null); setBusy(action); setError(''); setMessage('');
    try {
      const result = await mutateSupplierFeedRun(run.id, action);
      if (!result.detail || result.detail.run.id !== run.id || !result.detail.control) throw new Error('Invalid action response. Refresh the run before proceeding.');
      if (!['approved', 'applied', 'bounded', 'attention'].includes(result.outcome)
        || (action === 'approve' && (result.outcome !== 'approved' || !result.detail.control.approvedAt))
        || (result.outcome === 'applied' && result.detail.run.status !== 'applied')) throw new Error('Action success was not confirmed by persisted state.');
      onChange(result.detail);
      if (result.outcome === 'attention') setError('Application stopped; attention required. Inspect persisted row failures/conflicts before proceeding.');
      else if (result.outcome === 'approved') setMessage(result.detail.run.status === 'approved'
        ? 'Approval recorded. Canonical changes have not been applied.' : `Approval recorded. Current persisted run state: ${result.detail.run.status}.`);
      else if (result.outcome === 'applied' && result.detail.run.status === 'applied') setMessage('Application completed according to the persisted run state.');
      else setMessage(`Bounded application request finished (${result.processed} rows processed). Review persisted progress before continuing.`);
    } catch (err) {
      setUncertain(true);
      setError(`${err instanceof Error ? err.message : 'Action was not confirmed.'} Refresh the run to inspect any committed progress before proceeding.`);
    } finally { setBusy(null); }
  }
  return <section aria-label="Approval and application">
    {control && <><h3>{control.state}</h3><p>{control.description}</p><p className="text-muted">Reason: {control.reasonCodes.join(', ')} · Approval identity: {control.approvedBy ?? 'Not recorded'} · Approved: {control.approvedAt ?? 'Not recorded'}</p>
      <dl className="feed-info"><dt>Run status</dt><dd>{run.status}</dd>{(['total', 'applied', 'pending', 'skipped', 'failed', 'conflict'] as const).map(key => <div key={key}><dt>{key === 'conflict' ? 'Conflicts / stale' : key[0].toUpperCase() + key.slice(1)}</dt><dd>{control.progress[key]}</dd></div>)}</dl>
      {control.anomalies.length > 0 && <p>Persisted mass-change anomalies requiring acknowledgement: {control.anomalies.join(', ')}</p>}
    </>}
    {busy && <p role="status">{busy === 'approve' ? 'Recording approval...' : 'Applying bounded request. At most 10 rows, committing each row separately.'}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}{message && <p role="status">{message}</p>}
    {actionable && control.canApprove && <button className="btn-primary" disabled={Boolean(busy)} onClick={() => setConfirm('approve')}>Approve plan</button>}
    {actionable && control.canApply && <button className="btn-primary" disabled={Boolean(busy)} onClick={() => setConfirm('apply')}>{control.canContinue ? 'Continue apply' : 'Apply approved plan'}</button>}
    <button className="btn-ghost" disabled={Boolean(busy)} onClick={refresh}>Refresh run</button>
    {confirm && <section role="dialog" aria-modal="true" aria-labelledby="feed-action-confirmation" className="card">
      <h3 id="feed-action-confirmation">{confirm === 'approve' ? 'Confirm plan approval' : 'Confirm approved plan application'}</h3>
      <p>{supplierFeed} · Run <code>{run.id}</code></p><p>Frozen plan: <code>{run.plan_fingerprint}</code></p>
      <p>{labels.map(([key, label]) => `${label}: ${run.counts[key] ?? 'Not recorded'}`).join(' · ')}</p>
      {confirm === 'approve' ? <><p>Approval does NOT apply canonical changes. Application requires a separate confirmation.</p>
        {control.anomalies.length > 0 && <p>This approval explicitly acknowledges these persisted anomalies: {control.anomalies.join(', ')}.</p>}</>
        : <><p>Application can modify canonical supplier data and record supplier-cost history where applicable through Block2E / Block2D.</p><p>At most 10 rows per request. Partial progress is durable. Further application requires Continue apply and another confirmation.</p></>}
      <button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="btn-primary" onClick={() => void execute()}>{confirm === 'approve' ? 'Confirm approval' : 'Confirm application'}</button>
    </section>}
  </section>;
}
