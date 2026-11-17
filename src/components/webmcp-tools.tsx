import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod'
import { agentActions, instant, itemFields, itemId } from '@/lib/agent-tools'
import type { AgentActionName } from '@/lib/agent-tools'
import { CALENDAR_VIEWS } from '@/lib/calendar'
import type { ContentItem } from '@/lib/content'
import {
  contentAssetsQueryOptions,
  contentItemQueryOptions,
  contentListQueryOptions,
  teamMembersQueryOptions,
  useChangeContentItemStatus,
  useCreateContentItem,
  useDeleteContentItem,
  useRescheduleContentItem,
  useUpdateContentItem,
} from '@/lib/content.queries'

const appRoute = getRouteApi('/_app')

const PAGES = ['calendar', 'pipeline', 'content'] as const

/** Navigation-only tools: the agent sets up a page, the user looks or saves. */
const pageActions = {
  open_page: {
    title: 'Open a page',
    description:
      'Shows the calendar, the pipeline board or the content list in this tab, optionally filtered. On the calendar, view is "month" or "week" and date (yyyy-MM-dd) picks the period.',
    input: z.object({
      page: z.enum(PAGES),
      view: z.enum(CALENDAR_VIEWS).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      channels: z.array(itemFields.channel).optional(),
      statuses: z.array(itemFields.status).optional(),
      assigneeId: z.string().optional(),
    }),
  },
  open_content_item: {
    title: 'Open a content item',
    description:
      'Opens the editor of an item in this tab so the user can review or edit it.',
    input: z.object({ id: itemId }),
  },
  open_new_content_item: {
    title: 'Start a new content item',
    description:
      'Opens the "new item" form in this tab, prefilled with a date, status and channel, for the user to complete and save.',
    input: z.object({
      scheduledAt: instant.optional(),
      status: itemFields.status.optional(),
      channel: itemFields.channel.optional(),
    }),
  },
} as const

type ActionInput<Name extends AgentActionName> = z.output<
  (typeof agentActions)[Name]['input']
>
type PageInput<Name extends keyof typeof pageActions> = z.output<
  (typeof pageActions)[Name]['input']
>

const READ_ONLY = new Set<string>([
  'get_current_user',
  'list_team_members',
  'list_content_items',
  'get_content_item',
])

function jsonSchema(schema: z.ZodObject): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input' })
  return rest
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'The action failed.'
}

/**
 * Registers Zora's WebMCP tools while a signed-in page is open, so an agent
 * in this browser tab can operate the app through structured tools instead of
 * clicking. The tools use the same queries and mutations as the UI, so every
 * change shows up on screen (moves on the calendar and board are optimistic).
 * Renders nothing; does nothing in browsers without WebMCP.
 */
export function WebMcpTools() {
  const { user } = appRoute.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const create = useCreateContentItem().mutateAsync
  const update = useUpdateContentItem().mutateAsync
  const reschedule = useRescheduleContentItem().mutateAsync
  const changeStatus = useChangeContentItemStatus().mutateAsync
  const remove = useDeleteContentItem().mutateAsync

  useEffect(() => {
    const modelContext = document.modelContext
    if (!modelContext) return

    const withUrl = (item: ContentItem) => ({
      ...item,
      url: `${window.location.origin}/content/${item.id}`,
    })

    const run = {
      get_current_user: async () => user,
      list_team_members: () => queryClient.fetchQuery(teamMembersQueryOptions()),
      list_content_items: async (filters: ActionInput<'list_content_items'>) => {
        const items = await queryClient.fetchQuery(contentListQueryOptions(filters))
        return { count: items.length, items: items.map(withUrl) }
      },
      get_content_item: async ({ id }: ActionInput<'get_content_item'>) => {
        const [item, media] = await Promise.all([
          queryClient.fetchQuery(contentItemQueryOptions(id)),
          queryClient.fetchQuery(contentAssetsQueryOptions(id)),
        ])
        return { ...withUrl(item), media }
      },
      create_content_item: async (input: ActionInput<'create_content_item'>) =>
        withUrl(await create(input)),
      update_content_item: async (input: ActionInput<'update_content_item'>) =>
        withUrl(await update(input)),
      reschedule_content_item: async (input: ActionInput<'reschedule_content_item'>) =>
        withUrl(await reschedule(input)),
      change_content_item_status: async (
        input: ActionInput<'change_content_item_status'>,
      ) => withUrl(await changeStatus(input)),
      delete_content_item: async ({ id }: ActionInput<'delete_content_item'>) => {
        const item = await queryClient.fetchQuery(contentItemQueryOptions(id))
        // The person at the keyboard confirms; the agent cannot skip this.
        if (
          !window.confirm(`An assistant wants to delete "${item.title}". Delete it?`)
        ) {
          return { deleted: false, reason: 'The user declined.' }
        }
        await remove(id)
        return { deleted: id }
      },
      open_page: async (input: PageInput<'open_page'>) => {
        const { page, view, date, ...filters } = input
        if (page === 'calendar') {
          await router.navigate({ to: '/calendar', search: { view, date, ...filters } })
        } else if (page === 'pipeline') {
          await router.navigate({ to: '/pipeline', search: filters })
        } else {
          await router.navigate({ to: '/content', search: filters })
        }
        return `Opened the ${page} page.`
      },
      open_content_item: async ({ id }: PageInput<'open_content_item'>) => {
        await router.navigate({
          to: '/content/$itemId',
          params: { itemId: id },
          search: { from: 'content' },
        })
        return `Opened the editor of item ${id}.`
      },
      open_new_content_item: async (input: PageInput<'open_new_content_item'>) => {
        await router.navigate({ to: '/content/new', search: { from: 'content', ...input } })
        return 'Opened the new item form; the user completes and saves it.'
      },
    } satisfies Record<
      AgentActionName | keyof typeof pageActions,
      (input: never) => Promise<unknown>
    >

    const definitions: Record<
      string,
      { title: string; description: string; input: z.ZodObject }
    > = { ...agentActions, ...pageActions }
    const controller = new AbortController()
    for (const [name, { title, description, input }] of Object.entries(definitions)) {
      const handler = run[name as keyof typeof run] as (input: unknown) => Promise<unknown>
      const tool: ModelContextTool = {
        name,
        title,
        description,
        inputSchema: jsonSchema(input),
        annotations: {
          readOnlyHint: READ_ONLY.has(name),
          // Titles and copy are written by people (and agents): treat as data.
          untrustedContentHint: READ_ONLY.has(name),
          consequentialHint: name === 'delete_content_item',
        },
        execute: async (args) => {
          const parsed = input.safeParse(args ?? {})
          if (!parsed.success) {
            return `Invalid input: ${z.prettifyError(parsed.error)}`
          }
          try {
            const result = await handler(parsed.data)
            return typeof result === 'string' ? result : JSON.stringify(result)
          } catch (error) {
            return `Failed: ${messageOf(error)}`
          }
        },
      }
      void modelContext
        .registerTool(tool, { signal: controller.signal })
        .catch(() => {})
    }
    return () => controller.abort()
  }, [user, router, queryClient, create, update, reschedule, changeStatus, remove])

  return null
}
