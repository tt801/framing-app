import type { EffectiveProduct } from './effectiveCatalogue'

export type SupplierAppearanceWarning =
  | 'colour-missing-or-unsupported' | 'face-width-missing-or-invalid'
  | 'display-name-unavailable' | 'sku-unavailable' | 'finish-unavailable' | 'material-unavailable'
  | 'depth-missing-or-invalid' | 'rebate-width-missing-or-invalid' | 'rebate-depth-missing-or-invalid'

export type SupplierAppearanceUnavailableReason =
  | 'missing-product' | 'not-supplier-frame' | 'company-mismatch' | 'invalid-identity'
  | 'not-eligible' | 'face-width-unavailable'

/** Appearance only: never a legacy Frame or a commercial pricing input. */
export type SupplierFrameAppearance = {
  readonly schemaVersion: 1
  readonly source: 'supplier'
  readonly companyAccountId: string
  readonly effectiveProductId: string
  readonly supplierId: string
  readonly supplierProductId: string
  readonly displayName: string
  readonly supplierSku: string | null
  readonly colourDescription: string | null
  readonly finishDescription: string | null
  readonly materialDescription: string | null
  readonly renderColour: string
  readonly colourResolution: 'hex' | 'neutral-fallback'
  readonly approximateColour: boolean
  readonly faceWidthCm: number
  readonly depthMm: number | null
  readonly rebateWidthMm: number | null
  readonly rebateDepthMm: number | null
  readonly asset: { readonly sourceUrl: null; readonly key: null; readonly thumbnailKey: null; readonly textureKey: null }
  readonly warnings: readonly SupplierAppearanceWarning[]
  readonly commerciallySelectable: false
}

export const SUPPLIER_NEUTRAL_COLOUR = '#333333'

export type SupplierFrameAppearanceResult =
  | { status: 'available'; appearance: SupplierFrameAppearance }
  | { status: 'unavailable'; reason: SupplierAppearanceUnavailableReason; appearance: null;
      warnings: readonly SupplierAppearanceWarning[]; commerciallySelectable: false }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value)

const description = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= 2000 && value.trim() ? value.trim() : null
const dimension = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/** Consume only the authorised effective catalogue; this pure mapper does not grant access. */
export function resolveSupplierFrameAppearance(input: {
  companyAccountId: string; product: EffectiveProduct | null | undefined
}): SupplierFrameAppearanceResult {
  const { companyAccountId, product } = input
  const unavailable = (reason: SupplierAppearanceUnavailableReason,
    warnings: readonly SupplierAppearanceWarning[] = []): SupplierFrameAppearanceResult =>
    ({ status: 'unavailable', reason, appearance: null, warnings, commerciallySelectable: false })
  if (!product) return unavailable('missing-product')
  if (product.source !== 'supplier' || product.category !== 'frame') return unavailable('not-supplier-frame')
  if (!uuid(companyAccountId) || product.companyAccountId !== companyAccountId) return unavailable('company-mismatch')
  if (!uuid(product.supplierId) || !uuid(product.supplierProductId) ||
    product.id !== `supplier:${product.supplierProductId.toLowerCase()}`) return unavailable('invalid-identity')
  if (product.visibleForNewSelection !== true || product.lifecycle !== 'active' || product.availability !== 'available' ||
    product.commerciallySelectable !== false) return unavailable('not-eligible')
  // The effective catalogue's frame widthMm contract is face width, never depth/rebate width.
  const widthMm = dimension(product.dimensions?.widthMm)
  const faceWidthCm = widthMm === null ? 0 : widthMm / 10
  if (faceWidthCm <= 0) return unavailable('face-width-unavailable', ['face-width-missing-or-invalid'])
  const warnings: SupplierAppearanceWarning[] = []
  const colour = description(product.colour)
  const hex = colour !== null && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour)
  const renderColour = hex
    ? (colour.length === 4 ? `#${colour.slice(1).split('').map(value => value + value).join('')}` : colour).toLowerCase()
    : SUPPLIER_NEUTRAL_COLOUR
  if (!hex) warnings.push('colour-missing-or-unsupported')
  const text = (value: unknown, warning: SupplierAppearanceWarning) => {
    const resolved = description(value)
    if (resolved === null) warnings.push(warning)
    return resolved
  }
  const measurement = (value: unknown, warning: SupplierAppearanceWarning) => {
    const resolved = dimension(value)
    if (resolved === null) warnings.push(warning)
    return resolved
  }
  return { status: 'available', appearance: {
    schemaVersion: 1, source: 'supplier', companyAccountId,
    effectiveProductId: product.id, supplierId: product.supplierId, supplierProductId: product.supplierProductId,
    displayName: text(product.name, 'display-name-unavailable') ?? 'Supplier frame', supplierSku: text(product.supplierSku, 'sku-unavailable'),
    colourDescription: colour, finishDescription: text(product.finish, 'finish-unavailable'), materialDescription: text(product.material, 'material-unavailable'),
    renderColour, colourResolution: hex ? 'hex' : 'neutral-fallback', approximateColour: !hex, faceWidthCm,
    depthMm: measurement(product.dimensions.depthMm, 'depth-missing-or-invalid'),
    rebateWidthMm: measurement(product.dimensions.rebateWidthMm, 'rebate-width-missing-or-invalid'),
    rebateDepthMm: measurement(product.dimensions.rebateDepthMm, 'rebate-depth-missing-or-invalid'),
    asset: { sourceUrl: null, key: null, thumbnailKey: null, textureKey: null },
    warnings, commerciallySelectable: false,
  } }
}
