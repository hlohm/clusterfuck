import { describe, expect, it } from 'vitest'
import { EventLog } from './eventLog.ts'

function event(id: number, type: string, data: unknown = {}) {
  return { id, type, time: `2026-07-09T10:00:0${id % 10}Z`, data }
}

describe('EventLog', () => {
  it('merges events across nodes, newest first, keeping the raw payload', () => {
    const log = new EventLog(10)
    log.push('DEVICE-A', event(1, 'StateChanged', { folder: 'f1' }))
    log.push('DEVICE-B', event(1, 'DeviceConnected'))

    const { events } = log.list()
    expect(events.map((e) => [e.nodeId, e.type])).toEqual([
      ['DEVICE-B', 'DeviceConnected'],
      ['DEVICE-A', 'StateChanged'],
    ])
    expect(events[1]!.data).toEqual({ folder: 'f1' })
  })

  it('filters by type set and node, and caps with limit after filtering', () => {
    const log = new EventLog(10)
    log.push('DEVICE-A', event(1, 'StateChanged'))
    log.push('DEVICE-A', event(2, 'FolderSummary'))
    log.push('DEVICE-B', event(1, 'StateChanged'))

    expect(log.list({ types: new Set(['StateChanged']) }).events).toHaveLength(2)
    expect(log.list({ nodeId: 'DEVICE-B' }).events).toHaveLength(1)
    expect(log.list({ types: new Set(['StateChanged']), limit: 1 }).events).toHaveLength(1)
    // An empty type set means "no filter", not "match nothing".
    expect(log.list({ types: new Set() }).events).toHaveLength(3)
  })

  it('drops the oldest entries past its capacity', () => {
    const log = new EventLog(2)
    log.push('DEVICE-A', event(1, 'One'))
    log.push('DEVICE-A', event(2, 'Two'))
    log.push('DEVICE-A', event(3, 'Three'))

    expect(log.list().events.map((e) => e.type)).toEqual(['Three', 'Two'])
  })
})
