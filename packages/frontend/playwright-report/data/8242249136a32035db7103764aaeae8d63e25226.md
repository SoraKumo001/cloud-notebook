# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook-flow.spec.ts >> Notebook detail page >> notebook detail page loads and shows the notebook title
- Location: e2e\notebook-flow.spec.ts:82:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Test Notebook')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('text=Test Notebook')

```

```yaml
- button "Language": English
- banner:
  - link "Back to notebooks":
    - /url: /notebooks
  - text: Notebooks
- main:
  - text: "{resource} not found"
  - heading "Add webpage" [level=2]
  - text: Webpage URL
  - textbox "Webpage URL":
    - /placeholder: https://example.com/article
  - button "Add" [disabled]
  - region:
    - heading "No sources yet" [level=3]
    - paragraph: Click + above or drop files here to add your first source.
    - button "Add files": Click to add files
  - heading "Chat" [level=2]
  - button "New Chat" [disabled]
  - 'button "Conversations ({count})"'
  - paragraph: Ask anything about your sources
  - paragraph: Type a question and the assistant will answer using the documents in this notebook.
  - textbox "Ask a question..."
  - button "Send" [disabled]
  - paragraph: Enter to send · Shift+Enter for new line
  - heading "Notes & Studio" [level=2]
  - paragraph: Write notes or generate study guides.
  - heading "Notes" [level=3]
  - paragraph: "{count} total"
  - button "New Note"
  - heading "No notes yet" [level=4]
  - paragraph: Create one to start taking notes.
  - heading "New note" [level=3]
  - tablist:
    - tab "Edit"
    - tab "Preview"
  - text: Title
  - textbox "Title":
    - /placeholder: Note title
  - text: Content
  - textbox "Content":
    - /placeholder: Write in Markdown…
  - button "Cancel"
  - button "Save" [disabled]
```

# Test source

```ts
  1   | import { expect, type Page, test } from '@playwright/test'
  2   | 
  3   | // ── Helpers ──────────────────────────────────────────────────────────────────
  4   | 
  5   | const MOCK_USER = {
  6   |   id: 'dev-user',
  7   |   email: 'dev@example.com',
  8   |   name: 'Dev User',
  9   | }
  10  | 
  11  | const MOCK_NOTEBOOK = {
  12  |   id: 'nb-1',
  13  |   title: 'Test Notebook',
  14  |   description: 'A notebook for testing',
  15  |   sourceCount: 0,
  16  |   updatedAt: new Date().toISOString(),
  17  | }
  18  | 
  19  | async function mockAuth(page: Page) {
  20  |   await page.route('**/api/me', async (route) => {
  21  |     await route.fulfill({
  22  |       status: 200,
  23  |       contentType: 'application/json',
  24  |       body: JSON.stringify(MOCK_USER),
  25  |     })
  26  |   })
  27  | }
  28  | 
  29  | /**
  30  |  * Build an SSE response body for a chat request.
  31  |  */
  32  | function chatSSE(): string {
  33  |   return (
  34  |     'event: meta\n' +
  35  |     'data: {"sessionId":"sess-1","chunks":[]}\n\n' +
  36  |     'event: delta\n' +
  37  |     'data: {"text":"Hello! I am your AI assistant."}\n\n' +
  38  |     'event: delta\n' +
  39  |     'data: {"text":" I can help with your research."}\n\n' +
  40  |     'event: done\n' +
  41  |     'data: {"finalText":"Hello! I am your AI assistant. I can help with your research.","citations":{"valid":[],"invalid":[]},"risk":{"risk":"low","reasons":[]}}\n\n'
  42  |   )
  43  | }
  44  | 
  45  | // ── Tests ────────────────────────────────────────────────────────────────────
  46  | 
  47  | test.describe('Notebook detail page', () => {
  48  |   test.beforeEach(async ({ page }) => {
  49  |     await mockAuth(page)
  50  | 
  51  |     // Mock notebook API
  52  |     await page.route('**/api/notebooks', async (route, request) => {
  53  |       const url = new URL(request.url())
  54  |       if (request.method() === 'GET' && url.searchParams.has('userId')) {
  55  |         await route.fulfill({
  56  |           status: 200,
  57  |           contentType: 'application/json',
  58  |           body: JSON.stringify([MOCK_NOTEBOOK]),
  59  |         })
  60  |       }
  61  |     })
  62  | 
  63  |     // Mock sources endpoint
  64  |     await page.route('**/api/notebooks/nb-1/sources', async (route) => {
  65  |       await route.fulfill({
  66  |         status: 200,
  67  |         contentType: 'application/json',
  68  |         body: JSON.stringify([]),
  69  |       })
  70  |     })
  71  | 
  72  |     // Mock chat SSE endpoint
  73  |     await page.route('**/api/chat', async (route) => {
  74  |       await route.fulfill({
  75  |         status: 200,
  76  |         headers: { 'Content-Type': 'text/event-stream' },
  77  |         body: chatSSE(),
  78  |       })
  79  |     })
  80  |   })
  81  | 
  82  |   test('notebook detail page loads and shows the notebook title', async ({ page }) => {
  83  |     await page.goto('/notebooks/nb-1')
  84  | 
  85  |     // Should show the notebook title in the header
> 86  |     await expect(page.locator(`text=${MOCK_NOTEBOOK.title}`)).toBeVisible()
      |                                                               ^ Error: expect(locator).toBeVisible() failed
  87  |   })
  88  | 
  89  |   test('upload dropzone is visible on the page', async ({ page }) => {
  90  |     await page.goto('/notebooks/nb-1')
  91  | 
  92  |     // Upload section heading
  93  |     await expect(page.locator('text=Upload sources')).toBeVisible()
  94  | 
  95  |     // Dropzone text
  96  |     await expect(page.locator('text=Drag & drop PDFs here')).toBeVisible()
  97  |   })
  98  | 
  99  |   test('chat panel is visible and accepts input', async ({ page }) => {
  100 |     await page.goto('/notebooks/nb-1')
  101 | 
  102 |     // Chat section heading
  103 |     await expect(page.locator('text=Chat').first()).toBeVisible()
  104 | 
  105 |     // The textarea should be present
  106 |     const chatInput = page.locator('textarea[placeholder="Ask a question..."]')
  107 |     await expect(chatInput).toBeVisible()
  108 |   })
  109 | 
  110 |   test('sending a chat message displays the assistant reply', async ({ page }) => {
  111 |     await page.goto('/notebooks/nb-1')
  112 | 
  113 |     const chatInput = page.locator('textarea[placeholder="Ask a question..."]')
  114 |     await chatInput.fill('What is in my notebook?')
  115 | 
  116 |     // Click the send button
  117 |     await page.click('button[aria-label="Send"]')
  118 | 
  119 |     // Wait for the assistant reply to appear
  120 |     await expect(page.locator('text=Hello! I am your AI assistant.')).toBeVisible({
  121 |       timeout: 10_000,
  122 |     })
  123 | 
  124 |     // Both user and assistant messages should be visible
  125 |     await expect(page.locator('text=What is in my notebook?')).toBeVisible()
  126 |   })
  127 | 
  128 |   test('sources section is displayed with empty state', async ({ page }) => {
  129 |     await page.goto('/notebooks/nb-1')
  130 | 
  131 |     // Sources section heading
  132 |     await expect(page.locator('text=Sources').first()).toBeVisible()
  133 | 
  134 |     // Empty state message
  135 |     await expect(page.locator('text=No sources yet')).toBeVisible()
  136 |   })
  137 | })
  138 | 
```