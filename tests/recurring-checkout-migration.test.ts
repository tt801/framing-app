import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('migrations/20261005_recurring_checkout_completion.sql', 'utf8')
describe('recurring checkout completion migration contract', () => {
  it('requires a claimed, paid subscription Checkout event and matching company/session/customer/subscription', () => {
    for (const clause of ["event_type='checkout.session.completed'", "claim_token=p_claim_token", "status='pending'", "v_session->>'id' is distinct from p_session_id", "v_session->>'payment_status' is distinct from 'paid'", "v_session->>'subscription' is distinct from p_subscription_id", "v_account.stripe_customer_id is distinct from p_customer_id", "v_account.stripe_subscription_id is distinct from p_subscription_id", "company_account_id=p_company_account_id and session_id=p_session_id", "v_attempt.customer_id is distinct from p_customer_id"]) {
      expect(sql).toContain(clause)
    }
  })
  it('is idempotent, leaves Founder reservations alone and grants no browser execution', () => {
    expect(sql).toContain("v_attempt.founder_reserved then return false")
    expect(sql).toContain("v_attempt.status='completed' then return true")
    expect(sql).toContain("v_attempt.status<>'pending' then return false")
    expect(sql).toContain('completed_at=now()')
    expect(sql).toContain('from public,anon,authenticated')
    expect(sql).toContain('to service_role')
  })
})
