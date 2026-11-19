/** Four-sided incremental contributions in cm. Commercial policy is deliberately separate. */
export type MatBorders = { top: number; bottom: number; left: number; right: number }
export const MAT_GEOMETRY_VERSION = 3
export const matSides = ['top', 'bottom', 'left', 'right'] as const
export const uniformBorders = (value: number): MatBorders => ({ top: value, bottom: value, left: value, right: value })
export const defaultMatBorders = () => [5, 2, 1].map(uniformBorders)
export function isMatBorders(value: unknown): value is MatBorders {
  return !!value && typeof value === 'object' && matSides.every(side => {
    const n = (value as MatBorders)[side]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
  })
}
/** Scalar inputs were already incremental. Never collapse inactive slots into their neighbours. */
export function normalizeMatBorders(legacy: number[], _active?: boolean[], saved?: unknown[]): MatBorders[] {
  return legacy.map((value, i) => isMatBorders(saved?.[i]) ? { ...saved[i] as MatBorders } : uniformBorders(value))
}
const data = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const MAT_REVIEW_ISSUE = 'This saved mat geometry needs review: measurements are incomplete, crossing, or have unknown semantics. Load a valid design before saving or pricing.'
export const MAT_COINCIDENT_REVIEW_ISSUE = 'This saved mat geometry needs review: legacy absolute borders produce zero-width reveals (coincident edges). Original geometry is retained; review the measurements before adopting the pilot layout.'
/** Read-only boundary adapter. A failed conversion is not permission to save the preview fallback. */
export function restoreMatBorders(value: unknown, active: boolean[]): { borders: MatBorders[]; issue: string | null } {
  const saved = data(value)
  const defaults = defaultMatBorders()
  const scalars = defaults.map((fallback, i) => saved[`mat${i + 1}BorderCm`] ?? data(saved[`mat${i + 1}`]).borderCm ?? fallback.top)
  const legacy = scalars.map(v => uniformBorders(typeof v === 'number' ? v : NaN))
  const fail = () => ({ borders: defaults, issue: MAT_REVIEW_ISSUE })
  if (!legacy.every(isMatBorders)) return fail()
  const sides = Array.isArray(saved.borders) ? saved.borders : [1, 2, 3].map(i => data(saved[`mat${i}`]).borders)
  const hasSides = saved.borders !== undefined || sides.some(v => v !== undefined)
  const version = saved.geometryVersion
  if (version !== undefined && version !== 2 && version !== MAT_GEOMETRY_VERSION) return fail()
  if (!hasSides) return version === undefined ? { borders: legacy, issue: null } : fail()
  if (version === undefined) return fail()
  if (version === MAT_GEOMETRY_VERSION) {
    if (sides.length !== 3 || !sides.every(isMatBorders)) return fail()
    if (Array.isArray(saved.borders) && [1, 2, 3].some((i, slot) => {
      const alias = data(saved[`mat${i}`]).borders
      return alias !== undefined && (!isMatBorders(alias) || matSides.some(side => alias[side] !== (sides[slot] as MatBorders)[side]))
    })) return fail()
    return { borders: sides.map(b => ({ ...b as MatBorders })), issue: null }
  }
  let previous = uniformBorders(0)
  let coincident = false
  let previousSlot = uniformBorders(0)
  const borders = legacy.map(b => ({ ...b }))
  for (let slot = 0; slot < 3; slot++) {
    const absolute = sides[slot]
    const alias = data(saved[`mat${slot + 1}`]).borders
    if (Array.isArray(saved.borders) && alias !== undefined && (!isMatBorders(alias) || !isMatBorders(absolute) || matSides.some(side => alias[side] !== absolute[side]))) return fail()
    if (!active[slot]) {
      // Equal-to-active values are Stage B's generated inactive placeholders. Retain independent
      // scalar settings for those; retain meaningful cached four-sided values when unambiguous.
      if (absolute !== undefined && !isMatBorders(absolute)) return fail()
      if (isMatBorders(absolute) && matSides.some(side => absolute[side] !== previous[side])) {
        if (matSides.some(side => absolute[side] < previousSlot[side])) return fail()
        borders[slot] = Object.fromEntries(matSides.map(side => [side, absolute[side] - previousSlot[side]])) as MatBorders
        previousSlot = absolute
      }
      continue
    }
    if (!isMatBorders(absolute) || matSides.some(side => absolute[side] < previous[side])) return fail()
    borders[slot] = Object.fromEntries(matSides.map(side => [side, absolute[side] - previous[side]])) as MatBorders
    if (slot > 0 && matSides.some(side => absolute[side] > 0 && borders[slot][side] === 0)) coincident = true
    previous = absolute
    previousSlot = absolute
  }
  return { borders, issue: coincident ? MAT_COINCIDENT_REVIEW_ISSUE : null }
}
export function matGeometry(width: number, height: number, face: number, borders: MatBorders[], active: boolean[]) {
  const total = uniformBorders(0)
  const invalid = !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !Number.isFinite(face) || face < 0 ||
    active.some((enabled, slot) => enabled && !isMatBorders(borders[slot]))
  const layers = borders.flatMap((increment, slot) => {
    if (!active[slot] || !isMatBorders(increment)) return []
    for (const side of matSides) total[side] += increment[side]
    return [{ slot, increment: { ...increment }, borders: { ...total } }]
  })
  const internal = { width: width + total.left + total.right, height: height + total.top + total.bottom }
  return {
    total, internal, external: { width: internal.width + 2 * face, height: internal.height + 2 * face },
    issue: invalid ? 'Mat contributions and dimensions must be finite and non-negative, with a positive layout size.' : null,
    layers: layers.map(layer => ({ ...layer, aperture: { x: layer.borders.left, y: layer.borders.top,
      width: internal.width - layer.borders.left - layer.borders.right,
      height: internal.height - layer.borders.top - layer.borders.bottom } })),
  }
}
