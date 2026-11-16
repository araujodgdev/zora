import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { PageHeader } from '@/components/app-shell'
import { ContentAssets } from '@/components/content/content-assets'
import { ContentItemForm } from '@/components/content/content-item-form'
import { contentItemIdSchema } from '@/lib/content'
import {
  contentAssetsQueryOptions,
  contentItemQueryOptions,
  teamMembersQueryOptions,
} from '@/lib/content.queries'
import { editItemSearchSchema, editorReturnPath } from '@/lib/editor-search'

export const Route = createFileRoute('/_app/content/$itemId')({
  validateSearch: editItemSearchSchema,
  // The form reads and writes local times, so it renders in the browser only.
  ssr: 'data-only',
  loader: async ({ context, params }) => {
    // An id that is not a UUID cannot exist; do not ask the server.
    if (!contentItemIdSchema.safeParse({ id: params.itemId }).success) {
      throw notFound()
    }
    // `getContentItem` throws `notFound()` for a missing item.
    await Promise.all([
      context.queryClient.query(contentItemQueryOptions(params.itemId)),
      context.queryClient.query(teamMembersQueryOptions()),
      context.queryClient.query(contentAssetsQueryOptions(params.itemId)),
    ])
  },
  head: () => ({ meta: [{ title: 'Edit item · Zora' }] }),
  component: EditContentItemPage,
  notFoundComponent: ContentItemNotFound,
})

function EditContentItemPage() {
  const { itemId } = Route.useParams()
  const search = Route.useSearch()
  const { data: item } = useSuspenseQuery(contentItemQueryOptions(itemId))
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions())
  return (
    <>
      <PageHeader title={item.title} description="Edit this content item." />
      {/* The form starts from the item as loaded; a refetch must not wipe edits in progress. */}
      <ContentItemForm
        key={item.id}
        item={item}
        members={members}
        from={search.from}
      />
      <div className="mt-10 border-t pt-8">
        <ContentAssets itemId={item.id} />
      </div>
    </>
  )
}

function ContentItemNotFound() {
  return (
    <>
      <PageHeader
        title="Content item not found"
        description="It may have been deleted, or the link is wrong."
      />
      <BackLink />
    </>
  )
}

function BackLink() {
  const { from } = Route.useSearch()
  return (
    <Link
      to={editorReturnPath(from)}
      className="mt-4 inline-block text-sm underline underline-offset-4"
    >
      Back
    </Link>
  )
}
