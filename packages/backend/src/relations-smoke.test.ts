// Test if column-shorthand where works with relations
import { describe, expect, it } from 'vitest'
import { notebooks, sources } from './db/schema'
import { createTestEnv } from './test/d1-adapter'

describe('relations smoke (column shorthand where)', () => {
  it('returns notebook with sources via findFirst + column shorthand', async () => {
    const testEnv = createTestEnv()
    await testEnv.db.insert(notebooks).values({
      id: 'nb-1',
      userId: 'u1',
      title: 'Test',
      description: '',
    })
    await testEnv.db.insert(sources).values([
      {
        id: 's1',
        notebookId: 'nb-1',
        userId: 'u1',
        name: 'a.pdf',
        type: 'pdf',
        status: 'completed',
      },
    ])

    // Use column shorthand { id: 'nb-1' } instead of eq()
    const result = await testEnv.db.query.notebooks.findFirst({
      where: { id: 'nb-1' },
      with: { sources: true },
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe('nb-1')
    expect(result?.sources).toHaveLength(1)
    expect(result?.sources?.[0].name).toBe('a.pdf')
  })
})
