import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsOverlay } from './SettingsOverlay'
import * as auth from '../data/auth'

afterEach(() => vi.restoreAllMocks())

describe('SettingsOverlay', () => {
  it('initialises auth from the open state by generating a token, then shows it to save', async () => {
    vi.spyOn(auth, 'getAuthStatus').mockResolvedValue({
      required: false,
      authorized: true,
      managedByEnv: false,
    })
    const setToken = vi.spyOn(auth, 'setAuthToken').mockResolvedValue('generated-token-value')
    render(<SettingsOverlay onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Generate & enable' }))

    await waitFor(() => expect(setToken).toHaveBeenCalledWith(undefined))
    expect(await screen.findByText('generated-token-value')).toBeInTheDocument()
  })

  it('reveals the current token and offers rotate/generate when enabled and file-managed', async () => {
    vi.spyOn(auth, 'getAuthStatus').mockResolvedValue({
      required: true,
      authorized: true,
      managedByEnv: false,
    })
    vi.spyOn(auth, 'getToken').mockResolvedValue('the-current-token')
    render(<SettingsOverlay onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Generate new token' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show token' }))
    expect(await screen.findByText('the-current-token')).toBeInTheDocument()
  })

  it('hides rotate/generate and explains how to change an env-managed token', async () => {
    vi.spyOn(auth, 'getAuthStatus').mockResolvedValue({
      required: true,
      authorized: true,
      managedByEnv: true,
    })
    vi.spyOn(auth, 'getToken').mockResolvedValue('the-env-token')
    render(<SettingsOverlay onClose={vi.fn()} />)

    expect(await screen.findByText(/remove the proxy's auth file and restart/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate new token' })).not.toBeInTheDocument()
    // Reveal + sign out remain available.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()

    // The reveal can be put away again without closing the dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Show token' }))
    expect(await screen.findByText('the-env-token')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('the-env-token')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show token' })).toBeInTheDocument()
  })

  it('confirms before rotating, since it signs out other browsers', async () => {
    vi.spyOn(auth, 'getAuthStatus').mockResolvedValue({
      required: true,
      authorized: true,
      managedByEnv: false,
    })
    const setToken = vi.spyOn(auth, 'setAuthToken').mockResolvedValue('new-token')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SettingsOverlay onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Generate new token' }))
    expect(confirm).toHaveBeenCalled()
    expect(setToken).not.toHaveBeenCalled() // declined
  })
})
