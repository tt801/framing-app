import React, { Suspense } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ErrorBoundary } from '@/App'

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('internal test detail')
  return <div>healthy content</div>
}

describe('Block 5B error boundary', () => {
  afterEach(() => cleanup())
  it('shows a safe fallback for descendant render failures', () => {
    render(<ErrorBoundary><ThrowingChild shouldThrow /></ErrorBoundary>)
    expect(screen.getByText('This screen could not load')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByText('internal test detail')).toBeNull()
  })

  it('renders healthy children normally', () => {
    render(<ErrorBoundary><ThrowingChild shouldThrow={false} /></ErrorBoundary>)
    expect(screen.getByText('healthy content')).toBeTruthy()
  })

  it('recovers after retry when the child no longer throws', async () => {
    const view = render(<ErrorBoundary><ThrowingChild shouldThrow /></ErrorBoundary>)
    view.rerender(<ErrorBoundary><ThrowingChild shouldThrow={false} /></ErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('healthy content')).toBeTruthy())
  })

  it('preserves Suspense loading behavior', async () => {
    let resolveLazy!: (module: { default: React.ComponentType }) => void
    const LazyChild = React.lazy(() => new Promise<{ default: React.ComponentType }>(resolve => { resolveLazy = resolve }))
    render(<ErrorBoundary><LazyChild /></ErrorBoundary>)
    expect(document.querySelector('div.animate-spin')).toBeTruthy()
    resolveLazy({ default: () => <div>lazy content</div> })
    await waitFor(() => expect(screen.getByText('lazy content')).toBeTruthy())
  })
})
