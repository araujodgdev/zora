import * as React from "react"
import { cn } from "cn"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"
import { ClayCheckbox } from "@/components/clay/clay-checkbox"
import { useUiMode } from "@/lib/ui-mode"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  const uiMode = useUiMode()

  // Fun mode: the clay checkbox (a native input). Maps Radix's API onto it:
  // `checked` may be "indeterminate", `onCheckedChange` gets a boolean.
  if (uiMode === "fun") {
    const { checked, defaultChecked, onCheckedChange, id, name, value, required, disabled } = props
    return (
      <ClayCheckbox
        data-slot="checkbox"
        size="sm"
        className={className}
        id={id}
        name={name}
        value={value as string | undefined}
        required={required}
        disabled={disabled}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        indeterminate={checked === "indeterminate"}
        checked={checked === undefined ? undefined : checked === true}
        defaultChecked={defaultChecked === undefined ? undefined : defaultChecked === true}
        onCheckedChange={(next) => onCheckedChange?.(next)}
      />
    )
  }

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
