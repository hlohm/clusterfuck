import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { OverviewView } from './OverviewView'
import { TableView } from './TableView'
import { edgeCases } from '../fixtures/edge-cases'
import * as mutations from '../data/mutations'
import { formatBytes } from '../format'

describe('OverviewView', () => {
  it('renders the KPI row from cluster health', () => {
    render(<OverviewView cluster={edgeCases} />)

    expect(screen.getByText('Devices online')).toBeInTheDocument()
    // edge-cases: origin (this-device) + mirror + relay-a + relay-b connected = 4 of 7
    expect(screen.getByText('4/7')).toBeInTheDocument()
    expect(screen.getByText('Out-of-sync items')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('renders a cluster-wide data-transferred tile, summed across every reported connection', () => {
    render(<OverviewView cluster={edgeCases} />)

    // edge-cases: device-origin reports 3 connections, but only the
    // connected one (mirror) has nonzero bytes — a disconnected connection's
    // totals are 0, per Connection's doc comment — and no other device
    // reports any, so mirror's own numbers are also the cluster totals.
    const totalIn = 128_500_000
    const totalOut = 340_200_000

    expect(screen.getByText('Data transferred')).toBeInTheDocument()
    const tile = screen.getByText('Data transferred').closest('.stat-tile') as HTMLElement
    expect(within(tile).getByText(formatBytes(totalIn + totalOut))).toBeInTheDocument()
    expect(within(tile).getByText(new RegExp(formatBytes(totalOut)))).toBeInTheDocument()
    expect(within(tile).getByText(new RegExp(formatBytes(totalIn)))).toBeInTheDocument()
  })

  it('lists attention shares and opens them on click', () => {
    const onOpenShare = vi.fn()
    render(<OverviewView cluster={edgeCases} onOpenShare={onOpenShare} />)

    // The error share (ledger on satellite) is in the attention list; click
    // its own row (the first button on the page is now a section toggle).
    screen.getByText(/disk full/).closest('button')!.click()
    expect(onOpenShare).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'error', folderId: 'ledger' }),
    )
  })

  it('collapses a section on its header toggle and moves it with the arrow controls', () => {
    window.localStorage.clear()
    render(<OverviewView cluster={edgeCases} />)

    // Collapse "Needs attention": its content disappears, the heading stays.
    expect(screen.getByText(/disk full/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }))
    expect(screen.queryByText(/disk full/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }))
    expect(screen.getByText(/disk full/)).toBeInTheDocument()

    // Move "Folders" above "Nodes" and check the heading order flips.
    const headingOrder = () =>
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headingOrder().indexOf('Nodes')).toBeLessThan(headingOrder().indexOf('Folders'))
    fireEvent.click(screen.getByRole('button', { name: 'Move Folders up' }))
    expect(headingOrder().indexOf('Folders')).toBeLessThan(headingOrder().indexOf('Nodes'))

    // The arrangement persisted.
    expect(window.localStorage.getItem('clusterfuck.overviewLayout')).toContain('folders')
    window.localStorage.clear() // don't leak the custom layout into other tests
  })

  it('renders a card per folder', () => {
    render(<OverviewView cluster={edgeCases} />)
    expect(screen.getByRole('heading', { name: 'ledger' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'coldstore' })).toBeInTheDocument()
  })

  it('reveals the access token on demand when the proxy has auth enabled', async () => {
    const authModule = await import('../data/auth')
    const statusSpy = vi
      .spyOn(authModule, 'getAuthStatus')
      .mockResolvedValue({ required: true, authorized: true })
    const tokenSpy = vi.spyOn(authModule, 'getToken').mockResolvedValue('sekrit-token')
    render(<OverviewView cluster={edgeCases} isLive />)

    const show = await screen.findByRole('button', { name: 'Show access token' })
    show.click()
    expect(await screen.findByText('sekrit-token')).toBeInTheDocument()

    statusSpy.mockRestore()
    tokenSpy.mockRestore()
  })

  it('applies an asymmetric-share drift fix through the existing addShare mutation, once confirmed', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const addShare = vi.spyOn(mutations, 'addShare').mockResolvedValue(undefined)
    render(<OverviewView cluster={edgeCases} isLive />)

    // The vault-doesn't-share-back findings carry a one-click fix when live.
    const fixButtons = screen.getAllByRole('button', { name: 'Apply fix' })
    expect(fixButtons.length).toBeGreaterThanOrEqual(2)
    // Rows render warnings (asymmetric) before infos (label), so the first
    // Apply fix belongs to an asymmetric-share finding on vault's copy.
    fixButtons[0]!.click()

    expect(addShare).toHaveBeenCalledWith('device-vault', 'ledger', expect.any(String))
    confirmSpy.mockRestore()
    addShare.mockRestore()
  })

  it('offers no Apply fix on fixtures (mutations need the live source)', () => {
    render(<OverviewView cluster={edgeCases} />)
    expect(screen.queryByRole('button', { name: 'Apply fix' })).not.toBeInTheDocument()
  })

  it("surfaces the fixture's deliberate config drift with suggested fixes, deep-linking on click", () => {
    const onOpenShare = vi.fn()
    render(<OverviewView cluster={edgeCases} onOpenShare={onOpenShare} />)

    expect(screen.getByRole('heading', { name: 'Config drift' })).toBeInTheDocument()
    // The asymmetric-share warnings (vault doesn't share back) and the label drift.
    expect(screen.getAllByText(/doesn't share it back/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/labeled differently/)).toBeInTheDocument()
    expect(screen.getAllByText(/^Fix: /).length).toBeGreaterThanOrEqual(3)

    screen.getAllByText(/doesn't share it back/)[0]!.closest('button')!.click()
    expect(onOpenShare).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'ledger' }))
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

  it('offers Remove node only on managed nodes, never on an unmanaged (peer-only) device', () => {
    render(<OverviewView cluster={edgeCases} isLive />)

    const originCard = screen.getByRole('heading', { name: 'origin' }).closest('.folder-card') as HTMLElement
    expect(within(originCard).getByText('Remove node')).toBeInTheDocument()

    const roamerCard = screen
      .getByRole('heading', { name: 'roamer (unmanaged)' })
      .closest('.folder-card') as HTMLElement
    expect(within(roamerCard).queryByText('Remove node')).not.toBeInTheDocument()
  })

  it('does not offer Remove node against a fixture (not live)', () => {
    render(<OverviewView cluster={edgeCases} />)
    const originCard = screen.getByRole('heading', { name: 'origin' }).closest('.folder-card') as HTMLElement
    expect(within(originCard).queryByText('Remove node')).not.toBeInTheDocument()
  })

  it('removes a node once confirmed, by its device id', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const removeNode = vi.spyOn(mutations, 'removeNode').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    const mirrorCard = screen.getByRole('heading', { name: 'mirror' }).closest('.folder-card') as HTMLElement
    within(mirrorCard).getByText('Remove node').click()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Remove mirror as a registered node?'))
    expect(removeNode).toHaveBeenCalledWith('device-mirror')

    confirmSpy.mockRestore()
    removeNode.mockRestore()
  })

  it('does not remove a node when the confirmation is declined', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const removeNode = vi.spyOn(mutations, 'removeNode').mockResolvedValue(undefined)

    render(<OverviewView cluster={edgeCases} isLive />)
    const mirrorCard = screen.getByRole('heading', { name: 'mirror' }).closest('.folder-card') as HTMLElement
    within(mirrorCard).getByText('Remove node').click()

    expect(removeNode).not.toHaveBeenCalled()

    confirmSpy.mockRestore()
    removeNode.mockRestore()
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
