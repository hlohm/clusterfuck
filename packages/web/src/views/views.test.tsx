import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { OverviewView } from './OverviewView'
import { TableView } from './TableView'
import { edgeCases } from '../fixtures/edge-cases'
import * as mutations from '../data/mutations'

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

  it('renders a card per device, with a share row per folder it participates in', () => {
    render(<OverviewView cluster={edgeCases} />)
    expect(screen.getByRole('heading', { name: 'origin' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'mirror' })).toBeInTheDocument()
    // relay-a shares exactly one folder (coldstore), receiveencrypted.
    expect(screen.getAllByText('Receive Encrypted').length).toBeGreaterThan(0)
  })

  it("shows an unmanaged device's card with no folders instead of an empty list", () => {
    render(<OverviewView cluster={edgeCases} />)
    expect(screen.getByRole('heading', { name: 'roamer (unmanaged)' })).toBeInTheDocument()
    expect(screen.getByText(/Known only from another node/)).toBeInTheDocument()
  })

  it("opens a device's folder share from its Nodes card", () => {
    const onOpenShare = vi.fn()
    render(<OverviewView cluster={edgeCases} onOpenShare={onOpenShare} />)

    const mirrorCard = screen.getByRole('heading', { name: 'mirror' }).closest('.folder-card') as HTMLElement
    within(mirrorCard).getByText('ledger').click()

    expect(onOpenShare).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'ledger', deviceId: 'device-mirror' }),
    )
  })

  it('shows pending devices and folders even on a fixture, with no accept/dismiss actions', () => {
    render(<OverviewView cluster={edgeCases} />)

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('new-phone')).toBeInTheDocument()
    expect(screen.getByText(/tried to connect on origin, mirror/)).toBeInTheDocument()
    expect(screen.getByText('Recipes')).toBeInTheDocument()
    expect(screen.getByText(/offered by relay-a on origin/)).toBeInTheDocument()
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    expect(screen.queryByText('Dismiss')).not.toBeInTheDocument()
  })

  it('dismisses a pending device once confirmed, when live', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const dismiss = vi.spyOn(mutations, 'dismissPendingDevice').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    const row = screen.getByText('new-phone').closest('.pending-row') as HTMLElement
    within(row).getByText('Dismiss').click()

    expect(confirmSpy).toHaveBeenCalled()
    expect(dismiss).toHaveBeenCalledWith('PENDING-DEVICE-1')

    confirmSpy.mockRestore()
    dismiss.mockRestore()
  })

  it('dismisses one pending folder offer once confirmed, when live', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const dismiss = vi.spyOn(mutations, 'dismissPendingFolder').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    const row = screen.getByText('Recipes').closest('.pending-row') as HTMLElement
    within(row).getByText('Dismiss').click()

    expect(confirmSpy).toHaveBeenCalled()
    expect(dismiss).toHaveBeenCalledWith('device-origin', 'shared-recipes', 'device-relay-a')

    confirmSpy.mockRestore()
    dismiss.mockRestore()
  })

  it('opens the accept-pending-device dialog, prefilled, and submits to the right mutation', () => {
    const accept = vi.spyOn(mutations, 'acceptPendingDevice').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    const row = screen.getByText('new-phone').closest('.pending-row') as HTMLElement
    fireEvent.click(within(row).getByText('Accept'))

    const dialog = screen.getByRole('dialog', { name: 'Accept pending device' })
    expect(within(dialog).getByDisplayValue('new-phone')).toBeInTheDocument() // name prefilled from the suggestion

    fireEvent.click(within(dialog).getByText('Accept'))

    expect(accept).toHaveBeenCalledWith('PENDING-DEVICE-1', 'new-phone', expect.any(Array))

    accept.mockRestore()
  })

  it('opens the accept-pending-folder dialog and submits with the required path', () => {
    const accept = vi.spyOn(mutations, 'acceptPendingFolder').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    const row = screen.getByText('Recipes').closest('.pending-row') as HTMLElement
    fireEvent.click(within(row).getByText('Accept'))

    const dialog = screen.getByRole('dialog', { name: 'Accept pending folder' })
    const pathInput = within(dialog).getByPlaceholderText('~/shared-recipes')
    fireEvent.change(pathInput, { target: { value: '~/recipes' } })

    fireEvent.click(within(dialog).getByText('Accept'))

    expect(accept).toHaveBeenCalledWith(
      'device-origin',
      'shared-recipes',
      expect.objectContaining({ offeredBy: 'device-relay-a', path: '~/recipes' }),
    )

    accept.mockRestore()
  })

  it('locks an encrypted pending-folder offer to the receiveencrypted type', () => {
    const accept = vi.spyOn(mutations, 'acceptPendingFolder').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    expect(screen.getByText(/offered by relay-b on mirror \(encrypted\)/)).toBeInTheDocument()

    const row = screen.getByText('Vault backup').closest('.pending-row') as HTMLElement
    fireEvent.click(within(row).getByText('Accept'))

    const dialog = screen.getByRole('dialog', { name: 'Accept pending folder' })
    const typeSelect = within(dialog).getByTitle(/can only be accepted as receiveencrypted/) as HTMLSelectElement
    expect(typeSelect.value).toBe('receiveencrypted')
    expect(typeSelect.disabled).toBe(true)

    fireEvent.click(within(dialog).getByText('Accept'))

    expect(accept).toHaveBeenCalledWith(
      'device-mirror',
      'vault-backup',
      expect.objectContaining({ offeredBy: 'device-relay-b', type: 'receiveencrypted' }),
    )

    accept.mockRestore()
  })

  it('only offers cluster-wide actions against the live source, never a fixture', () => {
    render(<OverviewView cluster={edgeCases} />)
    expect(screen.queryByText('Cluster actions')).not.toBeInTheDocument()
  })

  it('pauses every device cluster-wide from the Overview, once confirmed', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const pauseAll = vi.spyOn(mutations, 'setAllDevicesPaused').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    expect(screen.getByText('Cluster actions')).toBeInTheDocument()

    const devicesRow = screen.getByText('Devices').closest('.cluster-actions__row') as HTMLElement
    within(devicesRow).getByText('Pause all').click()

    expect(confirmSpy).toHaveBeenCalled()
    expect(pauseAll).toHaveBeenCalledWith(true)

    confirmSpy.mockRestore()
    pauseAll.mockRestore()
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
