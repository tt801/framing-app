// src/lib/stock.ts
import { useEffect, useMemo, useState } from 'react'

export type StockRecord = {
  productId: string
  name: string
  kind: 'frame' | 'mat' | 'glazing' | 'print'
  qty: number        // on-hand units
  minQty: number     // low-stock threshold
  unit?: 'm' | 'm2' | 'unit'
}

const KEY = 'frameit_stock_v1'

const load = (): Record<string, StockRecord> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const save = (m: Record<string, StockRecord>) => localStorage.setItem(KEY, JSON.stringify(m))

export function useStock() {
  const [map, setMap] = useState<Record<string, StockRecord>>(() => load())

  useEffect(() => { save(map) }, [map])

  const upsert = (rec: StockRecord) =>
    setMap(prev => ({ ...prev, [rec.productId]: { ...prev[rec.productId], ...rec } }))

  const setQty = (id: string, qty: number) =>
    setMap(prev => prev[id] ? { ...prev, [id]: { ...prev[id], qty } } : prev)

  const setMin = (id: string, minQty: number) =>
    setMap(prev => prev[id] ? { ...prev, [id]: { ...prev[id], minQty } } : prev)

  const adjust = (id: string, delta: number) =>
    setMap(prev => prev[id] ? { ...prev, [id]: { ...prev[id], qty: Math.max(0, (prev[id].qty || 0) + delta) } } : prev)

  const remove = (id: string) => setMap(prev => {
    const n = { ...prev }; delete n[id]; return n
  })

  const asArray = useMemo(() => Object.values(map), [map])

  return { records: asArray, upsert, setQty, setMin, adjust, remove }
}
