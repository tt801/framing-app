import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useToast } from '@/lib/toast'
import ToastContainer from '@/components/ToastContainer'

beforeEach(() => { vi.useFakeTimers(); useToast.setState({ toasts: [] }) })
afterEach(() => {
  cleanup()
  for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id)
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks()
})

it('keeps notification identities distinct even when random values collide', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const { add, remove } = useToast.getState()
  add('Old', 'success', 100)
  const old = useToast.getState().toasts[0].id
  remove(old)
  add('New', 'info', 200)
  expect(useToast.getState().toasts[0].id).not.toBe(old)
  vi.advanceTimersByTime(100)
  expect(useToast.getState().toasts.map(toast => toast.message)).toEqual(['New'])
})

it('returns the identity so a resolved warning can be dismissed without removing others', () => {
  const { add, remove } = useToast.getState()
  const id = add('Needs linking', 'warning', 0)
  add('Other warning', 'warning', 0)
  expect(typeof id).toBe('string')
  remove(id)
  expect(useToast.getState().toasts.map(t => t.message)).toEqual(['Other warning'])
})

it('preserves existing default and numeric lifetimes and persistent warnings', () => {
  const { add, remove } = useToast.getState()
  add('Routine')
  add('Saved', 'success', 500)
  add('Action required', 'warning', 0)
  expect(useToast.getState().toasts[0].type).toBe('info')
  vi.advanceTimersByTime(500)
  expect(useToast.getState().toasts.map(t => t.message)).toEqual(['Routine', 'Action required'])
  vi.advanceTimersByTime(10000)
  expect(useToast.getState().toasts.map(t => t.message)).toEqual(['Action required'])
  remove(useToast.getState().toasts[0].id)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels a dismissed notification timer without affecting another notification', () => {
  const { add, remove } = useToast.getState()
  add('First', 'error'); add('Second', 'info')
  const [first, second] = useToast.getState().toasts
  remove(first.id)
  expect(vi.getTimerCount()).toBe(1)
  remove(first.id)
  expect(useToast.getState().toasts[0].id).toBe(second.id)
})

it('announces all variants and exposes labelled dismiss controls', () => {
  const { add } = useToast.getState()
  add('Saved', 'success'); add('Failed', 'error'); add('Partial result', 'warning', 0); add('Draft opened', 'info')
  render(<ToastContainer />)
  expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Failed'), expect.stringContaining('Partial result')]))
  expect(screen.getAllByRole('status')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss warning notification' }))
  act(() => vi.advanceTimersByTime(3000))
  expect(useToast.getState().toasts).toEqual([])
})
