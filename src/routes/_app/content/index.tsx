import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/app-shell'
import { AssigneeAvatar } from '@/components/content/assignee-avatar'
import { ChannelBadge } from '@/components/content/channel-badge'
import { ContentFilters } from '@/components/content/content-filters'
import { StatusBadge } from '@/components/content/status-badge'
import { LocalDateTime } from '@/components/local-date-time'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FORMAT_LABELS } from '@/lib/content'
import {
  contentFilterSearchSchema,
  hasContentFilters,
  toContentListFilters,
} from '@/lib/content-filters'
import type { ContentFilterValues } from '@/lib/content-filters'
import {
  contentListQueryOptions,
  teamMembersQueryOptions,
} from '@/lib/content.queries'

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
        <ContentFilters value={search} onChange={setFilters} members={members} />
        <Card>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {filtered
                  ? 'No content matches these filters.'
                  : 'No content yet. Create the first item with New item.'}
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
