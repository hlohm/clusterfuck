import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OverviewView } from './OverviewView'
import { TableView } from './TableView'
import { edgeCases } from '../fixtures/edge-cases'

describe('OverviewView', () => {
  it('renders the KPI row from cluster health', () => {
    render(<OverviewView cluster={edgeCases} />)

    expect(screen.getByText('Devices online')).toBeInTheDocument()
    // edge-cases: origin (this-device) + mirror + relay-a + relay-b connected = 4 of 7
    expect(screen.getByText('4/7')).toBeInTheDocument()
    expect(screen.getByText('Out-of-sync items')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('lists attention shares and opens them on click', () => {
    const onOpenShare = vi.fn()
    render(<OverviewView cluster={edgeCases} onOpenShare={onOpenShare} />)

    // The error share (ledger on satellite) is in the attention list.
    expect(screen.getByText(/disk full/)).toBeInTheDocument()

    screen.getAllByRole('button')[0]!.click()
    expect(onOpenShare).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'error', folderId: 'ledger' }),
    )
  })

  it('renders a card per folder', () => {
    render(<OverviewView cluster={edgeCases} />)
    expect(screen.getByRole('heading', { name: 'ledger' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'coldstore' })).toBeInTheDocument()
  })
})

describe('TableView', () => {
  it('renders one row per share with type and state spelled out', () => {
    render(<TableView cluster={edgeCases} />)

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(1 + edgeCases.shares.length) // header + shares

    expect(screen.getAllByText('Receive Encrypted').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/disk full/)).toBeInTheDocument()
  })

  it('opens a share when its row is clicked', () => {
    const onOpenShare = vi.fn()
    render(<TableView cluster={edgeCases} onOpenShare={onOpenShare} />)

    screen.getByText(/disk full/).closest('tr')!.click()
    expect(onOpenShare).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'ledger', deviceId: 'device-satellite' }),
    )
  })
})
