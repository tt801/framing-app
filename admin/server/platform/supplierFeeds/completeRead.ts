// REST servers may return fewer rows than requested. Advance by actual rows,
// require exact stable counts, unique ordered IDs, and verify count again at end.
export async function completeRead(query: () => any): Promise<Record<string, any>[]> {
  const result: Record<string, any>[] = []
  const ids = new Set<string>()
  let total: number | undefined
  for (;;) {
    const page = await query().order('id', { ascending: true }).range(result.length, result.length + 199)
    if (page.error || !Number.isSafeInteger(page.count) || page.count < 0 || page.count > 100_000
      || (total !== undefined && total !== page.count) || !Array.isArray(page.data)) throw new Error('Cannot establish complete planning evidence')
    total = page.count
    for (const row of page.data) {
      if (typeof row.id !== 'string' || ids.has(row.id) || (result.length && row.id <= result[result.length - 1].id)) throw new Error('Cannot establish complete planning evidence')
      ids.add(row.id); result.push(row)
    }
    if (result.length > total!) throw new Error('Cannot establish complete planning evidence')
    if (result.length === total) break
    if (!page.data.length) throw new Error('Cannot establish complete planning evidence')
  }
  const end = await query().range(0, 0)
  if (end.error || end.count !== total) throw new Error('Cannot establish complete planning evidence')
  return result
}
