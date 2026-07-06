import { describe, expect, it } from 'vitest'
import type { DeviceOptions, NodeDeviceOptions } from '@clusterfuck/shared'
import {
  deviceOptionsDiffer,
  deviceOptionsFieldsValid,
  deviceOptionsFormFields,
  deviceOptionsFromFormFields,
  parseAddresses,
} from './deviceOptions'

const options: DeviceOptions = {
  name: 'backup box',
  addresses: ['tcp://10.0.0.9:22000', 'dynamic'],
  compression: 'metadata',
  introducer: true,
  autoAcceptFolders: false,
  maxSendKbps: 1000,
  maxRecvKbps: 0,
}

describe('form field round-trip', () => {
  it('options -> fields -> options is lossless', () => {
    expect(deviceOptionsFromFormFields(deviceOptionsFormFields(options))).toEqual(options)
  })
})

describe('parseAddresses', () => {
  it('takes one address per line, trimming and dropping blanks', () => {
    expect(parseAddresses(' tcp://a:22000 \n\n dynamic \n')).toEqual(['tcp://a:22000', 'dynamic'])
  })

  it('falls back to discovery when everything is blank', () => {
    expect(parseAddresses('')).toEqual(['dynamic'])
    expect(parseAddresses('  \n  ')).toEqual(['dynamic'])
  })
})

describe('deviceOptionsFieldsValid', () => {
  it('accepts zero (unlimited) and rejects blanks, negatives, and fractions', () => {
    const fields = deviceOptionsFormFields(options)
    expect(deviceOptionsFieldsValid(fields)).toBe(true)
    expect(deviceOptionsFieldsValid({ ...fields, maxSendKbps: '' })).toBe(false)
    expect(deviceOptionsFieldsValid({ ...fields, maxRecvKbps: '-1' })).toBe(false)
    expect(deviceOptionsFieldsValid({ ...fields, maxSendKbps: '1.5' })).toBe(false)
  })
})

describe('deviceOptionsDiffer', () => {
  const node = (nodeId: string, opts: DeviceOptions | undefined, error?: string): NodeDeviceOptions => ({
    nodeId,
    options: opts,
    ...(error !== undefined ? { error } : {}),
  })

  it('is false for a single readable node and for identical configs', () => {
    expect(deviceOptionsDiffer([node('a', options)])).toBe(false)
    expect(deviceOptionsDiffer([node('a', options), node('b', { ...options })])).toBe(false)
  })

  it('is true when any readable node disagrees, ignoring unreadable ones', () => {
    expect(
      deviceOptionsDiffer([node('a', options), node('b', { ...options, compression: 'always' })]),
    ).toBe(true)
    expect(
      deviceOptionsDiffer([node('a', options), node('b', undefined, 'connection failed')]),
    ).toBe(false)
  })
})
