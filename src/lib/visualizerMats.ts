import { defaultMatBorders, matSides, type MatBorders } from './matGeometry'

/** `color` is the catalogue/admin field; `colour` is a legacy fallback only. */
export function matColour(material?: { color?: string; colour?: string }) {
  for (const candidate of [material?.color, material?.colour]) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (value && value !== 'transparent' && (typeof CSS === 'undefined' || !CSS.supports || CSS.supports('color', value))) return value
  }
  return '#EEE'
}
export type MatSlot = { materialId: string; borders: MatBorders; locked: boolean }
export function createMatSlots(ids: string[] = []): MatSlot[] {
  return defaultMatBorders().map((borders, i) => ({ materialId: ids[i] || 'mat0', borders, locked: true }))
}
export function restoreMatLocks(borders: MatBorders[], saved?: unknown): boolean[] {
  return borders.map((b, i) => Array.isArray(saved) && typeof saved[i] === 'boolean'
    ? saved[i] : matSides.every(side => b[side] === b.top))
}
export function deleteMatSlot(slots: MatSlot[], index: number): MatSlot[] {
  const ids = slots.map(s => s.materialId)
  ids.splice(index, 1); ids.push('mat0')
  return slots.map((slot, i) => ({ ...slot, materialId: ids[i], borders: { ...slot.borders } }))
}
export function selectMatMaterial(slots: MatSlot[], index: number, id: string): MatSlot[] {
  if (id === 'mat0') return deleteMatSlot(slots, index)
  return slots.map((slot, i) => i !== index ? slot : slot.materialId === 'mat0'
    ? { materialId: id, borders: defaultMatBorders()[i], locked: true } : { ...slot, materialId: id })
}
export function editMatSide(slots: MatSlot[], index: number, side: keyof MatBorders, value: number): MatSlot[] {
  if (!Number.isFinite(value) || value < 0) return slots
  return slots.map((slot, i) => i !== index ? slot : { ...slot, borders: slot.locked
    ? { top: value, bottom: value, left: value, right: value } : { ...slot.borders, [side]: value } })
}
export const matUnit = (slot: number, unit: 'metric' | 'imperial') => unit === 'imperial' ? 'in' : slot === 0 ? 'cm' : 'mm'
export const matDisplayValue = (cm: number, slot: number, unit: 'metric' | 'imperial') => unit === 'imperial' ? cm / 2.54 : slot === 0 ? cm : cm * 10
export const matPhysicalValue = (value: number, slot: number, unit: 'metric' | 'imperial') => unit === 'imperial' ? value * 2.54 : slot === 0 ? value : value / 10
