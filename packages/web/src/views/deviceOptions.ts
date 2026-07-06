import type { DeviceOptions, NodeDeviceOptions } from '@clusterfuck/shared'

/**
 * Editor helpers for a device's options (name, addresses, compression,
 * introducer, auto-accept, rate limits). Pure functions like versioning.ts /
 * advancedOptions.ts: typed options on the wire, string form fields in the
 * editor, conversions tested on their own.
 */

export interface DeviceOptionsFormFields {
  name: string
  /** One address per line; parsed to Syncthing's list on save. */
  addressesText: string
  compression: string
  introducer: boolean
  autoAcceptFolders: boolean
  maxSendKbps: string
  maxRecvKbps: string
}

export function deviceOptionsFormFields(options: DeviceOptions): DeviceOptionsFormFields {
  return {
    name: options.name,
    addressesText: options.addresses.join('\n'),
    compression: options.compression,
    introducer: options.introducer,
    autoAcceptFolders: options.autoAcceptFolders,
    maxSendKbps: String(options.maxSendKbps),
    maxRecvKbps: String(options.maxRecvKbps),
  }
}

/** One address per non-blank line, whitespace-trimmed; empty input falls back to discovery. */
export function parseAddresses(text: string): string[] {
  const addresses = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return addresses.length > 0 ? addresses : ['dynamic']
}

/** Mirrors the proxy's validation so the Apply button disables instead of round-tripping to a 400. */
export function deviceOptionsFieldsValid(fields: DeviceOptionsFormFields): boolean {
  const validKbps = (raw: string) => {
    const n = Number(raw)
    return raw.trim() !== '' && Number.isInteger(n) && n >= 0
  }
  return validKbps(fields.maxSendKbps) && validKbps(fields.maxRecvKbps)
}

/** Only meaningful when deviceOptionsFieldsValid(fields). */
export function deviceOptionsFromFormFields(fields: DeviceOptionsFormFields): DeviceOptions {
  return {
    name: fields.name.trim(),
    addresses: parseAddresses(fields.addressesText),
    compression: fields.compression,
    introducer: fields.introducer,
    autoAcceptFolders: fields.autoAcceptFolders,
    maxSendKbps: Number(fields.maxSendKbps),
    maxRecvKbps: Number(fields.maxRecvKbps),
  }
}

/**
 * Whether the readable nodes disagree about how the device is configured —
 * the editor applies one set of options to every node, so the user should
 * know when that will overwrite a deliberate per-node difference.
 */
export function deviceOptionsDiffer(nodes: NodeDeviceOptions[]): boolean {
  const readable = nodes.filter((n) => n.options !== undefined)
  if (readable.length < 2) return false
  const first = JSON.stringify(readable[0]!.options)
  return readable.some((n) => JSON.stringify(n.options) !== first)
}
