// src/features/printOnly/withNoneOptions.ts
// Utility helpers to non-destructively add a "None" option to catalogs
export type NamedItem = { id: string; name: string }


export const NONE_ID = "none" as const


export function withNoneOption<T extends NamedItem>(
items: T[],
label: string = "None"
): (T | (T & { __isNone: true }))[] {
const hasNone = items.some((i) => i.id === NONE_ID)
const none = { id: NONE_ID, name: label, __isNone: true } as T & { __isNone: true }
return hasNone ? items : [none, ...items]
}


export const isNone = (id?: string | null) => id === NONE_ID