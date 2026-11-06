import React from 'react'
import { flushSync } from 'react-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest'
import RoomMockup from '@/components/RoomMockup'
import ToastContainer from '@/components/ToastContainer'
import { useToast } from '@/lib/toast'

const scope = vi.hoisted(() => ({ companyAccountId: 'company-a', userId: 'user-a' }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => scope }))
const refs = vi.hoisted(() => [] as Array<{ current: unknown }>)
vi.mock('react', async importOriginal => {
  const original = await importOriginal<typeof import('react')>()
  return { ...original, useRef: (value: unknown) => { const ref = original.useRef(value); refs.push(ref); return ref } }
})
const room = (artworkUrl = '') => <><RoomMockup artworkUrl={artworkUrl}/><ToastContainer/></>
const click = () => fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }))
let ctx: CanvasRenderingContext2D
let serialize: MockInstance<HTMLCanvasElement['toDataURL']>
let handoff: MockInstance<HTMLAnchorElement['click']>
beforeEach(() => {
  refs.length = 0; scope.companyAccountId = 'company-a'; scope.userId = 'user-a'
  window.location.hash = '#/app'
  ctx = new Proxy({}, { get: (target, key) => {
    if (!(key in target)) Reflect.set(target, key, vi.fn())
    return Reflect.get(target, key)
  } }) as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  serialize = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,fixture')
  handoff = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup(); for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id)
  vi.restoreAllMocks()
  window.location.hash = ''
})
it('requests the currently displayed fallback canvas as PNG with the exact filename', () => {
  const rendered = render(room()); const canvas = rendered.container.querySelector('canvas')!
  const dimensions = [canvas.width, canvas.height]
  click()
  expect(serialize).toHaveBeenCalledExactlyOnceWith('image/png')
  expect(handoff).toHaveBeenCalledTimes(1)
  const anchor = handoff.mock.contexts[0] as HTMLAnchorElement
  expect(anchor.download).toBe('room-preview.png'); expect(anchor.href).toBe('data:image/png;base64,fixture')
  expect(screen.getByRole('status').textContent).toContain("Room PNG download requested. Check your browser's downloads.")
  expect([canvas.width, canvas.height]).toEqual(dimensions)
  expect(useToast.getState().toasts).toHaveLength(1)
})

it.each(['missing', 'zero-width', 'zero-height', 'no-context'])('reports %s canvas and permits a subsequent retry', condition => {
  const rendered = render(room()); const canvas = rendered.container.querySelector('canvas')!
  const ref = refs.find(ref => ref.current === canvas)!
  if (condition === 'missing') ref.current = null
  if (condition === 'zero-width') canvas.width = 0
  if (condition === 'zero-height') canvas.height = 0
  if (condition === 'no-context') vi.mocked(canvas.getContext).mockReturnValueOnce(null)
  click()
  expect(screen.getByRole('alert').textContent).toContain('room preview is not ready')
  expect(serialize).not.toHaveBeenCalled(); expect(handoff).not.toHaveBeenCalled()
  ref.current = canvas; canvas.width = 900; canvas.height = 600
  click(); expect(handoff).toHaveBeenCalledTimes(1)
  expect(useToast.getState().toasts.at(-1)?.type).toBe('success')
})
it.each(['security', 'serialization', 'handoff', 'empty', 'invalid-data'])('catches %s failure and releases the lock', failure => {
  render(room())
  if (failure === 'security' || failure === 'serialization') serialize.mockImplementationOnce(() => { throw new DOMException('Failed', failure === 'security' ? 'SecurityError' : 'InvalidStateError') })
  if (failure === 'handoff') handoff.mockImplementationOnce(() => { throw new Error('Download handoff failed') })
  if (failure === 'empty') serialize.mockReturnValueOnce('')
  if (failure === 'invalid-data') serialize.mockReturnValueOnce('data:,')
  click()
  expect(screen.getByRole('alert').textContent).toContain("Check your browser's downloads before retrying")
  expect(useToast.getState().toasts).toHaveLength(1)
  expect(useToast.getState().toasts[0].type).toBe('error'); expect(useToast.getState().toasts[0].duration).toBe(0)
  click(); expect(useToast.getState().toasts.at(-1)?.type).toBe('success')
})
it('catches a context lookup exception and releases the lock', () => {
  const rendered = render(room()); const canvas = rendered.container.querySelector('canvas')!
  vi.mocked(canvas.getContext).mockImplementationOnce(() => { throw new Error('Context unavailable') })
  click(); expect(useToast.getState().toasts[0].type).toBe('error')
  click(); expect(handoff).toHaveBeenCalledTimes(1)
})
it('guards re-entrant export calls during both serialization and download handoff', () => {
  render(room()); serialize.mockImplementationOnce(() => { click(); return 'data:image/png;base64,fixture' })
  handoff.mockImplementationOnce(() => { click() })
  click()
  expect(serialize).toHaveBeenCalledTimes(1); expect(handoff).toHaveBeenCalledTimes(1)
  expect(useToast.getState().toasts).toHaveLength(1)
  click(); expect(handoff).toHaveBeenCalledTimes(2)
})
it('exposes export-only pending semantics if React renders during the synchronous handoff', () => {
  render(room())
  let pending: { disabled: boolean; busy: string | null; generateDisabled: boolean; brightnessDisabled: boolean; uploadDisabled: boolean } | undefined
  // No real async boundary or artificial wait: flush the queued pending update inside the mocked handoff.
  handoff.mockImplementationOnce(() => {
    flushSync(() => {})
    const button = screen.getByRole('button', { name: 'Preparing PNG…' }) as HTMLButtonElement
    pending = {
      disabled: button.disabled, busy: button.getAttribute('aria-busy'),
      generateDisabled: (screen.getByRole('button', { name: 'Generate background' }) as HTMLButtonElement).disabled,
      brightnessDisabled: (screen.getByRole('slider') as HTMLInputElement).disabled,
      uploadDisabled: (screen.getByLabelText('Upload room photo') as HTMLInputElement).disabled,
    }
  })
  click()
  expect(pending).toEqual({disabled:true,busy:'true',generateDisabled:false,brightnessDisabled:false,uploadDisabled:false})
  expect(useToast.getState().toasts[0].type).toBe('success')
  expect((screen.getByRole('button', { name: 'Export PNG' }) as HTMLButtonElement).disabled).toBe(false)
})
for (const outcome of ['success', 'failure']) {
  it.each(['unmount', 'company', 'user', 'artwork', 'backdrop', 'switch-back', 'route'])(`suppresses ${outcome} notification after re-entrant %s invalidation`, change => {
    const rendered = render(room())
    handoff.mockImplementationOnce(() => {
      if (change === 'unmount') flushSync(() => rendered.unmount())
      if (change === 'company') { scope.companyAccountId = 'company-b'; flushSync(() => rendered.rerender(room())) }
      if (change === 'user') { scope.userId = 'user-b'; flushSync(() => rendered.rerender(room())) }
      if (change === 'artwork') flushSync(() => rendered.rerender(room('data:image/png;base64,new')))
      if (change === 'backdrop') flushSync(() => rendered.rerender(<><RoomMockup artworkUrl="" backdrop="office"/><ToastContainer/></>))
      if (change === 'switch-back') {
        scope.companyAccountId = 'company-b'; flushSync(() => rendered.rerender(room()))
        scope.companyAccountId = 'company-a'; flushSync(() => rendered.rerender(room()))
      }
      if (change === 'route') window.location.hash = '#/quotes'
      if (outcome === 'failure') throw new Error('Handoff failed after scope invalidation')
    })
    click(); expect(useToast.getState().toasts).toEqual([])
    if (change !== 'unmount') { click(); expect(useToast.getState().toasts.at(-1)?.type).toBe('success') }
  })
}
it('allows invalid or still-loading artwork and opening images without a new readiness requirement', () => {
  render(<><RoomMockup artworkUrl="broken-image" openings={[{id:'opening',shape:'rect',xCm:0,yCm:0,widthCm:20,heightCm:20,imageUrl:'still-loading'}]}/><ToastContainer/></>)
  click(); expect(handoff).toHaveBeenCalledTimes(1); expect(useToast.getState().toasts[0].type).toBe('success')
})
