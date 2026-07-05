# packages/backend/src/db/

## Responsibility
drizzle-orm 1.0.0-rc.4 setup: client factory, RQBv2 relations graph, and per-table schema modules. Used by every route handler that accesses D1.

## Files

### client.ts
- `createDb(binding: D1Database): DB` — instantiates a drizzle D1 client bound to the relations graph.
- Exports `type DB = DrizzleD1Database<typeof relations>` — threaded through Hono Variables (`db: DB`).
- All route handlers get `db` via `c.get('db')` (set by `dbMiddleware`).

### relations.ts
- Defines `defineRelations()` graph for RQBv2 `db.query.*` queries.
- Relations defined:
  - `users → {sessions, notebooks, invitationsCreated, invitationsConsumed}` (`relations.ts:5-16`).
  - `notebooks → sources`, `notes`, `chatSessions`, `sourceImages` (M15.2 — direct relation so RQB can fetch images at notebook level without a nested JOIN)
  - `sources → sourceChunks`, `sourceImages`
  - `chatSessions → chatMessages`
- All relations use `r.many(...)` with explicit `{ from, to }`.
- Required for joins through relations (e.g., DELETE notebook needs sources → sourceChunks cascade).

### schema/
See [schema/codemap.md](schema/codemap.md) for per-table definitions (13 tables: `aiConnections`, `chatMessages`, `chatSessions`, `globalSettings`, `invitations`, `notebooks`, `notes`, `sessions`, `sourceChunks`, `sourceImages`, `sources`, `userSettings`, `users`).

### settings.ts
- `getEffectiveAiConfig(db, userId, masterKey, nb): AiConfig` — resolves the effective AI config for a notebook by falling back through: notebook-level overrides → user settings → system defaults.
- Exports `TaskConfig` (`{ provider, apiKey, baseUrl, model }`) and `AiConfig` (`{ embedding, chat, summarization, ocr }`) types.
- Internal `resolveTaskConfig(db, userId, masterKey, modelString, defaultProvider, defaultModel)` — parses `connectionId:model` notation to look up a named `aiConnections` row, falling back to the legacy single-provider model.
- 157 lines total.

## Patterns

### RQBv2 column shorthand (M15.2)
Use `where: { id }` in `db.query.*` calls, **not** `eq(notebooks.id, id)`. drizzle v1 relations filter cannot tolerate `eq()`'s enumerable properties (`'decoder'`, `'shouldInlineParams'`, etc.). Standard `db.select().where(eq(table.col, val))` still works — the workaround applies only to RQBv2.

### D1 cascade cleanup
Foreign-key references use `{ onDelete: 'cascade' }` so deleting a notebook automatically removes sources, sourceChunks, sourceImages, notes, chatSessions. R2 / Vectorize cleanup happens explicitly in the route handler (see `index.ts` DELETE /api/notebooks/:id, DELETE /api/sources/:id).