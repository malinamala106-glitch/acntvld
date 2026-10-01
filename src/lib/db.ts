import { PrismaClient } from '@prisma/client'

// Bump this whenever the Prisma schema OR the client options below change, so
// a dev server reusing the cached client can't keep serving the old behaviour.
const PRISMA_CACHE_VERSION = 'v13-chat-context-attachment-meta'

function createPrismaClient() {
  return new PrismaClient({
    // Query logging is a per-statement cost: Prisma serialises the SQL and
    // parameters and writes a line for every query. Useful in dev, pure
    // overhead on a production request path, so it stays dev-only.
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
    // Default every User read to omit the password hash. Several routes
    // returned a whole user row to the client (admin user edits, balance
    // adjustments), which shipped the hash into responses and logs. With this
    // default, leaking it requires asking for it on purpose — only the login
    // route does that, via `omit: { passwordHash: false }`.
    omit: { user: { passwordHash: true } },
  })
}

// Returning the factory's type keeps the cached client's options in sync with
// what it was constructed with; a bare `PrismaClient` here would not match.
type CachedClient = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as {
  prisma: CachedClient | undefined
  __prismaVersion: string | undefined
}

function resolveClient(): CachedClient {
  const cached = globalForPrisma.prisma
  if (globalForPrisma.__prismaVersion === PRISMA_CACHE_VERSION && cached) return cached

  // Discard any old cached client so a regenerated Prisma Client is picked up.
  if (cached) {
    try {
      cached.$disconnect()
    } catch {}
  }

  const client = createPrismaClient()
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client
    globalForPrisma.__prismaVersion = PRISMA_CACHE_VERSION
  }
  return client
}

export const db = resolveClient()
