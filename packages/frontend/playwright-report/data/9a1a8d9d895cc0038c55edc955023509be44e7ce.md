# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Smoke tests >> new notebook modal opens and creates a notebook
- Location: e2e\smoke.spec.ts:73:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForSelector: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('text=No notebooks yet') to be visible

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - button "Language" [ref=e6] [cursor=pointer]:
    - img [ref=e7]
    - generic [ref=e10]: English
  - generic [ref=e11]:
    - banner [ref=e12]:
      - generic [ref=e13]:
        - link "N Cloud open-notebook" [ref=e14] [cursor=pointer]:
          - /url: /
          - generic [ref=e15]: "N"
          - generic [ref=e16]: Cloud open-notebook
        - generic [ref=e17]:
          - generic [ref=e18]: Dev User
          - button "Global settings" [ref=e19] [cursor=pointer]:
            - img [ref=e20]
          - button "Sign Out" [ref=e23] [cursor=pointer]
    - main [ref=e24]:
      - generic [ref=e25]:
        - generic [ref=e26]:
          - heading "Notebooks" [level=1] [ref=e27]
          - paragraph [ref=e28]: Organize your research and sources.
        - button "New Notebook" [ref=e29] [cursor=pointer]:
          - img [ref=e30]
          - text: New Notebook
      - generic [ref=e31]:
        - generic [ref=e32]:
          - img [ref=e33]
          - textbox "Search notebooks..." [ref=e36]
        - combobox [ref=e37] [cursor=pointer]:
          - option "Last updated" [selected]
          - option "Newest first"
          - option "Title A-Z"
          - option "Title Z-A"
      - 'link "{count, plural, one {# source} other {# sources}} TestNote No description Updated {date}" [ref=e39] [cursor=pointer]':
        - /url: /notebooks/4fea3810-61da-432b-af14-e21a1a5b22b6
        - generic [ref=e40]:
          - img [ref=e42]
          - generic [ref=e44]: "{count, plural, one {# source} other {# sources}}"
        - heading "TestNote" [level=3] [ref=e45]
        - paragraph [ref=e46]: No description
        - generic [ref=e47]:
          - img [ref=e48]
          - text: "Updated {date}"
```

# Test source

```ts
  5   | const MOCK_USER = {
  6   |   id: 'dev-user',
  7   |   email: 'dev@example.com',
  8   |   name: 'Dev User',
  9   | }
  10  | 
  11  | /**
  12  |  * Set up API mocks that are needed for every authenticated page.
  13  |  */
  14  | async function mockAuth(page: Page) {
  15  |   await page.route('**/api/me', async (route) => {
  16  |     await route.fulfill({
  17  |       status: 200,
  18  |       contentType: 'application/json',
  19  |       body: JSON.stringify(MOCK_USER),
  20  |     })
  21  |   })
  22  | }
  23  | 
  24  | /**
  25  |  * Set up the GET /api/notebooks mock.  Takes a list of notebooks to return.
  26  |  */
  27  | async function mockNotebooksList(page: Page, notebooks: unknown[]) {
  28  |   await page.route('**/api/notebooks', async (route, request) => {
  29  |     if (request.method() !== 'GET') return
  30  |     const url = new URL(request.url())
  31  |     // Only intercept requests that have the userId query parameter
  32  |     if (!url.searchParams.has('userId')) return
  33  |     await route.fulfill({
  34  |       status: 200,
  35  |       contentType: 'application/json',
  36  |       body: JSON.stringify(notebooks),
  37  |     })
  38  |   })
  39  | }
  40  | 
  41  | // ── Tests ────────────────────────────────────────────────────────────────────
  42  | 
  43  | test.describe('Smoke tests', () => {
  44  |   test('landing page (/) renders correctly', async ({ page }) => {
  45  |     await page.goto('/')
  46  | 
  47  |     // Should see the app title
  48  |     await expect(page.locator('text=Cloud open-notebook')).toBeVisible()
  49  | 
  50  |     // Should see the main heading
  51  |     await expect(page.locator('text=Your Private AI-Powered Research Assistant')).toBeVisible()
  52  | 
  53  |     // Should see the CTA button
  54  |     await expect(page.locator('text=Create New Notebook')).toBeVisible()
  55  |   })
  56  | 
  57  |   test('notebooks page loads with empty state after auth', async ({ page }) => {
  58  |     await mockAuth(page)
  59  |     await mockNotebooksList(page, [])
  60  | 
  61  |     await page.goto('/notebooks')
  62  | 
  63  |     // Should show the notebooks heading
  64  |     await expect(page.locator('h1:has-text("Notebooks")')).toBeVisible()
  65  | 
  66  |     // Should show the empty state
  67  |     await expect(page.locator('text=No notebooks yet')).toBeVisible()
  68  | 
  69  |     // Should show the "New Notebook" button
  70  |     await expect(page.locator('text=New Notebook')).toBeVisible()
  71  |   })
  72  | 
  73  |   test('new notebook modal opens and creates a notebook', async ({ page }) => {
  74  |     const createdNotebook = {
  75  |       id: 'nb-1',
  76  |       title: 'Test Notebook',
  77  |       description: null,
  78  |       sourceCount: 0,
  79  |       updatedAt: new Date().toISOString(),
  80  |     }
  81  | 
  82  |     await mockAuth(page)
  83  |     await mockNotebooksList(page, [])
  84  | 
  85  |     // Mock POST /api/notebooks
  86  |     await page.route('**/api/notebooks', async (route, request) => {
  87  |       if (request.method() === 'POST') {
  88  |         await route.fulfill({
  89  |           status: 201,
  90  |           contentType: 'application/json',
  91  |           body: JSON.stringify(createdNotebook),
  92  |         })
  93  |       } else {
  94  |         // GET — return empty list on first call, then the created notebook
  95  |         // after creation
  96  |         await route.fulfill({
  97  |           status: 200,
  98  |           contentType: 'application/json',
  99  |           body: JSON.stringify([]),
  100 |         })
  101 |       }
  102 |     })
  103 | 
  104 |     await page.goto('/notebooks')
> 105 |     await page.waitForSelector('text=No notebooks yet')
      |                ^ Error: page.waitForSelector: Test timeout of 30000ms exceeded.
  106 | 
  107 |     // Click "New Notebook" button
  108 |     await page.click('text=New Notebook')
  109 | 
  110 |     // Modal should be visible
  111 |     await expect(page.locator('text=Create new notebook')).toBeVisible()
  112 | 
  113 |     // Fill in the title
  114 |     const titleInput = page.locator('input[type="text"]')
  115 |     await titleInput.fill('Test Notebook')
  116 | 
  117 |     // Submit
  118 |     await page.click('button:has-text("Create")')
  119 | 
  120 |     // Should navigate to the notebook detail page
  121 |     await page.waitForURL('**/notebooks/nb-1')
  122 |   })
  123 | 
  124 |   test('notebooks page shows user name in header', async ({ page }) => {
  125 |     await mockAuth(page)
  126 |     await mockNotebooksList(page, [])
  127 | 
  128 |     await page.goto('/notebooks')
  129 | 
  130 |     // Should display the user name in the header
  131 |     await expect(page.locator(`text=${MOCK_USER.name}`)).toBeVisible()
  132 |   })
  133 | })
  134 | 
```