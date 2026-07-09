import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LoginScreen } from './LoginScreen'
import * as auth from '../data/auth'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoginScreen', () => {
  it('disables Sign in until a token is entered', () => {
    render(<LoginScreen onAuthorized={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Access token'), { target: { value: 'sekrit' } })
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('logs in with the entered token and reports success', async () => {
    const login = vi.spyOn(auth, 'login').mockResolvedValue(undefined)
    const onAuthorized = vi.fn()
    render(<LoginScreen onAuthorized={onAuthorized} />)

    fireEvent.change(screen.getByPlaceholderText('Access token'), { target: { value: 'sekrit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(login).toHaveBeenCalledWith('sekrit')
    await vi.waitFor(() => expect(onAuthorized).toHaveBeenCalled())
  })

  it("shows the proxy's error on a rejected token and re-enables the form", async () => {
    vi.spyOn(auth, 'login').mockRejectedValue(new Error('invalid token'))
    render(<LoginScreen onAuthorized={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Access token'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('invalid token')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })
})
