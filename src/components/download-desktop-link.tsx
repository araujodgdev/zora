import { useHydrated } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { ZORA_DESKTOP_DOWNLOAD_URL, isZoraDesktop } from '@/lib/desktop-bridge'

/**
 * Public download pill under the sign-in and sign-up cards.
 * Hidden automatically when already running inside Zora Desktop.
 */
export function DownloadDesktopLink() {
  const hydrated = useHydrated()
  if (hydrated && isZoraDesktop()) return null

  return (
    <a
      href={ZORA_DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors"
    >
      <Download className="size-4" />
      Baixar Zora Desktop (Studio e LightCraft · Windows)
    </a>
  )
}
