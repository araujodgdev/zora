import { useForm } from '@tanstack/react-form'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/form-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  CHANNELS,
  CHANNEL_LABELS,
  FORMATS,
  FORMAT_LABELS,
  STATUSES,
  STATUS_LABELS,
  createContentItemSchema,
  normalizeScheduleState,
  scheduleStateError,
} from '@/lib/content'
import type {
  Channel,
  ContentFormat,
  ContentItem,
  ContentStatus,
  TeamMember,
} from '@/lib/content'
import {
  useCreateContentItem,
  useDeleteContentItem,
  useUpdateContentItem,
} from '@/lib/content.queries'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/dates'
import { editorReturnPath } from '@/lib/editor-search'
import type { EditorOrigin } from '@/lib/editor-search'

const selectClassName =
  'border-input bg-transparent h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/** The form's fields. Everything is text; `toInput` converts on submit. */
type FormValues = {
  title: string
  body: string
  channel: Channel
  format: ContentFormat
  status: ContentStatus
  scheduledAt: string
  publishedAt: string
  publishedUrl: string
  notes: string
  assetLinks: string
  assigneeId: string
}
type FieldName = keyof FormValues
type FieldErrors = Partial<Record<FieldName, string>>

/** Presets of a new item (the `/content/new` search params). */
export type NewItemDefaults = {
  channel?: Channel
  status?: ContentStatus
  scheduledAt?: Date
}

function toFormValues(
  item: ContentItem | undefined,
  defaults: NewItemDefaults,
): FormValues {
  if (item) {
    return {
      title: item.title,
      body: item.body,
      channel: item.channel,
      format: item.format,
      status: item.status,
      scheduledAt: toDateTimeLocalValue(item.scheduledAt),
      publishedAt: toDateTimeLocalValue(item.publishedAt),
      publishedUrl: item.publishedUrl ?? '',
      notes: item.notes,
      assetLinks: item.assetLinks.join('\n'),
      assigneeId: item.assigneeId ?? '',
    }
  }
  return {
    title: '',
    body: '',
    channel: defaults.channel ?? 'linkedin',
    format: 'post',
    status: defaults.status ?? 'idea',
    scheduledAt: toDateTimeLocalValue(defaults.scheduledAt ?? null),
    publishedAt: '',
    publishedUrl: '',
    notes: '',
    assetLinks: '',
    assigneeId: '',
  }
}

/** The form's text as input for the shared schema, which checks every rule. */
function toInput(values: FormValues) {
  return {
    ...values,
    scheduledAt: fromDateTimeLocalValue(values.scheduledAt),
    publishedAt: fromDateTimeLocalValue(values.publishedAt),
    publishedUrl: values.publishedUrl.trim(),
    assetLinks: values.assetLinks
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    assigneeId: values.assigneeId || null,
  }
}

/**
 * Checks the form against the same rules as the server, so mistakes show next
 * to their field. Returns the item to save, or the errors by field.
 */
function validate(
  values: FormValues,
):
  | { ok: true; data: ReturnType<typeof createContentItemSchema.parse> }
  | { ok: false; errors: FieldErrors; message: string } {
  const input = toInput(values)
  const parsed = createContentItemSchema.safeParse(input)
  if (!parsed.success) {
    const errors: FieldErrors = {}
    for (const issue of parsed.error.issues) {
      const [field, index] = issue.path
      if (typeof field !== 'string' || field in errors) continue
      errors[field as FieldName] =
        typeof index === 'number'
          ? `Link ${index + 1}: ${issue.message}`
          : issue.message
    }
    return { ok: false, errors, message: 'Check the highlighted fields.' }
  }
  // A published item without a date gets "now" on the server, so it is fine.
  const scheduleError = scheduleStateError(normalizeScheduleState(parsed.data))
  if (scheduleError) {
    return {
      ok: false,
      errors: { scheduledAt: scheduleError },
      message: scheduleError,
    }
  }
  return { ok: true, data: parsed.data }
}

type ContentItemFormProps = {
  /** The item to edit; omit to create one. */
  item?: ContentItem
  /** Presets for a new item. */
  defaults?: NewItemDefaults
  members: ReadonlyArray<TeamMember>
  /** Where to go after saving, cancelling or deleting. */
  from: EditorOrigin | undefined
}

/**
 * The editor form for every field of a content item: creates a new item, or
 * edits `item`. Local-time fields are read in the browser's zone, so render it
 * on the client only (the editor routes use `ssr: 'data-only'`).
 */
export function ContentItemForm({
  item,
  defaults = {},
  members,
  from,
}: ContentItemFormProps) {
  const navigate = useNavigate()
  const createItem = useCreateContentItem()
  const updateItem = useUpdateContentItem()
  const deleteItem = useDeleteContentItem()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const returnPath = editorReturnPath(from)

  const form = useForm({
    defaultValues: toFormValues(item, defaults),
    onSubmit: async ({ value }) => {
      setFormError(null)
      const result = validate(value)
      if (!result.ok) {
        setFieldErrors(result.errors)
        setFormError(result.message)
        return
      }
      setFieldErrors({})
      try {
        if (item) {
          await updateItem.mutateAsync({ id: item.id, ...result.data })
        } else {
          await createItem.mutateAsync(result.data)
        }
      } catch (error) {
        setFormError(
          error instanceof Error && error.message
            ? error.message
            : 'Could not save the item.',
        )
        return
      }
      toast.success(item ? 'Item saved.' : 'Item created.')
      await navigate({ to: returnPath })
    },
  })

  async function confirmDelete() {
    if (!item) return
    try {
      await deleteItem.mutateAsync(item.id)
    } catch (error) {
      setConfirmingDelete(false)
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not delete the item.',
      )
      return
    }
    toast.success('Item deleted.')
    await navigate({ to: returnPath })
  }

  /** Props that tie a control to its label's error message. */
  function errorProps(id: string, name: FieldName) {
    return fieldErrors[name]
      ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` }
      : {}
  }

  return (
    <form
      method="post"
      noValidate
      className="grid max-w-3xl gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      {formError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <form.Field name="title">
        {(field) => (
          <FormField id="item-title" label="Title" error={fieldErrors.title}>
            <Input
              id="item-title"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              {...errorProps('item-title', 'title')}
            />
          </FormField>
        )}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <form.Field name="channel">
          {(field) => (
            <FormField id="item-channel" label="Channel">
              <select
                id="item-channel"
                className={selectClassName}
                value={field.state.value}
                onChange={(event) =>
                  field.handleChange(event.target.value as Channel)
                }
              >
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {CHANNEL_LABELS[channel]}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </form.Field>
        <form.Field name="format">
          {(field) => (
            <FormField id="item-format" label="Format">
              <select
                id="item-format"
                className={selectClassName}
                value={field.state.value}
                onChange={(event) =>
                  field.handleChange(event.target.value as ContentFormat)
                }
              >
                {FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {FORMAT_LABELS[format]}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </form.Field>
        <form.Field name="status">
          {(field) => (
            <FormField id="item-status" label="Status">
              <select
                id="item-status"
                className={selectClassName}
                value={field.state.value}
                onChange={(event) =>
                  field.handleChange(event.target.value as ContentStatus)
                }
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </form.Field>
      </div>

      <form.Field name="body">
        {(field) => (
          <FormField id="item-body" label="Copy" error={fieldErrors.body}>
            <Textarea
              id="item-body"
              rows={8}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </FormField>
        )}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="scheduledAt">
          {(field) => (
            <FormField
              id="item-scheduled-at"
              label="Scheduled (local time)"
              error={fieldErrors.scheduledAt}
            >
              <Input
                id="item-scheduled-at"
                type="datetime-local"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                {...errorProps('item-scheduled-at', 'scheduledAt')}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field name="publishedAt">
          {(field) => (
            <FormField
              id="item-published-at"
              label="Published (local time)"
              error={fieldErrors.publishedAt}
            >
              <Input
                id="item-published-at"
                type="datetime-local"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                {...errorProps('item-published-at', 'publishedAt')}
              />
              <p className="text-muted-foreground text-xs">
                Left empty on a published item, it is set to now.
              </p>
            </FormField>
          )}
        </form.Field>
      </div>

      <form.Field name="publishedUrl">
        {(field) => (
          <FormField
            id="item-published-url"
            label="Published URL"
            error={fieldErrors.publishedUrl}
          >
            <Input
              id="item-published-url"
              type="url"
              placeholder="https://"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              {...errorProps('item-published-url', 'publishedUrl')}
            />
          </FormField>
        )}
      </form.Field>

      <form.Field name="assetLinks">
        {(field) => (
          <FormField
            id="item-asset-links"
            label="Asset links (one URL per line)"
            error={fieldErrors.assetLinks}
          >
            <Textarea
              id="item-asset-links"
              rows={3}
              placeholder="https://"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              {...errorProps('item-asset-links', 'assetLinks')}
            />
          </FormField>
        )}
      </form.Field>

      <form.Field name="notes">
        {(field) => (
          <FormField id="item-notes" label="Notes" error={fieldErrors.notes}>
            <Textarea
              id="item-notes"
              rows={3}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </FormField>
        )}
      </form.Field>

      <form.Field name="assigneeId">
        {(field) => (
          <FormField id="item-assignee" label="Assignee">
            <select
              id="item-assignee"
              className={selectClassName}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </FormField>
        )}
      </form.Field>

      <div className="flex items-center gap-2">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : item ? 'Save' : 'Create item'}
            </Button>
          )}
        </form.Subscribe>
        <Button variant="outline" asChild>
          <Link to={returnPath}>Cancel</Link>
        </Button>
        {item ? (
          <Button
            type="button"
            variant="destructive"
            className="ml-auto"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Button>
        ) : null}
      </div>

      {item ? (
        <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this item?</DialogTitle>
              <DialogDescription>
                “{item.title}” will be removed for everyone on the team. This
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep it
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteItem.isPending}
                onClick={() => void confirmDelete()}
              >
                {deleteItem.isPending ? 'Deleting…' : 'Delete item'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </form>
  )
}
