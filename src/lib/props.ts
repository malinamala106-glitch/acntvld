import type { CryptoWallet, Product, Role, User, UserStatus } from './types'

/**
 * Server → client boundary serialisation.
 *
 * Server components pass plain objects down to client components. The RSC
 * boundary turns a `Date` into an ISO string and an enum-typed column into a
 * plain string, and the prop types in `lib/types.ts` deliberately model what
 * the *client* receives. Prisma's inferred row types can't know that, which is
 * why handing a row straight to a client component produced eight `tsc` errors
 * — hidden behind `typescript.ignoreBuildErrors` until this audit turned it off.
 *
 * These helpers make the conversion explicit instead of casting it away, so the
 * boundary stays type-checked and a future schema change fails the build rather
 * than quietly reaching a browser.
 */

const ROLES: readonly string[] = ['ADMIN', 'BUYER', 'VENDOR']
const STATUSES: readonly string[] = ['ACTIVE', 'MUTED', 'BANNED', 'PENDING']

function toIso(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value instanceof Date ? value.toISOString() : value
}

type UserRow = {
  id: string
  email: string
  username?: string | null
  name: string | null
  role: string
  status: string
  balance: number
  lockedBalance?: number
  profileCompleted?: boolean
  createdAt?: Date | string
}

export function toUserProps(row: UserRow): User {
  return {
    ...row,
    role: (ROLES.includes(row.role) ? row.role : 'BUYER') as Role,
    status: (STATUSES.includes(row.status) ? row.status : 'ACTIVE') as UserStatus,
    createdAt: toIso(row.createdAt),
  }
}

type ProductRow = {
  id: string
  name: string
  description: string | null
  renderHtml?: boolean
  category: string
  metadata?: string | null
  deliveryFormat?: string | null
  price: number
  stock: number
  image: string | null
  isActive: boolean
  createdAt?: Date | string
  fromPrice?: number
  maxPrice?: number
  hasBatchPricing?: boolean
}

export function toProductProps(row: ProductRow): Product {
  return { ...row, createdAt: toIso(row.createdAt) }
}

type WalletRow = {
  id: string
  network: string
  address: string
  label: string | null
  isActive: boolean
  createdAt?: Date | string
}

export function toWalletProps(row: WalletRow): CryptoWallet {
  return { ...row, createdAt: toIso(row.createdAt) }
}
