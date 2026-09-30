// Database JSON and legacy imports enter as unknown, even when the surrounding row is typed.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export type StoredLineItem = { id: string; description: string; qty: number; unitPrice: number; [key: string]: unknown }

// An absent items field is an empty draft; malformed or unpriced items must not disappear.
export function normalizeLineItems(value: unknown): StoredLineItem[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const items: StoredLineItem[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !isFiniteNumber(item.qty) || !isFiniteNumber(item.unitPrice)) return null
    items.push({
      ...item,
      id: typeof item.id === 'string' && item.id ? item.id : `legacy-line-${index + 1}`,
      description: typeof item.description === 'string' ? item.description : typeof item.name === 'string' ? item.name : '',
      qty: item.qty,
      unitPrice: item.unitPrice,
    })
  }
  return items
}
