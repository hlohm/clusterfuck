import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { FOLDER_STATE_STYLE } from '../encoding/folderStateStyle'
import { DEVICE_STATE_STYLE } from '../encoding/deviceStateStyle'
import type { FolderType, FolderState, DeviceState } from '../model/types'

const FOLDER_TYPES: FolderType[] = ['sendreceive', 'sendonly', 'receiveonly', 'receiveencrypted']
const FOLDER_STATES: FolderState[] = ['idle', 'syncing', 'scanning', 'out-of-sync', 'error', 'paused']
const DEVICE_STATES: DeviceState[] = ['this-device', 'connected', 'disconnected', 'paused']

export function Legend() {
  return (
    <aside className="legend">
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
                    backgroundColor: style.color.light,
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

      <section>
        <h3>Folder state (badge)</h3>
        <ul>
          {FOLDER_STATES.map((state) => {
            const style = FOLDER_STATE_STYLE[state]
            return (
              <li key={state}>
                <span className="legend__dot" style={{ backgroundColor: style.color.light }} />
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
                    borderColor: style.accent.light,
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
