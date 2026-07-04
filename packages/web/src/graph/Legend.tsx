import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { FOLDER_STATE_STYLE } from '../encoding/folderStateStyle'
import { DEVICE_STATE_STYLE } from '../encoding/deviceStateStyle'
import { folderColorMap } from '../encoding/folderColors'
import { cssColor } from '../encoding/colors'
import type { ClusterModel, FolderType, FolderState, DeviceState } from '@clusterfuck/shared'
import type { GraphMode } from './adapter/GraphAdapter'

const FOLDER_TYPES: FolderType[] = ['sendreceive', 'sendonly', 'receiveonly', 'receiveencrypted']
const FOLDER_STATES: FolderState[] = ['idle', 'syncing', 'scanning', 'out-of-sync', 'error', 'paused']
const DEVICE_STATES: DeviceState[] = ['this-device', 'connected', 'disconnected', 'paused']

export interface LegendProps {
  cluster: ClusterModel
  mode: GraphMode
}

export function Legend({ cluster, mode }: LegendProps) {
  const folderColors = folderColorMap(cluster.folders.map((f) => f.id))

  return (
    <aside className="legend">
      {mode === 'hubs' && (
        <section>
          <h3>Shapes</h3>
          <ul>
            <li>
              <span className="legend__shape legend__shape--device" />
              <span>Device</span>
            </li>
            <li>
              <span className="legend__shape legend__shape--folder" />
              <span>Folder</span>
            </li>
          </ul>
        </section>
      )}

      {mode === 'hubs' ? (
        <section>
          <h3>Folder type (edge)</h3>
          <ul>
            {FOLDER_TYPES.map((type) => {
              const style = FOLDER_TYPE_STYLE[type]
              return (
                <li key={type}>
                  <span
                    className="legend__swatch"
                    style={{
                      backgroundColor: cssColor(style.color),
                      borderStyle: style.dash === 'dashed' ? 'dashed' : 'solid',
                    }}
                  />
                  <span>{style.label}</span>
                  {style.icon === 'lock' && <span title="encrypted">🔒</span>}
                </li>
              )
            })}
          </ul>
        </section>
      ) : (
        <section>
          <h3>Folders (edge color)</h3>
          <ul>
            {cluster.folders.map((folder) => {
              const color = folderColors.get(folder.id)
              return (
                <li key={folder.id}>
                  <span
                    className="legend__swatch"
                    style={{ backgroundColor: color ? cssColor(color) : undefined }}
                  />
                  <span>{folder.label}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section>
        <h3>Folder state (badge)</h3>
        <ul>
          {FOLDER_STATES.map((state) => {
            const style = FOLDER_STATE_STYLE[state]
            return (
              <li key={state}>
                <span className="legend__dot" style={{ backgroundColor: cssColor(style.color) }} />
                <span>{style.label}</span>
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h3>Device state</h3>
        <ul>
          {DEVICE_STATES.map((state) => {
            const style = DEVICE_STATE_STYLE[state]
            return (
              <li key={state}>
                <span
                  className="legend__swatch legend__swatch--round"
                  style={{
                    borderStyle: style.outline,
                    borderColor: cssColor(style.accent),
                  }}
                />
                <span>{style.label}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
