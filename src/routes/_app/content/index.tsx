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
  head: () => ({ meta: [{ title: 'Conteúdos · Zora' }] }),
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
          title="Conteúdos"
          description="Todos os itens de conteúdo, de todos os canais."
        />
        <Button asChild>
          <Link to="/content/new" search={{ from: 'content' }}>
            <Plus data-icon="inline-start" />
            Novo item
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
                  ? 'Nenhum conteúdo corresponde a estes filtros.'
                  : 'Nenhum conteúdo ainda. Crie o primeiro em Novo item.'}
              </p>
            ) : (
              <>
              {/* Phones: one stacked row per item; the table does not fit. */}
              <ul className="divide-y md:hidden">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to="/content/$itemId"
                      params={{ itemId: item.id }}
                      search={{ from: 'content' }}
                      className="focus-visible:ring-ring/50 grid gap-2 rounded-md py-3 outline-none focus-visible:ring-3"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-medium">{item.title}</span>
                        <AssigneeAvatar
                          member={
                            item.assigneeId
                              ? (membersById.get(item.assigneeId) ?? null)
                              : null
                          }
                          size="sm"
                        />
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <ChannelBadge channel={item.channel} />
                        <StatusBadge status={item.status} />
                        <span className="text-muted-foreground text-xs">
                          {FORMAT_LABELS[item.format]}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        <LocalDateTime value={item.scheduledAt} fallback="Sem data" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead>Formato</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Agendado para</TableHead>
                    <TableHead>Responsável</TableHead>
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
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
