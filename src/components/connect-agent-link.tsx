import { Link } from '@tanstack/react-router'
import { ArrowRight, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Under the sign-in and sign-up cards: the way to `/connect`. */
export function ConnectAgentLink({ className }: { className?: string }) {
  return (
    <Link
      to="/connect"
      className={cn(
        'text-muted-foreground hover:text-foreground hover:bg-muted group mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors',
        className,
      )}
    >
      <Plug className="size-4" />
      Use o Zora no Claude, ChatGPT ou Codex
      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  )
}
