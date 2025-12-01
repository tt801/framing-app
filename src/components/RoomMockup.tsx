import React, { useEffect, useRef, useState } from 'react'
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

type BackdropKind = 'studio' | 'living' | 'gallery' | 'office'

export type RoomMockupProps = {
  artworkUrl: string   // dataURL/blob URL of artwork or framed composite
  width?: number
  height?: number
  // Pro overlays (optional)
  openings?: MatOpening[]
  // Needed to convert cm -> px relative to the artwork drawn in the room
  artSizeCm?: { widthCm: number; heightCm: number }
  // notify parent when openings move (enable drag)
  onOpeningsChange?: (next: MatOpening[]) => void
  // high-level backdrop choice from Visualizer tab (studio / living / gallery / office)
  backdrop?: BackdropKind
}

export default function RoomMockup({
  artworkUrl,
  width = 900,
  height = 600,
  openings = [],
  artSizeCm,
  onOpeningsChange,
  backdrop,
}: RoomMockupProps) {
  const [state, setState] = useState<RoomPreviewState>(() => loadRoomPreview())
  const [loading, setLoading] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<HTMLImageElement | null>(null)
  const artRef = useRef<HTMLImageElement | null>(null)

  // live refs so event handlers always see the latest state/props
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const openingsRef = useRef(openings)
  useEffect(() => {
    openingsRef.current = openings
  }, [openings])

  // Cache for per-opening images
  const openingImgCache = useRef<Map<string, HTMLImageElement>>(new Map())

  // ---- drag state ----
  type DragMode = 'none' | 'artwork' | 'opening'
  const dragModeRef = useRef<DragMode>('none')
  const draggingOpeningIdRef = useRef<string | null>(null)

  // store pointer offset inside the opening (in cm)
  const openingOffsetRef = useRef<{ dxCm: number; dyCm: number }>({ dxCm: 0, dyCm: 0 })

  // drag start info for artwork (normalised pointer + starting frame pos)
  const dragStartRef = useRef<{
    pointerXNorm: number
    pointerYNorm: number
    frameX: number
    frameY: number
  } | null>(null)

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

  // ----------------- IMAGE LOADING -----------------

  useEffect(() => {
    if (!artworkUrl) {
      console.warn('[RoomMockup] No artworkUrl provided')
      artRef.current = null
      draw()
      return
    }

    let url: string | null = null
    let revoke = false

    if (typeof artworkUrl === 'string') {
      url = artworkUrl
    } else if (artworkUrl instanceof Blob) {
      url = URL.createObjectURL(artworkUrl)
      revoke = true
    } else {
      console.warn('[RoomMockup] Unsupported artworkUrl type:', artworkUrl)
      artRef.current = null
      draw()
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      console.log('[RoomMockup] Artwork image loaded OK', { url })
      artRef.current = img
      draw()
      if (revoke && url) URL.revokeObjectURL(url)
    }

    img.onerror = (err) => {
      console.error('[RoomMockup] Failed to load artwork image', { url, err })
      artRef.current = null
      draw()
      if (revoke && url) URL.revokeObjectURL(url)
    }

    img.src = url

    return () => {
      if (revoke && url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkUrl])

  // hydrate background image from saved state.bgDataUrl
  useEffect(() => {
    if (!state.bgDataUrl) {
      bgRef.current = null
      draw()
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      bgRef.current = img
      draw()
    }
    img.onerror = () => {
      console.error('RoomMockup: failed to load bgDataUrl image')
      bgRef.current = null
      draw()
    }
    img.src = state.bgDataUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bgDataUrl])

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
      img.onload = () => {
        if (!cancelled) {
          cache.set(url, img)
          draw()
        }
      }
      img.onerror = () => {
        console.error('RoomMockup: failed to load opening image:', url)
      }
      img.src = url
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openings.map(o => o.imageUrl).join('|')])

  // redraw on state or openings change
  useEffect(() => { draw() }, [state, openings])

  // ----------------- STATE UPDATE HELPERS -----------------

  function update(patch: Partial<RoomPreviewState>) {
    setState(prev => {
      const next: RoomPreviewState = {
        ...prev,
        ...patch,
        frame: patch.frame ? { ...prev.frame, ...patch.frame } : prev.frame,
      }
      saveRoomPreview(next)
      return next
    })
  }

  // Sync high-level Visualizer "backdrop" choice into wall colour etc.
  useEffect(() => {
    if (!backdrop) return

    if (backdrop === 'studio') {
      update({
        wallColor: '#f3f4f6',
        brightness: 5,
        showFloorLine: false,
      })
    } else if (backdrop === 'living') {
      update({
        wallColor: '#fefcf5',
        brightness: 0,
        showFloorLine: true,
      })
    } else if (backdrop === 'gallery') {
      update({
        wallColor: '#fdfdfd',
        brightness: 0,
        showFloorLine: false,
      })
    } else if (backdrop === 'office') {
      update({
        wallColor: '#f0f9ff',
        brightness: 0,
        showFloorLine: true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backdrop])

  // built-in backdrop images (public/room-backdrops/*.jpg)
  useEffect(() => {
    if (!backdrop) return

    const path = `/room-backdrops/${backdrop}.jpg`
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      console.log('[RoomMockup] Built-in backdrop loaded', path)
      bgRef.current = img
      draw()
    }

    img.onerror = (err) => {
      console.warn('[RoomMockup] Failed to load built-in backdrop', path, err)
    }

    img.src = path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backdrop])

  // ----------------- AI BACKGROUND GENERATION -----------------

  async function generate() {
    setLoading(true)
    try {
      const p = getAiProvider()
      if (!p || typeof p.generateBackground !== 'function') {
        console.warn('AI provider not configured for room backgrounds')
        alert('Background generation is not configured yet.')
        return
      }

      const dataUrl = await p.generateBackground({
        prompt: stateRef.current.prompt,
        seed: 1234,
        size: { width, height },
        wallColor: stateRef.current.wallColor,
      })

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        bgRef.current = img
        update({ bgDataUrl: dataUrl })
        draw()
      }
      img.onerror = () => {
        console.error('RoomMockup: failed to load generated background image')
      }
      img.src = dataUrl
    } catch (e) {
      console.error(e)
      alert('Could not generate background. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function onBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const data = String(reader.result || '')
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        bgRef.current = img
        update({ bgDataUrl: data })
        draw()
      }
      img.onerror = () => {
        console.error('RoomMockup: failed to load uploaded background image')
      }
      img.src = data
    }
    reader.readAsDataURL(f)
  }

  // ----------------- DRAW -----------------

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const displayW = rect.width || width
    const displayH = rect.height || height
    const dpr = window.devicePixelRatio || 1

    // Set internal canvas size to match on-screen size * DPR
    canvas.width = displayW * dpr
    canvas.height = displayH * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Work in CSS pixel coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, displayW, displayH)

    const s = stateRef.current

    // background
    if (bgRef.current) {
      ctx.drawImage(bgRef.current, 0, 0, displayW, displayH)
    } else {
      ctx.fillStyle = s.wallColor
      ctx.fillRect(0, 0, displayW, displayH)
    }

    // brightness overlay
    if (s.brightness !== 0) {
      const v = Math.max(-100, Math.min(100, s.brightness))
      const alpha = Math.abs(v) / 150
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`
      ctx.fillRect(0, 0, displayW, displayH)
    }

    // artwork
    const img = artRef.current
    if (!img) {
      console.warn('RoomMockup: no artwork image loaded. artworkUrl =', artworkUrl)

      const placeholderW = displayW * 0.36
      const placeholderH = placeholderW * 0.7
      const cx = s.frame.x * displayW
      const cy = s.frame.y * displayH

      ctx.save()
      ctx.translate(cx, cy)
      ctx.fillStyle = 'rgba(148,163,184,0.25)'
      ctx.fillRect(-placeholderW / 2, -placeholderH / 2, placeholderW, placeholderH)
      ctx.strokeStyle = 'rgba(148,163,184,0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(-placeholderW / 2, -placeholderH / 2, placeholderW, placeholderH)
      ctx.fillStyle = '#334155'
      ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No artwork image', 0, 0)
      ctx.restore()

      return
    }

    const cx = s.frame.x * displayW
    const cy = s.frame.y * displayH
    const scale = s.frame.scale
    const rot = (s.frame.rotation * Math.PI) / 180

    const baseW = displayW * 0.36
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
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)

    // --- PRO overlay: multiple mat openings rendered in artwork plane ---
    const openingsNow = openingsRef.current
    if (openingsNow.length) {
      openingsNow.forEach(o => {
        const isCircle = o.shape === 'circle'
        const ox = -drawW / 2 + o.xCm * pxPerCmX
        const oy = -drawH / 2 + o.yCm * pxPerCmY
        const ow = Math.max(4, o.widthCm * pxPerCmX)
        const ohRaw = Math.max(4, o.heightCm * pxPerCmY)
        const oh = isCircle ? Math.max(ow, ohRaw) : ohRaw

        ctx.save()
        ctx.beginPath()
        if (o.shape === 'rect') {
          const r = Math.min(8, Math.min(ow, oh) * 0.08)
          roundRectPath(ctx, ox, oy, ow, oh, r)
        } else {
          ctx.ellipse(ox + ow / 2, oy + oh / 2, ow / 2, oh / 2, 0, 0, Math.PI * 2)
        }
        ctx.clip()

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
        ctx.strokeStyle = active
          ? 'rgba(59,130,246,0.95)'
          : 'rgba(255,255,255,0.9)'
        ctx.lineWidth = active ? 3 : 2
        if (o.shape === 'rect') {
          const r = Math.min(8, Math.min(ow, oh) * 0.08)
          roundRectPath(ctx, ox, oy, ow, oh, r)
        } else {
          ctx.beginPath()
          ctx.ellipse(ox + ow / 2, oy + oh / 2, ow / 2, oh / 2, 0, 0, Math.PI * 2)
        }
        ctx.stroke()
        ctx.restore()
      })
    }

    ctx.restore()
  }

  // ----------------- POINTER / DRAG HANDLERS -----------------

  function canvasToArtworkLocalPx(mx: number, my: number) {
    const g = geomRef.current
    if (!g) return null
    const { cx, cy, rot, drawW, drawH } = g
    const dx = mx - cx
    const dy = my - cy
    const cos = Math.cos(-rot)
    const sin = Math.sin(-rot)
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos
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

  function isInsideOpening(o: MatOpening, xCm: number, yCm: number) {
    const withinRect =
      xCm >= o.xCm &&
      xCm <= o.xCm + o.widthCm &&
      yCm >= o.yCm &&
      yCm <= o.yCm + o.heightCm
    if (!withinRect) return false
    if (o.shape === 'rect') return true
    const cx = o.xCm + o.widthCm / 2
    const cy = o.yCm + o.heightCm / 2
    const rx = Math.max(1e-6, o.widthCm / 2)
    const ry = Math.max(1e-6, o.heightCm / 2)
    const dx = (xCm - cx) / rx
    const dy = (yCm - cy) / ry
    return dx * dx + dy * dy <= 1
  }

  function clampOpening(o: MatOpening): MatOpening {
    const aw = artSizeCm?.widthCm ?? 100
    const ah = artSizeCm?.heightCm ?? 100
    const w = Math.min(o.widthCm, aw)
    const h = Math.min(o.heightCm, ah)
    const x = Math.max(0, Math.min(aw - w, o.xCm))
    const y = Math.max(0, Math.min(ah - h, o.yCm))
    return { ...o, xCm: x, yCm: y, widthCm: w, heightCm: h }
  }

  function mutateOpening(id: string, patch: Partial<MatOpening>) {
    if (!onOpeningsChange) return
    const current = openingsRef.current
    const next = current.map(o => (o.id === id ? clampOpening({ ...o, ...patch }) : o))
    onOpeningsChange(next)
  }

  // drag / zoom / opening-drag
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false

    function onDown(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      const openingsNow = openingsRef.current

      // try openings first
      if (openingsNow.length && onOpeningsChange && geomRef.current) {
        const local = canvasToArtworkLocalPx(mx, my)
        if (local) {
          const { x, y, drawW, drawH } = local
          if (x >= 0 && x <= drawW && y >= 0 && y <= drawH) {
            const { xCm, yCm } = artworkPxToCm(x, y)
            for (let i = openingsNow.length - 1; i >= 0; i--) {
              const o = openingsNow[i]
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

      // else artwork drag: remember pointer and frame pos at start
      const s = stateRef.current
      const pointerXNorm = (e.clientX - rect.left) / rect.width
      const pointerYNorm = (e.clientY - rect.top) / rect.height
      dragStartRef.current = {
        pointerXNorm,
        pointerYNorm,
        frameX: s.frame.x,
        frameY: s.frame.y,
      }

      dragModeRef.current = 'artwork'
      draggingOpeningIdRef.current = null
      dragging = true
    }

    function onMove(e: MouseEvent) {
      if (!dragging) return

      const rect = canvas.getBoundingClientRect()

      if (dragModeRef.current === 'opening' && onOpeningsChange && geomRef.current) {
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const local = canvasToArtworkLocalPx(mx, my)
        if (!local) return
        const { x, y, drawW, drawH } = local
        const clampedX = Math.max(0, Math.min(drawW, x))
        const clampedY = Math.max(0, Math.min(drawH, y))
        const { xCm, yCm } = artworkPxToCm(clampedX, clampedY)
        const id = draggingOpeningIdRef.current!
        const off = openingOffsetRef.current
        mutateOpening(id, { xCm: xCm - off.dxCm, yCm: yCm - off.dyCm })
        draw()
        return
      }

      if (dragModeRef.current === 'artwork') {
        const start = dragStartRef.current
        if (!start) return

        const pointerXNorm = (e.clientX - rect.left) / rect.width
        const pointerYNorm = (e.clientY - rect.top) / rect.height

        const deltaX = pointerXNorm - start.pointerXNorm
        const deltaY = pointerYNorm - start.pointerYNorm

        const nx = Math.max(0, Math.min(1, start.frameX + deltaX))
        const ny = Math.max(0, Math.min(1, start.frameY + deltaY))

        update({
          frame: {
            x: nx,
            y: ny,
            scale: stateRef.current.frame.scale,
            rotation: stateRef.current.frame.rotation,
          },
        })
      }
    }

    function onUp() {
      dragging = false
      dragModeRef.current = 'none'
      draggingOpeningIdRef.current = null
      dragStartRef.current = null
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const s = stateRef.current
      const newScale = Math.max(
        0.2,
        Math.min(3, s.frame.scale * (e.deltaY < 0 ? 1.05 : 0.95)),
      )
      update({
        frame: {
          x: s.frame.x,
          y: s.frame.y,
          scale: newScale,
          rotation: s.frame.rotation,
        },
      })
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
    // deliberate: no deps so handlers are stable; they read from refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOpeningsChange])

  function exportPng() {
    const url = canvasRef.current?.toDataURL('image/png')
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = 'room-preview.png'
    a.click()
  }

  // ----------------- RENDER -----------------

  return (
  <div className="grid gap-4">
    <div className="flex flex-wrap items-end gap-3">
      {/* Prompt + Generate background */}
      <div className="flex items-end gap-2 flex-1 min-w-[260px]">
        <label className="text-sm flex-1">
          Prompt
          <input
            className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
            value={state.prompt}
            onChange={(e) => update({ prompt: e.target.value })}
          />
        </label>
        <button
          onClick={generate}
          disabled={loading}
          className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap h-[33px]"
        >
          {loading ? "Generating…" : "Generate background"}
        </button>
      </div>

      {/* Brightness + Upload + Export */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm flex items-center gap-2">
          <span>Brightness</span>
          <input
            type="range"
            min={-100}
            max={100}
            className="align-middle"
            value={state.brightness}
            onChange={(e) => update({ brightness: Number(e.target.value) })}
          />
        </label>

        <label className="inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs cursor-pointer hover:bg-gray-50 whitespace-nowrap">
          Upload room photo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onBgUpload}
          />
        </label>

        <button
          onClick={exportPng}
          className="inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs hover:bg-gray-50 whitespace-nowrap"
        >
          Export PNG
        </button>
      </div>
    </div>

    <div className="overflow-hidden rounded-2xl border shadow-sm bg-white">
      <canvas
        ref={canvasRef}
        className="block w-full h-auto cursor-move"
        style={{ width: "100%", height: "auto", aspectRatio: `${width}/${height}` }}
      />
    </div>
  </div>
);
}

/* ---------------- helpers for drawing ---------------- */

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
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
  let sw = srcW,
    sh = srcH,
    sx = 0,
    sy = 0
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

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'
  ctx.setLineDash([4, 4])
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  ctx.setLineDash([])
}
