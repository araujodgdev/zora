import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { PageHeader } from '@/components/app-shell'
import { contentItemIdSchema } from '@/lib/content'
import { contentItemQueryOptions } from '@/lib/content.queries'
import { editItemSearchSchema, editorReturnPath } from '@/lib/editor-search'

// Placeholder. The editor form replaces the component; the path, the search
// contract (`editItemSearchSchema`) and the loader are what other pages rely on.
export const Route = createFileRoute('/_app/content/$itemId')({
  validateSearch: editItemSearchSchema,
  loader: async ({ context, params }) => {
    // An id that is not a UUID cannot exist; do not ask the server.
    if (!contentItemIdSchema.safeParse({ id: params.itemId }).success) {
      throw notFound()
    }
    // `getContentItem` throws `notFound()` for a missing item.
    await context.queryClient.query(contentItemQueryOptions(params.itemId))
  },
  head: () => ({ meta: [{ title: 'Edit item · Zora' }] }),
  component: EditContentItemPage,
  notFoundComponent: ContentItemNotFound,
})

function EditContentItemPage() {
  const { itemId } = Route.useParams()
  const search = Route.useSearch()
  const { data: item } = useSuspenseQuery(contentItemQueryOptions(itemId))
  return (
    <>
      <PageHeader
        title={item.title}
        description="The editor form will appear here."
      />
      <pre className="bg-muted rounded-md p-3 text-xs">
        {JSON.stringify(search, null, 2)}
      </pre>
      <BackLink />
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
