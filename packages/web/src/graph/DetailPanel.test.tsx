import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DetailPanel } from './DetailPanel'
import { edgeCases } from '../fixtures/edge-cases'
import { formatBytes } from '../format'

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

describe('DetailPanel device connections', () => {
  it("lists a managed device's own reported connections with peer name, state, and per-connection transfer", () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-origin' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    expect(screen.getByText('Connections (3)')).toBeInTheDocument()
    const mirrorRow = screen.getByText('mirror').closest('.connections-list__row') as HTMLElement
    expect(within(mirrorRow).getByText(/Connected/)).toBeInTheDocument()
    expect(within(mirrorRow).getByText(new RegExp(formatBytes(340_200_000)))).toBeInTheDocument()
    expect(within(mirrorRow).getByText(new RegExp(formatBytes(128_500_000)))).toBeInTheDocument()

    const satelliteRow = screen.getByText('satellite').closest('.connections-list__row') as HTMLElement
    expect(within(satelliteRow).getByText(/Disconnected/)).toBeInTheDocument()
  })

  it('shows the total transfer summed across all of a device\'s own connections', () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-origin' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    const totalLine = screen.getByText('Total transfer:').closest('p') as HTMLElement
    // Sum of all three connections' out/in bytes for device-origin — mirror
    // is the only one with nonzero bytes (satellite/vault are disconnected,
    // and a disconnected connection's totals are 0, per Connection's doc
    // comment), so the sum equals mirror's own numbers exactly.
    expect(within(totalLine).getByText(new RegExp(formatBytes(340_200_000)))).toBeInTheDocument()
    expect(within(totalLine).getByText(new RegExp(formatBytes(128_500_000)))).toBeInTheDocument()
  })

  it('shows "Connections (0)" and no total-transfer line for a managed device with no reported connections', () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-mirror' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    expect(screen.getByText('Connections (0)')).toBeInTheDocument()
    expect(screen.queryByText('Total transfer:')).not.toBeInTheDocument()
  })

  it('never shows a Connections section for an unmanaged (peer-only) device', () => {
    render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'device', deviceId: 'device-roamer' }}
        onSelect={vi.fn()}
        isLive={false}
      />,
    )

    expect(screen.queryByText(/^Connections/)).not.toBeInTheDocument()
  })
})

describe('DetailPanel ignore patterns across folder switches', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("resets the loaded ignore section when the selected folder changes, instead of showing the previous folder's patterns", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const path = typeof input === 'string' ? input : input.toString()
        if (path.includes('/api/folders/ledger/ignores')) {
          return new Response(
            JSON.stringify({ folderId: 'ledger', nodes: [{ deviceId: 'device-origin', patterns: ['*.tmp'] }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error(`unexpected fetch in test: ${path}`)
      }),
    )
    const { rerender } = render(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'folder', folderId: 'ledger' }}
        onSelect={vi.fn()}
        isLive={true}
      />,
    )

    fireEvent.click(screen.getByText('Load ignore patterns'))
    expect(await screen.findByDisplayValue('*.tmp')).toBeInTheDocument()

    rerender(
      <DetailPanel
        cluster={edgeCases}
        selection={{ kind: 'folder', folderId: 'coldstore' }}
        onSelect={vi.fn()}
        isLive={true}
      />,
    )

    // The new folder must start unloaded — carrying ledger's patterns over
    // would let a Save write them under coldstore's id.
    expect(screen.getByText('Load ignore patterns')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('*.tmp')).not.toBeInTheDocument()
  })
})
