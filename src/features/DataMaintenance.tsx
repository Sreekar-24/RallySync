import { useState } from 'react'
import { ArrowDownToLine, FlaskConical, Trash2 } from 'lucide-react'
import { useRally } from '../store'
import { legacyDemoCleanup } from '../domain/maintenance'
import { downloadBackup } from '../lib/storage'
import { Modal } from '../components'
import './maintenance.css'

export default function DataMaintenance() {
  const { data, commit, notify, readOnly, startDemo, isDemo } = useRally()
  const cleanup = legacyDemoCleanup(data)
  const [confirm, setConfirm] = useState(false)
  if (isDemo) return null
  return (
    <div className="data-maintenance">
      <section className="panel maintenance-card">
        <span className="maintenance-icon">
          <FlaskConical size={23} />
        </span>
        <div>
          <h2>A little room to explore.</h2>
          <p>
            Try sample players and scores in a separate sandbox. Your saved history and shared sheet
            won’t change.
          </p>
        </div>
        <button className="button soft" onClick={startDemo}>
          Explore a demo
        </button>
      </section>
      {Boolean(cleanup.sessions || cleanup.players) && (
        <section className="panel maintenance-card legacy-cleanup">
          <span className="maintenance-icon">
            <Trash2 size={22} />
          </span>
          <div>
            <h2>Sample data from the first version?</h2>
            <p>
              Remove the old sample session and unused sample profiles without clearing your real
              history.
            </p>
          </div>
          <button className="button ghost" disabled={readOnly} onClick={() => setConfirm(true)}>
            Review cleanup
          </button>
        </section>
      )}
      {confirm && (
        <Modal
          title="Clean up old sample data?"
          subtitle="Review what will be removed before continuing."
          onClose={() => setConfirm(false)}
        >
          <div className="deletion-copy">
            <p>
              {cleanup.sessions} sample session, {cleanup.matches} matches recorded in it, and{' '}
              {cleanup.players} unused, unchanged sample profiles will be removed.
            </p>
            <p>
              Scores you recorded inside that sample session are included. Renamed profiles and
              players referenced by other sessions are kept.
            </p>
            <button className="button soft" onClick={() => downloadBackup(data)}>
              <ArrowDownToLine size={16} /> Download a recovery backup
            </button>
          </div>
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setConfirm(false)}>
              Keep data
            </button>
            <button
              className="button danger"
              onClick={() => {
                commit((current) => legacyDemoCleanup(current).data)
                setConfirm(false)
                notify('Old sample data removed. Real sessions were kept.')
              }}
            >
              Remove sample data
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
