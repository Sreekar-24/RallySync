import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Ellipsis,
  FlaskConical,
  History,
  LayoutDashboard,
  Leaf,
  LoaderCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
  WifiOff,
  X,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useRally } from './store'
import { Modal, Shuttle } from './components'
import PlayPage, { FinalScoreEntry } from './features/PlayPage'
import './features/collection.css'
import DataMaintenance from './features/DataMaintenance'

const PeoplePage = lazy(() => import('./features/PeoplePage'))
const HistoryPage = lazy(() => import('./features/HistoryPage'))
const RankingsPage = lazy(() => import('./features/RankingsPage'))
const RulesPage = lazy(() => import('./features/rules/RulesPage'))
const SettingsPage = lazy(() => import('./features/SettingsPage'))

type Page = 'play' | 'players' | 'rankings' | 'history' | 'rules' | 'settings'
const navigation = [
  { id: 'play' as const, label: 'Play', icon: LayoutDashboard },
  { id: 'players' as const, label: 'Players', icon: Users },
  { id: 'rankings' as const, label: 'Rankings', icon: Trophy },
  { id: 'history' as const, label: 'History', icon: History },
  { id: 'rules' as const, label: 'Learn & rules', icon: BookOpen },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
]
function hashPage(): Page {
  const value = location.hash.replace(/^#\/?/, '')
  return navigation.find((p) => p.id === value)?.id ?? 'play'
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function App() {
  const {
    data,
    ready,
    readOnly,
    persistStatus,
    storageError,
    toast,
    sync,
    syncBusy,
    syncError,
    isDemo,
    exitDemo,
  } = useRally()
  const [page, setPage] = useState<Page>(hashPage)
  const [more, setMore] = useState(false)
  const [installHelp, setInstallHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [correction, setCorrection] = useState<string | null>(null)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })
  const active = data.sessions.some((s) => s.status === 'active')
  const match = data.matches.find((m) => m.id === correction)
  const session = data.sessions.find((s) => s.id === match?.sessionId)

  useEffect(() => {
    const onHash = () => {
      setPage(hashPage())
      setMore(false)
      window.scrollTo(0, 0)
    }
    const onOnline = () => setOnline(navigator.onLine)
    const onInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPrompt)
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOnline)
    window.addEventListener('beforeinstallprompt', onInstall)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOnline)
      window.removeEventListener('beforeinstallprompt', onInstall)
    }
  }, [])
  const navigate = (next: Page) => {
    location.hash = `/${next}`
    setPage(next)
    setMore(false)
    window.scrollTo(0, 0)
  }
  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(null)
    } else setInstallHelp(true)
  }
  const status = isDemo
    ? 'Demo · not saved'
    : !online
      ? 'Offline · saved locally'
      : persistStatus === 'error'
        ? 'Backup needed'
        : syncBusy
          ? 'Syncing…'
          : syncError
            ? 'Sync needs attention'
            : sync.endpoint
              ? !sync.lastSyncAt
                ? 'Connection not checked'
                : sync.dirty
                  ? 'Changes waiting to sync'
                  : 'All changes synced'
              : persistStatus === 'saving'
                ? 'Saving on device…'
                : 'Saved on this device'

  if (!ready)
    return (
      <div className="app-loading">
        <div className="brand-mark">
          <Shuttle size={32} />
        </div>
        <strong>RallySync</strong>
        <span>Getting your court ready…</span>
        <LoaderCircle size={22} className="spin" />
      </div>
    )
  return (
    <ErrorBoundary>
      <div className="app-shell">
        <a
          className="skip-link"
          href="#main-content"
          onClick={(event) => {
            event.preventDefault()
            document.getElementById('main-content')?.focus()
            document.getElementById('main-content')?.scrollIntoView()
          }}
        >
          Skip to content
        </a>
        <aside className="sidebar">
          <button className="brand" onClick={() => navigate('play')} aria-label="RallySync home">
            <span className="brand-mark">
              <Shuttle size={26} />
            </span>
            <span>
              rally<span className="brand-light">sync</span>
              <i />
            </span>
          </button>
          <div className="sidebar-group-label">YOUR CLUBHOUSE</div>
          <nav className="desktop-navigation" aria-label="Primary navigation">
            {navigation.slice(0, 4).map((item) => (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={page === item.id ? 'page' : undefined}
              >
                <item.icon size={19} />
                <span>{item.label}</span>
                {item.id === 'play' && active && <span className="nav-live-dot" />}
              </button>
            ))}
            <div className="sidebar-group-label secondary-label">OFF THE COURT</div>
            {navigation.slice(4).map((item) => (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={page === item.id ? 'page' : undefined}
              >
                <item.icon size={19} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <div>
                <Leaf size={17} />
                <span>Small app. Big game.</span>
              </div>
              <p>
                Built for your crew.
                <br />
                Ready, online or off.
              </p>
            </div>
            <button className="club-profile" onClick={() => navigate('settings')}>
              <span className="club-avatar">
                <Shuttle size={20} />
              </span>
              <span>
                <strong>Your badminton crew</strong>
                <small>Local clubhouse</small>
              </span>
              <ChevronRight size={15} />
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <span>Clubhouse</span>
              <ChevronRight size={13} />
              <strong>{navigation.find((n) => n.id === page)?.label}</strong>
            </div>
            <button
              className="mobile-brand"
              onClick={() => navigate('play')}
              aria-label="RallySync home"
            >
              <span className="brand-mark">
                <Shuttle size={22} />
              </span>
              <strong>
                rallysync
                <i />
              </strong>
            </button>
            <div className="topbar-actions">
              <span className="today-date">
                <Clock3 size={14} />
                {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <button
                className={`save-status ${!online ? 'offline' : syncError || persistStatus === 'error' ? 'needs-attention' : ''}`}
                onClick={() => navigate('settings')}
                aria-label={status}
              >
                {!online ? (
                  <WifiOff size={14} />
                ) : syncBusy || persistStatus === 'saving' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <span className="status-dot" />
                )}
                <span>{status}</span>
              </button>
              <button
                className="icon-button install-button"
                onClick={() => void install()}
                aria-label="Install RallySync"
                title="Install RallySync"
              >
                <ArrowDownToLine size={18} />
              </button>
            </div>
          </header>
          {isDemo && (
            <div className="demo-banner" role="status">
              <FlaskConical size={20} />
              <p>
                <strong>Demo sandbox.</strong> Sample scores stay here. Your saved history and
                shared sheet are untouched.
              </p>
              <button
                className="button"
                onClick={() => {
                  exitDemo()
                  setCorrection(null)
                }}
              >
                Exit demo
              </button>
            </div>
          )}
          {readOnly && !storageError && (
            <div className="app-notice">
              <ShieldCheck size={16} />
              {sync.role === 'viewer' && sync.endpoint
                ? 'Viewer mode. Scores update from the organizer’s shared sheet.'
                : 'Another tab is editing this clubhouse. Close that tab and reload here to make changes.'}
            </div>
          )}
          {storageError && (
            <div className="app-notice error" role="alert">
              {storageError}
              <button className="text-button" onClick={() => navigate('settings')}>
                Back up data <ArrowLeft size={15} />
              </button>
            </div>
          )}
          {needRefresh && (
            <div className="app-notice">
              <RefreshCw size={15} />
              {active
                ? 'An app update is ready. Finish your session before updating.'
                : 'A fresh version of RallySync is ready.'}
              <button
                className="text-button"
                disabled={active}
                onClick={() => void updateServiceWorker(true)}
              >
                Update app
              </button>
            </div>
          )}
          <main id="main-content" tabIndex={-1}>
            <Suspense
              fallback={
                <div className="page-loading">
                  <LoaderCircle size={22} className="spin" /> One moment…
                </div>
              }
            >
              {page === 'play' ? (
                <PlayPage onNavigate={navigate} />
              ) : page === 'players' ? (
                <PeoplePage />
              ) : page === 'rankings' ? (
                <RankingsPage />
              ) : page === 'history' ? (
                <HistoryPage onCorrectMatch={setCorrection} />
              ) : page === 'rules' ? (
                <RulesPage />
              ) : isDemo ? (
                <div className="panel demo-settings-empty">
                  <FlaskConical size={36} />
                  <h1>You’re in the practice clubhouse.</h1>
                  <p>
                    Explore scoring, schedules, and insights with sample data. Exit demo to manage
                    your real backups, storage, and Sheets connection.
                  </p>
                  <button className="button primary" onClick={exitDemo}>
                    Exit demo
                  </button>
                </div>
              ) : (
                <>
                  <SettingsPage />
                  <DataMaintenance />
                </>
              )}
            </Suspense>
            <footer className="page-footer">
              <span>
                <Shuttle size={14} /> Made for the love of the game.
              </span>
              <span>
                RallySync <i /> Play fair. Play together.
              </span>
            </footer>
          </main>
        </div>
        <nav className="mobile-navigation" aria-label="Mobile navigation">
          {navigation
            .filter((n) => ['play', 'players', 'rankings', 'rules'].includes(n.id))
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id ? 'active' : ''}
                onClick={() => navigate(n.id)}
                aria-label={n.label}
                aria-current={page === n.id ? 'page' : undefined}
              >
                <n.icon size={21} />
                <span>{n.id === 'rules' ? 'Learn' : n.label}</span>
              </button>
            ))}
          <button
            className={more || page === 'history' || page === 'settings' ? 'active' : ''}
            onClick={() => setMore(!more)}
            aria-expanded={more}
            aria-label="More navigation"
          >
            <Ellipsis size={22} />
            <span>More</span>
          </button>
        </nav>
        {more && (
          <div className="mobile-more">
            <div className="mobile-more-heading">
              <strong>Off the court</strong>
              <button
                className="icon-button"
                onClick={() => setMore(false)}
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            {navigation
              .filter((n) => ['history', 'settings'].includes(n.id))
              .map((n) => (
                <button className="nav-item" key={n.id} onClick={() => navigate(n.id)}>
                  <n.icon size={19} />
                  {n.label}
                  <ChevronRight size={16} />
                </button>
              ))}
            <button
              className="nav-item"
              onClick={() => {
                setMore(false)
                void install()
              }}
            >
              <ArrowDownToLine size={19} /> Install the app
            </button>
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <Check size={17} />
            {toast}
          </div>
        )}
        {installHelp && (
          <Modal
            title="Your courtside companion. Installed."
            subtitle="Keep RallySync one tap away on your home screen."
            onClose={() => setInstallHelp(false)}
          >
            <div className="install-instructions">
              <div>
                <span className="step-number">1</span>
                <p>
                  <strong>iPhone or iPad</strong>
                  <br />
                  Open this site in Safari, tap Share, then Add to Home Screen.
                </p>
              </div>
              <div>
                <span className="step-number">2</span>
                <p>
                  <strong>Android or desktop</strong>
                  <br />
                  Use your browser’s Install app or Add to Home screen option, when available.
                </p>
              </div>
              <div className="notice subtle">
                <CircleHelp size={18} />
                <span>
                  Open the app online once to cache it. Local scoring then works offline. Export
                  backups to protect your history.
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="button primary" onClick={() => setInstallHelp(false)}>
                Got it <Check size={16} />
              </button>
            </div>
          </Modal>
        )}
        {match && session && (
          <Modal
            title="Keep the record straight."
            subtitle="Correct the team result. Rankings are recalculated from the updated history."
            onClose={() => setCorrection(null)}
          >
            <FinalScoreEntry match={match} session={session} onSaved={() => setCorrection(null)} />
          </Modal>
        )}
      </div>
    </ErrorBoundary>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RallySync view error', error.message, info.componentStack)
  }
  render() {
    return this.state.failed ? (
      <div className="app-loading">
        <Shuttle size={42} />
        <h1>Let’s get back on court.</h1>
        <p>This view couldn’t open. Your saved data has not been reset.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload the app
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
