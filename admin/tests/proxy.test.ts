import { describe, expect, it, vi } from 'vitest'
import type { UserConfig } from 'vite'

describe('admin local API proxy', () => {
  it('has no production or other implicit API target when not configured', async () => {
    vi.stubEnv('ADMIN_API_PROXY_TARGET', '')
    vi.resetModules()
    const { default: config } = await import('../vite.config')
    expect((config as UserConfig).server?.proxy).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('only proxies to an explicitly configured target', async () => {
    vi.stubEnv('ADMIN_API_PROXY_TARGET', 'http://127.0.0.1:56789')
    vi.resetModules()
    const { default: config } = await import('../vite.config')
    expect((config as UserConfig).server?.proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:56789' })
    vi.unstubAllEnvs()
  })
})
