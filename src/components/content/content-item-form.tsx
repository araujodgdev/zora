import { useForm } from '@tanstack/react-form'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ImageUp, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { ChannelBadge } from '@/components/content/channel-badge'
import { ContentBodyEditor } from '@/components/content/content-body-editor'
import { StatusBadge } from '@/components/content/status-badge'
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
import { Separator } from '@/components/ui/separator'
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
import { isMarkdownChannel } from '@/lib/post-text'
import { editorReturnPath } from '@/lib/editor-search'
import type { EditorOrigin } from '@/lib/editor-search'

const selectClassName =
  'border-input bg-input/30 hover:bg-input/50 h-9 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

// The form renders in the browser only (`ssr: 'data-only'`), so `navigator` is there.
const SAVE_SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ S'
    : 'Ctrl S'

const RETURN_LABELS: Record<EditorOrigin, string> = {
  calendar: 'Calendário',
  pipeline: 'Pipeline',
  content: 'Conteúdos',
}

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
    return { ok: false, errors, message: 'Confira os campos destacados.' }
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
  /** The page the editor was opened from: the back link and "Cancelar" go there. */
  from: EditorOrigin | undefined
  /** The media section of an existing item, shown in the main column. */
  media?: ReactNode
}

/**
 * The item editor, laid out like a document with an inspector:
 *
 * - main column: the title (edited in place, as the page heading), the copy,
 *   the media and the notes;
 * - a panel on the right (below on small screens, sticky on large ones) with
 *   the actions and every property: status, channel, format, assignee,
 *   dates and links.
 *
 * Saving an existing item stays on the page; creating one opens the new
 * item, so media can be added right away. Ctrl/Cmd+S saves. Local-time fields
 * are read in the browser's zone, so render it on the client only (the editor
 * routes use `ssr: 'data-only'`).
 */
export function ContentItemForm({
  item,
  defaults = {},
  members,
  from,
  media,
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
          // The saved values are the new baseline: nothing is unsaved now.
          form.reset(value)
          toast.success('Alterações salvas.')
        } else {
          const created = await createItem.mutateAsync(result.data)
          toast.success('Item criado.')
          await navigate({
            to: '/content/$itemId',
            params: { itemId: created.id },
            search: { from },
            replace: true,
          })
        }
      } catch (error) {
        setFormError(
          error instanceof Error && error.message
            ? error.message
            : 'Não foi possível salvar o item.',
        )
      }
    },
  })

  // Ctrl/Cmd+S saves from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void form.handleSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [form])

  async function confirmDelete() {
    if (!item) return
    try {
      await deleteItem.mutateAsync(item.id)
    } catch (error) {
      setConfirmingDelete(false)
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível excluir o item.',
      )
      return
    }
    toast.success('Item excluído.')
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
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-12"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      {/* Main column: what the item says. */}
      <div className="grid min-w-0 content-start gap-8">
        <header className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={returnPath}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 text-sm transition-colors outline-none focus-visible:ring-3"
            >
              <ArrowLeft className="size-4" />
              {RETURN_LABELS[from ?? 'content']}
            </Link>
            {/* The item at a glance, following the panel as it is edited. */}
            <form.Subscribe
              selector={(state) => [state.values.channel, state.values.status] as const}
            >
              {([channel, status]) => (
                <span className="ml-auto flex items-center gap-1.5">
                  <ChannelBadge channel={channel} />
                  <StatusBadge status={status} />
                </span>
              )}
            </form.Subscribe>
          </div>

          <form.Field name="title">
            {(field) => (
              <div className="grid gap-2">
                <label htmlFor="item-title" className="sr-only">
                  Título
                </label>
                <Textarea
                  id="item-title"
                  rows={1}
                  placeholder="Título do item"
                  autoFocus={!item}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    // A title is one line: pasted line breaks become spaces.
                    field.handleChange(event.target.value.replace(/\s*\n\s*/g, ' '))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault()
                  }}
                  className="font-display placeholder:text-muted-foreground/60 min-h-0 resize-none rounded-lg border-transparent bg-transparent px-2 py-1 -mx-2 text-4xl leading-[1.1] font-semibold tracking-[-0.02em] shadow-none hover:bg-white/[0.03] focus-visible:bg-white/[0.03] md:text-5xl dark:bg-transparent"
                  {...errorProps('item-title', 'title')}
                />
                {fieldErrors.title ? (
                  <p id="item-title-error" className="text-destructive text-sm">
                    {fieldErrors.title}
                  </p>
                ) : null}
              </div>
            )}
          </form.Field>
        </header>

        {formError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form.Subscribe selector={(state) => state.values.channel}>
          {(channel) => (
            <form.Field name="body">
              {(field) => (
                <div className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span id="item-body-label" className="text-sm leading-none font-medium">
                      Texto
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {isMarkdownChannel(channel)
                        ? 'Com formatação (Markdown)'
                        : 'Texto simples, sem formatação'}
                    </span>
                  </div>
                  <ContentBodyEditor
                    labelId="item-body-label"
                    channel={channel}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                  />
                  {fieldErrors.body ? (
                    <p className="text-destructive text-sm">{fieldErrors.body}</p>
                  ) : null}
                </div>
              )}
            </form.Field>
          )}
        </form.Subscribe>

        {media ?? (
          <section className="bg-card text-muted-foreground flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm">
            <ImageUp className="size-5 shrink-0" />
            Crie o item para enviar imagens, vídeos e PDFs.
          </section>
        )}

        <form.Field name="notes">
          {(field) => (
            <FormField id="item-notes" label="Notas internas" error={fieldErrors.notes}>
              <Textarea
                id="item-notes"
                placeholder="Contexto, referências, combinados da equipe…"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                className="min-h-24"
              />
            </FormField>
          )}
        </form.Field>
      </div>

      {/* Inspector: actions first, then the properties. */}
      <aside
        aria-label="Propriedades do item"
        className="bg-card grid gap-5 rounded-xl p-5 lg:sticky lg:top-6"
      >
        <form.Subscribe
          selector={(state) => [state.isSubmitting, state.isDirty] as const}
        >
          {([isSubmitting, isDirty]) => (
            <div className="grid gap-2">
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={isSubmitting}>
                  {isSubmitting
                    ? 'Salvando…'
                    : item
                      ? 'Salvar alterações'
                      : 'Criar item'}
                </Button>
                <Button variant="outline" asChild>
                  <Link to={returnPath}>{item ? 'Fechar' : 'Cancelar'}</Link>
                </Button>
              </div>
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                {item && isDirty ? (
                  <>
                    <span aria-hidden="true" className="bg-status-draft size-1.5 rounded-full" />
                    Alterações não salvas
                  </>
                ) : item ? (
                  'Tudo salvo'
                ) : (
                  'Novo item'
                )}
                <kbd className="border-border ml-auto hidden rounded border px-1.5 font-sans text-[0.6875rem] lg:inline">
                  {SAVE_SHORTCUT}
                </kbd>
              </p>
            </div>
          )}
        </form.Subscribe>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
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
          <form.Field name="channel">
            {(field) => (
              <FormField id="item-channel" label="Canal">
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
              <FormField id="item-format" label="Formato">
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
          <form.Field name="assigneeId">
            {(field) => (
              <FormField id="item-assignee" label="Responsável">
                <select
                  id="item-assignee"
                  className={selectClassName}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="">Ninguém</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </form.Field>
        </div>

        <Separator />

        <div className="grid gap-4">
          <form.Field name="scheduledAt">
            {(field) => (
              <FormField
                id="item-scheduled-at"
                label="Agendado para"
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
                label="Publicado em"
                error={fieldErrors.publishedAt}
              >
                <Input
                  id="item-published-at"
                  type="datetime-local"
                  aria-describedby="item-published-at-hint"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  {...errorProps('item-published-at', 'publishedAt')}
                />
                <p id="item-published-at-hint" className="text-muted-foreground text-xs">
                  Em branco num item publicado, vira o horário atual.
                </p>
              </FormField>
            )}
          </form.Field>
          <form.Field name="publishedUrl">
            {(field) => (
              <FormField
                id="item-published-url"
                label="Link da publicação"
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
                label="Links de arquivos (um por linha)"
                error={fieldErrors.assetLinks}
              >
                <Textarea
                  id="item-asset-links"
                  rows={2}
                  placeholder="https://"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="min-h-16"
                  {...errorProps('item-asset-links', 'assetLinks')}
                />
              </FormField>
            )}
          </form.Field>
        </div>

        {item ? (
          <>
            <Separator />
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive justify-start"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 data-icon="inline-start" />
              Excluir item
            </Button>
          </>
        ) : null}
      </aside>

      {item ? (
        <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir este item?</DialogTitle>
              <DialogDescription>
                “{item.title}” e as mídias dele somem para toda a equipe. Não dá
                para desfazer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
              >
                Manter
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteItem.isPending}
                onClick={() => void confirmDelete()}
              >
                {deleteItem.isPending ? 'Excluindo…' : 'Excluir item'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </form>
  )
}
