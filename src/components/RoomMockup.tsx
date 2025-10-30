import React, { useEffect, useRef, useState } from 'react'
import { getAiProvider } from '../lib/ai/provider'
import { loadRoomPreview, saveRoomPreview } from '../lib/roomPreview'
import type { RoomPreviewState } from '../lib/roomPreview'

export type RoomMockupProps = {
  artworkUrl: string   // dataURL/blob URL of artwork or framed composite
  width?: number
  height?: number
}

export default function RoomMockup({ artworkUrl, width = 900, height = 600 }: RoomMockupProps) {
  const [state, setState] = useState<RoomPreviewState>(() => loadRoomPreview())
  const [loading, setLoading] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<HTMLImageElement | null>(null)
  const artRef = useRef<HTMLImageElement | null>(null)

  // load artwork
  useEffect(() => {
    if (!artworkUrl) { artRef.current = null; draw(); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { artRef.current = img; draw() }
    img.src = artworkUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkUrl])

  // redraw on state change
  useEffect(() => { draw() }, [state])

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

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.shadowColor = 'rgba(0,0,0,0.3)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetX = 8
    ctx.shadowOffsetY = 10
    ctx.drawImage(img, -drawW/2, -drawH/2, drawW, drawH)
    ctx.restore()
  }

  // drag / zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    let lastX = 0, lastY = 0

    function onDown(e: MouseEvent) {
      dragging = true
      lastX = e.offsetX; lastY = e.offsetY
    }
    function onMove(e: MouseEvent) {
      if (!dragging) return
      const dx = e.offsetX - lastX
      const dy = e.offsetY - lastY
      lastX = e.offsetX; lastY = e.offsetY
      const nx = Math.max(0, Math.min(1, state.frame.x + dx/width))
      const ny = Math.max(0, Math.min(1, state.frame.y + dy/height))
      update({ frame: { x: nx, y: ny, scale: state.frame.scale, rotation: state.frame.rotation } })
    }
    function onUp() { dragging = false }
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
  }, [state.frame, width, height])

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
