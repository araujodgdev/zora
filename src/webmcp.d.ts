// WebMCP (Chrome origin trial, or chrome://flags/#enable-webmcp-testing):
// the part of `document.modelContext` the app uses. See
// https://developer.chrome.com/docs/ai/webmcp/imperative-api
interface ModelContextToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
  consequentialHint?: boolean
}

interface ModelContextTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: ModelContextToolAnnotations
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<unknown>
}

interface ModelContext extends EventTarget {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ): Promise<void>
}

interface Document {
  /** Present only in browsers with WebMCP. */
  readonly modelContext?: ModelContext
}
