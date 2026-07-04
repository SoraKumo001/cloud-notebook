// packages/backend/src/routes/notebooks/index.ts
// Notebook routes — aggregates CRUD, settings, and vector sub-routers.

import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import crud from './crud'
import settings from './settings'
import vector from './vector'

const router = new Hono<AppEnv>()

router.route('/', crud)
router.route('/', settings)
router.route('/', vector)

export default router
