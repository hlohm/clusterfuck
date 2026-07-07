import { describe, expect, it } from 'vitest'
import type { FolderAdvancedOptions } from '@clusterfuck/shared'
import {
  ADVANCED_DEFAULTS,
  advancedFieldsValid,
  advancedFormFields,
  advancedFromFormFields,
  describeAdvanced,
  formatMinDiskFree,
} from './advancedOptions'

const custom: FolderAdvancedOptions = {
  rescanIntervalS: 120,
  fsWatcherEnabled: false,
  fsWatcherDelayS: 30,
  minDiskFree: { value: 500, unit: 'MB' },
}

describe('advancedFormFields', () => {
  it('stringifies the current options for the form', () => {
    expect(advancedFormFields(custom)).toEqual({
      rescanIntervalS: '120',
      fsWatcherEnabled: false,
      fsWatcherDelayS: '30',
      minDiskFreeValue: '500',
      minDiskFreeUnit: 'MB',
    })
  })

  it("falls back to Syncthing's defaults when a share carries no options (fixtures)", () => {
    expect(advancedFormFields(undefined)).toEqual(advancedFormFields(ADVANCED_DEFAULTS))
  })
})

describe('advancedFieldsValid', () => {
  it('accepts the defaults and a zero rescan interval', () => {
    expect(advancedFieldsValid(advancedFormFields(undefined))).toBe(true)
    expect(advancedFieldsValid({ ...advancedFormFields(undefined), rescanIntervalS: '0' })).toBe(true)
  })

  it('rejects blanks, negatives, non-numbers, and a non-positive watcher delay', () => {
    const ok = advancedFormFields(undefined)
    expect(advancedFieldsValid({ ...ok, rescanIntervalS: '' })).toBe(false)
    expect(advancedFieldsValid({ ...ok, rescanIntervalS: '-1' })).toBe(false)
    expect(advancedFieldsValid({ ...ok, fsWatcherDelayS: '0' })).toBe(false)
    expect(advancedFieldsValid({ ...ok, minDiskFreeValue: 'lots' })).toBe(false)
  })
})

describe('advancedFromFormFields', () => {
  it('round-trips: fields built from options parse back to the same options', () => {
    expect(advancedFromFormFields(advancedFormFields(custom))).toEqual(custom)
  })
})

describe('display helpers', () => {
  it('formats a percent floor without a space and a sized one with', () => {
    expect(formatMinDiskFree({ value: 1, unit: '%' })).toBe('1%')
    expect(formatMinDiskFree({ value: 500, unit: 'MB' })).toBe('500 MB')
  })

  it('summarizes the active configuration', () => {
    expect(describeAdvanced(ADVANCED_DEFAULTS)).toBe('rescan every 1h 0m · watcher on (10s) · min free 1%')
  })

  it('spells out the disabled states instead of showing zeros', () => {
    expect(describeAdvanced(custom)).toBe('rescan every 2m · watcher off · min free 500 MB')
    expect(
      describeAdvanced({ ...custom, rescanIntervalS: 0, minDiskFree: { value: 0, unit: '%' } }),
    ).toBe('periodic rescan off · watcher off · no free-space floor')
  })
})
