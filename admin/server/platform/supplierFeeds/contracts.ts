// Private, transport-neutral feed contracts. No browser imports or persistence.
// Policy declaration only: Phase 2 does not schedule or perform cleanup.
export const initialFeedRetention = {
  sourceArtifactDays: 90, privateStagingDays: 90, runOutcome: 'retain', canonicalAudit: 'retain',
} as const

export type FeedMode = 'dry_run' | 'apply_requested'
export type FeedCoverage = 'snapshot' | 'delta'
export type FeedContext = {
  supplierId: string
  runId: string
  sourceId: string
  adapter: { id: string; version: string }
  scopeId: string
  mode: FeedMode
  coverage: FeedCoverage
  authoritative: boolean
  acquisitionComplete: boolean
  parsingComplete: boolean
  validationSafeForMissing: boolean
  missingInferenceEnabled: boolean
}
export type SourceItem = { key: string; rowNumber?: number; path?: string }
export type FeedIssue = { code: string; message: string; field?: string; itemKey?: string }
export type ProductCategory = 'frame' | 'mat' | 'glazing' | 'printing' | 'backer' | 'other'
export type Availability = 'unknown' | 'available' | 'limited' | 'unavailable'
export type Lifecycle = 'active' | 'discontinued' | 'superseded'
export type TaxBasis = 'exclusive' | 'inclusive' | 'exempt' | 'unknown'
export type AssetRights = 'unknown' | 'permitted' | 'restricted' | 'prohibited'
export type SourceAsset = {
  sourceUrl?: string | null
  attribution?: string | null
  rightsStatus: AssetRights
  permittedUses?: string[]
  sourceUpdatedAt?: string | null
}
export type PrivateCost = { amount: string; currency: string; unit: string; taxBasis: TaxBasis; effectiveAt: string }
export const dimensionNames = ['widthMm', 'depthMm', 'rebateWidthMm', 'rebateDepthMm', 'sheetWidthMm', 'sheetHeightMm', 'matThicknessMm', 'glazingThicknessMm', 'glazingUvPercent'] as const
export type DimensionName = typeof dimensionNames[number]
export type ProductFields = {
  category: ProductCategory
  supplierDescription: string
  lifecycle: Lifecycle
  availability: Availability
  supplierSku?: string | null
  catalogScope?: string
  variantKey?: string
  subcategory?: string | null
  displayDescription?: string | null
  collectionName?: string | null
  colour?: string | null
  finish?: string | null
  material?: string | null
  purchaseUnit?: string | null
} & Partial<Record<DimensionName, number | null>>
export type SourceProductKeyOrigin = 'supplier_provided' | 'adapter_derived'
export type Candidate = {
  supplierId: string; runId: string; sourceId: string; adapter: { id: string; version: string }; scopeId: string
  item: SourceItem; sourceProductKey: string
  /** Origin assertion only. The adapter supplies the stable key; generic validation cannot prove immutability. */
  sourceProductKeyOrigin: SourceProductKeyOrigin
  fields: ProductFields
  /** Omitted means no assertion about wholesale cost; never a selling price. */
  cost?: PrivateCost
  asset?: SourceAsset
}
export type ValidationResult = { value?: Candidate; errors: FeedIssue[]; warnings: FeedIssue[] }
export type CanonicalProduct = {
  id: string; supplierId: string; sourceProductKey: string | null
  /** Ownership is explicit; null denotes manual/unassigned. */
  ownerScopeId: string | null; ownerSourceId: string | null
  /** Decimal bigint text; optional only for pre-2E planning fixtures. Apply requires this evidence. */
  updatedAt: string; productRevision?: string; fields: ProductFields; cost?: PrivateCost; asset?: SourceAsset
}
export type SourceKeyAlias = { supplierId: string; productId: string; aliasKind: 'source_key' | 'sku'; aliasValue: string }
export type ReconciliationAction = 'create' | 'update' | 'unchanged' | 'reject' | 'review' | 'potential_missing'
export type PlanEntry = {
  action: ReconciliationAction; actionId: string; item?: SourceItem; sourceProductKey?: string
  candidate?: Candidate
  productId?: string; expectedUpdatedAt?: string; expectedProductRevision?: string
  ordinaryChanges: string[]; lifecycleChanges: string[]; costChange: boolean; assetChanges: string[]
  errors: FeedIssue[]; warnings: FeedIssue[]
}
export type MassChangeLimit = { count?: number; proportion?: number }
export type MassChangePolicy = Partial<Record<'creates' | 'updates' | 'costChanges' | 'potentialMissing', MassChangeLimit>>
export type MassChangeFlag = { kind: keyof MassChangePolicy; count: number; denominator: number; limit: MassChangeLimit }
export type FeedPlan = {
  context: FeedContext
  entries: PlanEntry[]
  counts: Record<ReconciliationAction | 'cost_changes', number>
  errors: FeedIssue[]; warnings: FeedIssue[]
  massChangeFlags: MassChangeFlag[]
  requiresAcknowledgement: boolean
  /** All canonical application requires separate, explicit Platform Admin approval. */
  requiresPlatformAdminApproval: true
  missingInferenceEligible: boolean
}
