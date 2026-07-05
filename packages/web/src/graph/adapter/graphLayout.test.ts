import { describe, expect, it } from 'vitest'
import { nodesGraph } from './graphLayout'
import { deviceNodeId } from './GraphAdapter'
import type { ParallelEdgeData } from '../edges/ParallelEdge'
import { edgeCases } from '../../fixtures/edge-cases'
import { hubAndSpoke } from '../../fixtures/hub-and-spoke'

function edgeData(edges: ReturnType<typeof nodesGraph>['edges'], id: string): ParallelEdgeData {
  const edge = edges.find((e) => e.id === id)
  if (!edge) throw new Error(`no edge with id ${id}`)
  return edge.data as ParallelEdgeData
}

describe('nodesGraph share-mode edge encoding', () => {
  it('arrows only the receiving end for an asymmetric sendonly/receiveonly pair', () => {
    const { edges } = nodesGraph(edgeCases, null)
    // ledger: device-mirror is sendonly, device-vault is receiveonly. Sorted: mirror < vault.
    const data = edgeData(edges, 'nodes-edge:ledger:device-mirror:device-vault')

    expect(data.arrowAtSource).toBe(false) // sendonly doesn't receive
    expect(data.arrowAtTarget).toBe(true) // receiveonly does
    expect(data.lockAtSource).toBeFalsy()
    expect(data.lockAtTarget).toBeFalsy()
    expect(data.dashed).toBeFalsy()
  })

  it('arrows and locks both ends of a mutual receiveencrypted relay, and dashes the line', () => {
    const { edges } = nodesGraph(edgeCases, null)
    // coldstore: relay-a and relay-b are both receiveencrypted. Sorted: relay-a < relay-b.
    const data = edgeData(edges, 'nodes-edge:coldstore:device-relay-a:device-relay-b')

    expect(data.arrowAtSource).toBe(true)
    expect(data.arrowAtTarget).toBe(true)
    expect(data.lockAtSource).toBe(true)
    expect(data.lockAtTarget).toBe(true)
    expect(data.dashed).toBe(true)
  })

  it('arrows both ends of a genuine sendreceive/sendreceive pair, with no lock or dash', () => {
    const { edges } = nodesGraph(hubAndSpoke, null)
    // notes: device-hub and device-laptop are both sendreceive. Sorted: hub < laptop.
    const data = edgeData(edges, 'nodes-edge:notes:device-hub:device-laptop')

    expect(data.arrowAtSource).toBe(true)
    expect(data.arrowAtTarget).toBe(true)
    expect(data.lockAtSource).toBeFalsy()
    expect(data.lockAtTarget).toBeFalsy()
    expect(data.dashed).toBeFalsy()
  })

  it('arrows only the source end when the alphabetically-first device is the receiver', () => {
    const { edges } = nodesGraph(hubAndSpoke, null)
    // photos: device-hub (sendreceive) and device-phone (sendonly). Sorted: hub < phone,
    // so hub is the *source* here — the mirror image of the mirror/vault case above,
    // exercising the arrowAtSource-only rendering branch instead of arrowAtTarget-only.
    const data = edgeData(edges, 'nodes-edge:photos:device-hub:device-phone')

    expect(data.arrowAtSource).toBe(true) // hub: sendreceive, receives
    expect(data.arrowAtTarget).toBe(false) // phone: sendonly, doesn't receive
  })

  it('every device pair sharing a folder gets exactly one line-worth of source/target device nodes', () => {
    const { nodes, edges } = nodesGraph(edgeCases, null)
    const deviceNodeIds = new Set(nodes.map((n) => n.id))
    for (const edge of edges) {
      expect(deviceNodeIds.has(edge.source)).toBe(true)
      expect(deviceNodeIds.has(edge.target)).toBe(true)
    }
    expect(deviceNodeIds.has(deviceNodeId('device-origin'))).toBe(true)
  })
})
