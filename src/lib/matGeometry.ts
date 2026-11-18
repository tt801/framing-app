/** Physical aperture-to-board-edge distances, in cm. No commercial policy lives here. */
export type MatBorders = { top: number; bottom: number; left: number; right: number }
export const matSides = ['top', 'bottom', 'left', 'right'] as const
export const uniformBorders = (value: number): MatBorders => ({ top: value, bottom: value, left: value, right: value })
export function isMatBorders(value: unknown): value is MatBorders {
  return !!value && typeof value === 'object' && matSides.every(side => {
    const n = (value as MatBorders)[side]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
  })
}
/** Legacy values are incremental bands, not absolute distances. Disabled slots contribute nothing. */
export function normalizeMatBorders(legacy: number[], active: boolean[], saved?: unknown[]): MatBorders[] {
  let cumulative = 0
  return legacy.map((value, i) => {
    if (active[i]) cumulative += Number.isFinite(value) && value >= 0 ? value : 0
    return isMatBorders(saved?.[i]) ? { ...saved[i] as MatBorders } : uniformBorders(cumulative)
  })
}
export function matGeometry(width: number, height: number, face: number, borders: MatBorders[], active: boolean[]) {
  const layers = borders.flatMap((b, slot) => active[slot] ? [{ slot, borders: b }] : [])
  const total = uniformBorders(0)
  for (const layer of layers) for (const side of matSides) total[side] = Math.max(total[side], layer.borders[side])
  const internal = { width: width + total.left + total.right, height: height + total.top + total.bottom }
  const invalid = layers.some((layer, i) => !isMatBorders(layer.borders) || (i > 0 && matSides.some(side => layer.borders[side] < layers[i - 1].borders[side])))
  return {
    total, internal, external: { width: internal.width + 2 * face, height: internal.height + 2 * face },
    issue: invalid ? 'Each lower mat aperture must fit inside the mat above it. Check the four border measurements.' : null,
    layers: layers.map(layer => ({ ...layer, aperture: { x: layer.borders.left, y: layer.borders.top,
      width: internal.width - layer.borders.left - layer.borders.right,
      height: internal.height - layer.borders.top - layer.borders.bottom } })),
  }
}
