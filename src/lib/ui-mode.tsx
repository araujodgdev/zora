import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

/**
 * The look of the app: `classic` (the studio look, shadcn) or `fun` (Zora
 * Clay, the plasticine components in `@/components/clay`). Independent of
 * the light/dark theme. Works like `@/lib/theme`: a cookie read during SSR,
 * so the page never flashes the other look; in the browser the `<html
 * data-ui>` attribute is the truth (`setUiMode` changes it first).
 *
 * The shared primitives (`ui/button`, `ui/input`, `ui/checkbox`, `ui/badge`,
 * `ui/card`) read it with `useUiMode()` and render their clay versions in
 * fun mode; `app.css` warms the surfaces under `html[data-ui='fun']`.
 */
export const UI_MODES = ['classic', 'fun'] as const
export type UiMode = (typeof UI_MODES)[number]

const UI_MODE_COOKIE = 'zora_ui'
const ONE_YEAR = 60 * 60 * 24 * 365

export const readUiMode = createIsomorphicFn()
  .server((): UiMode => (getCookie(UI_MODE_COOKIE) === 'fun' ? 'fun' : 'classic'))
  .client((): UiMode => domUiMode())

function domUiMode(): UiMode {
  return document.documentElement.dataset.ui === 'fun' ? 'fun' : 'classic'
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Switches the look now and remembers it for the next visits (cookie). */
export function setUiMode(mode: UiMode) {
  document.documentElement.dataset.ui = mode
  document.cookie = `${UI_MODE_COOKIE}=${mode}; path=/; max-age=${ONE_YEAR}; samesite=lax`
  listeners.forEach((listener) => listener())
}

const InitialUiMode = createContext<UiMode>('classic')

/** Gives `useUiMode` the look the server rendered, for hydration. Mounted once in the root route. */
export function UiModeProvider({ initial, children }: { initial: UiMode; children: ReactNode }) {
  return <InitialUiMode.Provider value={initial}>{children}</InitialUiMode.Provider>
}

/** The current look, updated when `setUiMode` runs. */
export function useUiMode(): UiMode {
  const initial = useContext(InitialUiMode)
  return useSyncExternalStore(subscribe, domUiMode, () => initial)
}
