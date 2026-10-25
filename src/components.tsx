import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Shuttle({ size = 24, ...props }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <g
        transform="rotate(35 16 16)"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 4 5 18h10l5-18H6Z" />
        <path d="m12 4 2 18m6-18-2 18M8 10h16M10 16h12M11 22h10v2a5 5 0 0 1-10 0v-2Z" />
      </g>
    </svg>
  )
}

export function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string
  index?: number
  small?: boolean
}) {
  return (
    <span
      className={`avatar avatar-${index % 5} ${small ? 'avatar-small' : ''}`}
      aria-hidden="true"
    >
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0])
        .join('')
        .toUpperCase()}
    </span>
  )
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    const cancel = (event: Event) => {
      event.preventDefault()
      closeRef.current()
    }
    dialog?.addEventListener('cancel', cancel)
    return () => {
      dialog?.removeEventListener('cancel', cancel)
      dialog?.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-labelledby="modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id="modal-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

export function CourtArt() {
  return (
    <svg className="court-art" viewBox="0 0 520 360" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id="courtGradient"
          x1="80"
          y1="20"
          x2="450"
          y2="340"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#36534a" />
          <stop offset="1" stopColor="#1d3c36" />
        </linearGradient>
        <filter id="courtShadow">
          <feDropShadow dx="0" dy="20" stdDeviation="15" floodOpacity=".22" />
        </filter>
      </defs>
      <g transform="translate(80 20) rotate(-14 180 150)" filter="url(#courtShadow)">
        <rect x="0" y="0" width="340" height="285" rx="14" fill="url(#courtGradient)" />
        <g stroke="#a9c6ad" strokeOpacity=".65" strokeWidth="1.5">
          <rect x="20" y="19" width="300" height="247" rx="1" />
          <path d="M42 19v247M298 19v247M20 143h300M20 96h300M20 190h300M170 19v77m0 94v76M20 39h300M20 246h300" />
        </g>
        <path d="M6 143h328" stroke="#e5f4e1" strokeWidth="2.5" strokeDasharray="3 3" />
        <circle cx="110" cy="211" r="19" fill="#d9f96c" fillOpacity=".16" />
        <circle cx="110" cy="211" r="7" fill="#d9f96c" />
        <circle cx="239" cy="68" r="19" fill="#f3b99c" fillOpacity=".18" />
        <circle cx="239" cy="68" r="7" fill="#f3b99c" />
        <path
          d="M117 200c80 0 43-130 112-128"
          stroke="#d9f96c"
          strokeWidth="2"
          strokeDasharray="5 6"
        />
        <path d="m223 65 10 6-9 7" stroke="#d9f96c" strokeWidth="2" />
      </g>
      <g
        transform="translate(347 210) rotate(18)"
        stroke="#eafaeb"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m0 0 12 39h23L47 0H0Z" fill="#eafaeb" fillOpacity=".06" />
        <path d="m15 0 4 39M32 0l-4 39M4 13h39M8 26h31M12 39h23v4a11.5 11.5 0 0 1-23 0v-4Z" />
      </g>
    </svg>
  )
}
