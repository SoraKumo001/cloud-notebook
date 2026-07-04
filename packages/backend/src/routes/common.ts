import type { Context, Env } from 'hono'
import { ErrorCode, errorResponse } from '../errors'

export const vHook = <E extends Env>(
  result: { success: boolean; error?: { issues: Array<{ message: string }> } },
  c: Context<E>,
) => {
  if (!result.success) {
    const message = result.error?.issues[0]?.message ?? 'Invalid request'
    return errorResponse(c, ErrorCode.ValidationFailed, `Validation failed: ${message}`, 400)
  }
}
