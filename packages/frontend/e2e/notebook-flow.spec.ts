import { expect, type Page, test } from '@playwright/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 'dev-user',
  email: 'dev@example.com',
  name: 'Dev User',
}

const MOCK_NOTEBOOK = {
  id: 'nb-1',
  title: 'Test Notebook',
  description: 'A notebook for testing',
  sourceCount: 0,
  updatedAt: new Date().toISOString(),
}

async function mockAuth(page: Page) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    })
  })
}

/**
 * Build an SSE response body for a chat request.
 */
function chatSSE(): string {
  return (
    'event: meta\n' +
    'data: {"sessionId":"sess-1","chunks":[]}\n\n' +
    'event: delta\n' +
    'data: {"text":"Hello! I am your AI assistant."}\n\n' +
    'event: delta\n' +
    'data: {"text":" I can help with your research."}\n\n' +
    'event: done\n' +
    'data: {"finalText":"Hello! I am your AI assistant. I can help with your research.","citations":{"valid":[],"invalid":[]},"risk":{"risk":"low","reasons":[]}}\n\n'
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Notebook detail page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page)

    // Mock notebook API
    await page.route('**/api/notebooks', async (route, request) => {
      const url = new URL(request.url())
      if (request.method() === 'GET' && url.searchParams.has('userId')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([MOCK_NOTEBOOK]),
        })
      }
    })

    // Mock sources endpoint
    await page.route('**/api/notebooks/nb-1/sources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    // Mock chat SSE endpoint
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: chatSSE(),
      })
    })
  })

  test('notebook detail page loads and shows the notebook title', async ({ page }) => {
    await page.goto('/notebooks/nb-1')

    // Should show the notebook title in the header
    await expect(page.locator(`text=${MOCK_NOTEBOOK.title}`)).toBeVisible()
  })

  test('upload dropzone is visible on the page', async ({ page }) => {
    await page.goto('/notebooks/nb-1')

    // Upload section heading
    await expect(page.locator('text=Upload sources')).toBeVisible()

    // Dropzone text
    await expect(page.locator('text=Drag & drop PDFs here')).toBeVisible()
  })

  test('chat panel is visible and accepts input', async ({ page }) => {
    await page.goto('/notebooks/nb-1')

    // Chat section heading
    await expect(page.locator('text=Chat').first()).toBeVisible()

    // The textarea should be present
    const chatInput = page.locator('textarea[placeholder="Ask a question..."]')
    await expect(chatInput).toBeVisible()
  })

  test('sending a chat message displays the assistant reply', async ({ page }) => {
    await page.goto('/notebooks/nb-1')

    const chatInput = page.locator('textarea[placeholder="Ask a question..."]')
    await chatInput.fill('What is in my notebook?')

    // Click the send button
    await page.click('button[aria-label="Send"]')

    // Wait for the assistant reply to appear
    await expect(page.locator('text=Hello! I am your AI assistant.')).toBeVisible({
      timeout: 10_000,
    })

    // Both user and assistant messages should be visible
    await expect(page.locator('text=What is in my notebook?')).toBeVisible()
  })

  test('sources section is displayed with empty state', async ({ page }) => {
    await page.goto('/notebooks/nb-1')

    // Sources section heading
    await expect(page.locator('text=Sources').first()).toBeVisible()

    // Empty state message
    await expect(page.locator('text=No sources yet')).toBeVisible()
  })
})
