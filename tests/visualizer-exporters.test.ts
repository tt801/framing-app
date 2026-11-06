import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exportNodeAsPng, exportNodeAsJpeg, exportNodeAsPdf } from '@/lib/exporters'
const mocks = vi.hoisted(() => ({ capture: vi.fn(), image: vi.fn(), save: vi.fn(), constructor: vi.fn() }))
vi.mock('html2canvas', () => ({ default: mocks.capture }))
vi.mock('jspdf', () => ({ default: function (options: unknown) {
  mocks.constructor(options)
  return { internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } }, addImage: mocks.image, save: mocks.save }
} }))
let canvas: HTMLCanvasElement
let anchorClick: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.resetAllMocks(); canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
  vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/test;base64,fixture')
  mocks.capture.mockResolvedValue(canvas)
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
it.each([
  { exporter: exportNodeAsPng, background: null, mime: 'image/png', args: ['image/png'], file: 'frameit.png' },
  { exporter: exportNodeAsJpeg, background: '#ffffff', mime: 'image/jpeg', args: ['image/jpeg', 0.92], file: 'frameit.jpg' },
])('preserves $file capture and anchor download contract', async ({ exporter, background, args, file }) => {
  const node = document.createElement('div'); await exporter(node)
  expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(node, { backgroundColor: background, scale: 2 })
  expect(canvas.toDataURL).toHaveBeenCalledWith(...args)
  expect(anchorClick).toHaveBeenCalledTimes(1)
  const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement
  expect(anchor.download).toBe(file); expect(anchor.href).toBe('data:image/test;base64,fixture')
})
it.each([{ w: 800, h: 600, x: 10, y: 77.25, dw: 190, dh: 142.5 }, { w: 100, h: 400, x: 70.375, y: 10, dw: 69.25, dh: 277 }])('preserves A4 PDF fit and placement for $w × $h', async size => {
  canvas.width = size.w; canvas.height = size.h
  const node = document.createElement('div'); await exportNodeAsPdf(node)
  expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(node, { backgroundColor: '#ffffff', scale: 2 })
  expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.95)
  expect(mocks.constructor).toHaveBeenCalledExactlyOnceWith({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  expect(mocks.image).toHaveBeenCalledExactlyOnceWith('data:image/test;base64,fixture', 'JPEG', size.x, size.y, size.dw, size.dh)
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('frameit.pdf')
  expect(anchorClick).not.toHaveBeenCalled()
})
it.each([exportNodeAsPng, exportNodeAsJpeg, exportNodeAsPdf])('propagates capture rejection without requesting a download', async exporter => {
  mocks.capture.mockRejectedValue(new Error('Capture failed'))
  await expect(exporter(document.createElement('div'))).rejects.toThrow('Capture failed')
  expect(anchorClick).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
})
it.each([exportNodeAsPng, exportNodeAsJpeg, exportNodeAsPdf])('propagates serialization failure', async exporter => {
  vi.mocked(canvas.toDataURL).mockImplementation(() => { throw new DOMException('Tainted', 'SecurityError') })
  await expect(exporter(document.createElement('div'))).rejects.toThrow('Tainted')
  expect(anchorClick).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
})
