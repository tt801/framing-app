import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getAiProvider } from '../lib/ai/provider'
import { loadRoomPreview, saveRoomPreview } from '../lib/roomPreview'
import type { RoomPreviewState } from '../lib/roomPreview'

type OpeningShape = 'rect' | 'oval' | 'circle'
export type MatOpening = {
  id: string
  shape: OpeningShape
  xCm: number
  yCm: number
  widthCm: number
  heightCm: number
  imageUrl?: string
}

export type RoomMockupProps = {
  artworkUrl: string   // dataURL/blob URL of artwork or framed composite
  width?: number
  height?: number
  // Pro overlays (optional)
  openings?: MatOpening[]
  // Needed to convert cm -> px relative to the artwork drawn in the room
  artSizeCm?: { widthCm: number; heightCm: number }
  // NEW: notify parent when openings move (enable drag)
  onOpeningsChange?: (next: MatOpening[]) => void
}

export default function RoomMockup({
  artworkUrl,
  width = 900,
  height = 600,
  openings = [],
  artSizeCm,
  onOpeningsChange,
}: RoomMockupProps) {
  const [state, setState] = useState<RoomPreviewState>(() => loadRoomPreview())
  const [loading, setLoading] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<HTMLImageElement | null>(null)
  const artRef = useRef<HTMLImageElement | null>(null)

  // Cache for per-opening images
  const openingImgCache = useRef<Map<string, HTMLImageElement>>(new Map())

  // ---- drag state ----
  type DragMode = 'none' | 'artwork' | 'opening'
  const dragModeRef = useRef<DragMode>('none')
  const draggingOpeningIdRef = useRef<string | null>(null)
  // store pointer offset inside the opening (in cm)
  const openingOffsetRef = useRef<{ dxCm: number; dyCm: number }>({ dxCm: 0, dyCm: 0 })

  // geometry cache from last draw (so events can reuse)
  const geomRef = useRef<{
    cx: number
    cy: number
    rot: number
    drawW: number
    drawH: number
    pxPerCmX: number
    pxPerCmY: number
  } | null>(null)

  // load artwork
  useEffect(() => {
    if (!artworkUrl) { artRef.current = null; draw(); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { artRef.current = img; draw() }
    img.src = artworkUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkUrl])

  // (Re)load per-opening images if URLs change
  useEffect(() => {
    let cancelled = false
    const cache = openingImgCache.current
    const urls = new Set<string>()
    openings.forEach(o => { if (o.imageUrl) urls.add(o.imageUrl) })

    // evict images no longer used
    for (const [k] of cache) {
      if (!urls.has(k)) cache.delete(k)
    }

    // load any new ones
    urls.forEach(url => {
      if (cache.has(url)) return
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { if (!cancelled) { cache.set(url, img); draw() } }
      img.src = url
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openings.map(o => o.imageUrl).join('|')])

  // redraw on state or openings change
  useEffect(() => { draw() }, [state, openings])

  function update(patch: Partial<RoomPreviewState>) {
    const next: RoomPreviewState = {
      ...state,
      ...patch,
      frame: patch.frame ? { ...state.frame, ...patch.frame } : state.frame
    }
    setState(next)
    saveRoomPreview(next)
  }

  async function generate() {
    setLoading(true)
    try {
      const p = getAiProvider()
      const dataUrl = await p.generateBackground({
        prompt: state.prompt, seed: 1234, size: { width, height }, wallColor: state.wallColor
      })
      const img = new Image()
      img.onload = () => { bgRef.current = img; update({ bgDataUrl: dataUrl }); draw() }
      img.src = dataUrl
    } catch (e) {
      console.error(e)
      alert('Could not generate background. Please try again.')
    } finally { setLoading(false) }
  }

  function onBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const data = String(reader.result || '')
      const img = new Image()
      img.onload = () => { bgRef.current = img; update({ bgDataUrl: data }); draw() }
      img.src = data
    }
    reader.readAsDataURL(f)
  }

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0,0,canvas.width,canvas.height)

    // background
    if (bgRef.current) {
      ctx.drawImage(bgRef.current, 0, 0, width, height)
    } else {
      ctx.fillStyle = state.wallColor
      ctx.fillRect(0,0,width,height)
    }

    // brightness overlay
    if (state.brightness !== 0) {
      const v = Math.max(-100, Math.min(100, state.brightness))
      const alpha = Math.abs(v) / 150
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`
      ctx.fillRect(0,0,width,height)
    }

    // optional floor line
    if (state.showFloorLine) {
      const y = Math.floor(height*0.72)
      const grd = ctx.createLinearGradient(0,y-10,0,y+10)
      grd.addColorStop(0,'rgba(0,0,0,0.2)')
      grd.addColorStop(1,'rgba(0,0,0,0)')
      ctx.fillStyle = grd
      ctx.fillRect(0,y-10,width,20)
    }

    // artwork
    const img = artRef.current
    if (!img) return
    const cx = state.frame.x * width
    const cy = state.frame.y * height
    const scale = state.frame.scale
    const rot = state.frame.rotation * Math.PI/180

    const baseW = width * 0.36
    const drawW = baseW * scale
    const ratio = img.height / img.width
    const drawH = drawW * ratio

    // store geometry for event handlers
    const artWcm = artSizeCm?.widthCm ?? 100
    const artHcm = artSizeCm?.heightCm ?? 100
    const pxPerCmX = drawW / Math.max(1, artWcm)
    const pxPerCmY = drawH / Math.max(1, artHcm)
    geomRef.current = { cx, cy, rot, drawW, drawH, pxPerCmX, pxPerCmY }

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.shadowColor = 'rgba(0,0,0,0.3)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetX = 8
    ctx.shadowOffsetY = 10
    ctx.drawImage(img, -drawW/2, -drawH/2, drawW, drawH)

    // --- PRO overlay: multiple mat openings rendered in artwork plane ---
    if (openings.length) {
      openings.forEach(o => {
        // compute rect within the current transformed artwork space
        const isCircle = o.shape === 'circle'
        const ox = -drawW/2 + o.xCm * pxPerCmX
        const oy = -drawH/2 + o.yCm * pxPerCmY
        const ow = Math.max(4, o.widthCm * pxPerCmX)
        const ohRaw = Math.max(4, o.heightCm * pxPerCmY)
        const oh = isCircle ? Math.max(ow, ohRaw) : ohRaw

        ctx.save()
        ctx.beginPath()
        if (o.shape === 'rect') {
          const r = Math.min(8, Math.min(ow, oh) * 0.08)
          roundRectPath(ctx, ox, oy, ow, oh, r)
        } else {
          ctx.ellipse(ox + ow/2, oy + oh/2, ow/2, oh/2, 0, 0, Math.PI*2)
        }
        ctx.clip()

        // draw opening image or placeholder
        if (o.imageUrl) {
          const cached = openingImgCache.current.get(o.imageUrl)
          if (cached) {
            const { sx, sy, sw, sh } = objectFitCover(cached.width, cached.height, ow, oh)
            ctx.drawImage(cached, sx, sy, sw, sh, ox, oy, ow, oh)
          } else {
            drawPlaceholder(ctx, ox, oy, ow, oh)
          }
        } else {
          drawPlaceholder(ctx, ox, oy, ow, oh)
        }
        ctx.restore()

        // outline (slightly stronger if actively dragged)
        ctx.save()
        const active = draggingOpeningIdRef.current === o.id && dragModeRef.current === 'opening'
        ctx.strokeStyle = active ? 'rgba(59,130,246,0.95)' : 'rgba(255,255,255,0.9)'
        ctx.lineWidth = active ? 3 : 2
        if (o.shape === 'rect') {
          const r = Math.min(8, Math.min(ow, oh) * 0.08)
          roundRectPath(ctx, ox, oy, ow, oh, r)
        } else {
          ctx.beginPath()
          ctx.ellipse(ox + ow/2, oy + oh/2, ow/2, oh/2, 0, 0, Math.PI*2)
        }
        ctx.stroke()
        ctx.restore()
      })
    }

    ctx.restore()
  }

  // --------- pointer helpers ---------
  function canvasToArtworkLocalPx(mx: number, my: number) {
    // convert canvas coords -> artwork local pixel space (before drawing offset: -drawW/2.. +drawW/2)
    const g = geomRef.current
    if (!g) return null
    const { cx, cy, rot, drawW, drawH } = g
    // shift to artwork origin, un-rotate
    const dx = mx - cx
    const dy = my - cy
    const cos = Math.cos(-rot)
    const sin = Math.sin(-rot)
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos
    // convert to top-left based local px
    const x = lx + drawW / 2
    const y = ly + drawH / 2
    return { x, y, drawW, drawH }
  }

  function artworkPxToCm(x: number, y: number) {
    const g = geomRef.current
    if (!g) return { xCm: 0, yCm: 0 }
    const { pxPerCmX, pxPerCmY } = g
    return { xCm: x / Math.max(1e-6, pxPerCmX), yCm: y / Math.max(1e-6, pxPerCmY) }
  }

  // hit test inside an opening (in cm space)
  function isInsideOpening(o: MatOpening, xCm: number, yCm: number) {
    const withinRect = (xCm >= o.xCm && xCm <= o.xCm + o.widthCm && yCm >= o.yCm && yCm <= o.yCm + o.heightCm)
    if (!withinRect) return false
    if (o.shape === 'rect') return true
    // ellipse/circle precise test
    const cx = o.xCm + o.widthCm / 2
    const cy = o.yCm + o.heightCm / 2
    const rx = Math.max(1e-6, o.widthCm / 2)
    const ry = Math.max(1e-6, o.heightCm / 2)
    const dx = (xCm - cx) / rx
    const dy = (yCm - cy) / ry
    return dx*dx + dy*dy <= 1
  }

  function clampOpening(o: MatOpening): MatOpening {
    // keep opening fully inside artwork cm bounds
    const aw = artSizeCm?.widthCm ?? 100
    const ah = artSizeCm?.heightCm ?? 100
    const w = Math.min(o.widthCm, aw)
    const h = Math.min(o.heightCm, ah)
    let x = Math.max(0, Math.min(aw - w, o.xCm))
    let y = Math.max(0, Math.min(ah - h, o.yCm))
    return { ...o, xCm: x, yCm: y, widthCm: w, heightCm: h }
  }

  function mutateOpening(id: string, patch: Partial<MatOpening>) {
    if (!onOpeningsChange) return
    const next = openings.map(o => (o.id === id ? clampOpening({ ...o, ...patch }) : o))
    onOpeningsChange(next)
  }

  // drag / zoom / opening-drag
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    let lastX = 0, lastY = 0

    function onDown(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      // if we can drag openings, test them first
      if (openings.length && onOpeningsChange && geomRef.current) {
        const local = canvasToArtworkLocalPx(mx, my)
        if (local) {
          const { x, y, drawW, drawH } = local
          // must be inside the artwork image first
          if (x >= 0 && x <= drawW && y >= 0 && y <= drawH) {
            const { xCm, yCm } = artworkPxToCm(x, y)
            // top-most hit: check in reverse to prioritize later items
            for (let i = openings.length - 1; i >= 0; i--) {
              const o = openings[i]
              if (isInsideOpening(o, xCm, yCm)) {
                dragModeRef.current = 'opening'
                draggingOpeningIdRef.current = o.id
                openingOffsetRef.current = { dxCm: xCm - o.xCm, dyCm: yCm - o.yCm }
                dragging = true
                return
              }
            }
          }
        }
      }

      // else fall back to artwork drag
      dragModeRef.current = 'artwork'
      draggingOpeningIdRef.current = null
      dragging = true
      lastX = e.offsetX; lastY = e.offsetY
    }

    function onMove(e: MouseEvent) {
      if (!dragging) return

      if (dragModeRef.current === 'opening' && onOpeningsChange && geomRef.current) {
        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const local = canvasToArtworkLocalPx(mx, my)
        if (!local) return
        const { x, y, drawW, drawH } = local
        // only respond if pointer stays over artwork bounds
        const clampedX = Math.max(0, Math.min(drawW, x))
        const clampedY = Math.max(0, Math.min(drawH, y))
        const { xCm, yCm } = artworkPxToCm(clampedX, clampedY)
        const id = draggingOpeningIdRef.current!
        const off = openingOffsetRef.current
        mutateOpening(id, { xCm: xCm - off.dxCm, yCm: yCm - off.dyCm })
        draw()
        return
      }

      // artwork drag (keep existing behavior)
      const dx = e.offsetX - lastX
      const dy = e.offsetY - lastY
      lastX = e.offsetX; lastY = e.offsetY
      const nx = Math.max(0, Math.min(1, state.frame.x + dx/width))
      const ny = Math.max(0, Math.min(1, state.frame.y + dy/height))
      update({ frame: { x: nx, y: ny, scale: state.frame.scale, rotation: state.frame.rotation } })
    }

    function onUp() {
      dragging = false
      dragModeRef.current = 'none'
      draggingOpeningIdRef.current = null
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const s = Math.max(0.2, Math.min(3, state.frame.scale * (e.deltaY < 0 ? 1.05 : 0.95)))
      update({ frame: { x: state.frame.x, y: state.frame.y, scale: s, rotation: state.frame.rotation } })
    }

    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.frame, width, height, openings, onOpeningsChange])

  function exportPng() {
    const url = canvasRef.current?.toDataURL('image/png')
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = 'room-preview.png'
    a.click()
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Prompt
          <input className="ml-2 w-[320px] rounded-md border px-3 py-2"
                 value={state.prompt}
                 onChange={(e)=>update({prompt: e.target.value})} />
        </label>
        <label className="text-sm">Wall
          <input type="color" className="ml-2 h-9 w-12 cursor-pointer rounded-md border"
                 value={state.wallColor}
                 onChange={(e)=>update({wallColor: e.target.value})} />
        </label>
        <label className="text-sm">Brightness
          <input type="range" min={-100} max={100} className="ml-2 align-middle"
                 value={state.brightness}
                 onChange={(e)=>update({brightness: Number(e.target.value)})} />
        </label>
        <label className="text-sm">Rotate
          <input type="range" min={-15} max={15} className="ml-2 align-middle w-40"
                 value={state.frame.rotation}
                 onChange={(e)=>update({ frame: { rotation: Number(e.target.value) } as any })} />
        </label>
        <label className="text-sm inline-flex items-center gap-2">
          <input type="checkbox"
                 checked={state.showFloorLine}
                 onChange={(e)=>update({showFloorLine:e.target.checked})} />
          Floor line
        </label>
        <button onClick={generate} disabled={loading}
                className="rounded-md border px-3 py-2 hover:bg-gray-50 disabled:opacity-50">
          {loading ? 'Generating…' : 'Generate Background'}
        </button>
        <label className="rounded-md border px-3 py-2 cursor-pointer hover:bg-gray-50">
          Upload Room Photo
          <input type="file" accept="image/*" className="hidden" onChange={onBgUpload} />
        </label>
        <button onClick={exportPng} className="rounded-md border px-3 py-2 hover:bg-gray-50">Export PNG</button>
      </div>

      <div className="overflow-hidden rounded-2xl border shadow-sm bg-white">
        <canvas ref={canvasRef}
                className="block w-full h-auto"
                style={{ width: '100%', height: 'auto', aspectRatio: `${width}/${height}` }} />
      </div>
    </div>
  )
}

/* ---------------- helpers for drawing ---------------- */

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
}

function objectFitCover(srcW: number, srcH: number, dstW: number, dstH: number) {
  const srcRatio = srcW / srcH
  const dstRatio = dstW / dstH
  let sw = srcW, sh = srcH, sx = 0, sy = 0
  if (srcRatio > dstRatio) {
    sh = srcH
    sw = sh * dstRatio
    sx = (srcW - sw) / 2
    sy = 0
  } else {
    sw = srcW
    sh = sw / dstRatio
    sx = 0
    sy = (srcH - sh) / 2
  }
  return { sx, sy, sw, sh }
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'
  ctx.setLineDash([4, 4])
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  ctx.setLineDash([])
}
