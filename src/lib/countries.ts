/** Explicit ISO 3166-1 alpha-2 allowlist (249 assigned codes).
 * Source: https://www.iso.org/obp/ui/#search/code/ — no reserved, retired or user-assigned codes.
 * Review this list explicitly when ISO assignments change; Intl is for labels, not validation.
 */
export const COUNTRY_CODES = Object.freeze([
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA',
  'RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
] as const)
export type CountryCode = typeof COUNTRY_CODES[number]
const codes: ReadonlySet<string> = new Set(COUNTRY_CODES)

/** Strict canonical-code predicate: normalization is a separate explicit operation. */
export const isCountryCode = (value: unknown): value is CountryCode => typeof value === 'string' && codes.has(value)
export function normalizeCountryCode(value: unknown): CountryCode | null {
  if (typeof value !== 'string' || value.length > 100) return null
  const code = value.trim().toUpperCase()
  return isCountryCode(code) ? code : null
}
const names = new Intl.DisplayNames(['en'], { type: 'region' })
export const countryDisplayName = (value: unknown): string | null => isCountryCode(value) ? names.of(value) ?? value : null

export type OperatingCountryResolution =
  | { readonly status: 'valid'; readonly code: CountryCode; readonly suggestion: null }
  | { readonly status: 'confirmation-required'; readonly code: null; readonly suggestion: CountryCode }
  | { readonly status: 'missing' | 'invalid'; readonly code: null; readonly suggestion: null }

/** English names/explicit aliases are suggestions only, never confirmed operating countries.
 * Accept only the country field itself; never currency, addresses or default company profiles.
 */
export function resolveOperatingCountry(value: unknown): OperatingCountryResolution {
  if (value == null || (typeof value === 'string' && !value.trim())) return { status: 'missing', code: null, suggestion: null }
  const code = normalizeCountryCode(value)
  if (code) return { status: 'valid', code, suggestion: null }
  if (typeof value !== 'string' || value.length > 100) return { status: 'invalid', code: null, suggestion: null }
  const text = value.trim().toLowerCase()
  const aliases: Readonly<Record<string, CountryCode>> = { uk: 'GB', usa: 'US', 'united states of america': 'US' }
  const suggestion = Object.hasOwn(aliases, text) ? aliases[text]
    : COUNTRY_CODES.find(candidate => countryDisplayName(candidate)?.toLowerCase() === text)
  return suggestion ? { status: 'confirmation-required', code: null, suggestion }
    : { status: 'invalid', code: null, suggestion: null }
}

/** Any invalid entry makes coverage unspecified; never infer worldwide coverage. */
export function normalizeSupplierCoverage(value: unknown): readonly CountryCode[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 249 || !Array.from(value).every(isCountryCode)) return null
  return Object.freeze([...new Set<CountryCode>(value)].sort())
}
export type SupplierCountryRecommendation = 'recommended' | 'international' | 'unspecified' | 'country-required'
export function supplierCountryRecommendation(operatingCountry: unknown, coverage: unknown): SupplierCountryRecommendation {
  const countries = normalizeSupplierCoverage(coverage)
  if (!countries) return 'unspecified'
  if (!isCountryCode(operatingCountry)) return 'country-required'
  return countries.includes(operatingCountry) ? 'recommended' : 'international'
}
/** A geographic filter only, not supplier eligibility, authorization or licensing. */
export function matchesSupplierCountryBrowse(operatingCountry: unknown, coverage: unknown,
  mode: 'recommended' | 'international'): boolean {
  return mode === 'international' || (mode === 'recommended' && supplierCountryRecommendation(operatingCountry, coverage) === 'recommended')
}
