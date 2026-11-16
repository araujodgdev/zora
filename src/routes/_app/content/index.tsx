import { useForm } from '@tanstack/react-form'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useHydrated } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '@/components/app-shell'
import { AssigneeAvatar } from '@/components/content/assignee-avatar'
import { ChannelBadge } from '@/components/content/channel-badge'
import { ContentFilters } from '@/components/content/content-filters'
import { StatusBadge } from '@/components/content/status-badge'
import { FormField, firstErrorMessage } from '@/components/form-field'
import { LocalDateTime } from '@/components/local-date-time'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CHANNELS,
  CHANNEL_LABELS,
  FORMATS,
  FORMAT_LABELS,
  STATUSES,
  STATUS_LABELS,
  createContentItemSchema,
} from '@/lib/content'
import type { Channel, ContentFormat, ContentStatus } from '@/lib/content'
import {
  contentFilterSearchSchema,
  hasContentFilters,
  toContentListFilters,
} from '@/lib/content-filters'
import type { ContentFilterValues } from '@/lib/content-filters'
import {
  contentListQueryOptions,
  teamMembersQueryOptions,
  useCreateContentItem,
} from '@/lib/content.queries'
import { fromDateTimeLocalValue } from '@/lib/dates'

export const Route = createFileRoute('/_app/content/')({
  validateSearch: contentFilterSearchSchema,
  // The loader and the component both derive the list filters from the
  // validated search with `toContentListFilters`, so they hit the same query.
  loaderDeps: ({ search }) => ({ filters: toContentListFilters(search) }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.query(contentListQueryOptions(deps.filters)),
      context.queryClient.query(teamMembersQueryOptions()),
    ])
  },
  head: () => ({ meta: [{ title: 'Content · Zora' }] }),
  component: ContentPage,
})

function ContentPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: items } = useSuspenseQuery(
    contentListQueryOptions(toContentListFilters(search)),
  )
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions())
  const membersById = new Map(members.map((member) => [member.id, member]))
  const filtered = hasContentFilters(search)

  function setFilters(next: ContentFilterValues) {
    void navigate({ search: next, replace: true })
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Content"
          description="Every content item across channels."
        />
        <Button asChild>
          <Link to="/content/new" search={{ from: 'content' }}>
            <Plus data-icon="inline-start" />
            New item
          </Link>
        </Button>
      </div>
      <div className="grid gap-6">
        <QuickCreateForm />
        <ContentFilters value={search} onChange={setFilters} members={members} />
        <Card>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {filtered
                  ? 'No content matches these filters.'
                  : 'No content yet. Add the first item above.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Assignee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        <Link
                          to="/content/$itemId"
                          params={{ itemId: item.id }}
                          search={{ from: 'content' }}
                          className="underline-offset-4 hover:underline"
                        >
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <ChannelBadge channel={item.channel} />
                      </TableCell>
                      <TableCell>{FORMAT_LABELS[item.format]}</TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>
                        <LocalDateTime value={item.scheduledAt} />
                      </TableCell>
                      <TableCell>
                        <AssigneeAvatar
                          member={
                            item.assigneeId
                              ? (membersById.get(item.assigneeId) ?? null)
                              : null
                          }
                          size="sm"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

const selectClassName =
  'border-input bg-transparent h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

// Kept until the real editor (`/content/new`) is built.
function QuickCreateForm() {
  const hydrated = useHydrated()
  const createItem = useCreateContentItem()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      title: '',
      channel: 'linkedin' as Channel,
      format: 'post' as ContentFormat,
      status: 'idea' as ContentStatus,
      scheduledAt: '',
    },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null)
      const parsed = createContentItemSchema.safeParse({
        ...value,
        scheduledAt: fromDateTimeLocalValue(value.scheduledAt),
      })
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? 'Check the fields.')
        return
      }
      try {
        await createItem.mutateAsync(parsed.data)
        formApi.reset()
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : 'Could not create the item.',
        )
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>New content item</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset
            disabled={!hydrated}
            className="grid items-end gap-4 md:grid-cols-[2fr_1fr_1fr_1fr_1.5fr_auto]"
          >
            <form.Field name="title">
              {(field) => (
                <FormField
                  id="new-title"
                  label="Title"
                  error={firstErrorMessage(field.state.meta.errors)}
                >
                  <Input
                    id="new-title"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </FormField>
              )}
            </form.Field>
            <form.Field name="channel">
              {(field) => (
                <FormField id="new-channel" label="Channel">
                  <select
                    id="new-channel"
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
                <FormField id="new-format" label="Format">
                  <select
                    id="new-format"
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
                <FormField id="new-status" label="Status">
                  <select
                    id="new-status"
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
            <form.Field name="scheduledAt">
              {(field) => (
                <FormField id="new-scheduled-at" label="Scheduled (local time)">
                  <Input
                    id="new-scheduled-at"
                    type="datetime-local"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </FormField>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={!hydrated || isSubmitting}>
                  {isSubmitting ? 'Adding…' : 'Add'}
                </Button>
              )}
            </form.Subscribe>
          </fieldset>
          {formError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
