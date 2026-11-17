import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A value to copy (a URL, a terminal command) in monospace, with a copy
 * button that turns into a check for a moment. Long lines wrap anywhere
 * (a command on a phone stays readable); the copy is always the exact value.
 */
export function CopyField({
  value,
  label,
  className,
}: {
  value: string
  /** What is copied, for the button's accessible name ("Copiar <label>"). */
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie.')
    }
  }

  return (
    <div className={cn('bg-muted flex min-w-0 items-start gap-2 rounded-xl py-1.5 pr-1.5 pl-4', className)}>
      <pre className="min-w-0 flex-1 py-1 font-mono text-[0.8125rem] leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>{value}</code>
      </pre>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={() => void copy()}
        aria-label={copied ? 'Copiado' : `Copiar ${label}`}
        className="shrink-0"
      >
        {copied ? <Check className="text-brand" /> : <Copy />}
      </Button>
    </div>
  )
}
