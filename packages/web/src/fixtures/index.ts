import type { ClusterModel } from '@clusterfuck/shared'
import { smallMirror } from './small-mirror'
import { hubAndSpoke } from './hub-and-spoke'
import { edgeCases } from './edge-cases'

export const FIXTURE_CLUSTERS: ClusterModel[] = [smallMirror, hubAndSpoke, edgeCases]

export { smallMirror, hubAndSpoke, edgeCases }
