import { describe, expect, it } from 'vitest'
import { AGENT_IDS, agentGuides, connectSearchSchema } from './agent-connect'

const url = 'https://zora.example.com/mcp'

describe('agentGuides', () => {
  it('has one guide per agent, in the order of AGENT_IDS', () => {
    expect(agentGuides(url).map((guide) => guide.id)).toEqual([...AGENT_IDS])
  })

  it('puts the server URL in the terminal commands', () => {
    const byId = Object.fromEntries(agentGuides(url).map((guide) => [guide.id, guide]))
    expect(byId['claude-code']?.command).toBe(
      `claude mcp add --transport http zora ${url}\nclaude mcp login zora`,
    )
    expect(byId.codex?.command).toBe(`codex mcp add zora --url ${url}\ncodex mcp login zora`)
  })

  it('gives every guide steps, and app guides a link instead of a command', () => {
    for (const guide of agentGuides(url)) {
      expect(guide.steps.length).toBeGreaterThan(0)
      expect(Boolean(guide.command) || Boolean(guide.link)).toBe(true)
    }
  })
})

describe('connectSearchSchema', () => {
  it('keeps a known agent and drops anything else', () => {
    expect(connectSearchSchema.parse({ agent: 'codex' })).toEqual({ agent: 'codex' })
    expect(connectSearchSchema.parse({ agent: 'gemini' })).toEqual({ agent: undefined })
    expect(connectSearchSchema.parse({})).toEqual({})
  })
})
