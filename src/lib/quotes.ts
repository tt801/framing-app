// src/lib/quotes.ts
import { useEffect, useState } from 'react'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'

export type Quote = {
  id: string
  customerId: string
  items: { id: string; description: string; qty: number; unitPrice: number }[]
  notes?: string
  meta?: any
  createdAt?: string
}

const STORAGE_KEY = 'quotes_v1'
function rid() { return Math.random().toString(36).slice(2, 10) }
function safeParse<T>(raw: string | null): T | null { try { return raw ? JSON.parse(raw) as T : null } catch { return null } }

export function useQuotes() {
  const billing = useBillingAccess()
  const allowWrite = useBillingWriteGuard()
  const [quotes, setQuotes] = useState<Quote[]>(() => safeParse<Quote[]>(localStorage.getItem(STORAGE_KEY)) || [])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(quotes)) }, [quotes])

  const add = (q: Omit<Quote, 'id' | 'createdAt'>) => {
    if (!allowWrite('create quotes')) return null
    const now = new Date().toISOString()
    const full: Quote = { id: rid(), createdAt: now, ...q }
    setQuotes(prev => [full, ...prev])
    return full
  }

  const update = (patch: Partial<Quote> & { id: string }) => {
    if (!allowWrite('edit quotes')) return
    setQuotes(prev => prev.map(q => q.id === patch.id ? { ...q, ...patch } : q))
  }

  const remove = (id: string) => {
    if (!allowWrite('delete quotes')) return
    setQuotes(prev => prev.filter(q => q.id !== id))
  }

  return { quotes, add, update, remove, readOnly: billing.readOnly }
}
