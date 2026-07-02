// packages/backend/src/errors.test.ts
// Unit tests for error code enum, type guard, and response helper.

import { describe, expect, it } from 'vitest'
import { ErrorCode, errorResponse, isErrorCode } from './errors'

// ---- isErrorCode ------------------------------------------------------------

describe('isErrorCode', () => {
  it('returns true for every known ErrorCode value', () => {
    for (const value of Object.values(ErrorCode)) {
      expect(isErrorCode(value)).toBe(true)
    }
  })

  it('returns false for an unknown string', () => {
    expect(isErrorCode('notebook.unknown')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isErrorCode(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isErrorCode(undefined)).toBe(false)
  })

  it('returns false for a number', () => {
    expect(isErrorCode(42)).toBe(false)
  })

  it('returns false for an object', () => {
    expect(isErrorCode({ code: 'notebook.notFound' })).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isErrorCode('')).toBe(false)
  })
})

// ---- errorResponse ----------------------------------------------------------

describe('errorResponse', () => {
  it('returns { error, code } with the given status', () => {
    const c = { json: (body: unknown, status: number) => ({ body, status }) }
    const res = errorResponse(c as any, ErrorCode.NotebookNotFound, 'Notebook not found', 404)
    expect(res).toEqual({
      body: { error: 'Notebook not found', code: 'notebook.notFound' },
      status: 404,
    })
  })

  it('includes details when provided', () => {
    const c = { json: (body: unknown, status: number) => ({ body, status }) }
    const res = errorResponse(c as any, ErrorCode.ValidationFailed, 'Validation failed', 400, {
      field: 'title',
      reason: 'required',
    })
    expect(res).toEqual({
      body: {
        error: 'Validation failed',
        code: 'validation.failed',
        details: { field: 'title', reason: 'required' },
      },
      status: 400,
    })
  })

  it('omits details when not provided', () => {
    const c = { json: (body: unknown, status: number) => ({ body, status }) }
    const res = errorResponse(c as any, ErrorCode.ServerInternalError, 'Internal error', 500)
    expect(res).not.toHaveProperty('body.details')
    expect(res).toEqual({
      body: { error: 'Internal error', code: 'server.internalError' },
      status: 500,
    })
  })
})

// ---- ErrorCode snapshot -----------------------------------------------------

describe('ErrorCode values', () => {
  it('all values use dot notation (e.g. notebook.notFound)', () => {
    const values = Object.values(ErrorCode) as string[]
    for (const v of values) {
      expect(v).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
    }
  })

  it('snapshot matches the full set of error codes', () => {
    // Sorted for deterministic snapshot
    const sorted = Object.values(ErrorCode).slice().sort()
    expect(sorted).toMatchInlineSnapshot(`
      [
        "auth.emailRegistered",
        "auth.forbidden",
        "auth.invalidCredentials",
        "auth.inviteInvalid",
        "auth.inviteRequired",
        "auth.tokenInvalid",
        "auth.tokenMissing",
        "auth.unauthorized",
        "connection.notFound",
        "invitation.notFound",
        "note.notFound",
        "notebook.notFound",
        "proxy.upstreamError",
        "request.deprecated",
        "request.emptyBody",
        "request.invalidKey",
        "request.invalidSourceIds",
        "request.invalidUrl",
        "request.tooLarge",
        "resource.conflict",
        "server.configError",
        "server.internalError",
        "server.upstreamError",
        "session.notFound",
        "source.notFound",
        "storage.forbiddenInProduction",
        "storage.healthCheckFailed",
        "storage.providerMismatch",
        "validation.failed",
      ]
    `)
  })
})
