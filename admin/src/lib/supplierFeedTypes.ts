// Transport-only types. Privileged database access stays in server/platform.
export type FeedHealth = 'Healthy' | 'Changed — review required' | 'Check failed' | 'Planning failed' | 'Never checked' | 'Unknown — history limit';
export type PlanCounts = Record<'create' | 'update' | 'unchanged' | 'review' | 'reject' | 'potential_missing' | 'cost_changes', number | null>;
export type FeedCheck = {
  id: string; checked_at: string; status: string; release_classification: string | null;
  source_url: string | null; published_update_source_url: string | null;
  published_update_date: string | null; published_update_date_raw: string | null; published_update_match: string | null;
  artifact_retrieved_at: string | null; evidence_retrieved_at: string | null;
  etag: string | null; last_modified: string | null; content_byte_length: number | null;
  sha256: string | null; release_logical_key: string | null; feed_run_id: string | null;
  plan_fingerprint: string | null; error_code: string | null; error_summary: string | null;
  synthetic: boolean;
};
export type FeedRun = {
  id: string; logical_run_key: string | null; created_at: string; status: string; mode: string | null;
  approved_at: string | null; completed_at: string | null; appliedAt: string | null;
  plan_fingerprint: string | null; source_checksum: string | null; artifact_ref: string | null;
  adapter_id: string | null; adapter_version: string | null; planner_version: string | null;
  row_count: number | null; counts: PlanCounts; failure_code: string | null;
};
export type FeedSummary = {
  id: string; supplier_id: string; source_key: string; scope_key: string;
  allows_authoritative_snapshots: boolean; supplier: { id: string; name: string; status: string };
  canonicalProductCount: number; health: FeedHealth; latestCheck: FeedCheck | null; latestRun: FeedRun | null;
  latestRelease: { sha256: string; classification: string | null; publishedUpdateDate: string | null; origin: 'check' | 'applied_import' } | null;
  historyLimited: boolean;
};
export type FeedList = { feeds: FeedSummary[]; hasMore: boolean; offset: number };
export type FeedDetail = { feed: FeedSummary; checks: FeedCheck[]; runs: FeedRun[]; checksLimited: boolean; runsLimited: boolean; syntheticChecks: number; syntheticRuns: number };
export type ReviewRow = {
  id: string; row_number: number | null; source_product_key: string | null; source_record_key: string | null;
  source_path: string | null; row_kind: string | null; proposed_action: string | null; validation_status: string | null;
  matched_product_id: string | null; apply_state: string | null; failure_code: string | null;
  description: string | null; ordinaryChanges: string[]; lifecycleChanges: string[]; assetChanges: string[];
  costChange: boolean | null; errors: string[]; warnings: string[];
};
export type ApplyProgress = { total: number; pending: number; applied: number; skipped: number; failed: number; conflict: number; version2: number };
export type RunControl = {
  state: 'Review required' | 'Ready for approval' | 'Approved — ready to apply' | 'Applying' | 'Partially applied' | 'Applied' | 'Failed / attention required' | 'Not eligible';
  canApprove: boolean; canApply: boolean; canContinue: boolean; synthetic: boolean;
  reasonCodes: string[]; description: string; anomalies: string[]; progress: ApplyProgress;
  approvedBy: string | null; approvedAt: string | null; applyDisposition: string | null;
};
export type RunDetail = { run: FeedRun; rows: ReviewRow[]; hasMore: boolean; offset: number; control: RunControl };
export type RunActionResult = { detail: RunDetail; processed: number; outcome: 'approved' | 'applied' | 'bounded' | 'attention' };
