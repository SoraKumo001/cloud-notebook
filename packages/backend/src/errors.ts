/**
 * Error codes returned to clients in the `code` field of error responses.
 * The set is intentionally small and stable; clients are expected to fall
 * back to the `error` field (English) if a code is not recognised.
 */
export const ErrorCode = {
  // Resource not found (404)
  NotebookNotFound: 'notebook.notFound',
  SourceNotFound: 'source.notFound',
  SessionNotFound: 'session.notFound',
  NoteNotFound: 'note.notFound',
  ConnectionNotFound: 'connection.notFound',
  InvitationNotFound: 'invitation.notFound',
  // Auth (401/403)
  AuthInvalidCredentials: 'auth.invalidCredentials',
  AuthUnauthorized: 'auth.unauthorized',
  AuthForbidden: 'auth.forbidden',
  AuthTokenMissing: 'auth.tokenMissing',
  AuthTokenInvalid: 'auth.tokenInvalid',
  AuthEmailRegistered: 'auth.emailRegistered',
  AuthInviteRequired: 'auth.inviteRequired',
  AuthInviteInvalid: 'auth.inviteInvalid',
  // Validation / request (400/413)
  ValidationFailed: 'validation.failed',
  RequestInvalidKey: 'request.invalidKey',
  RequestEmptyBody: 'request.emptyBody',
  RequestTooLarge: 'request.tooLarge',
  RequestInvalidUrl: 'request.invalidUrl',
  RequestInvalidSourceIds: 'request.invalidSourceIds',
  RequestDeprecated: 'request.deprecated',
  // Conflict (409)
  ResourceConflict: 'resource.conflict',
  // Server config (500)
  ServerConfigError: 'server.configError',
  ServerInternalError: 'server.internalError',
  ServerUpstreamError: 'server.upstreamError',
  // Proxy / fetch (502)
  ProxyUpstreamError: 'proxy.upstreamError',
  // Specific
  StorageProviderMismatch: 'storage.providerMismatch',
  StorageHealthCheckFailed: 'storage.healthCheckFailed',
  StorageForbiddenInProduction: 'storage.forbiddenInProduction',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * Type guard for the ErrorCode union. Used to validate that callers pass
 * a known code at compile time.
 */
export function isErrorCode(value: unknown): value is ErrorCodeValue {
  return typeof value === 'string' && (Object.values(ErrorCode) as string[]).includes(value)
}

/**
 * Returns a JSON response with both `error` (English fallback string) and
 * `code` (machine-readable identifier). Use this instead of `c.json({ error: '...' }, status)`
 * in every route handler.
 */
export function errorResponse(
  c: { json: (body: unknown, status: number) => Response },
  code: ErrorCodeValue,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  return c.json({ error: message, code, ...(details ? { details } : {}) }, status)
}
