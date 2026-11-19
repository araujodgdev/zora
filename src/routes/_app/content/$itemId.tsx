import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { PageHeader } from '@/components/app-shell'
import { ContentAssets } from '@/components/content/content-assets'
import { ContentDesigns } from '@/components/content/content-designs'
import { ContentItemForm } from '@/components/content/content-item-form'
import { ContentPublish } from '@/components/content/content-publish'
import { contentItemIdSchema } from '@/lib/content'
import { contentDesignsQueryOptions } from '@/lib/content-designs.queries'
import {
  contentAssetsQueryOptions,
  contentItemQueryOptions,
  teamMembersQueryOptions,
} from '@/lib/content.queries'
import { editItemSearchSchema, editorReturnPath } from '@/lib/editor-search'
import { loadQuery } from '@/lib/route-query'
import {
  itemPublishJobsQueryOptions,
  socialConnectionsQueryOptions,
} from '@/lib/social.queries'

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
    const [item] = await Promise.all([
      loadQuery(context.queryClient, contentItemQueryOptions(params.itemId)),
      loadQuery(context.queryClient, teamMembersQueryOptions()),
      loadQuery(context.queryClient, contentAssetsQueryOptions(params.itemId)),
      loadQuery(context.queryClient, contentDesignsQueryOptions(params.itemId)),
      loadQuery(context.queryClient, socialConnectionsQueryOptions()),
      loadQuery(context.queryClient, itemPublishJobsQueryOptions(params.itemId)),
    ])
    return { title: item.title }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.title ?? 'Item'} · Zora` }],
  }),
  component: EditContentItemPage,
  notFoundComponent: ContentItemNotFound,
})

function EditContentItemPage() {
  const { itemId } = Route.useParams()
  const search = Route.useSearch()
  const { data: item } = useSuspenseQuery(contentItemQueryOptions(itemId))
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions())
  return (
    // The form starts from the item as loaded; a refetch must not wipe edits in progress.
    <ContentItemForm
      key={item.id}
      item={item}
      members={members}
      from={search.from}
      designs={<ContentDesigns itemId={item.id} channel={item.channel} from={search.from} />}
      media={<ContentAssets itemId={item.id} />}
      renderPublish={({ isDirty, channel, onPublished }) => (
        <ContentPublish
          item={item}
          currentChannel={channel}
          isDirty={isDirty}
          onPublished={onPublished}
        />
      )}
    />
  )
}

function ContentItemNotFound() {
  return (
    <>
      <PageHeader
        title="Item não encontrado"
        description="Ele pode ter sido excluído, ou o link está errado."
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
      Voltar
    </Link>
  )
}
