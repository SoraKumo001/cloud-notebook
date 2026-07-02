// packages/backend/src/mcp.ts
// MCP (Model Context Protocol) server — exposes notebook data & RAG chat to
// external AI agents (Claude Desktop, Cursor, etc.).
//
// Transport: WebStandard Streamable HTTP (stateless, JSON response mode).
// This is the official MCP HTTP transport; we run it without session
// management because each Workers request is short-lived and isolation-safe.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { mcpAuthMiddleware } from './mcp-auth'
import { registerTools } from './mcp-tools'

// ---------------------------------------------------------------------------
// Types (mirror index.ts Bindings + Variables)
// ---------------------------------------------------------------------------

type Bindings = {
  DB: D1Database
  VECTORIZE: VectorizeIndex
  AI: Ai
  NODE_ENV?: string
  CF_ENV?: string
}

type Variables = {
  user: { id: string; email: string; name?: string }
  notebook: { id: string; userId: string; title: string }
}

// ---------------------------------------------------------------------------
// MCP Hono app (mounted at /mcp in index.ts)
// ---------------------------------------------------------------------------

const mcpApp = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CORS — open for MCP clients (desktop apps)
mcpApp.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version', 'MCP-Session-Id'],
    exposeHeaders: ['MCP-Session-Id'],
  }),
)

// Bearer-token auth
mcpApp.use('*', mcpAuthMiddleware)

// All methods → MCP handler.
//
// Each request gets a fresh McpServer + transport because Workers isolate
// state can be reused across requests but per-request state (the registered
// tool callbacks close over the request-scoped `env` and `notebook`) must not
// leak between callers. The transport's stateless mode (no sessionIdGenerator)
// plus enableJsonResponse avoids the per-session SSE-stream bookkeeping.
mcpApp.all('*', async (c) => {
  const notebook = c.get('notebook')

  const server = new McpServer({ name: 'cloud-notebook', version: '1.0.0' })
  registerTools(server, c.env, notebook)

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)

  try {
    return await transport.handleRequest(c.req.raw)
  } finally {
    await transport.close()
    await server.close()
  }
})

export { mcpApp }
