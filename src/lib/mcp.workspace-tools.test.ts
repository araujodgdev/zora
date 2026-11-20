import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, createTestDb, resetDatabase, seedWorkspace } from '../../test/db'
import { member, organization, session, user } from '../db/schema'
import type { MediaBucket } from './content-assets.server'
import { runZoraTool, zoraTools } from './mcp.server'
import type { McpDeps } from './mcp.server'
import type { Workspace } from './workspace'
import { resolveMcpWorkspace, setMcpActiveWorkspace } from './workspace.server'

const db = await createTestDb()
afterAll(() => closeTestDb(db))

const ana = { id: 'u-ana', name: 'Ana', email: 'ana@example.com' }
const bob = { id: 'u-bob', name: 'Bob', email: 'bob@example.com' }
const emptyBucket: MediaBucket = {
  put: async () => ({}),
  get: async () => null,
  delete: async () => {},
}

beforeEach(async () => {
  await resetDatabase(db)
  await db.insert(user).values([
    { ...ana, emailVerified: true },
    { ...bob, emailVerified: true },
  ])
})

function makeDeps(
  who: typeof ana,
  workspace: Workspace | null,
): McpDeps {
  return {
    db,
    bucket: emptyBucket,
    user: who,
    workspace,
    appUrl: 'https://zora.test',
  }
}

async function call(deps: McpDeps, name: string, args: unknown = {}) {
  const tool = zoraTools.find((t) => t.name === name)!
  const result = await runZoraTool(tool, args, deps)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  return { result, text, data: result.isError ? null : JSON.parse(text) }
}

describe('resolveMcpWorkspace', () => {
  it('returns null when the user belongs to no workspace', async () => {
    expect(await resolveMcpWorkspace(db, ana.id)).toBeNull()
  })

  it('prefers mcp_workspace_state over the latest browser session and falls back if membership is removed', async () => {
    await seedWorkspace(db, 'ws-a', [ana.id], 'Alpha')
    await seedWorkspace(db, 'ws-b', [ana.id], 'Beta')
    await db.insert(session).values({
      id: 'sess-1',
      token: 'tok-1',
      userId: ana.id,
      activeOrganizationId: 'ws-a',
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Without an MCP choice, follows the browser session.
    expect((await resolveMcpWorkspace(db, ana.id))?.id).toBe('ws-a')

    // After switching via MCP, remembers Beta even though browser session is still on Alpha.
    await setMcpActiveWorkspace(db, ana.id, 'ws-b')
    expect((await resolveMcpWorkspace(db, ana.id))?.id).toBe('ws-b')

    // If Ana leaves Beta, falls back to the browser session (Alpha).
    await db.delete(member).where(eq(member.id, 'ws-b-u-ana'))
    expect((await resolveMcpWorkspace(db, ana.id))?.id).toBe('ws-a')
  })
})

describe('MCP workspace tools', () => {
  it('lists and switches workspaces by id or slug, isolating content per workspace', async () => {
    await seedWorkspace(db, 'ws-a-signum', [ana.id], 'Signum')
    await seedWorkspace(db, 'ws-b-lume', [ana.id], 'Lume')
    await db
      .update(organization)
      .set({ slug: 'lume-studio' })
      .where(eq(organization.id, 'ws-b-lume'))
    await seedWorkspace(db, 'ws-secret', [bob.id], 'Secret')

    const initial = await resolveMcpWorkspace(db, ana.id)
    const deps = makeDeps(ana, initial)

    const listed = await call(deps, 'list_workspaces')
    expect(listed.data.count).toBe(2)
    expect(listed.data.activeWorkspaceId).toBe('ws-a-signum')
    expect(listed.data.workspaces).toEqual([
      { id: 'ws-a-signum', name: 'Signum', slug: 'ws-a-signum', role: 'owner', active: true },
      { id: 'ws-b-lume', name: 'Lume', slug: 'lume-studio', role: 'owner', active: false },
    ])

    // Create a post in Signum.
    await call(deps, 'create_content_item', {
      title: 'Post Signum',
      channel: 'x',
      format: 'post',
    })

    // Switch to Lume by slug; persisted across fresh resolveMcpWorkspace calls.
    const switched = await call(deps, 'switch_workspace', { workspaceId: 'lume-studio' })
    expect(switched.data.workspace).toMatchObject({ id: 'ws-b-lume', name: 'Lume', slug: 'lume-studio' })
    expect(deps.workspace?.id).toBe('ws-b-lume')
    expect((await resolveMcpWorkspace(db, ana.id))?.id).toBe('ws-b-lume')

    // Lume has 0 content items; Signum's post stays isolated.
    const lumeItems = await call(deps, 'list_content_items')
    expect(lumeItems.data.count).toBe(0)

    // Switch back to Signum by id and see the original post again.
    const back = await call(deps, 'switch_workspace', { workspaceId: 'ws-a-signum' })
    expect(back.data.workspace.id).toBe('ws-a-signum')
    const signumItems = await call(deps, 'list_content_items')
    expect(signumItems.data.count).toBe(1)

    // Cannot switch to a workspace Ana is not a member of.
    const forbidden = await call(deps, 'switch_workspace', { workspaceId: 'ws-secret' })
    expect(forbidden.result.isError).toBe(true)
    expect(forbidden.text).toMatch(/não encontrado|não faz parte/i)
    expect((await resolveMcpWorkspace(db, ana.id))?.id).toBe('ws-a-signum')
  })

  it('allows creating a first workspace when starting with workspace = null and blocks workspace tools until one is active', async () => {
    const deps = makeDeps(ana, null)

    const who = await call(deps, 'get_current_user')
    expect(who.data).toEqual({ ...ana, workspace: null })

    const blocked = await call(deps, 'list_content_items')
    expect(blocked.result.isError).toBe(true)
    expect(blocked.text).toContain('No active workspace')

    const created = await call(deps, 'create_workspace', { name: 'Nova Marca' })
    expect(created.data.active).toBe(true)
    expect(created.data.workspace).toMatchObject({ name: 'Nova Marca', role: 'owner' })
    expect(created.data.workspace.slug).toMatch(/^nova-marca-[a-f0-9]{6}$/)
    expect(deps.workspace?.id).toBe(created.data.workspace.id)
    expect((await resolveMcpWorkspace(db, ana.id))?.id).toBe(created.data.workspace.id)

    // Creating another workspace with switchTo = false keeps the current active workspace.
    const second = await call(deps, 'create_workspace', {
      name: 'Projeto Secundário',
      switchTo: false,
    })
    expect(second.data.active).toBe(false)
    expect((await resolveMcpWorkspace(db, ana.id))?.id).toBe(created.data.workspace.id)

    // Content creation now succeeds in the active workspace.
    const post = await call(deps, 'create_content_item', {
      title: 'Primeiro post',
      channel: 'x',
      format: 'post',
    })
    expect(post.result.isError).toBeUndefined()
    expect(post.data.title).toBe('Primeiro post')
  })

  it('renames workspaces for owners and admins and refuses regular members', async () => {
    await seedWorkspace(db, 'ws-a', [ana.id, bob.id], 'Original A')
    await seedWorkspace(db, 'ws-b', [ana.id], 'Original B')

    const anaDeps = makeDeps(ana, await resolveMcpWorkspace(db, ana.id))

    // Rename active workspace (no workspaceId passed).
    const renamedA = await call(anaDeps, 'rename_workspace', { name: 'Marca A' })
    expect(renamedA.data.workspace).toMatchObject({
      id: 'ws-a',
      name: 'Marca A',
      slug: 'ws-a',
    })
    expect(anaDeps.workspace?.name).toBe('Marca A')

    // Rename a non-active workspace by id.
    const renamedB = await call(anaDeps, 'rename_workspace', {
      workspaceId: 'ws-b',
      name: 'Marca B',
    })
    expect(renamedB.data.workspace).toMatchObject({ id: 'ws-b', name: 'Marca B' })
    const [rowB] = await db.select().from(organization).where(eq(organization.id, 'ws-b'))
    expect(rowB?.name).toBe('Marca B')
    expect(rowB?.slug).toBe('ws-b')

    // Bob is a regular member of ws-a and cannot rename it.
    const bobDeps = makeDeps(bob, await resolveMcpWorkspace(db, bob.id))
    const denied = await call(bobDeps, 'rename_workspace', { name: 'Tentativa' })
    expect(denied.result.isError).toBe(true)
    expect(denied.text).toMatch(/Só donos e admins/)

    // Promote Bob to admin: now he can rename.
    await db
      .update(member)
      .set({ role: 'admin' })
      .where(eq(member.id, 'ws-a-u-bob'))
    const bobAdminDeps = makeDeps(bob, await resolveMcpWorkspace(db, bob.id))
    const allowed = await call(bobAdminDeps, 'rename_workspace', { name: 'Marca A v2' })
    expect(allowed.data.workspace).toMatchObject({ id: 'ws-a', name: 'Marca A v2', role: 'admin' })
  })
})
