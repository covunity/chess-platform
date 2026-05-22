import { createContext, useContext, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'dark' ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  function setTheme(t: Theme) {
    setThemeState(t)
    document.documentElement.setAttribute('data-theme', t)
    try {
      localStorage.setItem('theme', t)
    } catch {
      // localStorage may throw in private-browsing / sandboxed contexts —
      // the in-memory state still flips so the toggle works for this session.
    }
  }

  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx) return ctx
  // No provider in scope (e.g. component-level tests rendering without App).
  // Return a self-contained fallback that mutates DOM + localStorage directly
  // so the component still renders and is interactable.
  const current: Theme = readInitialTheme()
  const apply = (t: Theme) => {
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t)
    try { localStorage.setItem('theme', t) } catch {}
  }
  return {
    theme: current,
    setTheme: apply,
    toggleTheme: () => apply(current === 'dark' ? 'light' : 'dark'),
  }
}
