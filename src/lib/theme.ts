import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { useSyncExternalStore } from 'react'

export const THEMES = ['dark', 'light'] as const
export type Theme = (typeof THEMES)[number]

const THEME_COOKIE = 'zora_theme'
const ONE_YEAR = 60 * 60 * 24 * 365

/**
 * The theme to render: dark unless the person picked light. Read on the
 * server from the cookie, so the page never flashes the other theme; in the
 * browser the `<html>` class is the truth (`setTheme` changes it first).
 */
export const readTheme = createIsomorphicFn()
  .server((): Theme => (getCookie(THEME_COOKIE) === 'light' ? 'light' : 'dark'))
  .client((): Theme => domTheme())

function domTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Switches the theme now and remembers it for the next visits (cookie). */
export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`
  listeners.forEach((listener) => listener())
}

/**
 * The current theme, updated when `setTheme` runs. `initial` is the theme
 * the server rendered (from the root route context), used during hydration.
 */
export function useTheme(initial: Theme): Theme {
  return useSyncExternalStore(subscribe, domTheme, () => initial)
}
