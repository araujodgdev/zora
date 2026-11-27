import * as React from "react"
import { cn } from "cn"
import { ClayInput } from "@/components/clay/clay-input"
import { useUiMode } from "@/lib/ui-mode"

/** Fields that are not text boxes keep the classic input in fun mode. */
const CLASSIC_ONLY_TYPES = new Set(["file", "hidden", "range", "color", "checkbox", "radio"])

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const uiMode = useUiMode()

  // Fun mode: the clay field (a groove pressed into a slab). `className`
  // sizes the slab; every other prop goes to the <input>.
  if (uiMode === "fun" && !CLASSIC_ONLY_TYPES.has(type ?? "text")) {
    return <ClayInput data-slot="input" type={type} className={className} {...props} size="sm" color="cream" />
  }

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
