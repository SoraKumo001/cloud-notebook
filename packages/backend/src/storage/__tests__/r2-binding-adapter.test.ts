// packages/backend/src/storage/__tests__/r2-binding-adapter.test.ts
//
// Unit tests for R2BindingAdapter. Uses a hand-rolled mock of R2Bucket
// instead of relying on a real binding (which only exists in Workers
// runtime).

import { describe, expect, it, vi } from 'vitest'
import { R2BindingAdapter } from '../r2-binding-adapter'

function makeMockBucket(
  overrides: Partial<{
    put: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    head: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    createPresignedUrl: ReturnType<typeof vi.fn>
  }> = {},
) {
  return {
    put: vi.fn(),
    get: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    createPresignedUrl: vi.fn(),
    ...overrides,
  } as any
}

describe('R2BindingAdapter', () => {
  it('exposes provider "r2-binding"', () => {
    const adapter = new R2BindingAdapter(makeMockBucket())
    expect(adapter.provider).toBe('r2-binding')
    expect(adapter.supportsDirectPresign()).toBe(true)
  })

  it('presign() returns the URL from createPresignedUrl and a future expiresAt', async () => {
    const createPresignedUrl = vi.fn().mockResolvedValue('https://presigned.example/abc')
    const adapter = new R2BindingAdapter(makeMockBucket({ createPresignedUrl }))

    const before = Date.now()
    const result = await adapter.presign('notebooks/n/sources/s/file.pdf', 'application/pdf', 600)
    const after = Date.now()

    expect(createPresignedUrl).toHaveBeenCalledWith('notebooks/n/sources/s/file.pdf', {
      method: 'PUT',
      expiresIn: 600,
      headers: { 'content-type': 'application/pdf' },
    })
    expect(result.url).toBe('https://presigned.example/abc')
    const expiresAtMs = Date.parse(result.expiresAt)
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 600_000)
    expect(expiresAtMs).toBeLessThanOrEqual(after + 600_000)
  })

  it('presign() omits content-type header when not given', async () => {
    const createPresignedUrl = vi.fn().mockResolvedValue('https://x')
    const adapter = new R2BindingAdapter(makeMockBucket({ createPresignedUrl }))

    await adapter.presign('k', '', 60)

    expect(createPresignedUrl).toHaveBeenCalledWith('k', {
      method: 'PUT',
      expiresIn: 60,
      headers: undefined,
    })
  })

  it('put() returns etag and size from the binding', async () => {
    const put = vi.fn().mockResolvedValue({ etag: 'e1', size: 1024 })
    const adapter = new R2BindingAdapter(makeMockBucket({ put }))

    const result = await adapter.put('k', new ArrayBuffer(8), 'application/pdf')

    expect(put).toHaveBeenCalledWith('k', expect.any(ArrayBuffer), {
      httpMetadata: { contentType: 'application/pdf' },
    })
    expect(result).toEqual({ etag: 'e1', size: 1024 })
  })

  it('put() throws on empty result', async () => {
    const put = vi.fn().mockResolvedValue(null)
    const adapter = new R2BindingAdapter(makeMockBucket({ put }))

    await expect(adapter.put('k', new ArrayBuffer(8))).rejects.toThrow(/empty result/)
  })

  it('head() returns null when object does not exist', async () => {
    const head = vi.fn().mockResolvedValue(null)
    const adapter = new R2BindingAdapter(makeMockBucket({ head }))

    expect(await adapter.head('missing')).toBeNull()
  })

  it('head() returns size and contentType', async () => {
    const head = vi
      .fn()
      .mockResolvedValue({ size: 42, httpMetadata: { contentType: 'text/plain' } })
    const adapter = new R2BindingAdapter(makeMockBucket({ head }))

    expect(await adapter.head('k')).toEqual({ size: 42, contentType: 'text/plain' })
  })

  it('delete() calls binding.delete with a single key as a one-element array', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const adapter = new R2BindingAdapter(makeMockBucket({ delete: del }))

    await adapter.delete('only-key')

    expect(del).toHaveBeenCalledWith(['only-key'])
  })

  it('delete() passes multiple keys as one batched call', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const adapter = new R2BindingAdapter(makeMockBucket({ delete: del }))

    await adapter.delete(['a', 'b', 'c'])

    expect(del).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('delete() noops on empty array without calling the binding', async () => {
    const del = vi.fn()
    const adapter = new R2BindingAdapter(makeMockBucket({ delete: del }))

    await adapter.delete([])

    expect(del).not.toHaveBeenCalled()
  })

  it('healthCheck() writes then deletes a probe key', async () => {
    const put = vi.fn().mockResolvedValue({ etag: 'x', size: 12 })
    const del = vi.fn().mockResolvedValue(undefined)
    const adapter = new R2BindingAdapter(makeMockBucket({ put, delete: del }))

    await adapter.healthCheck()

    expect(put).toHaveBeenCalledTimes(1)
    const putKey = put.mock.calls[0][0] as string
    expect(putKey).toMatch(/^__healthcheck\//)

    expect(del).toHaveBeenCalledWith(putKey)
  })

  it('healthCheck() still attempts cleanup if put throws', async () => {
    const put = vi.fn().mockRejectedValue(new Error('network'))
    const del = vi.fn().mockResolvedValue(undefined)
    const adapter = new R2BindingAdapter(makeMockBucket({ put, delete: del }))

    await expect(adapter.healthCheck()).rejects.toThrow('network')
    // The probe key is generated before the put call, so the cleanup in the
    // finally block still runs and attempts to delete it. This is intentional
    // — even on partial failure we don't want to leak probe keys.
    expect(del).toHaveBeenCalledTimes(1)
  })
})
