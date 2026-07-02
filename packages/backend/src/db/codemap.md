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
  - `notebooks → sources`, `notes`, `chatSessions`, `sourceImages` (M15.2 — direct relation so RQB can fetch images at notebook level without a nested JOIN)
  - `sources → sourceChunks`, `sourceImages`
  - `chatSessions → chatMessages`
- All relations use `r.many(...)` with explicit `{ from, to }`.
- Required for joins through relations (e.g., DELETE notebook needs sources → sourceChunks cascade).

### schema/
See [schema/codemap.md](schema/codemap.md) for per-table definitions (8 tables).

## Patterns

### RQBv2 column shorthand (M15.2)
Use `where: { id }` in `db.query.*` calls, **not** `eq(notebooks.id, id)`. drizzle v1 relations filter cannot tolerate `eq()`'s enumerable properties (`'decoder'`, `'shouldInlineParams'`, etc.). Standard `db.select().where(eq(table.col, val))` still works — the workaround applies only to RQBv2.

### D1 cascade cleanup
Foreign-key references use `{ onDelete: 'cascade' }` so deleting a notebook automatically removes sources, sourceChunks, sourceImages, notes, chatSessions. R2 / Vectorize cleanup happens explicitly in the route handler (see `index.ts` DELETE /api/notebooks/:id, DELETE /api/sources/:id).