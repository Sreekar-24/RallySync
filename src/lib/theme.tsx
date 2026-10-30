import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Contrast, Monitor, Moon, Palette, Sun } from 'lucide-react'

export type ThemePreference = 'light' | 'dark' | 'contrast' | 'system'
const storageKey = 'rallysync-appearance'
const choices = [
  { value: 'light' as const, label: 'Light', description: 'The original clubhouse', icon: Sun },
  { value: 'dark' as const, label: 'Dark', description: 'Easy on evening eyes', icon: Moon },
  {
    value: 'contrast' as const,
    label: 'High contrast',
    description: 'Clear edges and bold text',
    icon: Contrast,
  },
  { value: 'system' as const, label: 'System', description: 'Follow your device', icon: Monitor },
]

function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey)
    if (choices.some((choice) => choice.value === value)) return value as ThemePreference
  } catch {
    // Appearance remains usable when the browser blocks local storage.
  }
  return 'light'
}

const ThemeContext = createContext<{
  preference: ThemePreference
  setPreference: (value: ThemePreference) => void
} | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(savedPreference)
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = preference === 'system' ? (query.matches ? 'dark' : 'light') : preference
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved === 'light' ? 'light' : 'dark'
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      if (meta)
        meta.content =
          resolved === 'contrast' ? '#000000' : resolved === 'dark' ? '#101b1b' : '#142a30'
    }
    apply()
    query.addEventListener('change', apply)
    const followOtherTabs = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(savedPreference())
    }
    window.addEventListener('storage', followOtherTabs)
    return () => {
      query.removeEventListener('change', apply)
      window.removeEventListener('storage', followOtherTabs)
    }
  }, [preference])

  const change = (value: ThemePreference) => {
    setPreference(value)
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      // Keep the selected theme for this visit even without persistent storage.
    }
  }
  return (
    <ThemeContext.Provider value={{ preference, setPreference: change }}>
      {children}
    </ThemeContext.Provider>
  )
}

function useTheme() {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('Appearance controls require ThemeProvider.')
  return theme
}

/** A native disclosure and radio group keep touch and keyboard selection familiar. */
export function ThemePicker() {
  const { preference, setPreference } = useTheme()
  const ref = useRef<HTMLDetailsElement>(null)
  const Icon = choices.find((choice) => choice.value === preference)!.icon
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current)
        ref.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  return (
    <details
      className="theme-picker"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && ref.current?.open) {
          ref.current.open = false
          ref.current.querySelector('summary')?.focus()
          event.stopPropagation()
        }
      }}
    >
      <summary aria-label="Appearance" title="Appearance">
        <Icon size={19} />
      </summary>
      <fieldset className="theme-popover">
        <legend>Make yourself comfortable</legend>
        {choices.map(({ value, label, description, icon: ChoiceIcon }) => (
          <label key={value} className={preference === value ? 'selected' : ''}>
            <input
              type="radio"
              name="quick-appearance"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
            />
            <ChoiceIcon size={18} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {preference === value && <Check size={16} />}
          </label>
        ))}
        <p>Only this device. Your scores stay the same.</p>
      </fieldset>
    </details>
  )
}

export function AppearanceSettings() {
  const { preference, setPreference } = useTheme()
  return (
    <section className="appearance-settings" aria-labelledby="appearance-title">
      <div className="appearance-heading">
        <Palette size={22} />
        <div>
          <h2 id="appearance-title">Your courtside view.</h2>
          <p>Choose a comfortable theme. Saved on this device.</p>
        </div>
      </div>
      <fieldset className="appearance-options">
        <legend className="sr-only">Appearance theme</legend>
        {choices.map(({ value, label, description, icon: Icon }) => (
          <label key={value} className={preference === value ? 'selected' : ''}>
            <input
              type="radio"
              name="settings-appearance"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
            />
            <Icon size={19} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {preference === value && <Check size={15} />}
          </label>
        ))}
      </fieldset>
      <p className="appearance-motion-note">
        Animations follow your device’s reduced-motion setting.
      </p>
    </section>
  )
}
