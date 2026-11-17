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
import { MEDIA_TYPES, assetKind, formatBytes } from './content-assets'
import type { ContentAsset } from './content-assets'
import * as assets from './content-assets.server'
import type { MediaBucket } from './content-assets.server'
import * as content from './content.server'
import type { Workspace } from './workspace'

/** Uploads through MCP arrive as base64 in the JSON-RPC body. */
export const MAX_MCP_UPLOAD_BYTES = 10 * 1024 * 1024
/** Images up to this size are returned inline so the agent can look at them. */
export const MAX_MCP_IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024
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
const deletes: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
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
      error instanceof assets.AssetUploadError
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
