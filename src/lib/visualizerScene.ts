import { matGeometry, isMatBorders, type MatBorders } from './matGeometry'
import type { RoomPreviewState } from './roomPreview'
import { createMatSlots, type MatSlot } from './visualizerMats'
export type OpeningShape = 'rect' | 'oval' | 'circle'
export type DesignOpening = { id: string; shape: OpeningShape; xCm: number; yCm: number; widthCm: number; heightCm: number; imageUrl?: string }
export type LayoutModel = 'single-board-v1' | 'shared-group-v1' | 'legacy-individual-v1'
export const effectiveMatActivity = (mode: 'basic' | 'pro', model: LayoutModel, active: boolean[]) => active.map((enabled, i) => enabled && !(mode === 'pro' && model === 'single-board-v1' && i > 0))
export type VisualizerDesign = {
  version: 1 | 2; layoutModel: LayoutModel; mode: 'basic' | 'pro'
  basic: { widthCm: number; heightCm: number; imageUrl: string; mats?: MatSlot[]; room?: RoomPreviewState; backdrop?: 'studio' | 'living' | 'gallery' | 'office' }
  pro: { room?: RoomPreviewState; backdrop?: 'studio' | 'living' | 'gallery' | 'office'; origin: { x: number; y: number } | null; openings: DesignOpening[]; layout?: { widthCm: number; heightCm: number }; mat?: MatSlot; legacy?: { layoutModel: LayoutModel; mats: MatSlot[] } }
  mats: MatSlot[]
}
type Data = Record<string, unknown>
const record = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const validPoint = (value: unknown) => value === null || [record(value).x, record(value).y].every(n => typeof n === 'number' && Number.isFinite(n))
const validOpenings = (value: unknown): boolean => Array.isArray(value) && new Set(value.map(o => record(o).id)).size === value.length && value.every(o => {
  const p = record(o)
  return typeof p.id === 'string' && p.id.length > 0 && ['rect', 'oval', 'circle'].includes(String(p.shape)) &&
    [p.xCm, p.yCm, p.widthCm, p.heightCm].every(n => typeof n === 'number' && Number.isFinite(n)) && Number(p.widthCm) > 0 && Number(p.heightCm) > 0 &&
    (p.imageUrl === undefined || typeof p.imageUrl === 'string') && (p.shape !== 'circle' || p.widthCm === p.heightCm)
})
const same = (a: unknown, b: unknown): boolean => a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null &&
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => same(value, (b as Data)[key])))
/** Additive snapshot adapter. Existing JSON fields stay readable, but conflicting mirrors are never silently preferred. */
export function decodeVisualizerPreset(value: unknown): { state: Data; issue: string | null } {
  let state = record(value)
  const initialMats = record(state.mats)
  const conflictingOrigin = initialMats.origin !== undefined && initialMats.proOrigin !== undefined && !same(initialMats.origin, initialMats.proOrigin)
  if (initialMats.origin !== undefined && initialMats.proOrigin === undefined) state = { ...state, mats: { ...initialMats, proOrigin: initialMats.origin } }
  const fail = () => ({ state, issue: 'Saved design needs review: unsupported version or conflicting artwork/mat data.' })
  if (conflictingOrigin) return fail()
  if (state.visualizerDesign === undefined) {
    const mats = record(state.mats), art = record(state.art), model = mats.layoutModel
    if ((mats.mode !== undefined && mats.mode !== 'basic' && mats.mode !== 'pro') ||
      (mats.proOrigin !== undefined && !validPoint(mats.proOrigin)) || (mats.openings !== undefined && !validOpenings(mats.openings)) ||
      [art.widthCm, art.heightCm].some(n => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0))) return fail()
    return model !== undefined && model !== 'single-board-v1' && model !== 'shared-group-v1' && model !== 'legacy-individual-v1' ? fail() : { state, issue: null }
  }
  const d = record(state.visualizerDesign), basic = record(d.basic), pro = record(d.pro)
  if ((typeof d.version !== 'number' || ![1, 2].includes(d.version)) || !['basic', 'pro'].includes(String(d.mode)) || !['single-board-v1', 'shared-group-v1', 'legacy-individual-v1'].includes(String(d.layoutModel)) ||
    ![basic.widthCm, basic.heightCm].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) || typeof basic.imageUrl !== 'string' ||
    !validPoint(pro.origin) || !Array.isArray(pro.openings) || !Array.isArray(d.mats) || d.mats.length !== 3) return fail()
  if (!d.mats.every(s => typeof record(s).materialId === 'string' && typeof record(s).locked === 'boolean' && isMatBorders(record(s).borders))) return fail()
  if (!validOpenings(pro.openings)) return fail()
  if (pro.layout !== undefined && ![record(pro.layout).widthCm, record(pro.layout).heightCm].every(n => typeof n === "number" && Number.isFinite(n) && n > 0)) return fail()
  if (d.version === 1 && (basic.mats !== undefined || pro.mat !== undefined || pro.legacy !== undefined)) return fail()
  if (d.version === 2) {
    const validSlot = (value: unknown) => typeof record(value).materialId === 'string' && !!record(value).materialId && typeof record(value).locked === 'boolean' && isMatBorders(record(value).borders);
    const validSlots = (value: unknown): value is MatSlot[] => Array.isArray(value) && value.length === 3 && value.every(validSlot);
    const validRoom = (room: unknown) => {
      const r = record(room), f = record(r.frame);
      return typeof r.prompt === 'string' && typeof r.wallColor === 'string' && typeof r.showFloorLine === 'boolean' &&
        (r.bgDataUrl === undefined || typeof r.bgDataUrl === 'string') &&
        [r.brightness, f.x, f.y, f.scale, f.rotation].every(n => typeof n === 'number' && Number.isFinite(n)) && Number(f.scale) > 0;
    };
    if ([basic, pro].some(w => (w.room !== undefined && !validRoom(w.room)) || (w.backdrop !== undefined && !['studio', 'living', 'gallery', 'office'].includes(String(w.backdrop))))) return fail();
    const backdrop = d.mode === 'basic' ? basic.backdrop : pro.backdrop;
    if (state.backdrop !== undefined && backdrop !== undefined && !same(state.backdrop, backdrop)) return fail();
    if (!validSlots(basic.mats) || !validSlot(pro.mat) || pro.layout === undefined) return fail();
    const legacy = record(pro.legacy);
    if (pro.legacy !== undefined && (!validSlots(legacy.mats) || !['single-board-v1', 'shared-group-v1', 'legacy-individual-v1'].includes(String(legacy.layoutModel)))) return fail();
    const expected = d.mode === 'basic' ? basic.mats : pro.legacy !== undefined ? legacy.mats : [(pro.mat as MatSlot), ...createMatSlots().slice(1)];
    if (!same(d.mats, expected) || d.layoutModel !== (d.mode === 'pro' && pro.legacy !== undefined ? legacy.layoutModel : 'single-board-v1')) return fail();
  }
  const art = d.version === 2
    ? { widthCm: d.mode === 'pro' ? record(pro.layout).widthCm : basic.widthCm, heightCm: d.mode === 'pro' ? record(pro.layout).heightCm : basic.heightCm, imageUrl: d.mode === 'pro' ? '' : basic.imageUrl }
    : d.mode === "pro" && pro.layout !== undefined ? { ...basic, ...record(pro.layout) } : basic
  const slots = d.mats as MatSlot[]
  const mats: Data = { geometryVersion: 3, layoutModel: d.layoutModel, mode: d.mode, proOrigin: pro.origin, openings: pro.openings,
    borders: slots.map(s => s.borders), locks: slots.map(s => s.locked), ...Object.fromEntries(slots.map((s, i) => [`selectedMat${i + 1}`, s.materialId])) }
  const oldArt = record(state.art), oldMats = record(state.mats)
  const oldDimensions = record(record(state.dims).art)
  if (['widthCm', 'heightCm'].some(key => oldDimensions[key] !== undefined && !same(oldDimensions[key], art[key])) ||
    (state.artworkUrl !== undefined && !same(state.artworkUrl, art.imageUrl))) return fail()
  if (slots.some((slot, i) => {
    const enabled = effectiveMatActivity(d.mode as 'basic' | 'pro', d.layoutModel as LayoutModel, slots.map(s => s.materialId !== 'mat0'))[i], nested = record(oldMats[`mat${i + 1}`])
    return (oldMats[`hasMat${i + 1}`] !== undefined && oldMats[`hasMat${i + 1}`] !== enabled) ||
      (enabled && oldMats[`mat${i + 1}`] === null) ||
      (enabled && nested.id !== undefined && nested.id !== slot.materialId) ||
      (nested.borders !== undefined && !same(nested.borders, slot.borders)) ||
      [nested.borderCm, oldMats[`mat${i + 1}BorderCm`]].some(value => value !== undefined &&
        Object.values(slot.borders).some(side => !same(value, side)))
  })) return fail()
  if (Object.entries(art).some(([k, v]) => oldArt[k] !== undefined && !same(oldArt[k], v)) ||
    Object.entries(mats).some(([k, v]) => oldMats[k] !== undefined && !same(oldMats[k], v))) return fail()
  return { state: { ...state, art: { ...oldArt, ...art }, mats: { ...oldMats, ...mats } }, issue: null }
}

type SceneInput = { mode: 'basic' | 'pro'; layoutModel: LayoutModel; width: number; height: number; face: number;
  borders: MatBorders[]; active: boolean[]; origin: { x: number; y: number } | null; openings: DesignOpening[] }
/** One scene, in centimetres. Source coordinates/images are never modified by a border change. */
export function visualizerScene(input: SceneInput) {
  const { mode, layoutModel, width, height, face, borders } = input
  const active = effectiveMatActivity(mode, layoutModel, input.active)
  const basicGeometry = matGeometry(width, height, face, borders, active)
  const anchor = input.origin ?? { x: basicGeometry.total.left, y: basicGeometry.total.top }
  const invalidOpening = mode === 'pro' && input.openings.some(o => !['rect', 'oval', 'circle'].includes(o.shape) ||
    ![o.xCm, o.yCm, o.widthCm, o.heightCm].every(Number.isFinite) || o.widthCm <= 0 || o.heightCm <= 0 ||
    (o.shape === 'circle' && o.widthCm !== o.heightCm))
  const source = mode === 'pro' && !invalidOpening ? input.openings : []
  const shared = layoutModel !== 'legacy-individual-v1'
  const legacyBoundsIssue = !shared && mode === 'pro' && source.some(o => o.xCm < anchor.x || o.yCm < anchor.y)
  const minX = mode === 'pro' && shared ? Math.min(anchor.x, ...source.map(o => o.xCm)) : anchor.x
  const minY = mode === 'pro' && shared ? Math.min(anchor.y, ...source.map(o => o.yCm)) : anchor.y
  const layoutWidth = mode === 'pro' ? Math.max(anchor.x + width, ...source.map(o => o.xCm + o.widthCm)) - minX : width
  const layoutHeight = mode === 'pro' ? Math.max(anchor.y + height, ...source.map(o => o.yCm + o.heightCm)) - minY : height
  const geometry = matGeometry(layoutWidth, layoutHeight, face, borders, active)
  const offset = { x: geometry.total.left - minX, y: geometry.total.top - minY }
  const openings: DesignOpening[] = mode === 'pro' ? source.map(o => ({ ...o, xCm: o.xCm + offset.x, yCm: o.yCm + offset.y }))
    : [{ id: 'basic', shape: 'rect', xCm: geometry.total.left, yCm: geometry.total.top, widthCm: width, heightCm: height }]
  const ordered = shared && mode === 'pro' ? geometry.layers : [...geometry.layers].reverse()
  const layers = ordered.map((layer, index) => {
    if (!shared || mode === 'basic') return { slot: layer.slot, cutouts: openings.map(o => ({ ...o,
      xCm: o.xCm - (geometry.total.left - layer.borders.left), yCm: o.yCm - (geometry.total.top - layer.borders.top),
      widthCm: o.widthCm + geometry.total.left + geometry.total.right - layer.borders.left - layer.borders.right,
      heightCm: o.heightCm + geometry.total.top + geometry.total.bottom - layer.borders.top - layer.borders.bottom })) }
    if (index === 0) return { slot: layer.slot, cutouts: openings }
    const previous = geometry.layers[index - 1].borders
    return { slot: layer.slot, cutouts: [{ id: 'shared', shape: 'rect' as const,
      xCm: geometry.total.left - previous.left, yCm: geometry.total.top - previous.top,
      widthCm: layoutWidth + previous.left + previous.right, heightCm: layoutHeight + previous.top + previous.bottom }] }
  })
  return { ...geometry, layers, openings, offset, layoutWidth, layoutHeight, legacyBoundsIssue, savedOrigin: anchor, layoutOrigin: { x: minX, y: minY },
    minimumLayout: { width: mode === 'pro' ? Math.max(anchor.x + 1, ...source.map(o => o.xCm + o.widthCm)) - minX : 1, height: mode === 'pro' ? Math.max(anchor.y + 1, ...source.map(o => o.yCm + o.heightCm)) - minY : 1 },
    issue: invalidOpening ? 'Saved opening geometry needs review before saving or pricing.' : legacyBoundsIssue ? 'Historical opening coordinates need review before changing geometry.' : geometry.issue }
}
/** Inverse of the same scene, not an independent frame-size formula. */
export function layoutDimensionForExternal(scene: ReturnType<typeof visualizerScene>, axis: 'width' | 'height', external: number) {
  const border = axis === 'width' ? scene.total.left + scene.total.right : scene.total.top + scene.total.bottom
  const wanted = external - (scene.external[axis] - scene.internal[axis]) - border
  if (!Number.isFinite(wanted) || wanted < scene.minimumLayout[axis] - 1e-9) throw new Error('This frame size would clip an opening or leave no artwork area.')
  const coordinate = axis === 'width' ? 'x' : 'y'
  return wanted + scene.layoutOrigin[coordinate] - scene.savedOrigin[coordinate]
}
