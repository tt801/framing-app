import type { JobChecklistItem } from './jobs'

export const DEFAULT_JOB_CHECKLIST = [
  'Cut frame', 'Join frame', 'Cut glazing / glass', 'Cut mat / mount',
  'Assemble artwork', 'Fit backing & hardware', 'Final clean & quality check', 'Pack for collection',
]
export function makeCompanyChecklist(template: unknown): JobChecklistItem[] {
  const labels = Array.isArray(template) && template.length
    ? template.filter((text): text is string => typeof text === 'string' && Boolean(text.trim()))
    : DEFAULT_JOB_CHECKLIST
  return labels.map(text => ({ id: crypto.randomUUID(), text, done: false }))
}
