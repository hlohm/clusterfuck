import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RegisterNodeDialog } from './AddDialogs'
import * as mutations from '../data/mutations'

describe('RegisterNodeDialog', () => {
  it('disables Register node until id, url, and apiKey are all filled in', () => {
    render(<RegisterNodeDialog onClose={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Register node' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('st-a'), { target: { value: 'st-c' } })
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('http://127.0.0.1:8384'), {
      target: { value: 'http://127.0.0.1:38384' },
    })
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText(/Actions.*Settings.*GUI/), {
      target: { value: 'the-api-key' },
    })
    expect(button.disabled).toBe(false)
  })

  it('submits the trimmed id, url, and apiKey to registerNode, then closes', async () => {
    const onClose = vi.fn()
    const registerNode = vi.spyOn(mutations, 'registerNode').mockResolvedValue(undefined)

    render(<RegisterNodeDialog onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('st-a'), { target: { value: '  st-c  ' } })
    fireEvent.change(screen.getByPlaceholderText('http://127.0.0.1:8384'), {
      target: { value: '  http://127.0.0.1:38384  ' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Actions.*Settings.*GUI/), {
      target: { value: '  the-api-key  ' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Register node' }))

    // Trimmed: a copy-pasted key with accidental leading/trailing
    // whitespace would otherwise fail Syncthing's exact X-API-Key match,
    // and (per addNode's connectivity check) surface as a confusing
    // "could not connect" error instead of the fixable typo it actually is.
    expect(registerNode).toHaveBeenCalledWith('st-c', 'http://127.0.0.1:38384', 'the-api-key')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())

    registerNode.mockRestore()
  })

  it('masks the API key input so it is not shown in plain text', () => {
    render(<RegisterNodeDialog onClose={vi.fn()} />)
    const input = screen.getByPlaceholderText(/Actions.*Settings.*GUI/) as HTMLInputElement
    expect(input.type).toBe('password')
  })

  it('shows the mutation error inline and re-enables the form instead of closing', async () => {
    const onClose = vi.fn()
    const registerNode = vi
      .spyOn(mutations, 'registerNode')
      .mockRejectedValue(new Error('st-c is already a registered node'))

    render(<RegisterNodeDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('st-a'), { target: { value: 'st-c' } })
    fireEvent.change(screen.getByPlaceholderText('http://127.0.0.1:8384'), {
      target: { value: 'http://127.0.0.1:38384' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Actions.*Settings.*GUI/), {
      target: { value: 'the-api-key' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Register node' }))

    expect(await screen.findByText('st-c is already a registered node')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    registerNode.mockRestore()
  })
})
