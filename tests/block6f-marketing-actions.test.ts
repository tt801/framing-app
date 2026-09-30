import { describe, expect, it, vi } from 'vitest'
import { createMarketingActions, marketingSubmissionOutcome } from '@/lib/marketingActions'

function make(overrides: any = {}) {
  return {
    submit: vi.fn(), record: vi.fn(), confirm: vi.fn(() => true), feedback: vi.fn(),
    legacyImport: vi.fn(), scope: vi.fn(() => 'company-a'), legacyCount: () => 2, companyName: () => 'Company A', ...overrides,
  }
}

describe('Block 6F marketing actions', () => {
  for (const [name, status, result] of [
    ['HTTP 501', 501, { success: false, sent: 5, error: 'Provider unavailable' }],
    ['HTTP failure', 503, { success: true, sent: 5, error: 'Provider unavailable' }],
    ['rejected result', 200, { success: false, sent: 5, error: 'Provider unavailable' }],
  ] as const) {
    it(`${name} with misleading sent count cannot create an accepted-send record or success feedback`, async () => {
      const response = new Response(JSON.stringify(result), { status })
      const deps = make({
        submit: vi.fn(async () => marketingSubmissionOutcome(response, await response.json(), 5)),
        record: vi.fn(),
      })
      await createMarketingActions(deps).send({ kind: 'campaign', companyId: 'company-a', payload: {}, recipientCount: 5 })
      expect(deps.record).not.toHaveBeenCalled()
      expect(deps.feedback).toHaveBeenCalledWith('Provider unavailable', 'error')
      expect(deps.feedback).not.toHaveBeenCalledWith(expect.anything(), 'success')
    })
  }

  it('does not log a disabled or rejected provider submission as accepted', async () => {
    const deps = make({ submit: vi.fn().mockResolvedValue({ accepted: 0, failed: 1, message: 'Provider unavailable' }), record: vi.fn() })
    await createMarketingActions(deps).send({ kind: 'campaign', companyId: 'company-a', payload: {}, recipientCount: 1 })
    expect(deps.record).not.toHaveBeenCalled()
    expect(deps.feedback).toHaveBeenCalledWith('Provider unavailable', 'error')
  })

  it('reports partial provider acceptance without claiming delivery', async () => {
    const deps = make({ submit: vi.fn().mockResolvedValue({ accepted: 2, failed: 1 }), record: vi.fn().mockResolvedValue({ ok: true }) })
    await createMarketingActions(deps).send({ kind: 'campaign', companyId: 'company-a', payload: {}, recipientCount: 3 })
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', recipientCount: 2 }))
    expect(deps.feedback).toHaveBeenCalledWith('Submission accepted for 2 recipient(s); 1 failed. Delivery is not confirmed.', 'warning')
  })

  for (const kind of ['campaign', 'template'] as const) {
    it(`${kind} sends once and reports recording failure`, async () => {
      const deps = make({ submit: vi.fn().mockResolvedValue({ accepted: 1, failed: 0 }), record: vi.fn().mockResolvedValue({ ok: false, recordingError: 'db' }) })
      await createMarketingActions(deps).send({ kind, companyId: 'company-a', payload: {}, recipientCount: 1 })
      expect(deps.submit).toHaveBeenCalledTimes(1)
      expect(deps.record).toHaveBeenCalledTimes(1)
      expect(deps.feedback).toHaveBeenCalledWith('Submission accepted; log could not be saved.', 'warning')
    })
  }

  it('records the accepted submission in A but suppresses feedback after switching to B', async () => {
    let resolveSubmission: (value: any) => void = () => {}
    const pendingSubmission = new Promise<any>(resolve => { resolveSubmission = resolve })
    const deps = make({ submit: vi.fn(() => pendingSubmission), record: vi.fn().mockResolvedValue({ ok: true }) })
    const pending = createMarketingActions(deps).send({ kind: 'campaign', companyId: 'company-a', payload: {}, recipientCount: 1 })
    deps.scope.mockReturnValue('company-b')
    resolveSubmission({ accepted: 1, failed: 0 })
    await pending
    expect(deps.record).toHaveBeenCalledTimes(1)
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-a', recipientCount: 1 }))
    expect(deps.feedback).not.toHaveBeenCalled()
  })

  it('confirms partial legacy import without provider calls', async () => {
    const deps = make({ legacyImport: vi.fn().mockResolvedValue({ imported: 1, skipped: 0, failures: [{ id: 'bad' }] }) })
    await createMarketingActions(deps).importLegacy('marketing data')
    expect(deps.confirm).toHaveBeenCalledWith('Import 2 legacy marketing records into Company A for marketing data? Original browser data will be preserved.')
    expect(deps.feedback).toHaveBeenCalledWith('1 imported, 0 already imported. 1 failed.', 'error')
    expect(deps.submit).not.toHaveBeenCalled()
  })

  it('does nothing when legacy import is cancelled', async () => {
    const deps = make({ confirm: vi.fn(() => false) })
    await createMarketingActions(deps).importLegacy('marketing data')
    expect(deps.legacyImport).not.toHaveBeenCalled()
    expect(deps.submit).not.toHaveBeenCalled()
  })
})
