// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(), list: vi.fn(), detail: vi.fn(), comments: vi.fn(), reply: vi.fn(), currentUser: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/lib/supportTickets', () => ({
  createSupportTicket: mocks.create,
  listCustomerSupportTickets: mocks.list,
  getCustomerSupportTicket: mocks.detail,
  listCustomerTicketComments: mocks.comments,
  createCustomerTicketComment: mocks.reply,
}))
vi.mock('@/lib/supabase', () => ({ getCurrentUser: mocks.currentUser }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: mocks.toast }) }))
import HelpAssistant from '@/components/HelpAssistant'
import SupportPage from '@/pages/Support'

const ticket = { id: 'ticket-a', ticket_number: 'SUP-TEST-001', subject: 'Help with invoice', message: 'Original issue', status: 'open', category: 'billing', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }
beforeEach(() => {
  window.location.hash = '#/support'
  mocks.create.mockReset().mockResolvedValue({ ticket })
  mocks.list.mockReset().mockResolvedValue({ tickets: [ticket] })
  mocks.detail.mockReset().mockResolvedValue({ ticket })
  mocks.comments.mockReset().mockResolvedValue({ comments: [
    { id: 'admin', ticket_id: ticket.id, author_user_id: 'admin', author_name: 'Support agent', body: 'We can help', visibility: 'customer', created_at: '2026-10-03T00:00:00Z' },
  ] })
  mocks.reply.mockReset().mockResolvedValue({ comment: { id: 'reply', ticket_id: ticket.id, author_user_id: 'user-a', body: 'Thanks', visibility: 'customer' } })
  mocks.currentUser.mockReset().mockResolvedValue({ id: 'user-a' })
  mocks.toast.mockReset()
})
afterEach(() => { cleanup(); window.location.hash = '#/' })

describe('customer support experience', () => {
  it('offers self-service Help actions to open a ticket and view tickets', () => {
    render(<HelpAssistant currentArea="dashboard" />)
    fireEvent.click(screen.getByRole('button', { name: /Help$/ }))
    expect(screen.getByRole('link', { name: /Still need help\? Open a support ticket/ }).getAttribute('href')).toBe('#/support')
    expect(screen.getByRole('link', { name: 'My support tickets' }).getAttribute('href')).toBe('#/support?view=tickets')
  })

  it('does not auto-create a ticket when an old public auto link is loaded', async () => {
    window.location.hash = '#/support?auto=1&source=landing'
    render(<SupportPage />)
    await screen.findByRole('heading', { name: 'Contact support' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('submits the ticket form and displays the returned ticket number', async () => {
    render(<SupportPage />)
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: ' Help with invoice ' } })
    fireEvent.change(screen.getByPlaceholderText('Describe your issue'), { target: { value: 'The invoice is missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit support ticket' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ subject: 'Help with invoice', category: 'general', message: 'The invoice is missing' }))
    expect(await screen.findByText('SUP-TEST-001')).toBeTruthy()
  })

  it('lists tickets, opens detail, renders Admin replies, and posts a customer reply', async () => {
    window.location.hash = '#/support?view=tickets'
    render(<SupportPage />)
    fireEvent.click(await screen.findByRole('button', { name: /SUP-TEST-001/ }))
    expect(await screen.findByText('Original issue')).toBeTruthy()
    expect(await screen.findByText('We can help')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Write a reply'), { target: { value: 'Thanks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledWith({ ticketId: ticket.id, body: 'Thanks' }))
    expect(await screen.findByText('Thanks')).toBeTruthy()
  })
})
