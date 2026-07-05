import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Legend } from './Legend'
import { edgeCases } from '../fixtures/edge-cases'

describe('Legend', () => {
  // Regression test: .legend__swatch is a height:0 box shown via border-top
  // (so dashed vs solid folder-type edges can be told apart), so its color
  // has to be set as borderTopColor — backgroundColor has zero area to show
  // and silently falls back to a default gray border color instead.
  it('colors folder-identity swatches via borderTopColor, not backgroundColor', () => {
    const { container } = render(<Legend cluster={edgeCases} mode="nodes" />)
    const swatches = container.querySelectorAll('.legend__swatch')
    expect(swatches.length).toBeGreaterThan(0)
    for (const swatch of swatches) {
      const style = (swatch as HTMLElement).style
      expect(style.borderTopColor).not.toBe('')
      expect(style.backgroundColor).toBe('')
    }
  })

  it('colors folder-type swatches via borderTopColor, not backgroundColor', () => {
    const { container } = render(<Legend cluster={edgeCases} mode="folders" />)
    const swatches = container.querySelectorAll('.legend__swatch')
    expect(swatches.length).toBeGreaterThan(0)
    for (const swatch of swatches) {
      const style = (swatch as HTMLElement).style
      expect(style.borderTopColor).not.toBe('')
      expect(style.backgroundColor).toBe('')
    }
  })

  it('explains the share-mode arrow/lock/dash encoding only in Nodes mode', () => {
    render(<Legend cluster={edgeCases} mode="nodes" />)
    expect(screen.getByText('Share mode (line)')).toBeInTheDocument()
  })

  it('does not show the Nodes-mode share-mode note in Folders mode', () => {
    render(<Legend cluster={edgeCases} mode="folders" />)
    expect(screen.queryByText('Share mode (line)')).not.toBeInTheDocument()
  })
})
