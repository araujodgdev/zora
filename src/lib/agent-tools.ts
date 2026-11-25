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
      'The post copy. Blog: Markdown. X, LinkedIn, Instagram, TikTok, YouTube: plain text only, no Markdown (those networks show **, # and [](...) literally); keep within 280 (X), 3000 (LinkedIn), 2200 (Instagram/TikTok) or 5000 (YouTube) characters. For an X thread, separate tweets with a line containing only ---.',
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
    description:
      'The Zora team member you are acting for (id, name, email) and the active workspace (or null if none).',
    input: z.object({}),
  },
  list_team_members: {
    title: 'List team members',
    description:
      'The members of the current workspace. Use their id as assigneeId. Every member can edit all of the workspace content.',
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
export const AGENT_INSTRUCTIONS = `Zora is a collaborative planner for social media and blog content, with workspaces, design and photo editing, and direct social publishing.
Each content item has a channel, a format and a pipeline status (${STATUSES.join(' -> ')}), optionally a scheduled date, an assignee and uploaded media.
Authentication is per user across all workspaces the user belongs to. Content, team members and social connections belong to the active workspace (get_current_user names it); use list_workspaces to see all of the user's workspaces, switch_workspace to change the active workspace (persisted across calls), create_workspace to create a new one, and rename_workspace to rename one (owners and admins only; workspace deletion is disabled). Every member of a workspace sees and edits all of its content. Dates are UTC instants: always send an offset, and show times to the user in their time zone.
Text (body) is Markdown for the blog and plain text for X, LinkedIn, Instagram, TikTok and YouTube: never put Markdown in a social post.
An item can be published directly to connected social accounts (Instagram, TikTok, YouTube, LinkedIn, X) with publish_content_item (check list_social_connections first and get_publish_status for async video uploads). Always confirm with the user before calling publish_content_item because it posts publicly to a real social network. Items with status "scheduled" on a connected channel are also published automatically at scheduledAt.
An item can have designs (Zora Studio documents, each save a numbered version); people polish them in Studio (the design's url), and you compose them with Studio's engine. To make a post image:
1. create_design for the item (its channel's size by default).
2. Get the images into the item's media: search_stock_images + add_stock_image (Unsplash) for real-world photos and people, generate_image (AI, costs money) for illustrations and brand scenes; pass the designId so the shape matches.
3. Compose with edit_design: find commands with list_design_commands; place an image by mapping a name to its media file id in "images" and passing "zora-image:<name>" in the command's params. Keep layouts clean, legible, and easy for non-technical creators to tweak in Zora Studio's Simple Mode: clear typography, solid backgrounds and shapes, descriptive layer names, and high contrast. Keep text as live text (editable in Studio); convert to outlines only when a headline needs warping or effects. Fonts: list_design_fonts.
4. Look at the PNG edit_design returns, then show it to the person and ask about the open choices (font, colours, wording, layout) instead of guessing; iterate with more edit_design calls, passing the version you looked at as baseVersionId. If the person changed the design in Studio meanwhile the edit is refused: look again (render_design, inspect_design) and build on their version.
5. When they approve, publish_design puts the PNG in the item's media. When a post uses an Unsplash photo, credit the photographer in its text, e.g. "Foto: <name> / Unsplash".
An item can also have photo edits (Zora LightCraft developments of one original photo: develop settings plus a rendered preview, each save a numbered version). create_photo_edit starts one from an image of the item's media (raw camera files are uploaded by the person in the app); people can also develop it in LightCraft (the edit's url). To develop a photo with the photo engine:
1. Start with inspect_photo to check the photo's dimensions, camera/EXIF info and current settings (and list_photo_commands if you need a command's exact parameters).
2. Use edit_photo with clean, creator-friendly 1-step improvements rather than heavy multi-pass stacks: start from develop.auto and apply targeted tweaks (light.exposure, light.contrast, light.highlights, light.shadows, wb.temp, color.vibrance, color.saturation, detail.sharpness, effects.vignette) or social aspect-ratio crops (1:1, 4:5, 9:16, 16:9). For an export watermark logo, map a short name to an image media file id in "images" and pass "zora-image:<name>" in the command's params.
3. Look at the rendered preview edit_photo returns (or call render_photo with a scale < 1 if the full preview is over 4 MB), show it to the person and iterate simply, passing baseVersionId so a save the person made in LightCraft meanwhile is never overwritten.
4. When they approve, publish_photo_edit puts the rendered preview in the item's media. list_photo_edits, get_photo_edit, list_photo_edit_versions and restore_photo_edit_version work like the design tools.
Each returned item has a url to open it in the app. Ask before deleting anything.`
