import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ConfirmationDialog from '@/components/ConfirmationDialog'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const base = { title: 'Delete quote?', description: 'This cannot be undone.', recordIdentity: 'Q-001', confirmLabel: 'Delete quote' }

it('wraps Tab and Shift+Tab between the dialog actions', () => {
  render(<ConfirmationDialog {...base} onConfirm={vi.fn()} onCancel={vi.fn()} />)
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  const confirm = screen.getByRole('button', { name: 'Delete quote' })
  confirm.focus(); fireEvent.keyDown(confirm, { key: 'Tab' })
  expect(document.activeElement).toBe(cancel)
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(confirm)
})

it('handles Escape before native close handling and blocks repeated Escape while pending', async () => {
  let resolve!: () => void
  const cancel = vi.fn()
  render(<ConfirmationDialog {...base} onCancel={cancel} onConfirm={() => new Promise<void>(done => { resolve = done })} />)
  const dialog = screen.getByRole('dialog')
  expect(fireEvent.keyDown(dialog, { key: 'Escape' })).toBe(false)
  expect(cancel).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Delete quote' }))
  expect(fireEvent.keyDown(dialog, { key: 'Escape' })).toBe(false)
  expect(cancel).toHaveBeenCalledTimes(1)
  await act(async () => resolve())
})

it('focuses Cancel, explains the record, and never confirms on cancellation or Escape', () => {
  const confirm = vi.fn(), cancel = vi.fn()
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const view = render(<ConfirmationDialog {...base} onConfirm={confirm} onCancel={cancel} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  const dialog = screen.getByRole('dialog', { name: 'Delete quote?' })
  expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
  expect(screen.getByText('Q-001')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(confirm).not.toHaveBeenCalled()
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove()
})

it('submits once while pending, blocks Escape and retains an inline failure for retry', async () => {
  let resolve!: (error: string) => void
  const confirm = vi.fn(() => new Promise<string>(done => { resolve = done })), cancel = vi.fn()
  render(<ConfirmationDialog {...base} onConfirm={confirm} onCancel={cancel} />)
  const button = screen.getByRole('button', { name: 'Delete quote' })
  fireEvent.click(button); fireEvent.click(button)
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true')
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(cancel).not.toHaveBeenCalled()
  await act(async () => resolve('Quote changed. Reload before deleting.'))
  expect(screen.getByRole('alert').textContent).toContain('Quote changed')
  expect((screen.getByRole('button', { name: 'Delete quote' }) as HTMLButtonElement).disabled).toBe(false)
})

it('handles rejected operations without closing or exposing an unhandled rejection', async () => {
  render(<ConfirmationDialog {...base} onConfirm={vi.fn().mockRejectedValue(new Error('network'))} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete quote' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not complete'))
})

it('ignores completion after unmount and tolerates StrictMode mounting', async () => {
  let resolve!: () => void
  const confirm = vi.fn(() => new Promise<void>(done => { resolve = done }))
  const view = render(<React.StrictMode><ConfirmationDialog {...base} onConfirm={confirm} onCancel={vi.fn()} /></React.StrictMode>)
  fireEvent.click(screen.getByRole('button', { name: 'Delete quote' }))
  view.unmount()
  await act(async () => resolve())
  expect(screen.queryByRole('dialog')).toBeNull()
})
