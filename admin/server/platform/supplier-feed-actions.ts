import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { PlatformDependencies } from './dependencies.js'
import { OperationsNotFound, readRunDetail, runColumns } from './supplierFeeds/operations.js'

export const applyLimits = { rows: 10, budgetMs: 4000 } as const
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

// Auth uses explicitly supplied bearer tokens, not ambient cookies; no CORS is
// enabled. Origin/Fetch Metadata checks additionally fail closed for cross-site
// browser requests. Origin-less CLI callers still need a valid admin bearer.
function safeRequest(req: VercelRequest): boolean {
  const { origin, host, 'sec-fetch-site': site } = req.headers
  if (Array.isArray(origin) || Array.isArray(host) || Array.isArray(site)) return false
  if (site && !['same-origin', 'none'].includes(site)) return false
  if (origin !== undefined) {
    try {
      const url = new URL(origin)
      const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if (!host || url.host !== host || url.origin !== origin || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return false
    } catch { return false }
  }
  return true
}

export function createHandler({ getSupabaseAdmin, requirePlatformAdmin, platformAdminError }: PlatformDependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end() }
    try {
      const actor = await requirePlatformAdmin(req)
      if (typeof req.headers.authorization !== 'string' || !/^Bearer [^\s]+$/i.test(req.headers.authorization)) return res.status(403).json({ error: 'Missing bearer token' })
      if (!safeRequest(req)) return res.status(403).json({ error: 'Cross-origin supplier feed mutations are not permitted' })
      const contentType = req.headers['content-type']
      if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return res.status(415).json({ error: 'Content-Type must be application/json' })
      const body = req.body
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
        || Object.keys(body).some(k => !['runId', 'action'].includes(k)) || Object.keys(req.query).length
        || !uuid(body.runId) || !['approve', 'apply'].includes(body.action)) return res.status(400).json({ error: 'Expected only runId and action (approve or apply)' })
      if (!uuid(actor.id)) return res.status(403).json({ error: 'Platform admin identity required' })
      const db = getSupabaseAdmin()
      const { data, error } = await db.from('supplier_feed_runs').select(runColumns).eq('id', body.runId).limit(1)
      if (error) throw error
      const run = data?.[0]
      if (!run) throw new OperationsNotFound('Run not found')
      const detail = await readRunDetail(db, run.feed_source_id, run.id)
      if (body.action === 'approve') {
        if (!detail.control.canApprove) return res.status(409).json({ error: detail.control.description, reasonCodes: detail.control.reasonCodes, detail })
        const { error } = await db.rpc('block2e_approve_run', {
          p_run_id: run.id, p_fingerprint: detail.run.plan_fingerprint, p_actor: actor.id, p_acknowledged: detail.control.anomalies,
        })
        if (error) return res.status(409).json({ error: 'Approval was not confirmed. Refresh the run before proceeding.' })
        const authoritative = await readRunDetail(db, run.feed_source_id, run.id)
        if (!authoritative.control.approvedAt || !authoritative.control.approvedBy
          || !['approved', 'applying', 'partially_applied', 'applied'].includes(authoritative.run.status))
          return res.status(409).json({ error: 'Approval was not confirmed by persisted state.', reasonCodes: ['approval_not_confirmed'], detail: authoritative })
        return res.status(200).json({ detail: authoritative, processed: 0, outcome: 'approved' })
      }
      if (!detail.control.canApply) return res.status(409).json({ error: detail.control.description, reasonCodes: detail.control.reasonCodes, detail })
      const deadline = Date.now() + applyLimits.budgetMs
      let processed = 0
      let attention = false
      if (detail.control.progress.total === 0) {
        const { error } = await db.rpc('block2e_finish_empty_run', { p_run_id: run.id, p_fingerprint: detail.run.plan_fingerprint })
        if (error) return res.status(409).json({ error: 'Empty-run application was not confirmed. Refresh the run.' })
      } else {
        const { data: rows, error } = await db.from('supplier_feed_rows').select('id').eq('feed_run_id', run.id)
          .eq('row_persistence_version', 2).in('apply_state', ['pending', 'failed'])
          .order('row_number', { nullsFirst: false }).order('id').limit(applyLimits.rows)
        if (error) throw error
        for (const row of rows ?? []) {
          if (Date.now() >= deadline) break
          // Each HTTP RPC is a separate transaction. Block2E locks the run and
          // row, checks fingerprint/disposition/revision, and owns all DML.
          const { data: outcome, error } = await db.rpc('block2e_apply_row', {
            p_run_id: run.id, p_row_id: row.id, p_fingerprint: detail.run.plan_fingerprint,
          })
          if (error) { attention = true; break }
          processed++
          if (!outcome || !['applied', 'skipped'].includes(outcome.state)) { attention = true; break }
        }
      }
      const authoritative = await readRunDetail(db, run.feed_source_id, run.id)
      return res.status(200).json({ detail: authoritative, processed,
        outcome: attention || authoritative.control.progress.conflict || authoritative.control.progress.failed ? 'attention'
          : authoritative.run.status === 'applied' ? 'applied' : 'bounded' })
    } catch (error) {
      if (error instanceof OperationsNotFound) return res.status(404).json({ error: error.message })
      const { status, message } = platformAdminError(error)
      return res.status(status).json({ error: status === 403 ? message : 'Supplier feed action was not confirmed. Refresh the persisted run before proceeding.' })
    }
  }
}
