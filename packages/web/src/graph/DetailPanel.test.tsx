import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DetailPanel } from './DetailPanel'
import { edgeCases } from '../fixtures/edge-cases'

describe('DetailPanel device system status', () => {
  it("shows version/uptime/memory/listener/discovery for a managed device with systemStatus", () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-origin' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    const section = screen.getByText('System status').closest('.detail-panel__system-status') as HTMLElement
    expect(within(section).getByText('v1.27.3')).toBeInTheDocument()
    expect(within(section).getByText('2d 22h')).toBeInTheDocument() // 254_612s
    expect(within(section).getByText('80.6 MB')).toBeInTheDocument() // 84_500_000 bytes
    expect(within(section).getAllByText(/2\/2 OK/)).toHaveLength(2) // listeners and discovery both 2/2
  })

  it('shows the failing listener name inline when not everything is OK, alongside the healthy discovery line', () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-relay-b' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    const section = screen.getByText('System status').closest('.detail-panel__system-status') as HTMLElement
    expect(within(section).getByText(/2\/3 OK/)).toBeInTheDocument()
    expect(within(section).getByText(/2\/2 OK/)).toBeInTheDocument()
    expect(within(section).getByText(/connection refused/)).toBeInTheDocument()
  })

  it('renders no System status section for a device with no systemStatus (managed but not reported, or unmanaged)', () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-mirror' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    expect(screen.queryByText('System status')).not.toBeInTheDocument()
  })

  it('never shows System status for an unmanaged (peer-only) device', () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-roamer' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    expect(screen.queryByText('System status')).not.toBeInTheDocument()
  })
})
