import { createHash } from 'node:crypto'
import type { Candidate, CanonicalProduct, FeedContext, FeedIssue, FeedPlan, MassChangePolicy, PlanEntry, ProductFields, ReconciliationAction, SourceItem, SourceKeyAlias, ValidationResult } from './contracts.js'

export type PlanningRow = { item: SourceItem; result: ValidationResult }
export type PlanningInput = {
  context: FeedContext
  rows: readonly PlanningRow[]
  /** All supplier products, including other sources/scopes, for collision detection. */
  existingProducts: readonly CanonicalProduct[]
  aliases: readonly SourceKeyAlias[]
  /** Independent, explicitly acknowledged permission for zero-valid-product snapshots. Defaults off. */
  allowEmptySnapshotMissingInference?: boolean
  massChangePolicy: MassChangePolicy
}
const signature = (value: unknown): string => JSON.stringify(value, (_key, part: unknown) =>
  part && typeof part === 'object' && !Array.isArray(part)
    ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part)
const same = (a: unknown, b: unknown) => signature(a) === signature(b)
const actionId = (parts: unknown[]) => createHash('sha256').update(signature(parts)).digest('hex')
const skuKey = (fields: ProductFields) => fields.supplierSku
  ? signature([fields.catalogScope ?? 'default', fields.supplierSku.trim().toLowerCase(), fields.variantKey ?? '']) : null
const owned = (product: CanonicalProduct, context: FeedContext) =>
  product.supplierId === context.supplierId && product.ownerSourceId === context.sourceId && product.ownerScopeId === context.scopeId
const issue = (code: string, message: string, itemKey?: string): FeedIssue => ({ code, message, ...(itemKey ? { itemKey } : {}) })
function index<K>(items: readonly CanonicalProduct[], key: (item: CanonicalProduct) => K | null) {
  const result = new Map<K, CanonicalProduct[]>()
  for (const item of items) {
    const value = key(item)
    if (value !== null) result.set(value, [...(result.get(value) ?? []), item])
  }
  return result
}
const fieldOrder = ['category','supplierDescription','supplierSku','catalogScope','variantKey','subcategory','displayDescription','collectionName','colour','finish','material','purchaseUnit','widthMm','depthMm','rebateWidthMm','rebateDepthMm','sheetWidthMm','sheetHeightMm','matThicknessMm','glazingThicknessMm','glazingUvPercent'] as const
const assetOrder = ['rightsStatus','sourceUrl','attribution','permittedUses','sourceUpdatedAt'] as const
function changes(candidate: Candidate, product: CanonicalProduct) {
  const ordinaryChanges: string[] = []
  const lifecycleChanges: string[] = []
  for (const field of fieldOrder) {
    if (field in candidate.fields && !same(candidate.fields[field], product.fields[field])) ordinaryChanges.push(field)
  }
  for (const field of ['lifecycle','availability'] as const)
    if (!same(candidate.fields[field], product.fields[field])) lifecycleChanges.push(field)
  const costChange = candidate.cost !== undefined && !same(candidate.cost, product.cost && {
    ...product.cost,
    amount: product.cost.amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
    effectiveAt: new Date(product.cost.effectiveAt).toISOString(),
  })
  const assetChanges: string[] = []
  if (candidate.asset) for (const field of assetOrder)
    if (field in candidate.asset && !same(candidate.asset[field], product.asset?.[field])) assetChanges.push(field)
  return { ordinaryChanges, lifecycleChanges, costChange, assetChanges }
}
export function planFeed({ context, rows, existingProducts, aliases, massChangePolicy, allowEmptySnapshotMissingInference = false }: PlanningInput): FeedPlan {
  const products = existingProducts.filter(p => p.supplierId === context.supplierId)
  const byId = new Map(products.map(p => [p.id, p]))
  const byKey = index(products, p => p.sourceProductKey)
  const bySku = index(products, p => skuKey(p.fields))
  const byAlias = new Map<string, Set<string>>()
  const skuAliases = new Map<string, Set<string>>()
  for (const alias of aliases) {
    if (alias.supplierId !== context.supplierId) continue
    const target = alias.aliasKind === 'source_key' ? byAlias : skuAliases
    // SKU aliases are evidence only, never identity.
    const key = alias.aliasKind === 'sku' ? alias.aliasValue.trim().toLowerCase() : alias.aliasValue
    target.set(key, new Set([...(target.get(key) ?? []), alias.productId]))
  }
  const rowCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  for (const row of rows) {
    rowCounts.set(row.item.key, (rowCounts.get(row.item.key) ?? 0) + 1)
    const candidate = row.result.value
    if (candidate) sourceCounts.set(candidate.sourceProductKey, (sourceCounts.get(candidate.sourceProductKey) ?? 0) + 1)
  }
  const entries: PlanEntry[] = []
  const orderedRows = [...rows].sort((a, b) => signature(a.item).localeCompare(signature(b.item)))
  for (const [position, row] of orderedRows.entries()) {
    const candidate = row.result.value
    const errors: FeedIssue[] = row.result.errors.map(error => ({ ...error, itemKey: row.item.key }))
    const warnings: FeedIssue[] = row.result.warnings.map(warning => ({ ...warning, itemKey: row.item.key }))
    const base = { item: row.item, sourceProductKey: candidate?.sourceProductKey,
      ordinaryChanges: [] as string[], lifecycleChanges: [] as string[], costChange: false,
      assetChanges: [] as string[], errors, warnings }
    let action: ReconciliationAction = 'reject'
    let match: CanonicalProduct | undefined
    if (candidate && !errors.length) {
      if (candidate.supplierId !== context.supplierId || candidate.runId !== context.runId ||
          candidate.sourceId !== context.sourceId || candidate.scopeId !== context.scopeId ||
          !same(candidate.adapter, context.adapter) || candidate.item.key !== row.item.key) {
        errors.push(issue('provenance_mismatch', 'Candidate does not belong to this feed run', row.item.key))
      } else if ((sourceCounts.get(candidate.sourceProductKey) ?? 0) > 1 || (rowCounts.get(row.item.key) ?? 0) > 1) {
        action = 'review'
        warnings.push(issue('duplicate_source_identity', 'Duplicate source or item identity in this run', row.item.key))
      } else {
        const identities = new Set([...(byKey.get(candidate.sourceProductKey) ?? []).map(p => p.id), ...(byAlias.get(candidate.sourceProductKey) ?? [])])
        if (identities.size > 1 || [...identities].some(id => !byId.has(id))) {
          action = 'review'
          warnings.push(issue('ambiguous_identity', 'Source key and alias evidence conflicts', row.item.key))
        } else {
          match = identities.size ? byId.get([...identities][0]) : undefined
          const sku = skuKey(candidate.fields)
          const skuMatches = sku ? new Set([...(bySku.get(sku) ?? []).map(p => p.id), ...(skuAliases.get(candidate.fields.supplierSku?.trim().toLowerCase() ?? '') ?? [])]) : new Set<string>()
          if ([...skuMatches].some(id => id !== match?.id)) {
            action = 'review'
            if (!match && skuMatches.size === 1) match = byId.get([...skuMatches][0]) // evidence only, never an identity match
            warnings.push(issue('sku_collision', 'SKU collides; SKU cannot establish identity', row.item.key))
          } else if (match && !owned(match, context)) {
            action = 'review'
            warnings.push(issue('ownership_conflict', 'Product belongs to another source or scope', row.item.key))
          } else if (!match) action = 'create'
          else {
            const diff = changes(candidate, match)
            Object.assign(base, diff)
            action = diff.ordinaryChanges.length || diff.lifecycleChanges.length || diff.costChange || diff.assetChanges.length ? 'update' : 'unchanged'
            if (candidate.sourceProductKey !== match.sourceProductKey) warnings.push(issue('alias_match', 'Matched an established source-key alias; canonical key is not automatically changed', row.item.key))
          }
        }
      }
    }
    if (context.mode === 'apply_requested' && match && ['update','unchanged'].includes(action) &&
      (!match.productRevision || !/^[1-9][0-9]*$/.test(match.productRevision))) {
      action = 'review'
      base.ordinaryChanges = []; base.lifecycleChanges = []; base.assetChanges = []; base.costChange = false
      warnings.push(issue('missing_product_revision', 'Apply planning requires canonical product_revision evidence', row.item.key))
    }
    entries.push({ ...base, action, actionId: actionId([context.supplierId, context.runId, context.sourceId, context.scopeId, row.item, position, action, candidate, match?.updatedAt, match?.productRevision]),
      ...(candidate && !errors.length ? { candidate } : {}),
      ...(match ? { productId: match.id, expectedUpdatedAt: match.updatedAt,
        ...(match.productRevision ? { expectedProductRevision: match.productRevision } : {}) } : {}) })
  }
  // A DB-unique SKU tuple shared by different source keys cannot produce independent writes.
  // SKU is collision evidence, never a fallback match.
  const byRunSku = new Map<string, PlanEntry[]>()
  for (const entry of entries) {
    const key = entry.candidate && skuKey(entry.candidate.fields)
    if (key && ['create', 'update', 'unchanged'].includes(entry.action))
      byRunSku.set(key, [...(byRunSku.get(key) ?? []), entry])
  }
  for (const group of byRunSku.values()) if (group.length > 1) for (const entry of group) {
    entry.action = 'review'
    entry.ordinaryChanges = []; entry.lifecycleChanges = []; entry.assetChanges = []; entry.costChange = false
    entry.warnings.push(issue('sku_collision', 'Multiple source items share a canonical SKU tuple; review required', entry.item?.key))
    entry.actionId = actionId([context.supplierId, context.runId, context.sourceId, context.scopeId, entry.item, 'review', entry.candidate, entry.expectedUpdatedAt])
  }
  // Different source keys may both resolve to the same canonical product through aliases.
  // Such rows must not become independent writes or audit events in one run.
  const byTarget = new Map<string, PlanEntry[]>()
  for (const entry of entries) if (entry.productId && ['update','unchanged'].includes(entry.action))
    byTarget.set(entry.productId, [...(byTarget.get(entry.productId) ?? []), entry])
  for (const [productId, group] of byTarget) if (group.length > 1) for (const entry of group) {
    entry.action = 'review'
    entry.ordinaryChanges = []; entry.lifecycleChanges = []; entry.assetChanges = []; entry.costChange = false
    entry.warnings.push(issue('duplicate_target', 'Multiple items resolve to the same canonical product', entry.item?.key))
    entry.actionId = actionId([context.supplierId,context.runId,context.sourceId,context.scopeId,entry.item,'review',productId,entry.candidate,entry.expectedUpdatedAt])
  }
  const validSourceCount = entries.filter(e => e.candidate && !e.errors.length).length
  const emptySnapshotBlocked = context.coverage === 'snapshot' && context.authoritative &&
    validSourceCount === 0 && allowEmptySnapshotMissingInference !== true
  const seen = new Set(entries.map(e => e.productId).filter((id): id is string => !!id))
  const missingRevisionProducts = context.mode === 'apply_requested' && context.coverage === 'snapshot'
    ? products.filter(p => owned(p, context) && !seen.has(p.id) &&
      (!p.productRevision || !/^[1-9][0-9]*$/.test(p.productRevision))) : []
  const missingInferenceEligible = context.coverage === 'snapshot' && context.authoritative && context.acquisitionComplete &&
    context.parsingComplete && context.validationSafeForMissing && context.missingInferenceEnabled && !emptySnapshotBlocked &&
    missingRevisionProducts.length === 0 && entries.every(e => e.action !== 'reject' && e.action !== 'review')
  for (const product of missingRevisionProducts) entries.push({ action: 'review',
    actionId: actionId([context.supplierId,context.runId,context.sourceId,context.scopeId,'missing_revision',product.id]),
    productId: product.id, expectedUpdatedAt: product.updatedAt, sourceProductKey: product.sourceProductKey ?? undefined,
    ordinaryChanges: [], lifecycleChanges: [], costChange: false, assetChanges: [], errors: [],
    warnings: [issue('missing_product_revision', 'Apply planning requires canonical product_revision evidence')] })
  if (missingInferenceEligible) {
    for (const product of products.filter(p => owned(p, context) && !seen.has(p.id)).sort((a, b) => a.id.localeCompare(b.id)))
      entries.push({ action: 'potential_missing', actionId: actionId([context.supplierId,context.runId,context.sourceId,context.scopeId,'missing',product.id,product.productRevision]),
        productId: product.id, expectedUpdatedAt: product.updatedAt, expectedProductRevision: product.productRevision,
        sourceProductKey: product.sourceProductKey ?? undefined,
        ordinaryChanges: [], lifecycleChanges: [], costChange: false, assetChanges: [], errors: [], warnings: [] })
  }
  const counts = { create: 0, update: 0, unchanged: 0, reject: 0, review: 0, potential_missing: 0, cost_changes: 0 }
  for (const entry of entries) { counts[entry.action]++; if (entry.action === 'update' && entry.costChange) counts.cost_changes++ }
  const warnings = entries.flatMap(e => e.warnings)
  if (emptySnapshotBlocked) warnings.push(issue('empty_snapshot_missing_inference_blocked', 'Zero validated source products; explicit independent permission is required before planning missing items'))
  if (context.coverage === 'snapshot' && !missingInferenceEligible) warnings.push(issue('missing_inference_disabled', 'Snapshot is incomplete, unhealthy, or not authorized for missing-item inference'))
  const ownedCount = products.filter(p => owned(p, context)).length
  const denominators = { creates: Math.max(1, rows.length), updates: Math.max(1, ownedCount), costChanges: Math.max(1, ownedCount), potentialMissing: Math.max(1, ownedCount) }
  const totals = { creates: counts.create, updates: counts.update, costChanges: counts.cost_changes, potentialMissing: counts.potential_missing }
  const massChangeFlags = (Object.keys(totals) as (keyof MassChangePolicy)[]).flatMap(kind => {
    const limit = massChangePolicy[kind]
    const count = totals[kind]
    const denominator = denominators[kind]
    return limit && ((limit.count !== undefined && count > limit.count) || (limit.proportion !== undefined && count / denominator > limit.proportion))
      ? [{ kind, count, denominator, limit }] : []
  })
  return { context, entries, counts, errors: entries.flatMap(e => e.errors), warnings,
    massChangeFlags, requiresAcknowledgement: massChangeFlags.length > 0, requiresPlatformAdminApproval: true, missingInferenceEligible }
}
