import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { PlatformDependencies } from './dependencies.js'
import { OperationsNotFound, readFeedList, readFeedDetail, readRunDetail } from './supplierFeeds/operations.js'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export function createHandler({ getSupabaseAdmin, requirePlatformAdmin, platformAdminError }: PlatformDependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end() }
    try {
      await requirePlatformAdmin(req)
      const { feedId, runId, offset: rawOffset } = req.query
      if (Object.keys(req.query).some(key => !['feedId', 'runId', 'offset'].includes(key))
        || (feedId !== undefined && !uuid(feedId)) || (runId !== undefined && (!uuid(runId) || !feedId))
        || (rawOffset !== undefined && (typeof rawOffset !== 'string' || !/^(0|[1-9][0-9]{0,5})$/.test(rawOffset)))
        || (feedId && !runId && rawOffset !== undefined)) return res.status(400).json({ error: 'Invalid feed operations request' })
      const offset = Number(rawOffset ?? 0)
      const db = getSupabaseAdmin()
      const result = runId ? await readRunDetail(db, feedId as string, runId as string, offset)
        : feedId ? await readFeedDetail(db, feedId as string) : await readFeedList(db, offset)
      return res.status(200).json(result)
    } catch (error) {
      if (error instanceof OperationsNotFound) return res.status(404).json({ error: error.message })
      const { status, message } = platformAdminError(error)
      return res.status(status).json({ error: status === 403 ? message : 'Unable to load supplier feed operations' })
    }
  }
}
