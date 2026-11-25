import { z } from 'zod'

/*
 * How each agent connects to Zora's MCP server, for the `/connect` page.
 * Checked against each vendor's docs (November 2026); these flows change,
 * so re-check them when you edit this file:
 * - Claude Code: https://code.claude.com/docs/en/mcp
 * - Codex: https://developers.openai.com/codex/mcp
 * - Claude apps: https://support.claude.com/en/articles/11175166
 * - ChatGPT: https://developers.openai.com/api/docs/guides/custom-mcp-server
 */

export const AGENT_IDS = ['claude', 'chatgpt', 'claude-code', 'codex'] as const
export type AgentId = (typeof AGENT_IDS)[number]

/** `?agent=` on `/connect`; anything else falls back to Claude. */
export const connectSearchSchema = z.object({
  agent: z.enum(AGENT_IDS).optional().catch(undefined),
})

export type AgentGuide = {
  id: AgentId
  name: string
  /** Where it runs, shown under the name. */
  surface: string
  /** Terminal commands, copied together (one per line). */
  command?: string
  steps: Array<string>
  /** Where to start in the app, for app-based agents. */
  link?: { href: string; label: string }
}

/** The step every flow ends with: Zora's own sign-in and consent page. */
const APPROVE = 'Entre no Zora (se pedir) e clique em Permitir.'

export function agentGuides(serverUrl: string): Array<AgentGuide> {
  return [
    {
      id: 'claude',
      name: 'Claude',
      surface: 'claude.ai, app para desktop e celular',
      link: { href: 'https://claude.ai/customize/connectors', label: 'Abrir Conectores no Claude' },
      steps: [
        'Abra Personalizar → Conectores.',
        'Adicione um conector personalizado com o nome Zora e a URL do servidor acima. Clique em Continuar.',
        'Clique em Conectar. ' + APPROVE,
      ],
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      surface: 'chatgpt.com e apps',
      link: { href: 'https://chatgpt.com/plugins', label: 'Abrir Plugins no ChatGPT' },
      steps: [
        'Abra Plugins, clique em + e escolha Adicionar servidor MCP personalizado.',
        'Nome: Zora. Em URL do servidor, cole a URL acima; a autenticação é OAuth.',
        'Leia o aviso, confirme e clique em Criar como plugin.',
        APPROVE,
      ],
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      surface: 'terminal',
      command: [
        `claude mcp add --transport http zora ${serverUrl}`,
        'claude mcp login zora',
      ].join('\n'),
      steps: ['Cole os comandos no terminal.', 'O navegador abre. ' + APPROVE],
    },
    {
      id: 'codex',
      name: 'Codex',
      surface: 'terminal, editor e app para desktop',
      command: [`codex mcp add zora --url ${serverUrl}`, 'codex mcp login zora'].join('\n'),
      steps: ['Cole os comandos no terminal.', 'O navegador abre. ' + APPROVE],
    },
  ]
}

/** What to ask once connected, shown at the end of the page. */
export const EXAMPLE_PROMPTS = [
  'Quais posts estão agendados para esta semana no Zora?',
  'Crie um rascunho de thread no X sobre a novidade de sexta às 10h.',
  'Crie um design 1080×1080 para o post do Instagram de amanhã e me mostre a prévia.',
  'Mova os posts prontos do LinkedIn para agendado e atribua a mim.',
] as const
