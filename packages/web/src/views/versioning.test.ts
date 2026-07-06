import { describe, expect, it } from 'vitest'
import type { FolderVersioning } from '@clusterfuck/shared'
import {
  describeVersioning,
  formFieldsFor,
  paramsFromFormFields,
  versioningFieldsValid,
} from './versioning'

describe('formFieldsFor', () => {
  it('uses type defaults when there is no matching current config', () => {
    expect(formFieldsFor('simple', undefined)).toEqual({ keep: '5', cleanoutDays: '0' })
  })

  it('uses type defaults when the current config is a different type', () => {
    const current: FolderVersioning = { type: 'trashcan', params: { cleanoutDays: '30' } }
    // Switching the selector to staggered should not carry trashcan's params over.
    expect(formFieldsFor('staggered', current)).toEqual({ maxAgeDays: '0', versionsPath: '' })
  })

  it('reads existing params when the type matches', () => {
    const current: FolderVersioning = { type: 'simple', params: { keep: '10', cleanoutDays: '7' } }
    expect(formFieldsFor('simple', current)).toEqual({ keep: '10', cleanoutDays: '7' })
  })

  it('converts staggered maxAge seconds to days for the editor', () => {
    const current: FolderVersioning = { type: 'staggered', params: { maxAge: String(3 * 86400), versionsPath: '/v' } }
    expect(formFieldsFor('staggered', current)).toEqual({ maxAgeDays: '3', versionsPath: '/v' })
  })
})

describe('paramsFromFormFields', () => {
  it('coerces int fields, clamping blanks/negatives to 0', () => {
    expect(paramsFromFormFields('simple', { keep: '5', cleanoutDays: '' })).toEqual({
      keep: '5',
      cleanoutDays: '0',
    })
    expect(paramsFromFormFields('trashcan', { cleanoutDays: '-4' })).toEqual({ cleanoutDays: '0' })
  })

  it('converts staggered days back to maxAge seconds', () => {
    expect(paramsFromFormFields('staggered', { maxAgeDays: '2', versionsPath: '' })).toEqual({
      maxAge: String(2 * 86400),
    })
  })

  it('keeps a non-empty optional path but drops a blank one', () => {
    expect(paramsFromFormFields('staggered', { maxAgeDays: '0', versionsPath: '/v' })).toEqual({
      maxAge: '0',
      versionsPath: '/v',
    })
  })

  it('produces no params for none', () => {
    expect(paramsFromFormFields('none', {})).toEqual({})
  })
})

describe('versioningFieldsValid', () => {
  it('requires a command for external', () => {
    expect(versioningFieldsValid('external', { command: '' })).toBe(false)
    expect(versioningFieldsValid('external', { command: '/bin/v' })).toBe(true)
  })

  it('accepts the other types unconditionally', () => {
    expect(versioningFieldsValid('none', {})).toBe(true)
    expect(versioningFieldsValid('simple', { keep: '', cleanoutDays: '' })).toBe(true)
  })
})

describe('describeVersioning', () => {
  it('summarizes each type', () => {
    expect(describeVersioning({ type: 'none', params: {} })).toBe('None')
    expect(describeVersioning({ type: 'simple', params: { keep: '5' } })).toBe('Simple, keep 5')
    expect(describeVersioning({ type: 'trashcan', params: { cleanoutDays: '0' } })).toBe('Trash can')
    expect(describeVersioning({ type: 'trashcan', params: { cleanoutDays: '30' } })).toBe(
      'Trash can, clean out after 30 d',
    )
    expect(describeVersioning({ type: 'staggered', params: { maxAge: String(5 * 86400) } })).toBe(
      'Staggered, max age 5 d',
    )
    expect(describeVersioning({ type: 'external', params: { command: '/bin/v' } })).toBe('External: /bin/v')
  })
})
