import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RoomMockup, { type MatOpening } from '@/components/RoomMockup'

const scope = vi.hoisted(() => ({ companyAccountId: 'company-a', userId: 'user-a' }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => scope }))

class ControlledImage {
  static requests: ControlledImage[] = []
  src = ''
  crossOrigin = ''
  width = 800
  height = 600
  naturalWidth = 800
  naturalHeight = 600
  onload: (() => void) | null = null
  onerror: ((error: Event) => void) | null = null
  constructor() { ControlledImage.requests.push(this) }
  load() { act(() => { this.onload?.() }) }
  fail() { act(() => { this.onerror?.(new Event('error')) }) }
}
let drawn: ControlledImage[]
let placeholder: string[]
let clear: ReturnType<typeof vi.fn>
const image = (url: string) => {
  const matches = ControlledImage.requests.filter(img => img.src === url)
  expect(matches.length).toBeGreaterThan(0)
  return matches[matches.length - 1]
}
const opening = (imageUrl: string): MatOpening => ({ id: 'one', shape: 'rect', xCm: 1, yCm: 1, widthCm: 10, heightCm: 10, imageUrl })
const room = (artworkUrl = 'art-a', openings: MatOpening[] = []) => <RoomMockup artworkUrl={artworkUrl} openings={openings}/>

beforeEach(() => {
  scope.companyAccountId = 'company-a'; scope.userId = 'user-a'
  localStorage.clear()
  ControlledImage.requests = []; drawn = []; placeholder = []
  vi.stubGlobal('Image', ControlledImage)
  clear = vi.fn(() => { drawn = []; placeholder = [] })
  const methods = {
    clearRect: clear,
    drawImage: vi.fn((img: ControlledImage) => { drawn.push(img) }),
    fillText: vi.fn((text: string) => { placeholder.push(text) }),
  }
  const ctx = new Proxy(methods, { get(target, key) {
    if (!(key in target)) Reflect.set(target, key, vi.fn())
    return Reflect.get(target, key)
  } }) as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it('ignores artwork A loading after B, including any stale redraw', () => {
  const view = render(room())
  const a = image('art-a')
  view.rerender(room('art-b'))
  const b = image('art-b'); b.load()
  expect(drawn).toEqual([b])
  clear.mockClear(); a.load()
  expect(drawn).toEqual([b])
  expect(clear).not.toHaveBeenCalled()
})

it('ignores stale artwork errors without clearing the newer image', () => {
  const view = render(room()); const a = image('art-a')
  view.rerender(room('art-b')); const b = image('art-b'); b.load()
  clear.mockClear(); a.fail()
  expect(drawn).toEqual([b]); expect(clear).not.toHaveBeenCalled()
  expect(console.error).not.toHaveBeenCalled()
})

it('clearing artwork invalidates both outstanding callbacks and keeps the placeholder', () => {
  const view = render(room()); const a = image('art-a')
  view.rerender(room(''))
  expect(placeholder).toContain('No artwork image')
  clear.mockClear(); a.load(); a.fail()
  expect(drawn).toEqual([]); expect(placeholder).toContain('No artwork image')
  expect(clear).not.toHaveBeenCalled()
})

it('keeps the previous image while loading and clears it on current failure', () => {
  const view = render(room()); const a = image('art-a'); a.load()
  view.rerender(room('art-b'))
  expect(drawn).toEqual([a])
  image('art-b').fail()
  expect(drawn).toEqual([]); expect(placeholder).toContain('No artwork image')
})

it.each([[0, 600], [800, 0], [-1, 600], [800, NaN], [Infinity, 600]])(
  'rejects intrinsic artwork dimensions %s by %s even with usable display dimensions', (w, h) => {
    const view = render(room()); image('art-a').load()
    view.rerender(room('art-b')); const b = image('art-b')
    b.naturalWidth = w; b.naturalHeight = h; b.load()
    expect(drawn).toEqual([]); expect(placeholder).toContain('No artwork image')
  },
)

it('preserves anonymous CORS and revokes owned Blob URLs on replacement and unmount', () => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:owned')
    static revokeObjectURL = vi.fn()
  })
  const view = render(<RoomMockup artworkUrl={new Blob(['art']) as unknown as string}/> )
  const blob = image('blob:owned'); expect(blob.crossOrigin).toBe('anonymous')
  view.rerender(room())
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned')
  clear.mockClear(); blob.load(); blob.fail()
  expect(clear).not.toHaveBeenCalled()
  view.unmount()
})

it('evicts opening cache entries and rejects obsolete success/error callbacks', () => {
  const view = render(room('art-a', [opening('opening-a')]))
  const art = image('art-a'); art.load()
  const a = image('opening-a'); a.load()
  expect(drawn).toEqual([art, a])
  view.rerender(room('art-a', [opening('opening-b')]))
  const b = image('opening-b'); b.load()
  expect(drawn).toEqual([art, b])
  clear.mockClear(); a.load(); a.fail()
  expect(clear).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled()
  view.rerender(room('art-a', [opening('opening-a')]))
  const nextA = image('opening-a'); expect(nextA).not.toBe(a)
  expect(drawn).toEqual([art])
  nextA.load(); expect(drawn).toEqual([art, nextA])
})

it('retains cached images for unchanged URLs without reloading on geometry changes', () => {
  const view = render(room('art-a', [opening('opening-a')]))
  const art = image('art-a'); const a = image('opening-a'); art.load(); a.load()
  view.rerender(room('art-a', [{ ...opening('opening-a'), xCm: 20 }]))
  expect(image('opening-a')).toBe(a); expect(drawn).toEqual([art, a])
})

it.each([[0, 600], [800, 0], [NaN, 600], [800, Infinity]])(
  'keeps opening placeholders for invalid intrinsic dimensions %s by %s', (w, h) => {
    const view = render(room('art-a', [opening('opening-a')]))
    const art = image('art-a'); art.load()
    const a = image('opening-a'); a.naturalWidth = w; a.naturalHeight = h; a.load()
    expect(drawn).toEqual([art])
    view.rerender(room('art-a', [opening('opening-a')]))
    expect(drawn).toEqual([art])
  },
)

it.each(['companyAccountId', 'userId'] as const)('invalidates pending artwork and openings on %s changes', key => {
  const view = render(room('art-a', [opening('opening-a')]))
  const oldArt = image('art-a'); const oldOpening = image('opening-a')
  scope[key] = 'new-scope'
  view.rerender(room('art-a', [opening('opening-a')]))
  const art = image('art-a'); const child = image('opening-a')
  expect(art).not.toBe(oldArt); expect(child).not.toBe(oldOpening)
  art.load(); child.load(); clear.mockClear()
  oldArt.load(); oldArt.fail(); oldOpening.load(); oldOpening.fail()
  expect(drawn).toEqual([art, child]); expect(clear).not.toHaveBeenCalled()
  expect(console.error).not.toHaveBeenCalled()
})

it('ignores callbacks after unmount without logging or drawing', () => {
  const view = render(room('art-a', [opening('opening-a')]))
  const art = image('art-a'); const child = image('opening-a')
  view.unmount(); clear.mockClear()
  art.load(); art.fail(); child.load(); child.fail()
  expect(clear).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled()
})

it('cannot reinsert an evicted opening from a pending load, even when its URL returns', () => {
  const view = render(room('art-a', [opening('opening-a')]))
  const art = image('art-a'); art.load()
  const old = image('opening-a')
  view.rerender(room('art-a'))
  clear.mockClear(); old.load(); old.fail()
  expect(clear).not.toHaveBeenCalled()
  view.rerender(room('art-a', [opening('opening-a')]))
  const current = image('opening-a'); expect(current).not.toBe(old)
  expect(drawn).toEqual([art])
  current.load(); clear.mockClear(); old.load()
  expect(drawn).toEqual([art, current]); expect(clear).not.toHaveBeenCalled()
})

it('does not revalidate old callbacks when the company switches away and back', () => {
  const view = render(room('art-a', [opening('opening-a')]))
  const old = image('art-a'); const oldOpening = image('opening-a')
  scope.companyAccountId = 'company-b'; view.rerender(room('art-a', [opening('opening-a')]))
  scope.companyAccountId = 'company-a'; view.rerender(room('art-a', [opening('opening-a')]))
  const current = image('art-a'); const currentOpening = image('opening-a')
  current.load(); currentOpening.load(); clear.mockClear()
  old.load(); old.fail(); oldOpening.load(); oldOpening.fail()
  expect(drawn).toEqual([current, currentOpening]); expect(clear).not.toHaveBeenCalled()
})

it.each(['load', 'fail', 'unmount'] as const)('preserves Blob URL release on %s', outcome => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:owned')
    static revokeObjectURL = vi.fn()
  })
  const view = render(<RoomMockup artworkUrl={new Blob(['art']) as unknown as string}/> )
  if (outcome === 'unmount') view.unmount()
  else image('blob:owned')[outcome]()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned')
})

it('does not change persisted preferences, dimensions or transforms on scope invalidation', () => {
  const saved = { prompt: 'unchanged', wallColor: '#123456', brightness: 20,
    frame: { x: 0.2, y: 0.7, scale: 1.4, rotation: 25 }, showFloorLine: false }
  localStorage.setItem('frameit:roompreview:v1', JSON.stringify(saved))
  const view = render(room()); image('art-a').load()
  const canvas = view.container.querySelector('canvas')!
  const size = [canvas.width, canvas.height]
  const old = image('art-a'); scope.userId = 'user-b'; view.rerender(room())
  const current = image('art-a'); current.load(); clear.mockClear(); old.fail()
  expect(drawn).toEqual([current]); expect(clear).not.toHaveBeenCalled()
  expect([canvas.width, canvas.height]).toEqual(size)
  expect(JSON.parse(localStorage.getItem('frameit:roompreview:v1')!)).toEqual(saved)
})
