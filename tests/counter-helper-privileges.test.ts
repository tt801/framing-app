// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'migrations/20260929_restrict_numbering_helpers.sql')
const migration = () => readFileSync(migrationPath, 'utf8')

describe('internal invoice/job numbering privileges', () => {
  it.each([
    ['next_invoice_number', 'uuid, text, integer'],
    ['next_job_reference', 'uuid, integer'],
  ])('revokes direct client execution of %s', (name, args) => {
    const sql = migration()
    expect(sql).toMatch(/\bbegin\s*;/i)
    expect(sql).toMatch(/\bcommit\s*;/i)
    const revoke = new RegExp(
      `\\brevoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\(${args.replaceAll(', ', '\\s*,\\s*')}\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
      'i',
    )
    expect(sql).toMatch(revoke)
    expect(sql).not.toMatch(new RegExp(`\\bgrant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\b`, 'i'))
  })
})
