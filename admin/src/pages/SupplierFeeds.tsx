import { useCallback, useEffect, useState } from 'react';
import { listSupplierFeeds, getSupplierFeed, getSupplierFeedRun } from '@/lib/api';
import type { FeedCheck, FeedRun, FeedSummary, PlanCounts } from '@/lib/supplierFeedTypes';

function useRead<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string }>({ data: null, loading: true, error: '' });
  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: '' });
    void load().then(data => { if (!cancelled) setState({ data, loading: false, error: '' }); })
      .catch(error => { if (!cancelled) setState({ data: null, loading: false, error: error instanceof Error ? error.message : 'Unable to load supplier feed operations' }); });
    return () => { cancelled = true; };
  }, [load]);
  return state;
}
const date = (value: string | null) => value ? `${new Date(value).toLocaleString()} (local)` : 'Not recorded';
function Health({ feed }: { feed: FeedSummary }) {
  const colour = feed.health === 'Healthy' ? 'green' : feed.health.includes('failed') ? 'red' : feed.health.includes('review') ? 'amber' : 'slate';
  return <span className={`badge badge-${colour}`}>{feed.health}</span>;
}
function EvidenceLink({ value }: { value: string | null }) {
  if (!value) return <>Not recorded</>;
  let safe = false;
  try { const url = new URL(value); safe = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Artifact paths are text, not browser links. */ }
  return safe ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : <code>{value}</code>;
}
function Release({ feed }: { feed: FeedSummary }) {
  return feed.latestRelease ? <div><code>{feed.latestRelease.sha256}</code><div className="text-muted">{feed.latestRelease.origin === 'applied_import' ? 'Applied import evidence — no check classification' : feed.latestRelease.classification}{feed.latestRelease.publishedUpdateDate ? ` · Published ${feed.latestRelease.publishedUpdateDate}` : ''}</div></div> : <>No successful release evidence.</>;
}
const countLabels: Array<[keyof PlanCounts, string]> = [['create', 'Create'], ['update', 'Update'], ['unchanged', 'Unchanged'], ['review', 'Review'], ['reject', 'Reject'], ['potential_missing', 'Potential Missing'], ['cost_changes', 'Cost Changes']];
function Counts({ run }: { run: FeedRun }) {
  return <section aria-label="Change Plan"><h3>Change Plan</h3><p className="text-muted">Persisted Block2E plan only. Potential Missing is a proposal, not confirmed discontinuation.</p>
    <div className="feed-counts">{countLabels.map(([key, label]) => <div key={key}><div className="text-muted">{label}</div><strong>{run.counts[key] ?? 'Not recorded'}</strong></div>)}</div>
  </section>;
}
function RunProvenance({ run }: { run: FeedRun }) {
  return <dl className="feed-info">
    <dt>Run ID</dt><dd><code>{run.id}</code></dd><dt>Logical key</dt><dd><code>{run.logical_run_key ?? 'Not recorded'}</code></dd>
    <dt>Status / mode</dt><dd>{run.status} / {run.mode ?? 'Not recorded'}</dd><dt>Created</dt><dd>{date(run.created_at)}</dd>
    <dt>Approved</dt><dd>{date(run.approved_at)}</dd><dt>Applied</dt><dd>{date(run.appliedAt)}</dd><dt>Completed</dt><dd>{date(run.completed_at)}</dd>
    <dt>Frozen plan fingerprint</dt><dd><code>{run.plan_fingerprint ?? 'Not frozen'}</code> (freeze timestamp not stored)</dd>
    <dt>Artifact SHA</dt><dd><code>{run.source_checksum ?? 'Not recorded'}</code></dd><dt>Artifact reference</dt><dd><EvidenceLink value={run.artifact_ref} /></dd>
    <dt>Adapter / planner</dt><dd>{run.adapter_id ?? 'Not recorded'} / {run.adapter_version ?? 'Not recorded'} / {run.planner_version ?? 'Not recorded'}</dd>
    <dt>Staged rows</dt><dd>{run.row_count ?? 'Not recorded'}</dd>{run.failure_code && <><dt>Failure</dt><dd>{run.failure_code}</dd></>}
  </dl>;
}
function CheckProvenance({ check }: { check: FeedCheck }) {
  return <details><summary>Evidence / provenance</summary><dl className="feed-info">
    <dt>Source URL</dt><dd><EvidenceLink value={check.source_url} /></dd><dt>Evidence URL</dt><dd><EvidenceLink value={check.published_update_source_url} /></dd>
    <dt>Published update</dt><dd>{check.published_update_date ?? 'Not recorded'} · {check.published_update_date_raw ?? 'No raw evidence'} · {check.published_update_match ?? 'No match recorded'}</dd>
    <dt>Artifact SHA</dt><dd><code>{check.sha256 ?? 'Not recorded'}</code></dd><dt>Release key</dt><dd><code>{check.release_logical_key ?? 'Not recorded'}</code></dd>
    <dt>Artifact retrieved</dt><dd>{date(check.artifact_retrieved_at)}</dd><dt>Evidence retrieved</dt><dd>{date(check.evidence_retrieved_at)}</dd>
    <dt>ETag / Last-Modified</dt><dd>{check.etag ?? 'Not recorded'} / {check.last_modified ?? 'Not recorded'}</dd><dt>Bytes</dt><dd>{check.content_byte_length ?? 'Not recorded'}</dd>
    <dt>Linked run</dt><dd><code>{check.feed_run_id ?? 'Not recorded'}</code></dd><dt>Plan fingerprint</dt><dd><code>{check.plan_fingerprint ?? 'Not recorded'}</code></dd>
  </dl></details>;
}
function RunDetailView({ feedId, runId }: { feedId: string; runId: string }) {
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => getSupplierFeedRun(feedId, runId, offset), [feedId, runId, offset]);
  const { data, loading, error } = useRead(load);
  if (loading) return <p role="status">Loading run...</p>;
  if (error) return <p role="alert" className="error-text">{error}</p>;
  if (!data) return null;
  return <section className="card"><h2>Run Detail</h2><RunProvenance run={data.run} /><Counts run={data.run} />
    <h3>Row-level review</h3><p className="text-muted">Up to 50 persisted rows per page; up to 20 issues / changed fields per row. Long text is capped at 512 characters.</p>
    {!data.rows.length ? <p>No staged rows on this page.</p> : <table className="drawer-table"><thead><tr><th>Row / key</th><th>Action</th><th>Product / target</th><th>Review information</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}>
      <td>{row.row_number ?? '—'}<div><code>{row.source_product_key ?? row.source_record_key ?? row.id}</code></div><div>{row.source_path}</div><div>{row.row_kind}</div></td>
      <td>{row.proposed_action ?? 'Not recorded'}<div>{row.validation_status}</div><div>{row.apply_state}</div></td>
      <td>{row.description ?? 'Not recorded'}<div><code>{row.matched_product_id}</code></div></td>
      <td><div>Fields: {row.ordinaryChanges.join(', ') || 'None recorded'}</div><div>Lifecycle: {row.lifecycleChanges.join(', ') || 'None recorded'}</div><div>Assets: {row.assetChanges.join(', ') || 'None recorded'}</div><div>Cost change: {row.costChange === null ? 'Not recorded' : row.costChange ? 'Yes' : 'No'}</div>
        {row.errors.map((issue, i) => <div className="error-text" key={`e${i}`}>{issue}</div>)}{row.warnings.map((issue, i) => <div key={`w${i}`}>{issue}</div>)}{row.failure_code && <div className="error-text">{row.failure_code}</div>}</td>
    </tr>)}</tbody></table>}
    <div className="feed-paging"><button className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous rows</button><button className="btn-ghost" disabled={!data.hasMore} onClick={() => setOffset(offset + 50)}>Next rows</button></div>
  </section>;
}
function FeedDetailView({ feedId, back }: { feedId: string; back: () => void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const load = useCallback(() => getSupplierFeed(feedId), [feedId]);
  const { data, loading, error } = useRead(load);
  return <><button className="btn-ghost" onClick={back}>Back to feeds</button>
    {loading ? <p role="status">Loading feed...</p> : error ? <p role="alert" className="error-text">{error}</p> : data && <>
      <section className="card"><h2>{data.feed.supplier.name} / {data.feed.source_key}</h2><Health feed={data.feed} /><dl className="feed-info">
        <dt>Supplier ID / state</dt><dd><code>{data.feed.supplier_id}</code> / {data.feed.supplier.status}</dd><dt>Feed ID / scope</dt><dd><code>{data.feed.id}</code> / {data.feed.scope_key}</dd>
        <dt>Authoritative snapshots allowed</dt><dd>{data.feed.allows_authoritative_snapshots ? 'Yes' : 'No'}</dd><dt>Feed enabled / source type</dt><dd>Not stored in the current schema</dd>
        <dt>Last operational check</dt><dd>{data.feed.latestCheck ? `${date(data.feed.latestCheck.checked_at)} · ${data.feed.latestCheck.status}` : 'Never checked'}</dd>
        <dt>Latest release</dt><dd><Release feed={data.feed} /></dd><dt>Canonical owned products</dt><dd>{data.feed.canonicalProductCount}</dd><dt>Latest operational run</dt><dd>{data.feed.latestRun ? `${data.feed.latestRun.id} · ${data.feed.latestRun.status}` : 'None recorded'}</dd>
      </dl>{data.feed.historyLimited && <p role="status">Summary scans are limited to the latest 200 checks / runs. Older evidence may be omitted; health is conservative.</p>}</section>
      <section className="card"><h2>Check History</h2><p className="text-muted">Synthetic checks remain visible for audit evidence, but do not affect feed health or release summaries. {data.syntheticChecks} synthetic checks and {data.syntheticRuns} synthetic runs identified in the scanned history.</p>
        {!data.checks.length ? <p>No checks recorded.</p> : <table className="drawer-table"><thead><tr><th>Checked</th><th>Outcome</th><th>Evidence / error</th></tr></thead><tbody>{data.checks.map(check => <tr key={check.id}>
          <td>{date(check.checked_at)}</td><td><span className={`badge badge-${check.synthetic ? 'slate' : ['changed', 'unchanged'].includes(check.status) ? 'green' : 'red'}`}>{check.status}</span><div>{check.release_classification ?? 'No release classification'}</div>{check.synthetic && <div>Synthetic verification — excluded from operational summaries</div>}</td>
          <td>{check.error_code && <p className="error-text">{check.error_code}: {check.error_summary}</p>}<CheckProvenance check={check} /></td>
        </tr>)}</tbody></table>}{data.checksLimited && <p className="text-muted">Showing the latest 50 checks; older history is omitted.</p>}
      </section>
      <section className="card"><h2>Import / Planning Runs</h2>{!data.runs.length ? <p>No operational Block2E runs recorded.</p> : <table className="drawer-table"><thead><tr><th>Run / created</th><th>Status / mode</th><th>Stored counts</th><th>Approval / completion</th></tr></thead><tbody>{data.runs.map(run => <tr key={run.id}>
        <td><button className="btn-ghost" aria-label={`View run ${run.id}`} onClick={() => setRunId(run.id)}>{run.logical_run_key ?? run.id}</button><div><code>{run.id}</code></div><div>{date(run.created_at)}</div></td>
        <td>{run.status}<div>{run.mode ?? 'Not recorded'}</div></td><td>{countLabels.map(([key, label]) => <div key={key}>{label}: {run.counts[key] ?? 'Not recorded'}</div>)}</td>
        <td>Approved: {date(run.approved_at)}<div>Completed: {date(run.completed_at)}</div><div>Applied: {date(run.appliedAt)}</div></td>
      </tr>)}</tbody></table>}{data.runsLimited && <p className="text-muted">Showing the latest 20 operational runs; older history is omitted.</p>}</section>
      {runId && <RunDetailView key={runId} feedId={feedId} runId={runId} />}
    </>}
  </>;
}
export default function SupplierFeeds() {
  const [feedId, setFeedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => listSupplierFeeds(offset), [offset]);
  const { data, loading, error } = useRead(load);
  return <div className="supplier-page feed-page"><p className="text-muted">Read-only supplier feed operations. No checks, planning or canonical changes are triggered here.</p>
    {feedId ? <FeedDetailView key={feedId} feedId={feedId} back={() => setFeedId(null)} /> : <section className="card"><h2>Supplier Feeds</h2>
      {loading ? <p role="status">Loading feeds...</p> : error ? <p role="alert" className="error-text">{error}</p> : data && <>
        {!data.feeds.length ? <p>No configured supplier feeds.</p> : <table className="drawer-table"><thead><tr><th>Supplier</th><th>Feed</th><th>Health</th><th>Last checked</th><th>Latest release</th><th>Latest run</th><th>Products</th></tr></thead><tbody>{data.feeds.map(feed => <tr key={feed.id}>
          <td>{feed.supplier.name}<div className="text-muted">{feed.supplier.status}</div></td><td><button className="btn-ghost" onClick={() => setFeedId(feed.id)}>{feed.source_key}</button><div>{feed.scope_key}</div></td>
          <td><Health feed={feed} />{feed.historyLimited && <div>Bounded history — may be incomplete</div>}</td><td>{feed.latestCheck ? date(feed.latestCheck.checked_at) : 'Never checked'}</td><td><Release feed={feed} /></td>
          <td>{feed.latestRun ? <><code>{feed.latestRun.id}</code><div>{feed.latestRun.status}</div></> : 'None recorded'}</td><td>{feed.canonicalProductCount}</td>
        </tr>)}</tbody></table>}
        <div className="feed-paging"><button className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous feeds</button><button className="btn-ghost" disabled={!data.hasMore} onClick={() => setOffset(offset + 25)}>Next feeds</button></div>
      </>}
    </section>}
  </div>;
}
