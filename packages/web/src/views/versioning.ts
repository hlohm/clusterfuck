import type { FolderVersioning, VersioningType } from '@clusterfuck/shared'

/**
 * Editor + display helpers for a share's file-versioning config. Kept as pure
 * functions (no React) so the param plumbing — including Syncthing's
 * seconds-vs-days quirk for staggered `maxAge` — is unit-testable on its own.
 * `params` in the model are Syncthing's raw string knobs; the editor works in
 * friendlier synthetic fields (notably `maxAgeDays`) and converts on the way
 * in and out.
 */

export const VERSIONING_TYPE_LABELS: Record<VersioningType, string> = {
  none: 'No versioning',
  trashcan: 'Trash can',
  simple: 'Simple',
  staggered: 'Staggered',
  external: 'External command',
}

export interface VersioningField {
  /** Editor form-state key — the raw Syncthing param key, except `maxAgeDays` (see conversions). */
  key: string
  label: string
  kind: 'int' | 'text'
  placeholder?: string
  /** A blank value is dropped from params rather than sent as "" (e.g. an optional path). */
  optional?: boolean
}

const SECONDS_PER_DAY = 86_400

/** The knobs the editor exposes per type — a focused subset of Syncthing's, matching what its own GUI surfaces. */
export const VERSIONING_FIELDS: Record<VersioningType, VersioningField[]> = {
  none: [],
  trashcan: [{ key: 'cleanoutDays', label: 'Clean out after (days, 0 = keep forever)', kind: 'int' }],
  simple: [
    { key: 'keep', label: 'Keep versions', kind: 'int' },
    { key: 'cleanoutDays', label: 'Clean out after (days, 0 = keep forever)', kind: 'int' },
  ],
  staggered: [
    { key: 'maxAgeDays', label: 'Maximum age (days, 0 = keep forever)', kind: 'int' },
    { key: 'versionsPath', label: 'Versions path (optional)', kind: 'text', placeholder: 'default', optional: true },
  ],
  external: [
    {
      key: 'command',
      label: 'Command',
      kind: 'text',
      placeholder: 'e.g. /usr/bin/versioner %FOLDER_PATH% %FILE_PATH%',
    },
  ],
}

/** Starting values when a type is first selected — mirrors Syncthing's own defaults. */
const DEFAULTS: Record<VersioningType, Record<string, string>> = {
  none: {},
  trashcan: { cleanoutDays: '0' },
  simple: { keep: '5', cleanoutDays: '0' },
  staggered: { maxAgeDays: '0', versionsPath: '' },
  external: { command: '' },
}

function toDays(seconds: string | undefined): string {
  const s = Number(seconds ?? '0')
  return Number.isFinite(s) && s > 0 ? String(Math.round(s / SECONDS_PER_DAY)) : '0'
}

/**
 * Populates the editor's fields for `type`, from the current config when it's
 * already that type, otherwise from the type's defaults (so flipping the
 * selector shows sensible starting values rather than the previous type's).
 */
export function formFieldsFor(
  type: VersioningType,
  current: FolderVersioning | undefined,
): Record<string, string> {
  const params = current && current.type === type ? current.params : undefined
  const out: Record<string, string> = {}
  for (const field of VERSIONING_FIELDS[type]) {
    if (!params) {
      out[field.key] = DEFAULTS[type][field.key] ?? ''
    } else if (type === 'staggered' && field.key === 'maxAgeDays') {
      out[field.key] = toDays(params.maxAge)
    } else {
      out[field.key] = params[field.key] ?? DEFAULTS[type][field.key] ?? ''
    }
  }
  return out
}

/** Converts the editor's field values into Syncthing's raw string params for `type`. */
export function paramsFromFormFields(
  type: VersioningType,
  fields: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = {}
  for (const field of VERSIONING_FIELDS[type]) {
    const raw = (fields[field.key] ?? '').trim()
    if (type === 'staggered' && field.key === 'maxAgeDays') {
      const days = Number(raw)
      params.maxAge = String(Number.isFinite(days) && days > 0 ? Math.round(days * SECONDS_PER_DAY) : 0)
    } else if (field.kind === 'int') {
      const n = Number(raw)
      params[field.key] = String(Number.isFinite(n) && n > 0 ? Math.round(n) : 0)
    } else if (raw !== '' || !field.optional) {
      params[field.key] = raw
    }
  }
  return params
}

/** Whether the editor's fields are complete enough to save (external needs a command). */
export function versioningFieldsValid(type: VersioningType, fields: Record<string, string>): boolean {
  if (type === 'external') return (fields.command ?? '').trim() !== ''
  return true
}

/** A one-line human summary for the read-only detail view. */
export function describeVersioning(v: FolderVersioning): string {
  switch (v.type) {
    case 'none':
      return 'None'
    case 'trashcan': {
      const days = v.params.cleanoutDays ?? '0'
      return days !== '0' && days !== '' ? `Trash can, clean out after ${days} d` : 'Trash can'
    }
    case 'simple':
      return `Simple, keep ${v.params.keep ?? '?'}`
    case 'staggered': {
      const days = toDays(v.params.maxAge)
      return days !== '0' ? `Staggered, max age ${days} d` : 'Staggered'
    }
    case 'external': {
      const cmd = v.params.command ?? ''
      return cmd ? `External: ${cmd}` : 'External'
    }
  }
}
