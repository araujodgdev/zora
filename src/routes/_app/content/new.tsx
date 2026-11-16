import { Link, createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/app-shell'
import { editorReturnPath, newItemSearchSchema } from '@/lib/editor-search'

// Placeholder. The editor form replaces the component; the path and search
// contract (`newItemSearchSchema`) are what other pages link against.
export const Route = createFileRoute('/_app/content/new')({
  validateSearch: newItemSearchSchema,
  head: () => ({ meta: [{ title: 'New item · Zora' }] }),
  component: NewContentItemPage,
})

function NewContentItemPage() {
  const search = Route.useSearch()
  return (
    <>
      <PageHeader
        title="New content item"
        description="The editor form will appear here."
      />
      <pre className="bg-muted rounded-md p-3 text-xs">
        {JSON.stringify(search, null, 2)}
      </pre>
      <Link
        to={editorReturnPath(search.from)}
        className="mt-4 inline-block text-sm underline underline-offset-4"
      >
        Back
      </Link>
    </>
  )
}
