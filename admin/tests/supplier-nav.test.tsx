// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Sidebar from '../src/components/Sidebar.js'
afterEach(cleanup)
it('links the standalone Admin supplier page', () => {
  render(<Sidebar view="dashboard" setView={() => {}} onSignOut={() => {}} />)
  expect(screen.getByRole('button', { name: 'Suppliers' })).toBeTruthy()
})
