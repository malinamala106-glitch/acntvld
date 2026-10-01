/**
 * Client-safe error messages for API routes.
 *
 * Several routes deliberately surface short business-rule messages thrown
 * inside transactions ("Insufficient balance. You need $50.00…"). Returning
 * `e.message` blindly, though, would also leak Prisma engine errors, SQL
 * fragments, and connection details. This filter passes the former and
 * masks the latter.
 */
export function safeClientMessage(e: unknown, fallback: string): string {
  const msg = typeof (e as any)?.message === 'string' ? (e as any).message : ''
  if (!msg || msg === fallback) return fallback
  // Business messages in this codebase are short, human sentences.
  if (msg.length > 200) return fallback
  // Anything that smells like an engine/internal error never leaves the server.
  if (/prisma|query|invalid `|assertion|connect|timeout|ECONN|denied|violat|constraint|stack|at .+\(/i.test(msg)) {
    return fallback
  }
  return msg
}
