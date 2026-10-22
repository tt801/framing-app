/** Search only explicitly supplied text, never serialized records or arbitrary numbers. */
export function normalizeSearchText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : ''
}

export function matchesCommercialSearch(query: string, fields: readonly unknown[]): boolean {
  const needle = normalizeSearchText(query)
  return !needle || fields.some(field => normalizeSearchText(field).includes(needle))
}

/** Identity sources must already belong to the records/customer set loaded by the page. */
export function customerSearchFields(...sources: unknown[]): string[] {
  return sources.flatMap(source => {
    if (typeof source === 'string') return [source]
    if (!source || typeof source !== 'object' || Array.isArray(source)) return []
    const customer = source as Record<string, unknown>
    const fullName = [customer.firstName, customer.lastName].map(normalizeSearchText).filter(Boolean).join(' ')
    return [customer.firstName, customer.lastName, fullName, customer.name,
      customer.company, customer.companyName, customer.email, customer.primaryEmail, customer.contactEmail]
      .filter((field): field is string => typeof field === 'string' && Boolean(field.trim()))
  })
}

/** Call only with a human-readable reference, not a database ID, date or financial value. */
export function referenceSearchFields(reference: unknown): string[] {
  const text = normalizeSearchText(typeof reference === 'number' && Number.isFinite(reference) ? String(reference) : reference)
  if (!text) return []
  const compact = text.replace(/\s/g, '')
  const digits = compact.match(/(\d+)$/)?.[1]
  return [...new Set([text, compact, ...(digits ? [digits, digits.replace(/^0+/, '') || '0'] : [])])]
}
