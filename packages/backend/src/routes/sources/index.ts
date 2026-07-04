// packages/backend/src/routes/sources/index.ts
// Source routes — aggregates CRUD, ingestion, and presign sub-routers.

import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import crud from './crud'
import ingest from './ingest'
import presign from './presign'

const router = new Hono<AppEnv>()

router.route('/', crud)
router.route('/', ingest)
router.route('/', presign)

export default router
