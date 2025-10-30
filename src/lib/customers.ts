// src/lib/customers.ts
import { useEffect, useMemo, useState } from 'react'

export type Customer = {
  id: string
  firstName: string
  lastName: string
  company?: string
  email: string
  phone?: string
  notes?: string
}

const STORAGE_KEY = 'customers_v1'

export function emptyCustomer(): Customer {
  return { id: '', firstName: '', lastName: '', email: '', company: '', phone: '', notes: '' }
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function load(): Customer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Customer[]) : []
  } catch {
    return []
  }
}

function save(list: Customer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function validateCustomer(c: Customer): string[] {
  const errs: string[] = []
  if (!c.firstName.trim()) errs.push('First name is required')
  if (!c.lastName.trim()) errs.push('Last name is required')
  if (!c.email.trim()) errs.push('Email is required')
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errs.push('Email format looks invalid')
  return errs
}

/** Converts customers into CSV format. Escapes commas, quotes, newlines. */
export function customersToCSV(list: Customer[]): string {
  const header = ['id', 'firstName', 'lastName', 'company', 'email', 'phone', 'notes']
  const esc = (v: any) => {
    const s = (v ?? '').toString().replace(/"/g, '""')
    return /[",\n]/.test(s) ? `"${s}"` : s
  }
  const rows = list.map(c => header.map(k => esc((c as any)[k])).join(','))
  return [header.join(','), ...rows].join('\n')
}

/** Triggers a client-side download for a given CSV string. */
export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** React hook for customer CRUD with localStorage persistence. */
export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>(() => load())

  useEffect(() => {
    save(customers)
  }, [customers])

  const api = useMemo(
    () => ({
      customers,
      add: (c: Customer) => setCustomers(prev => [{ ...c, id: uid() }, ...prev]),
      update: (c: Customer) => setCustomers(prev => prev.map(x => (x.id === c.id ? { ...x, ...c } : x))),
      remove: (id: string) => setCustomers(prev => prev.filter(x => x.id !== id)),
      clearAll: () => setCustomers([]),
      findByEmail: (email: string) => customers.find(c => c.email === email),
      getById: (id: string) => customers.find(c => c.id === id),
    }),
    [customers]
  )

  return api
}
