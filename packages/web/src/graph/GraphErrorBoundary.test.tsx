import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GraphErrorBoundary } from './GraphErrorBoundary'

/** Throws when `shouldThrow` is true — mimics a data-dependent render crash. */
function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom: unrecognized state')
  return <div>graph ok</div>
}

describe('GraphErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <GraphErrorBoundary>
        <Thrower shouldThrow={false} />
      </GraphErrorBoundary>,
    )
    expect(screen.getByText('graph ok')).toBeInTheDocument()
  })

  it('shows a fallback with the error message instead of unmounting to blank', () => {
    // React logs the caught error to the console by default; silence it for this test.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <GraphErrorBoundary>
        <Thrower shouldThrow={true} />
      </GraphErrorBoundary>,
    )

    expect(screen.getByText('The graph failed to render.')).toBeInTheDocument()
    expect(screen.getByText('boom: unrecognized state')).toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('"Try again" re-renders the current children, recovering once they stop throwing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender } = render(
      <GraphErrorBoundary>
        <Thrower shouldThrow={true} />
      </GraphErrorBoundary>,
    )
    expect(screen.getByText('The graph failed to render.')).toBeInTheDocument()

    // Whatever caused the crash is no longer true, but the boundary is still
    // showing the fallback — it only re-renders children on a manual retry.
    rerender(
      <GraphErrorBoundary>
        <Thrower shouldThrow={false} />
      </GraphErrorBoundary>,
    )
    expect(screen.getByText('The graph failed to render.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Try again'))
    expect(screen.getByText('graph ok')).toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})
