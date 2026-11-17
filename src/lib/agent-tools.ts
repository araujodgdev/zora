/**
 * Inputs and descriptions of the actions an AI agent can take in Zora, shared
 * by the MCP server (`mcp.server.ts`, remote agents) and the WebMCP tools
 * (`webmcp.ts`, an agent in the user's browser tab). Client-safe.
 *
 * The shapes are plain (strings for dates) so they convert to JSON Schema;
 * handlers then validate with the shared schemas in `./content`.
 */
import { z } from 'zod'
import {
  CHANNELS,
  CHANNEL_LABELS,
  FORMATS,
  FORMAT_LABELS,
  STATUSES,
  STATUS_LABELS,
} from './content'

export const itemId = z.uuid().describe('Content item id (UUID).')

export const instant = z.iso
  .datetime({ offset: true })
  .describe(
    'ISO 8601 date-time with a UTC offset, e.g. 2026-11-20T09:00:00-03:00. Ask the user for their time zone if unsure.',
  )

export const itemFields = {
  title: z.string().min(1).max(300).describe('Short title.'),
  body: z
    .string()
    .describe(
      'The post copy. Blog: Markdown. X, LinkedIn, Instagram: plain text only, no Markdown (those networks show **, # and [](...) literally); keep within 280 (X), 3000 (LinkedIn) or 2200 (Instagram) characters.',
    ),
  channel: z
    .enum(CHANNELS)
    .describe(`Network: ${CHANNELS.map((c) => `${c} (${CHANNEL_LABELS[c]})`).join(', ')}.`),
  format: z
    .enum(FORMATS)
    .describe(`Format: ${FORMATS.map((f) => `${f} (${FORMAT_LABELS[f]})`).join(', ')}.`),
  status: z
    .enum(STATUSES)
    .describe(
      `Pipeline status, in order: ${STATUSES.map((s) => `${s} (${STATUS_LABELS[s]})`).join(', ')}. "scheduled" needs scheduledAt; "published" gets publishedAt = now if not given.`,
    ),
  scheduledAt: instant.nullable().describe('When it goes out, or null for unscheduled.'),
  publishedAt: instant.nullable().describe('When it went out.'),
  publishedUrl: z.string().nullable().describe('http(s) URL of the published post, or null.'),
  notes: z.string().describe('Internal notes.'),
  assetLinks: z.array(z.string()).describe('External http(s) links to assets (not uploads).'),
  assigneeId: z
    .string()
    .nullable()
    .describe('Team member id (see list_team_members), or null for unassigned.'),
}

type OptionalFields = {
  [K in keyof typeof itemFields]: z.ZodOptional<(typeof itemFields)[K]>
}
const optionalItemFields = Object.fromEntries(
  Object.entries(itemFields).map(([key, schema]) => [key, schema.optional()]),
) as OptionalFields

/** Input schema and description of each action both kinds of agent can take. */
export const agentActions = {
  get_current_user: {
    title: 'Who am I',
    description: 'The Zora team member you are acting for (id, name, email).',
    input: z.object({}),
  },
  list_team_members: {
    title: 'List team members',
    description:
      'Everyone on the team. Use their id as assigneeId. All members share one workspace and can edit everything.',
    input: z.object({}),
  },
  list_content_items: {
    title: 'List content items',
    description:
      'Content items (social posts and articles), ordered by scheduledAt (unscheduled last). Filters are combined with AND; scheduledFrom/scheduledTo form a half-open range and exclude unscheduled items.',
    input: z.object({
      scheduledFrom: instant.optional(),
      scheduledTo: instant.optional(),
      channels: z.array(itemFields.channel).optional(),
      statuses: z.array(itemFields.status).optional(),
      assigneeId: z.string().optional().describe('Only items assigned to this member.'),
    }),
  },
  get_content_item: {
    title: 'Get a content item',
    description: 'One content item with its uploaded media files.',
    input: z.object({ id: itemId }),
  },
  create_content_item: {
    title: 'Create a content item',
    description:
      'Creates a content item. Only title, channel and format are required; status defaults to "idea".',
    input: z.object({
      ...optionalItemFields,
      title: itemFields.title,
      channel: itemFields.channel,
      format: itemFields.format,
    }),
  },
  update_content_item: {
    title: 'Update a content item',
    description:
      'Changes only the fields you send. To schedule an unscheduled item, send status "scheduled" and scheduledAt together.',
    input: z.object({ id: itemId, ...optionalItemFields }),
  },
  reschedule_content_item: {
    title: 'Reschedule a content item',
    description:
      'Sets or clears scheduledAt only. Clearing the date of a "scheduled" item is refused; change its status first.',
    input: z.object({ id: itemId, scheduledAt: itemFields.scheduledAt }),
  },
  change_content_item_status: {
    title: 'Move a content item in the pipeline',
    description:
      'Changes status only. "scheduled" needs the item to have a scheduledAt already; "published" fills publishedAt with now when missing.',
    input: z.object({ id: itemId, status: itemFields.status }),
  },
  delete_content_item: {
    title: 'Delete a content item',
    description:
      'Permanently deletes an item and its uploaded media. Confirm with the user first.',
    input: z.object({ id: itemId }),
  },
} as const

export type AgentActionName = keyof typeof agentActions

/** Shared guidance for agents, used as MCP server instructions. */
export const AGENT_INSTRUCTIONS = `Zora is a three-person team's planner for a product launch's social media and blog content.
Each content item has a channel, a format and a pipeline status (${STATUSES.join(' -> ')}), optionally a scheduled date, an assignee and uploaded media.
Everyone on the team sees and edits everything. Dates are UTC instants: always send an offset, and show times to the user in their time zone.
Text (body) is Markdown for the blog and plain text for X, LinkedIn and Instagram: never put Markdown in a social post.
Each returned item has a url to open it in the app. Ask before deleting anything.`
