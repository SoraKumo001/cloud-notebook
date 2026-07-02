import { expect, type Page, test } from '@playwright/test'

// ── Shared helpers ───────────────────────────────────────────────────────────

const DEV_USER = {
  id: 'dev-user',
  email: 'dev@example.com',
  name: 'Dev User',
}

/**
 * Set up API mocks that are needed for every authenticated page.
 */
async function mockAuth(page: Page) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DEV_USER),
    })
  })
}

/**
 * Set up the GET /api/notebooks mock.  Takes a list of notebooks to return.
 */
async function mockNotebooksList(page: Page, notebooks: unknown[]) {
  await page.route('**/api/notebooks', async (route, request) => {
    if (request.method() !== 'GET') return
    const url = new URL(request.url())
    // Only intercept requests that have the userId query parameter
    if (!url.searchParams.has('userId')) return
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(notebooks),
    })
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Smoke tests', () => {
  test('landing page (/) renders correctly', async ({ page }) => {
    await page.goto('/')

    // Should see the app title
    await expect(page.locator('text=Cloud open-notebook')).toBeVisible()

    // Should see the main heading
    await expect(page.locator('text=Your Private AI-Powered Research Assistant')).toBeVisible()

    // Should see the CTA button
    await expect(page.locator('text=Create New Notebook')).toBeVisible()
  })

  test('notebooks page loads with empty state after auth', async ({ page }) => {
    await mockAuth(page)
    await mockNotebooksList(page, [])

    await page.goto('/notebooks')

    // Should show the notebooks heading
    await expect(page.locator('h1:has-text("Notebooks")')).toBeVisible()

    // Should show the empty state
    await expect(page.locator('text=No notebooks yet')).toBeVisible()

    // Should show the "New Notebook" button
    await expect(page.locator('text=New Notebook')).toBeVisible()
  })

  test('new notebook modal opens and creates a notebook', async ({ page }) => {
    const createdNotebook = {
      id: 'nb-1',
      title: 'Test Notebook',
      description: null,
      sourceCount: 0,
      updatedAt: new Date().toISOString(),
    }

    await mockAuth(page)
    await mockNotebooksList(page, [])

    // Mock POST /api/notebooks
    await page.route('**/api/notebooks', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(createdNotebook),
        })
      } else {
        // GET — return empty list on first call, then the created notebook
        // after creation
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
      }
    })

    await page.goto('/notebooks')
    await page.waitForSelector('text=No notebooks yet')

    // Click "New Notebook" button
    await page.click('text=New Notebook')

    // Modal should be visible
    await expect(page.locator('text=Create new notebook')).toBeVisible()

    // Fill in the title
    const titleInput = page.locator('input[type="text"]')
    await titleInput.fill('Test Notebook')

    // Submit
    await page.click('button:has-text("Create")')

    // Should navigate to the notebook detail page
    await page.waitForURL('**/notebooks/nb-1')
  })

  test('notebooks page shows user name in header', async ({ page }) => {
    await mockAuth(page)
    await mockNotebooksList(page, [])

    await page.goto('/notebooks')

    // Should display the user name in the header
    await expect(page.locator(`text=${DEV_USER.name}`)).toBeVisible()
  })
})
