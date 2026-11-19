/**
 * Zora's MCP server: the tools an AI agent uses to operate the app on behalf
 * of a signed-in team member. Served at `/mcp` (`src/routes/mcp.ts`) behind
 * OAuth; every tool calls the same service functions as the UI, so the same
 * validation and scheduling rules apply.
 */
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { user as userTable } from '../db/schema'
import type { Database } from '../db/client.server'
import { AGENT_INSTRUCTIONS, agentActions } from './agent-tools'
import type { AgentActionName } from './agent-tools'
import {
  changeContentItemStatusSchema,
  contentListFiltersSchema,
  createContentItemSchema,
  rescheduleContentItemSchema,
  updateContentItemSchema,
} from './content'
import type { ContentItem, TeamMember } from './content'
import { MEDIA_TYPES, UNSPLASH_HOME_URL, assetKind, formatBytes } from './content-assets'
import type { AssetAttribution, ContentAsset } from './content-assets'
import * as assets from './content-assets.server'
import type { MediaBucket } from './content-assets.server'
import * as content from './content.server'
import {
  DESIGN_PRESETS,
  DESIGN_PRESET_NAMES,
  MAX_DESIGN_SIDE,
  createContentDesignSchema,
  designPreviewKey,
  designSourceKey,
} from './content-designs'
import type { ContentDesign } from './content-designs'
import * as designs from './content-designs.server'
import * as images from './image-providers.server'
import type { ImageProviderConfig } from './image-providers.server'
import {
  SOCIAL_CHANNEL_INFO,
  socialPublishOptionsSchema,
} from './social'
import * as socialConnections from './social-connections.server'
import * as socialPublish from './social-publish.server'
import * as engine from './studio-engine.server'
import type { EngineRunResult, StudioEngineTransport } from './studio-engine.server'
import type { FontManifest } from './studio-fonts'
import { STUDIO_FONTS_BUNDLE, STUDIO_FONTS_MANIFEST } from './studio-hosting'
import { SocialPublishingError } from './treg.server'
import type { TregClient } from './treg.server'
import type { Workspace } from './workspace'

/** Uploads through MCP arrive as base64 in the JSON-RPC body. */
export const MAX_MCP_UPLOAD_BYTES = 10 * 1024 * 1024
/** Images up to this size are returned inline so the agent can look at them. */
export const MAX_MCP_IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024
/** Stock search shows at most this many thumbnails, each and in all within these sizes. */
const MAX_SEARCH_PREVIEWS = 6
const MAX_SEARCH_THUMBNAIL_BYTES = 300 * 1024
const MAX_SEARCH_PREVIEW_BYTES = 1024 * 1024
/** Default and largest longest side of a stock photo stored for a design. */
const DEFAULT_STOCK_SIDE = 3000
const MAX_STOCK_SIDE = 4000
/** Room for a base64 upload of MAX_MCP_UPLOAD_BYTES plus the JSON around it. */
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024

export type McpDeps = {
  db: Database
  bucket: MediaBucket
  /** The team member the access token was issued to. */
  user: TeamMember
  /** The workspace the tools act in (see `resolveMcpWorkspace`). */
  workspace: Workspace
  /** Public base URL, for links back to the app. */
  appUrl: string
  /** Keys of the image providers; without a key, that provider's tools return an error. */
  images?: ImageProviderConfig
  /** The design engine (`getStudioEngine()`); without it the engine tools return an error. */
  engine?: StudioEngineTransport | null
  /** treg.to client for social publishing; without it publish tools report unconfigured. */
  treg?: TregClient | null
}

/** The user an access token's `sub` names, or null if they no longer exist. */
export async function findMcpUser(
  db: Database,
  id: string,
): Promise<TeamMember | null> {
  const [found] = await db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, id))
    .limit(1)
  return found ?? null
}

// --- results ---------------------------------------------------------------

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

class ToolError extends Error {}

function notFound(what: string, id: string): never {
  throw new ToolError(`No ${what} with id ${id}.`)
}

function withLink(item: ContentItem, appUrl: string) {
  return { ...item, url: `${appUrl.replace(/\/+$/, '')}/content/${item.id}` }
}

function describeDesign(design: ContentDesign, appUrl: string) {
  return {
    ...design,
    url: `${appUrl.replace(/\/+$/, '')}/content/${design.contentItemId}/designs/${design.id}`,
  }
}

function describeAsset(asset: ContentAsset) {
  return { ...asset, kind: assetKind(asset.contentType), sizeText: formatBytes(asset.size) }
}

// --- base64 (no Buffer on Workers without nodejs_compat helpers) ------------

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
    throw new ToolError('dataBase64 is not valid base64.')
  }
  let binary: string
  try {
    binary = atob(clean)
  } catch {
    throw new ToolError('dataBase64 is not valid base64.')
  }
  if (binary.length > MAX_MCP_UPLOAD_BYTES) {
    throw new ToolError(`The file is larger than ${formatBytes(MAX_MCP_UPLOAD_BYTES)}.`)
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Unsplash's orientation for a size (squarish within 10 %). */
function orientationOf(width: number, height: number): images.UnsplashOrientation {
  const ratio = width / height
  return ratio > 1.1 ? 'landscape' : ratio < 1 / 1.1 ? 'portrait' : 'squarish'
}

/** A file-name-safe ASCII slug, e.g. "Ana Lúcia" -> "ana-lucia". */
function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// --- design engine -------------------------------------------------------------

/** Command list defaults: compact enough for an agent's context. */
const DEFAULT_COMMAND_LIST = 40
const MAX_COMMAND_LIST = 200
const MAX_COMMAND_PARAMS_CHARS = 1200
/** Command results and inspect output are cut to this many characters. */
const MAX_ENGINE_TEXT_CHARS = 60_000
/** A render is the first artboard at 1x, longest side capped (as Studio saves). */
const RENDER_MAX_SIZE = 4096

function requireEngine(transport: StudioEngineTransport | null | undefined): StudioEngineTransport {
  if (!transport) throw new engine.StudioEngineNotConfiguredError()
  return transport
}

/** A value as JSON, or its first characters as a string when it is too long. */
function bounded(value: unknown, maxChars: number): unknown {
  const text = JSON.stringify(value) ?? 'null'
  if (text.length <= maxChars) return value
  return `${text.slice(0, maxChars)}... (cut: ${text.length} characters in all)`
}

async function readBytes(bucket: MediaBucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key)
  if (!object?.body) return null
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

/** The PNG as image content, or a note when it is too large to show. */
function pngContent(png: Uint8Array): CallToolResult['content'] {
  if (png.length > MAX_MCP_IMAGE_PREVIEW_BYTES) {
    return [
      {
        type: 'text',
        text: `The PNG (${formatBytes(png.length)}) is larger than ${formatBytes(MAX_MCP_IMAGE_PREVIEW_BYTES)} and is not shown; look at a smaller render with render_design and a scale below 1.`,
      },
    ]
  }
  return [{ type: 'image', data: toBase64(png), mimeType: 'image/png' }]
}

/** The design and the version a tool works on (the current one by default). */
async function designAndVersion(deps: McpDeps, designId: string, versionId: string | undefined) {
  const design =
    (await designs.getContentDesign(deps.db, deps.workspace.id, designId)) ??
    notFound('design', designId)
  const shownId = versionId ?? design.currentVersionId
  if (!shownId) {
    throw new ToolError(
      `Design ${designId} has no saved version yet: edit it with edit_design (or in Studio) first.`,
    )
  }
  const version =
    (await designs.getDesignVersion(deps.db, deps.workspace.id, designId, shownId)) ??
    notFound('version of this design', shownId)
  return { design, version }
}

async function readVersionSource(deps: McpDeps, designId: string, versionId: string) {
  const source = await readBytes(deps.bucket, designSourceKey(designId, versionId))
  if (!source) throw new ToolError(`The source file of version ${versionId} was not found.`)
  return source
}

/** The images of an edit: names to media files of this workspace, read from R2. */
async function readEditImages(
  deps: McpDeps,
  wanted: Record<string, string>,
): Promise<Record<string, Uint8Array>> {
  const entries = Object.entries(wanted)
  if (entries.length > engine.MAX_ENGINE_IMAGES) {
    throw new ToolError(`At most ${engine.MAX_ENGINE_IMAGES} images per edit.`)
  }
  const found: Array<[string, ContentAsset]> = []
  let total = 0
  for (const [name, assetId] of entries) {
    const asset =
      (await assets.getContentAsset(deps.db, deps.workspace.id, assetId)) ??
      notFound('media file', assetId)
    if (assetKind(asset.contentType) !== 'image') {
      throw new ToolError(`Media file ${assetId} (image "${name}") is not an image.`)
    }
    if (asset.size > engine.MAX_ENGINE_IMAGE_BYTES) {
      throw new ToolError(
        `Media file ${assetId} (image "${name}") is larger than ${formatBytes(engine.MAX_ENGINE_IMAGE_BYTES)}.`,
      )
    }
    total += asset.size
    found.push([name, asset])
  }
  if (total > engine.MAX_ENGINE_IMAGES_TOTAL_BYTES) {
    throw new ToolError(
      `The images of one edit may total at most ${formatBytes(engine.MAX_ENGINE_IMAGES_TOTAL_BYTES)}.`,
    )
  }
  const read: Record<string, Uint8Array> = {}
  for (const [name, asset] of found) {
    const bytes = await readBytes(deps.bucket, assets.assetObjectKey(asset.contentItemId, asset.id))
    if (!bytes) throw new ToolError(`The file of media file ${asset.id} was not found.`)
    read[name] = bytes
  }
  return read
}

/** The font library manifest (R2 `studio-fonts/manifest.json`), or null. */
async function readFontManifest(bucket: MediaBucket): Promise<FontManifest | null> {
  const bytes = await readBytes(bucket, `${STUDIO_FONTS_BUNDLE.keyPrefix}${STUDIO_FONTS_MANIFEST}`)
  if (!bytes) return null
  try {
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as FontManifest
    return Array.isArray(manifest.families) ? manifest : null
  } catch {
    return null
  }
}

function asDesignFile(bytes: Uint8Array): designs.DesignFile {
  return { body: bytes.slice().buffer, size: bytes.length, head: bytes.subarray(0, 8) }
}

const engineCommandSchema = z.object({
  command: z.string().trim().min(1).max(200).describe('Command id, from list_design_commands.'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      `The command's parameters. To place an image from "images", pass "${engine.ENGINE_IMAGE_PREFIX}<name>" where the command takes an image path.`,
    ),
})

// --- tools -----------------------------------------------------------------

type ToolDefinition<Schema extends z.ZodObject> = {
  name: string
  title: string
  description: string
  inputSchema: Schema
  annotations: ToolAnnotations
  run: (args: z.output<Schema>, deps: McpDeps) => Promise<CallToolResult>
}

function defineTool<Schema extends z.ZodObject>(tool: ToolDefinition<Schema>) {
  return tool as unknown as ToolDefinition<z.ZodObject>
}

/** Name, title, description and input of an action shared with WebMCP. */
function action<Name extends AgentActionName>(
  name: Name,
): {
  name: Name
  title: string
  description: string
  inputSchema: (typeof agentActions)[Name]['input']
} {
  const { title, description } = agentActions[name]
  return { name, title, description, inputSchema: agentActions[name].input }
}

const readOnly: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
const writes: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
}
/** Writes that reach an outside service (a photo library, an image model). */
const fetchesAndWrites: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
}
const deletes: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}
const publishes: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
}

export const zoraTools = [
  defineTool({
    ...action('get_current_user'),
    annotations: readOnly,
    run: async (_args, { user, workspace }) =>
      ok({ ...user, workspace: { id: workspace.id, name: workspace.name } }),
  }),
  defineTool({
    ...action('list_team_members'),
    annotations: readOnly,
    run: async (_args, { db, workspace }) =>
      ok(await content.listTeamMembers(db, workspace.id)),
  }),
  defineTool({
    ...action('list_content_items'),
    annotations: readOnly,
    run: async (args, { db, workspace, appUrl }) => {
      const items = await content.listContentItems(
        db,
        workspace.id,
        contentListFiltersSchema.parse(args),
      )
      return ok({ count: items.length, items: items.map((item) => withLink(item, appUrl)) })
    },
  }),
  defineTool({
    ...action('get_content_item'),
    annotations: readOnly,
    run: async ({ id: itemId }, { db, workspace, appUrl }) => {
      const item =
        (await content.getContentItem(db, workspace.id, itemId)) ??
        notFound('content item', itemId)
      const media = await assets.listContentAssets(db, workspace.id, itemId)
      return ok({ ...withLink(item, appUrl), media: media.map(describeAsset) })
    },
  }),
  defineTool({
    ...action('create_content_item'),
    annotations: writes,
    run: async (args, { db, user, workspace, appUrl }) => {
      const item = await content.createContentItem(
        db,
        workspace.id,
        user.id,
        createContentItemSchema.parse(args),
      )
      return ok(withLink(item, appUrl))
    },
  }),
  defineTool({
    ...action('update_content_item'),
    annotations: { ...writes, idempotentHint: true },
    run: async (args, { db, workspace, appUrl }) => {
      const item =
        (await content.updateContentItem(db, workspace.id, updateContentItemSchema.parse(args))) ??
        notFound('content item', args.id)
      return ok(withLink(item, appUrl))
    },
  }),
  defineTool({
    ...action('reschedule_content_item'),
    annotations: { ...writes, idempotentHint: true },
    run: async (args, { db, workspace, appUrl }) => {
      const data = rescheduleContentItemSchema.parse(args)
      const item =
        (await content.rescheduleContentItem(db, workspace.id, data.id, data.scheduledAt)) ??
        notFound('content item', data.id)
      return ok(withLink(item, appUrl))
    },
  }),
  defineTool({
    ...action('change_content_item_status'),
    annotations: { ...writes, idempotentHint: true },
    run: async (args, { db, workspace, appUrl }) => {
      const data = changeContentItemStatusSchema.parse(args)
      const item =
        (await content.changeContentItemStatus(db, workspace.id, data.id, data.status)) ??
        notFound('content item', data.id)
      return ok(withLink(item, appUrl))
    },
  }),
  defineTool({
    ...action('delete_content_item'),
    annotations: deletes,
    run: async ({ id: itemId }, { db, bucket, workspace }) => {
      if (!(await assets.deleteContentItemWithAssets(db, bucket, workspace.id, itemId))) {
        notFound('content item', itemId)
      }
      return ok({ deleted: itemId })
    },
  }),
  defineTool({
    name: 'upload_content_asset',
    title: 'Upload a media file to an item',
    description: `Attaches a file to a content item. Send the bytes as base64 (up to ${formatBytes(MAX_MCP_UPLOAD_BYTES)}; larger files must be uploaded in the app).`,
    inputSchema: z.object({
      itemId: z.uuid().describe('Content item id (UUID).'),
      filename: z.string().min(1).max(255).describe('File name, e.g. teaser.png.'),
      contentType: z
        .enum(Object.keys(MEDIA_TYPES) as [keyof typeof MEDIA_TYPES])
        .describe('MIME type. SVG is not allowed.'),
      dataBase64: z.string().min(1).describe('The file content, base64-encoded.'),
    }),
    annotations: writes,
    run: async (args, { db, bucket, user, workspace }) => {
      if (args.dataBase64.length > Math.ceil(MAX_MCP_UPLOAD_BYTES / 3) * 4 + 64) {
        throw new ToolError(`The file is larger than ${formatBytes(MAX_MCP_UPLOAD_BYTES)}.`)
      }
      const bytes = fromBase64(args.dataBase64)
      const asset = await assets.createContentAsset(db, bucket, {
        organizationId: workspace.id,
        contentItemId: args.itemId,
        createdById: user.id,
        file: {
          name: args.filename.split(/[/\\]/).pop()!.trim() || 'file',
          type: args.contentType,
          size: bytes.length,
        },
        body: bytes.slice().buffer,
      })
      return ok(asset ? describeAsset(asset) : notFound('content item', args.itemId))
    },
  }),
  defineTool({
    name: 'get_content_asset',
    title: 'Get a media file',
    description: `Metadata of an uploaded file. Images up to ${formatBytes(MAX_MCP_IMAGE_PREVIEW_BYTES)} are returned too, so you can look at them.`,
    inputSchema: z.object({ assetId: z.uuid().describe('Media file id.') }),
    annotations: readOnly,
    run: async ({ assetId }, { db, bucket, workspace }) => {
      const asset = (await assets.getContentAsset(db, workspace.id, assetId)) ?? notFound('media file', assetId)
      const result = ok(describeAsset(asset))
      if (assetKind(asset.contentType) !== 'image' || asset.size > MAX_MCP_IMAGE_PREVIEW_BYTES) {
        return result
      }
      const object = await bucket.get(assets.assetObjectKey(asset.contentItemId, asset.id))
      if (!object?.body) return result
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
      result.content.push({ type: 'image', data: toBase64(bytes), mimeType: asset.contentType })
      return result
    },
  }),
  defineTool({
    name: 'delete_content_asset',
    title: 'Delete a media file',
    description: 'Permanently deletes an uploaded file. Confirm with the user first.',
    inputSchema: z.object({ assetId: z.uuid().describe('Media file id.') }),
    annotations: deletes,
    run: async ({ assetId }, { db, bucket, workspace }) => {
      if (!(await assets.deleteContentAsset(db, bucket, workspace.id, assetId))) {
        notFound('media file', assetId)
      }
      return ok({ deleted: assetId })
    },
  }),
  defineTool({
    name: 'create_design',
    title: 'Create a design',
    description: `Creates an empty design (a Zora Studio document) for a content item. Size: a preset (${DESIGN_PRESETS.map((p) => `"${p.name}"`).join(', ')}), or width and height in pixels (1 to ${MAX_DESIGN_SIDE}); with neither, the preset of the item's channel. The design has no version until it is first saved: compose it with edit_design, or the person opens it in Studio (its url).`,
    inputSchema: z.object({
      itemId: z.uuid().describe('Content item id (UUID).'),
      name: z.string().min(1).max(200).optional().describe('Design name; defaults to the preset label.'),
      preset: z.enum(DESIGN_PRESET_NAMES).optional().describe('Artboard preset.'),
      width: z
        .number()
        .int()
        .min(1)
        .max(MAX_DESIGN_SIDE)
        .optional()
        .describe('Width in px (with height, instead of a preset).'),
      height: z.number().int().min(1).max(MAX_DESIGN_SIDE).optional().describe('Height in px.'),
    }),
    annotations: writes,
    run: async (args, { db, user, workspace, appUrl }) => {
      const design = await designs.createContentDesign(
        db,
        workspace.id,
        user.id,
        createContentDesignSchema.parse(args),
      )
      return ok(design ? describeDesign(design, appUrl) : notFound('content item', args.itemId))
    },
  }),
  defineTool({
    name: 'list_designs',
    title: 'List the designs of an item',
    description:
      'The designs of a content item, with their size and current version (null when never saved).',
    inputSchema: z.object({ itemId: z.uuid().describe('Content item id (UUID).') }),
    annotations: readOnly,
    run: async ({ itemId: id }, { db, workspace, appUrl }) => {
      if (!(await content.getContentItem(db, workspace.id, id))) notFound('content item', id)
      const list = await designs.listContentDesigns(db, workspace.id, id)
      return ok({ count: list.length, designs: list.map((d) => describeDesign(d, appUrl)) })
    },
  }),
  defineTool({
    name: 'get_design',
    title: 'Get a design',
    description: `A design's metadata. Its PNG preview (of the current version, or of versionId) is returned as an image when it is up to ${formatBytes(MAX_MCP_IMAGE_PREVIEW_BYTES)}, so you can look at it.`,
    inputSchema: z.object({
      designId: z.uuid().describe('Design id.'),
      versionId: z.uuid().optional().describe('A version to show instead of the current one.'),
    }),
    annotations: readOnly,
    run: async ({ designId, versionId }, { db, bucket, workspace, appUrl }) => {
      const design =
        (await designs.getContentDesign(db, workspace.id, designId)) ?? notFound('design', designId)
      const shownId = versionId ?? design.currentVersionId
      const version = shownId
        ? ((await designs.getDesignVersion(db, workspace.id, designId, shownId)) ??
          notFound('version of this design', shownId))
        : null
      const result = ok({ ...describeDesign(design, appUrl), shownVersion: version })
      if (!version || version.previewSize > MAX_MCP_IMAGE_PREVIEW_BYTES) return result
      const object = await bucket.get(designPreviewKey(design.id, version.id))
      if (!object?.body) return result
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
      result.content.push({ type: 'image', data: toBase64(bytes), mimeType: 'image/png' })
      return result
    },
  }),
  defineTool({
    name: 'list_design_versions',
    title: 'List the versions of a design',
    description:
      'Every saved version of a design, newest first, with who saved it (authorKind "user" in Studio, "agent" through tools).',
    inputSchema: z.object({ designId: z.uuid().describe('Design id.') }),
    annotations: readOnly,
    run: async ({ designId }, { db, workspace }) => {
      const versions =
        (await designs.listDesignVersions(db, workspace.id, designId)) ??
        notFound('design', designId)
      return ok({ count: versions.length, versions })
    },
  }),
  defineTool({
    name: 'restore_design_version',
    title: 'Restore a design version',
    description:
      'Makes an older version current again by copying it into a new version; the history is kept.',
    inputSchema: z.object({
      designId: z.uuid().describe('Design id.'),
      versionId: z.uuid().describe('The version to restore.'),
    }),
    annotations: writes,
    run: async ({ designId, versionId }, { db, bucket, user, workspace }) => {
      const saved =
        (await designs.restoreDesignVersion(db, bucket, {
          organizationId: workspace.id,
          designId,
          versionId,
          createdById: user.id,
          authorKind: 'agent',
        })) ?? notFound('design version', versionId)
      return ok(saved)
    },
  }),
  defineTool({
    name: 'publish_design',
    title: 'Use a design as media',
    description:
      "Copies the design's current PNG into its item's media files (named after the design). Do this once the user approved the design.",
    inputSchema: z.object({ designId: z.uuid().describe('Design id.') }),
    annotations: writes,
    run: async ({ designId }, { db, bucket, user, workspace }) => {
      const asset =
        (await designs.publishDesignPreview(db, bucket, workspace.id, user.id, designId)) ??
        notFound('design', designId)
      return ok(describeAsset(asset))
    },
  }),
  defineTool({
    name: 'search_stock_images',
    title: 'Search stock photos (Unsplash)',
    description: `Searches Unsplash for free stock photos, e.g. for a design's background. Returns compact results (id, description, size, thumbnail URL, photographer, Unsplash page) and up to ${MAX_SEARCH_PREVIEWS} thumbnails as images so you can look at them. Pass orientation, or a designId to match that design's shape. Then call add_stock_image with the chosen id. Prefer stock photos for real-world scenes and people; use generate_image for illustrations and brand scenes.`,
    inputSchema: z.object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('What to look for (English works best), e.g. "team meeting laptop".'),
      orientation: z
        .enum(images.UNSPLASH_ORIENTATIONS)
        .optional()
        .describe('landscape, portrait or squarish.'),
      designId: z
        .uuid()
        .optional()
        .describe('A design whose shape sets the orientation (when orientation is not given).'),
      page: z.number().int().min(1).max(50).default(1).describe('Result page, from 1.'),
      perPage: z.number().int().min(1).max(20).default(10).describe('Results per page (1 to 20).'),
      previews: z.boolean().default(true).describe('Return thumbnails as images (default true).'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (args, { db, workspace, images: config = {} }) => {
      let orientation = args.orientation
      if (!orientation && args.designId) {
        const design =
          (await designs.getContentDesign(db, workspace.id, args.designId)) ??
          notFound('design', args.designId)
        orientation = orientationOf(design.widthPx, design.heightPx)
      }
      const found = await images.searchUnsplashPhotos(config, {
        query: args.query,
        page: args.page,
        perPage: args.perPage,
        orientation,
      })
      const photos = found.photos.map(images.describeUnsplashPhoto)
      const result = ok({
        total: found.total,
        totalPages: found.totalPages,
        page: args.page,
        orientation: orientation ?? null,
        photos,
        credit: `Photos from Unsplash (${UNSPLASH_HOME_URL}). Credit the photographer when you use one.`,
      })
      if (!args.previews) return result
      let budget = MAX_SEARCH_PREVIEW_BYTES
      for (const photo of photos.slice(0, MAX_SEARCH_PREVIEWS)) {
        // The hotlinked `urls.thumb` as Unsplash returned it: shown, never stored.
        const thumbnail = await images
          .downloadProviderImage(config, photo.thumbnailUrl, {
            provider: 'Unsplash',
            isAllowedHost: images.isUnsplashImageHost,
            maxBytes: Math.min(MAX_SEARCH_THUMBNAIL_BYTES, budget),
          })
          .catch(() => null)
        if (!thumbnail) continue
        budget -= thumbnail.bytes.length
        result.content.push({ type: 'text', text: `Thumbnail of photo ${photo.id}:` })
        result.content.push({
          type: 'image',
          data: toBase64(thumbnail.bytes),
          mimeType: thumbnail.contentType,
        })
        if (budget <= 0) break
      }
      return result
    },
  }),
  defineTool({
    name: 'add_stock_image',
    title: 'Add a stock photo to an item',
    description: `Downloads an Unsplash photo (JPEG, longest side up to maxSide px) and stores it in the content item's media with its attribution; Unsplash is told the photo was used, as its guidelines require. Returns the media file (use its id in a design) and the credit line. When the post uses the photo, credit the photographer in the post text or caption, e.g. "Foto: <name> / Unsplash".`,
    inputSchema: z.object({
      itemId: z.uuid().describe('Content item id (UUID).'),
      photoId: images.unsplashPhotoIdSchema.describe('Unsplash photo id, from search_stock_images.'),
      maxSide: z
        .number()
        .int()
        .min(320)
        .max(MAX_STOCK_SIDE)
        .default(DEFAULT_STOCK_SIDE)
        .describe(`Longest side in px (320 to ${MAX_STOCK_SIDE}, default ${DEFAULT_STOCK_SIDE}).`),
    }),
    annotations: fetchesAndWrites,
    run: async (args, { db, bucket, user, workspace, images: config = {} }) => {
      if (!(await content.getContentItem(db, workspace.id, args.itemId))) {
        notFound('content item', args.itemId)
      }
      const photo = await images.getUnsplashPhoto(config, args.photoId)
      const file = await images.downloadProviderImage(
        config,
        images.unsplashFileUrl(photo, args.maxSide),
        { provider: 'Unsplash', isAllowedHost: images.isUnsplashImageHost },
      )
      const described = images.describeUnsplashPhoto(photo)
      const attribution: AssetAttribution = {
        provider: 'unsplash',
        photoId: photo.id,
        photographer: photo.user.name,
        photographerUrl: described.photographer.profileUrl,
        photoUrl: described.unsplashUrl,
      }
      const name = slug(photo.user.name) || slug(photo.user.username) || 'photo'
      const asset =
        (await assets.createContentAsset(db, bucket, {
          organizationId: workspace.id,
          contentItemId: args.itemId,
          createdById: user.id,
          file: {
            name: `unsplash-${name}-${photo.id}.${images.extensionFor(file.contentType)}`,
            type: file.contentType,
            size: file.bytes.length,
          },
          body: file.bytes.slice().buffer,
          attribution,
        })) ?? notFound('content item', args.itemId)
      // Stored: now it counts as a download for Unsplash.
      let downloadTracked = true
      try {
        await images.trackUnsplashDownload(config, photo)
      } catch (error) {
        downloadTracked = false
        console.warn(
          'Unsplash download tracking failed for photo',
          photo.id,
          error instanceof Error ? error.message : '',
        )
      }
      return ok({
        asset: describeAsset(asset),
        attribution: {
          ...attribution,
          unsplashUrl: UNSPLASH_HOME_URL,
          text: `Photo by ${photo.user.name} on Unsplash`,
          textPtBr: `Foto: ${photo.user.name} / Unsplash`,
        },
        downloadTracked,
      })
    },
  }),
  defineTool({
    name: 'generate_image',
    title: 'Generate an image (AI)',
    description: `Generates 1 to ${images.MAX_FAL_IMAGES} images from a text prompt with fal (${images.FAL_IMAGE_MODEL}) and stores each in the content item's media. Pass designId to take the aspect ratio from that design (or aspectRatio). Returns the media files (use their ids in a design) and the images, so you can look at them. Takes up to about ${Math.round(images.FAL_MAX_WAIT_MS / 1000)} s and costs money per image: generate what the user asked for, not speculative batches. Use it for illustrations and abstract or brand scenes; prefer search_stock_images for real-world photos. Describe the image in detail, and leave out text you will set in the design anyway.`,
    inputSchema: z.object({
      itemId: z.uuid().describe('Content item id (UUID).'),
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(4000)
        .describe('What the image shows: subject, setting, style, lighting, colours.'),
      designId: z
        .uuid()
        .optional()
        .describe('A design of this item whose shape sets the aspect ratio.'),
      aspectRatio: z
        .enum(images.FAL_ASPECT_RATIOS)
        .optional()
        .describe('Width:height; overrides the design. Default 1:1 without a design.'),
      resolution: z
        .enum(images.FAL_RESOLUTIONS)
        .optional()
        .describe(
          '1K (about 1024 px on the long side), 2K or 4K. Default: 2K for a design longer than 1200 px, else 1K.',
        ),
      count: z
        .number()
        .int()
        .min(1)
        .max(images.MAX_FAL_IMAGES)
        .default(1)
        .describe(`How many variants (1 to ${images.MAX_FAL_IMAGES}).`),
    }),
    annotations: fetchesAndWrites,
    run: async (args, { db, bucket, user, workspace, images: config = {} }) => {
      if (!(await content.getContentItem(db, workspace.id, args.itemId))) {
        notFound('content item', args.itemId)
      }
      let size: { width: number; height: number } | null = null
      if (args.designId) {
        const design =
          (await designs.getContentDesign(db, workspace.id, args.designId)) ??
          notFound('design', args.designId)
        if (design.contentItemId !== args.itemId) {
          throw new ToolError(`Design ${args.designId} belongs to another content item.`)
        }
        size = { width: design.widthPx, height: design.heightPx }
      }
      const aspectRatio =
        args.aspectRatio ?? (size ? images.nearestFalAspectRatio(size.width, size.height) : '1:1')
      const resolution =
        args.resolution ?? (size && Math.max(size.width, size.height) > 1200 ? '2K' : '1K')
      const generation = await images.generateFalImages(config, {
        prompt: args.prompt,
        aspectRatio,
        resolution,
        count: args.count,
      })

      const stored: Array<ReturnType<typeof describeAsset>> = []
      const failed: Array<string> = []
      const shown: CallToolResult['content'] = []
      let budget = MAX_MCP_IMAGE_PREVIEW_BYTES
      const base = slug(args.prompt).slice(0, 48).replace(/-+$/, '') || 'image'
      for (const [index, image] of generation.images.entries()) {
        try {
          const file = await images.downloadProviderImage(config, image.url, {
            provider: 'fal',
            isAllowedHost: images.isFalMediaHost,
          })
          const asset =
            (await assets.createContentAsset(db, bucket, {
              organizationId: workspace.id,
              contentItemId: args.itemId,
              createdById: user.id,
              file: {
                name: `${base}-${slug(generation.requestId).slice(0, 8)}-${index + 1}.${images.extensionFor(file.contentType)}`,
                type: file.contentType,
                size: file.bytes.length,
              },
              body: file.bytes.slice().buffer,
              attribution: { provider: 'fal', model: images.FAL_IMAGE_MODEL, prompt: args.prompt },
            })) ?? notFound('content item', args.itemId)
          stored.push(describeAsset(asset))
          if (file.bytes.length <= budget) {
            budget -= file.bytes.length
            shown.push({ type: 'text', text: `Media file ${asset.id}:` })
            shown.push({ type: 'image', data: toBase64(file.bytes), mimeType: file.contentType })
          }
        } catch (error) {
          if (
            !(error instanceof images.ImageProviderError || error instanceof assets.AssetUploadError)
          ) {
            throw error
          }
          failed.push(`Image ${index + 1}: ${error.message}`)
        }
      }
      if (stored.length === 0) throw new ToolError(`No image could be stored. ${failed.join(' ')}`)
      const result = ok({
        model: images.FAL_IMAGE_MODEL,
        requestId: generation.requestId,
        aspectRatio,
        resolution,
        description: generation.description,
        assets: stored,
        ...(failed.length > 0 ? { failed } : {}),
        ...(shown.length / 2 < stored.length
          ? { note: 'Some images were too large to show here; look at them with get_content_asset.' }
          : {}),
      })
      result.content.push(...shown)
      return result
    },
  }),
  defineTool({
    name: 'list_design_commands',
    title: 'List design engine commands',
    description: `The commands edit_design can run (Zora Studio's engine): id, label and parameters. Filter with query (e.g. "text", "image", "rectangle", "align"); at most ${MAX_COMMAND_LIST} are returned (default ${DEFAULT_COMMAND_LIST}), so search rather than list everything.`,
    inputSchema: z.object({
      query: z.string().trim().max(200).optional().describe('Words to look for in ids and labels.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_COMMAND_LIST)
        .default(DEFAULT_COMMAND_LIST)
        .describe(`How many to return (1 to ${MAX_COMMAND_LIST}).`),
    }),
    annotations: readOnly,
    run: async ({ query, limit }, { engine: transport }) => {
      const found = await engine.listEngineCommands(requireEngine(transport), query)
      const shown = found.slice(0, limit).map((command) => ({
        id: command.id,
        label: command.label,
        params: bounded(command.params, MAX_COMMAND_PARAMS_CHARS),
      }))
      return ok({
        total: found.length,
        shown: shown.length,
        ...(found.length > shown.length
          ? { note: 'More commands match: narrow the query or raise limit.' }
          : {}),
        commands: shown,
      })
    },
  }),
  defineTool({
    name: 'list_design_fonts',
    title: 'List design fonts',
    description:
      "The font families of Zora's font library for designs (open-source Google Fonts), with category, styles and variable axes. Use these family names in text commands, and offer the person a few that fit when they choose a font.",
    inputSchema: z.object({
      category: z
        .string()
        .trim()
        .max(40)
        .optional()
        .describe('Only this category: SANS_SERIF, SERIF, DISPLAY, HANDWRITING or MONOSPACE.'),
    }),
    annotations: readOnly,
    run: async ({ category }, { bucket }) => {
      const builtIn =
        "Zora Studio's built-in fonts can be used too (they ship with Studio and the engine); this library is what Zora adds."
      const manifest = await readFontManifest(bucket)
      if (!manifest) {
        return ok({
          count: 0,
          families: [],
          note: `The font library has not been published to this server yet (pnpm fonts:sync). ${builtIn}`,
        })
      }
      const wanted = category?.toUpperCase()
      const families = manifest.families
        .filter((family) => !wanted || family.category.toUpperCase() === wanted)
        .map((family) => ({
          family: family.family,
          category: family.category,
          styles: [...new Set(family.files.map((file) => file.style))],
          ...(family.axes.length > 0
            ? { axes: family.axes.map((axis) => `${axis.tag} ${axis.min}-${axis.max}`) }
            : {}),
        }))
      return ok({ count: families.length, families, note: builtIn })
    },
  }),
  defineTool({
    name: 'edit_design',
    title: 'Edit a design',
    description: `Runs commands (up to ${engine.MAX_ENGINE_COMMANDS}, in order; find them with list_design_commands) with Zora Studio's engine on the design's current version, or on a blank artboard of the design's size when it has no version yet, and saves the result as a new version. Returns the version number, each command's result and the rendered PNG, so you can look at it. Images: map names to media file ids of this workspace (images: {"bg": "<assetId>"}) and pass "${engine.ENGINE_IMAGE_PREFIX}bg" in a command's params; at most ${engine.MAX_ENGINE_IMAGES} images, ${formatBytes(engine.MAX_ENGINE_IMAGE_BYTES)} each. If a command fails nothing is saved and the error names it. Pass baseVersionId (the version you last looked at) so an edit the person made meanwhile in Studio is never overwritten.`,
    inputSchema: z.object({
      designId: z.uuid().describe('Design id.'),
      baseVersionId: z
        .uuid()
        .optional()
        .describe('The version your commands were written for; refused if it is no longer current.'),
      commands: z
        .array(engineCommandSchema)
        .min(1)
        .max(engine.MAX_ENGINE_COMMANDS)
        .describe('Commands to run, in order.'),
      images: z
        .record(
          z.string().regex(engine.ENGINE_IMAGE_NAME, 'Use 1 to 64 letters, digits, "_" or "-".'),
          z.uuid(),
        )
        .optional()
        .describe('Images the commands use: name -> media file id (get_content_item lists them).'),
    }),
    annotations: writes,
    run: async (args, deps) => {
      const transport = requireEngine(deps.engine)
      const design =
        (await designs.getContentDesign(deps.db, deps.workspace.id, args.designId)) ??
        notFound('design', args.designId)
      const conflict = (currentId: string | null, currentNumber: number | null) =>
        new ToolError(
          `The design changed since the version you based this edit on: the current version is number ${currentNumber ?? '(none)'} (id ${currentId ?? 'none'}), probably saved by the person in Studio. Nothing was saved. Look at it again (get_design or inspect_design), then redo your edit on top of it with that baseVersionId.`,
        )
      if (args.baseVersionId && args.baseVersionId !== design.currentVersionId) {
        throw conflict(design.currentVersionId, design.currentVersionNumber)
      }
      const baseVersionId = design.currentVersionId
      const source = baseVersionId
        ? await readVersionSource(deps, design.id, baseVersionId)
        : undefined
      const placed = await readEditImages(deps, args.images ?? {})

      let result: EngineRunResult
      try {
        result = await engine.runEngine(transport, {
          ...(source
            ? { source }
            : { new: { width: design.widthPx, height: design.heightPx, name: design.name } }),
          images: placed,
          commands: args.commands,
          render: { scale: 1, maxSize: RENDER_MAX_SIZE },
        })
      } catch (error) {
        if (error instanceof engine.StudioEngineCommandError) {
          const failed = error.index !== null ? args.commands[error.index] : undefined
          const which =
            error.index !== null
              ? `Command ${error.index}${failed ? ` ("${failed.command}")` : ''} failed`
              : 'A command failed'
          throw new ToolError(
            `${which}: ${error.engineMessage} Nothing was saved; fix that command and send the whole edit again.`,
          )
        }
        throw error
      }
      if (!result.source || !result.preview) {
        throw new ToolError('The design engine returned no document or no preview; nothing was saved.')
      }

      let saved: designs.SavedDesignVersion | null
      try {
        saved = await designs.saveDesignVersion(deps.db, deps.bucket, {
          organizationId: deps.workspace.id,
          designId: design.id,
          createdById: deps.user.id,
          authorKind: 'agent',
          baseVersionId,
          source: asDesignFile(result.source),
          preview: asDesignFile(result.preview),
        })
      } catch (error) {
        if (error instanceof designs.DesignConflictError) {
          throw conflict(error.currentVersionId, error.currentVersionNumber)
        }
        if (error instanceof designs.DesignFileError) {
          throw new ToolError(`The design engine's output could not be stored: ${error.message}`)
        }
        throw error
      }
      if (!saved) notFound('design', design.id)
      const answer = ok({
        designId: design.id,
        versionId: saved.versionId,
        number: saved.number,
        baseVersionId,
        results: bounded(result.results, MAX_ENGINE_TEXT_CHARS),
        previewSize: result.preview.length,
        url: describeDesign(design, deps.appUrl).url,
      })
      answer.content.push(...pngContent(result.preview))
      return answer
    },
  }),
  defineTool({
    name: 'render_design',
    title: 'Render a design',
    description:
      'The PNG of a design version (the current one by default) as an image you can look at. Without scale it is the stored preview (the first artboard at 1x); with scale the engine renders it again at that scale (e.g. 0.5 for a smaller image). Nothing is saved.',
    inputSchema: z.object({
      designId: z.uuid().describe('Design id.'),
      versionId: z.uuid().optional().describe('A version other than the current one.'),
      scale: z
        .number()
        .min(0.05)
        .max(4)
        .optional()
        .describe('Render at this scale (0.05 to 4) instead of returning the stored preview.'),
    }),
    annotations: readOnly,
    run: async ({ designId, versionId, scale }, deps) => {
      const { design, version } = await designAndVersion(deps, designId, versionId)
      const meta = { designId: design.id, versionId: version.id, number: version.number }
      if (scale === undefined) {
        const png = await readBytes(deps.bucket, designPreviewKey(design.id, version.id))
        if (!png) throw new ToolError(`The preview of version ${version.id} was not found.`)
        const answer = ok({ ...meta, size: png.length })
        answer.content.push(...pngContent(png))
        return answer
      }
      const transport = requireEngine(deps.engine)
      const source = await readVersionSource(deps, design.id, version.id)
      const rendered = await engine.runEngine(transport, {
        source,
        commands: [],
        render: { scale, maxSize: RENDER_MAX_SIZE },
      })
      if (!rendered.preview) throw new ToolError('The design engine returned no image.')
      const answer = ok({ ...meta, scale, size: rendered.preview.length })
      answer.content.push(...pngContent(rendered.preview))
      return answer
    },
  }),
  defineTool({
    name: 'inspect_design',
    title: 'Inspect a design',
    description:
      "The structure of a design version (the current one by default) as Zora Studio's engine sees it: artboards, layers, text, images and their properties. Use it to find what to change before edit_design.",
    inputSchema: z.object({
      designId: z.uuid().describe('Design id.'),
      versionId: z.uuid().optional().describe('A version other than the current one.'),
    }),
    annotations: readOnly,
    run: async ({ designId, versionId }, deps) => {
      const transport = requireEngine(deps.engine)
      const { design, version } = await designAndVersion(deps, designId, versionId)
      const source = await readVersionSource(deps, design.id, version.id)
      const result = await engine.runEngine(transport, { source, commands: [], inspect: true })
      if (result.inspect === undefined) throw new ToolError('The design engine returned no structure.')
      return ok({
        designId: design.id,
        versionId: version.id,
        number: version.number,
        structure: bounded(result.inspect, MAX_ENGINE_TEXT_CHARS),
      })
    },
  }),
  defineTool({
    name: 'list_social_connections',
    title: 'List social connections',
    description:
      'Lists the social media accounts connected to this workspace (Instagram, TikTok, YouTube, LinkedIn, X), their status and any channel caveats. Use this before publish_content_item.',
    inputSchema: z.object({}),
    annotations: readOnly,
    run: async (_args, { db, workspace, appUrl, treg }) => {
      const connections = await socialConnections.listWorkspaceConnections(db, workspace.id)
      const base = appUrl.replace(/\/+$/, '')
      return ok({
        configured: Boolean(treg),
        connectionsUrl: `${base}/connections`,
        count: connections.length,
        connections: connections.map((conn) => ({
          channel: conn.channel,
          status: conn.status,
          accountName: conn.accountName,
          accountId: conn.accountId,
          caveat: SOCIAL_CHANNEL_INFO[conn.channel].caveat,
          lastError: conn.accountMeta.lastError ?? null,
        })),
      })
    },
  }),
  defineTool({
    name: 'publish_content_item',
    title: 'Publish a content item to social media',
    description:
      'Publishes an existing content item immediately to its connected social account (Instagram, TikTok, YouTube, LinkedIn or X). Always ask the user for confirmation before calling this tool. Fast posts complete right away and mark the item published; video uploads (Reels, TikTok, LinkedIn video) return status "processing" and can be tracked with get_publish_status.',
    inputSchema: z.object({
      id: z.uuid().describe('Content item id (UUID).'),
      options: socialPublishOptionsSchema
        .optional()
        .describe(
          'Optional per-channel overrides: tiktok ({ mode: "direct" | "inbox", privacyLevel, disableComment, disableDuet, disableStitch, isAigc }), youtube ({ privacyStatus: "public" | "unlisted" | "private", selfDeclaredMadeForKids, thumbnailAssetId, notifySubscribers }), linkedin ({ visibility: "PUBLIC" | "CONNECTIONS" }).',
        ),
    }),
    annotations: publishes,
    run: async ({ id, options }, { db, bucket, user, workspace, appUrl, treg }) => {
      const outcome = await socialPublish.publishContentItemNow(
        { db, bucket, treg: treg ?? null },
        {
          organizationId: workspace.id,
          itemId: id,
          userId: user.id,
          trigger: 'mcp',
          options,
        },
      )
      if (!outcome) notFound('content item', id)
      if (outcome.job.status === 'failed') {
        return fail(outcome.job.errorMessage ?? 'A publicação falhou na rede social.')
      }
      return ok({
        job: {
          id: outcome.job.id,
          status: outcome.job.status,
          stage: outcome.job.stage,
          channel: outcome.job.channel,
          remotePostId: outcome.job.remotePostId,
          publishedUrl: outcome.job.publishedUrl,
          note: outcome.job.providerState.note ?? null,
        },
        ...(outcome.item ? { item: withLink(outcome.item, appUrl) } : {}),
      })
    },
  }),
  defineTool({
    name: 'get_publish_status',
    title: 'Get publish status of a content item',
    description:
      'Returns the social publishing jobs of a content item and polls any in-flight video job (Instagram Reels, TikTok, LinkedIn video/PDF) so it can advance to "published" or "failed".',
    inputSchema: z.object({
      id: z.uuid().describe('Content item id (UUID).'),
      jobId: z.uuid().optional().describe('Optional specific publish job id to poll.'),
    }),
    annotations: fetchesAndWrites,
    run: async ({ id, jobId }, { db, bucket, workspace, appUrl, treg }) => {
      const existing = await content.getContentItem(db, workspace.id, id)
      if (!existing) notFound('content item', id)

      let jobs = await socialPublish.listItemPublishJobs(db, workspace.id, id)
      const target = jobId
        ? jobs.find((job) => job.id === jobId)
        : jobs.find((job) => job.status === 'processing')

      let updatedItem: ContentItem | null = null
      if (target && target.status === 'processing' && treg) {
        const polled = await socialPublish.pollPublishJob(
          { db, bucket, treg },
          workspace.id,
          target.id,
        )
        if (polled?.item) updatedItem = polled.item
        jobs = await socialPublish.listItemPublishJobs(db, workspace.id, id)
      }

      return ok({
        item: withLink(updatedItem ?? existing, appUrl),
        jobs: jobs.map((job) => ({
          id: job.id,
          status: job.status,
          stage: job.stage,
          channel: job.channel,
          trigger: job.trigger,
          remotePostId: job.remotePostId,
          publishedUrl: job.publishedUrl,
          errorMessage: job.errorMessage,
          note: job.providerState.note ?? null,
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
        })),
      })
    },
  }),
]

/** Runs a tool, turning rule violations into errors the agent can read. */
export async function runZoraTool(
  tool: ToolDefinition<z.ZodObject>,
  args: unknown,
  deps: McpDeps,
): Promise<CallToolResult> {
  try {
    return await tool.run(tool.inputSchema.parse(args), deps)
  } catch (error) {
    if (
      error instanceof ToolError ||
      error instanceof content.ContentRuleError ||
      error instanceof assets.AssetUploadError ||
      error instanceof designs.DesignRuleError ||
      error instanceof designs.DesignConflictError ||
      error instanceof designs.DesignFileError ||
      error instanceof images.ImageProviderError ||
      error instanceof engine.StudioEngineError ||
      error instanceof SocialPublishingError
    ) {
      return fail(error.message)
    }
    if (error instanceof z.ZodError) return fail(z.prettifyError(error))
    throw error
  }
}
/** A fresh MCP server for one request, acting for `deps.user`. */
export function createZoraMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: 'zora', title: 'Zora', version: '1.0.0' },
    { instructions: AGENT_INSTRUCTIONS },
  )
  for (const tool of zoraTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (args) => runZoraTool(tool, args, deps),
    )
  }
  return server
}

/** The stateless Streamable HTTP handler for one authorized request. */
export function createZoraMcpHandler(deps: McpDeps) {
  return createMcpHandler(() => createZoraMcpServer(deps), {
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  })
}
