import { useState } from 'react'
import { ArrowDownToLine, Ellipsis, Trash2 } from 'lucide-react'
import type { Session } from '../domain/model'
import { deleteSession } from '../domain/maintenance'
import { downloadBackup } from '../lib/storage'
import { Modal } from '../components'
import { useRally } from '../store'
import './maintenance.css'

export default function SessionActions({
  session,
  onDeleted,
}: {
  session: Session
  onDeleted?: () => void
}) {
  const { data, commit, notify, readOnly, isDemo } = useRally()
  const [confirming, setConfirming] = useState(false)
  const [menu, setMenu] = useState(false)
  const count = data.matches.filter((m) => m.sessionId === session.id).length
  return (
    <div className="session-more-wrap">
      <button
        className="button ghost small"
        aria-label={`Session options for ${session.name}`}
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        <Ellipsis size={18} />
        <span>Session options</span>
      </button>
      {menu && (
        <div className="session-more-menu">
          <button
            disabled={readOnly}
            onClick={() => {
              setMenu(false)
              setConfirming(true)
            }}
          >
            <Trash2 size={16} /> Delete session
          </button>
        </div>
      )}
      {confirming && (
        <Modal
          title={`Delete ${session.name}?`}
          subtitle="Delete this session only. Your other sessions and player profiles stay."
          onClose={() => setConfirming(false)}
        >
          <div className="deletion-copy">
            <p>
              This removes {count} match{count === 1 ? '' : 'es'}, including any active or stopped
              matches in this session. Standings and strength estimates will recalculate.
            </p>
            <p>
              {isDemo
                ? 'This affects only the demo sandbox.'
                : 'If Sheets is connected as organizer, this deletion will also sync to your shared history.'}
            </p>
            {!isDemo && (
              <button className="button soft" onClick={() => downloadBackup(data)}>
                <ArrowDownToLine size={16} /> Download a recovery backup
              </button>
            )}
          </div>
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setConfirming(false)}>
              Keep session
            </button>
            <button
              className="button danger"
              disabled={readOnly}
              onClick={() => {
                commit((current) => deleteSession(current, session.id))
                setConfirming(false)
                notify('Session deleted. Other history is unchanged.')
                onDeleted?.()
              }}
            >
              Delete session
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
