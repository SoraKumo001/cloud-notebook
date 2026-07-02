// packages/backend/src/mcp.test.ts
// Tests for MCP auth middleware, token management, and tools.
// - MCP auth middleware uses Bearer token (not Cookie).
// - /api/notebooks/:id/mcp-token routes use Cookie auth (under authMiddleware).

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { notebooks } from './db/schema'
import app from './index'
import { authedRequest, createAuthedRequest } from './test/auth-helper'
import { createTestEnv } from './test/d1-adapter'

// ---------------------------------------------------------------------------
// MCP auth middleware
// ---------------------------------------------------------------------------

describe('MCP auth middleware', () => {
  async function seedEnvWithToken(token: string | null, notebookId = 'nb-1') {
    const testEnv = createTestEnv()
    const { userId } = await createAuthedRequest(testEnv.env)
    await testEnv.db.insert(notebooks).values({
      id: notebookId,
      userId,
      title: 'Test',
      description: '',
      mcpToken: token,
    })
    return { env: testEnv.env, userId }
  }

  it('returns 401 when Authorization header is missing', async () => {
    const { env } = await seedEnvWithToken('valid-token')
    const res = await app.fetch(new Request('http://localhost/mcp'), env)
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const { env } = await seedEnvWithToken('valid-token')
    const res = await app.fetch(
      new Request('http://localhost/mcp', { headers: { Authorization: 'Basic xxx' } }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when token is invalid', async () => {
    // Notebook exists but with a different token
    const { env } = await seedEnvWithToken('valid-token')
    const res = await app.fetch(
      new Request('http://localhost/mcp', { headers: { Authorization: 'Bearer invalid-token' } }),
      env,
    )
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /api/notebooks/:id/mcp-token
// ---------------------------------------------------------------------------

describe('POST /api/notebooks/:id/mcp-token', () => {
  async function seedNotebook(notebookId = 'nb-1') {
    const testEnv = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(testEnv.env)
    await testEnv.db.insert(notebooks).values({
      id: notebookId,
      userId,
      title: 'Test',
      description: '',
    })
    return { ...testEnv, cookie, userId }
  }

  it('generates and returns a new token', async () => {
    const { env, cookie } = await seedNotebook()

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie, { method: 'POST' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('token')
    expect(typeof body.token).toBe('string')
    expect((body.token as string).length).toBeGreaterThan(0)
  })

  it('returns 404 when notebook does not exist', async () => {
    const { env, cookie } = await seedNotebook('nb-other')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nonexistent/mcp-token', cookie, {
        method: 'POST',
      }),
      env,
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /api/notebooks/:id/mcp-token
// ---------------------------------------------------------------------------

describe('GET /api/notebooks/:id/mcp-token', () => {
  async function seedNotebook(notebookId = 'nb-1') {
    const testEnv = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(testEnv.env)
    await testEnv.db.insert(notebooks).values({
      id: notebookId,
      userId,
      title: 'Test',
      description: '',
    })
    return { ...testEnv, cookie, userId }
  }

  it('returns has_token=false when no token exists', async () => {
    const { env, cookie } = await seedNotebook()

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { has_token: boolean }
    expect(body.has_token).toBe(false)
  })

  it('returns has_token=true after a token is generated', async () => {
    const { env, cookie } = await seedNotebook()

    // First create a token via POST
    const postRes = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie, { method: 'POST' }),
      env,
    )
    expect(postRes.status).toBe(200)

    // Then GET it back
    const getRes = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie),
      env,
    )
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as { has_token: boolean }
    expect(getBody.has_token).toBe(true)
  })

  it('returns has_token=true after regeneration', async () => {
    const { env, cookie } = await seedNotebook()

    // Create first token
    const postRes1 = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie, { method: 'POST' }),
      env,
    )
    expect(postRes1.status).toBe(200)

    // Regenerate
    const postRes2 = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie, { method: 'POST' }),
      env,
    )
    expect(postRes2.status).toBe(200)

    // GET still returns has_token=true
    const getRes = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie),
      env,
    )
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as { has_token: boolean }
    expect(getBody.has_token).toBe(true)
  })

  it('returns 404 when notebook does not exist', async () => {
    const { env, cookie } = await seedNotebook('nb-other')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nonexistent/mcp-token', cookie),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('returns has_token=false after token is deleted', async () => {
    const { env, cookie } = await seedNotebook()

    // Create token
    const postRes = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie, { method: 'POST' }),
      env,
    )
    expect(postRes.status).toBe(200)

    // Delete it
    const delRes = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie, { method: 'DELETE' }),
      env,
    )
    expect(delRes.status).toBe(204)

    // GET should return has_token=false
    const getRes = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie),
      env,
    )
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as { has_token: boolean }
    expect(getBody.has_token).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// POST /mcp — JSON-RPC dispatch (M22)
// ---------------------------------------------------------------------------

describe('POST /mcp — JSON-RPC dispatch', () => {
  async function seedEnvWithToken(token: string | null, notebookId = 'nb-1') {
    const testEnv = createTestEnv()
    const { userId } = await createAuthedRequest(testEnv.env)
    await testEnv.db.insert(notebooks).values({
      id: notebookId,
      userId,
      title: 'Test',
      description: '',
      mcpToken: token,
    })
    return testEnv.env
  }

  function rpcRequest(method: string, params: Record<string, unknown> = {}) {
    return new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  }

  it('returns the initialize result with server info and capabilities', async () => {
    const env = await seedEnvWithToken('valid-token')
    const res = await app.fetch(
      rpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0' },
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      jsonrpc: string
      id: number
      result: Record<string, unknown>
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(body.result).toBeDefined()
    const result = body.result as {
      serverInfo: { name: string }
      capabilities: { tools: Record<string, unknown> }
    }
    expect(result.serverInfo.name).toBe('cloud-notebook')
    expect(result.capabilities.tools).toBeDefined()
  })

  it('returns the registered tools via tools/list', async () => {
    const env = await seedEnvWithToken('valid-token')
    const res = await app.fetch(rpcRequest('tools/list'), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } }
    const toolNames = body.result.tools.map((t) => t.name)
    expect(toolNames).toContain('list_sources')
    expect(toolNames).toContain('get_source')
    expect(toolNames).toContain('search_sources')
    expect(toolNames).toContain('list_chat_sessions')
    expect(toolNames).toContain('get_chat_history')
    expect(toolNames).toContain('chat')
  })

  it('executes list_sources via tools/call', async () => {
    const env = await seedEnvWithToken('valid-token')
    const res = await app.fetch(
      rpcRequest('tools/call', { name: 'list_sources', arguments: { limit: 10 } }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result: { content: Array<{ type: string; text: string }> }
    }
    expect(body.result.content).toHaveLength(1)
    expect(body.result.content[0].type).toBe('text')
    // Empty notebook — list returns []
    const parsed = JSON.parse(body.result.content[0].text) as { sources: unknown[] }
    expect(parsed.sources).toEqual([])
  })

  it('returns an error for an unknown tool', async () => {
    const env = await seedEnvWithToken('valid-token')
    const res = await app.fetch(
      rpcRequest('tools/call', { name: 'does_not_exist', arguments: {} }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: Array<{ text: string }> }
      error?: { code: number; message: string }
    }
    // The transport returns the SDK's tool-error result wrapped in a content
    // array, or as a top-level JSON-RPC error. Accept either form.
    const isToolError =
      body.result?.isError === true ||
      (body.error !== undefined && typeof body.error.message === 'string')
    expect(isToolError).toBe(true)
  })

  it('returns a JSON-RPC error for an unknown method', async () => {
    const env = await seedEnvWithToken('valid-token')
    const res = await app.fetch(rpcRequest('does/not/exist'), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { error?: { code: number; message: string } }
    expect(body.error).toBeDefined()
    // MCP standard error code for "method not found".
    expect(body.error?.code).toBe(-32601)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/notebooks/:id/mcp-token
// ---------------------------------------------------------------------------

describe('DELETE /api/notebooks/:id/mcp-token', () => {
  async function seedNotebookWithToken(token: string | null, notebookId = 'nb-1') {
    const testEnv = createTestEnv()
    const { cookie, userId } = await createAuthedRequest(testEnv.env)
    await testEnv.db.insert(notebooks).values({
      id: notebookId,
      userId,
      title: 'Test',
      description: '',
      mcpToken: token,
    })
    return { ...testEnv, cookie, userId }
  }

  it('deletes the token', async () => {
    const { env, db, cookie } = await seedNotebookWithToken('existing-token')

    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nb-1/mcp-token', cookie, { method: 'DELETE' }),
      env,
    )
    expect(res.status).toBe(204)
    // Verify the token was cleared
    const [updated] = await db
      .select({ mcpToken: notebooks.mcpToken })
      .from(notebooks)
      .where(eq(notebooks.id, 'nb-1'))
    expect(updated?.mcpToken).toBeNull()
  })

  it('returns 404 when notebook does not exist', async () => {
    const { env, cookie } = await seedNotebookWithToken('existing-token', 'nb-other')
    const res = await app.fetch(
      authedRequest('http://localhost/api/notebooks/nonexistent/mcp-token', cookie, {
        method: 'DELETE',
      }),
      env,
    )
    expect(res.status).toBe(404)
  })
})
