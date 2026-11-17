import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ContentItemForm } from '@/components/content/content-item-form'
import { teamMembersQueryOptions } from '@/lib/content.queries'
import { newItemSearchSchema } from '@/lib/editor-search'

export const Route = createFileRoute('/_app/content/new')({
  validateSearch: newItemSearchSchema,
  // The form reads and writes local times, so it renders in the browser only.
  ssr: 'data-only',
  loader: async ({ context }) => {
    await context.queryClient.query(teamMembersQueryOptions())
  },
  head: () => ({ meta: [{ title: 'Novo item · Zora' }] }),
  component: NewContentItemPage,
})

function NewContentItemPage() {
  const search = Route.useSearch()
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions())
  return (
    <ContentItemForm
      members={members}
      from={search.from}
      defaults={{
        channel: search.channel,
        status: search.status,
        scheduledAt: search.scheduledAt
          ? new Date(search.scheduledAt)
          : undefined,
      }}
    />
  )
}
