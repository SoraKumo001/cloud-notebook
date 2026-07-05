# packages/frontend/src/lib/

## Responsibility
Browser-only utilities for content extraction (PDF, DOCX, text/Markdown), tokenization, webpage fetching/parsing, and the dispatcher that routes a `File` to the right parser. These modules are imported dynamically by hooks to keep heavy dependencies (`pdfjs-dist`, `mammoth`, `js-tiktoken`) out of the initial bundle.

## Modules

### sourceParser.ts
- Exports `SourceType = 'pdf' | 'text' | 'webpage' | 'docx'` and `ParsedSource` interface (title, pages[], fullText, metadata).
- Exports `parseFile(file: File, sourceType: SourceType): Promise<ParsedSource>` — dispatcher:
  - `'pdf'` → dynamically imports `./pdfParser` → `parsePDF`.
  - `'text'` → dynamically imports `./textParser` → `parseTextFile`.
  - `'docx'` → dynamically imports `./docxParser` → `parseDocxFile`.
  - `'webpage'` — routed via `parseWebpage(url)` in `sourceParser.ts:71-74`, which dynamically imports `parseWebpageUrl` from `./webpageParser`. `useIngestPipeline.ts:354` calls `parseWebpage(url)`.

### pdfParser.ts
- Lazy-loads `pdfjs-dist` via `getPdfjsLib()`. Sets `GlobalWorkerOptions.workerSrc` to a same-origin `pdf.worker.min.mjs` bundled via Vite `?url` import from the local `pdfjs-dist` package (`pdfParser.ts:21, 30`). This avoids the cross-origin CDN 404 that occurred with pdfjs-dist 6.x. Local copies also exist in `public/pdfjs/build/`.
- `parsePDF(arrayBuffer: ArrayBuffer, extractImages = true): Promise<PDFParseResult>` — extracts per-page text via `page.getTextContent()` and renders each page to a JPEG Blob (`canvas.toBlob('image/jpeg', 0.8)`, viewport scale 1.5). Renders are best-effort: image extraction failures are logged but don't fail the parse.
- Consumed by: `useIngestPipeline` (PDF ingestion).

### textParser.ts
- `parseTextFile(file: File): Promise<ParsedSource>` — reads via `file.text()`. For `.md` files, strips YAML front matter (`^---\n...\n---\n`) and extracts title from the first `# ` heading. Plain text uses file name (extension stripped) as title.
- Consumed by: `useIngestPipeline` (text/markdown ingestion).

### docxParser.ts
- `parseDocxFile(file: File): Promise<ParsedSource>` — dynamically imports `mammoth/mammoth.browser`, calls `mammoth.extractRawText({ arrayBuffer })`. Title from file name (extension stripped). No image extraction (planned for M8+).
- Consumed by: `useIngestPipeline` (DOCX ingestion).

### webpageParser.ts
- `parseWebpageUrl(url: string): Promise<ParsedSource>` — fetches via `/api/fetch?url=…` (backend proxy enforces SSRF protection via `isValidFetchUrl`), then parses HTML with `DOMParser`.
- `extractFromHtml(html, url)` — internal: extracts `<title>` or first `<h1>` as title, recursively removes `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, `<noscript>`, `<iframe>`, `<svg>`, `<canvas>` via `removeTags`, takes `innerText`, collapses triple+ newlines.
- Consumed by: `useIngestPipeline` (URL ingestion).

### tokenizer.ts
- Initializes `cl100k_base` via `js-tiktoken:getEncoding` at module load.
- `chunkText(text, maxTokens = 500, overlapTokens = 100): TextChunk[]` — token-based chunking that aligns boundaries to paragraph (`\n\n`) or sentence (`. `) breaks via `findSemanticBoundary`. Guarantees forward progress (avoid infinite loops on pathological input).
- `countTokens(text: string): number` — convenience wrapper.
- Consumed by: `useIngestPipeline` (chunking step after PDF/text/docx/webpage parsing).

## Patterns

### Pure-function design
All modules export pure functions. No React state, no module-level caches (except `pdfjs-dist` itself, which is cached in `getPdfjsLib()`).

### Dynamic imports
`pdfjs-dist` (via `getPdfjsLib` in `pdfParser.ts:29`) and `mammoth` (in `docxParser.ts:15`) are loaded via `await import(...)`. `js-tiktoken` uses a static import in `tokenizer.ts:1`, but the `lib/tokenizer` module itself is dynamically imported by callers (e.g. `useIngestPipeline.ts:252`), so the heavy encoding work is still deferred.

### `ParsedSource` is the universal return shape
Every parser returns the same `ParsedSource` interface so downstream code (`useIngestPipeline`) can consume them uniformly.

### Co-located tests
Each parser has a `*.test.ts` next to it (e.g. `pdfParser.test.ts`, `tokenizer.test.ts`). These are excluded from the codemap.