import { Link } from '@tanstack/react-router'
import { ArrowRight, Plug } from 'lucide-react'

/** Under the sign-in and sign-up cards: the way to `/connect`. */
export function ConnectAgentLink() {
  return (
    <Link
      to="/connect"
      className="text-muted-foreground hover:text-foreground hover:bg-muted group mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors"
    >
      <Plug className="size-4" />
      Use o Zora no Claude, ChatGPT ou Codex
      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  )
}
