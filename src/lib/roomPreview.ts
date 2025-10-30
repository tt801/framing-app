// src/lib/roomPreview.ts
export type RoomPreviewState = {
  bgDataUrl?: string
  prompt: string
  wallColor: string
  brightness: number // -100..100
  frame: { x: number; y: number; scale: number; rotation: number }
  showFloorLine: boolean
}

const KEY = 'frameit:roompreview:v1'

const DEFAULT_STATE: RoomPreviewState = {
  prompt: 'modern living room, soft light',
  wallColor: '#eaeaea',
  brightness: 0,
  frame: { x: 0.5, y: 0.45, scale: 0.8, rotation: 0 },
  showFloorLine: true,
}

export function loadRoomPreview(): RoomPreviewState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw)
    // defensive merge
    return {
      ...DEFAULT_STATE,
      ...parsed,
      frame: { ...DEFAULT_STATE.frame, ...(parsed.frame || {}) },
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function saveRoomPreview(s: RoomPreviewState) {
  localStorage.setItem(KEY, JSON.stringify(s))
}
