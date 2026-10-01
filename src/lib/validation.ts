import { z } from 'zod'

/**
 * Schemas for the money paths. Zod 4 is already a dependency; these are the
 * three routes where malformed input can move funds or leak data.
 * Error text matches the human tone the routes already use.
 */

// Networks offered on the deposit page (kept in sync with CryptoWallet.network values).
const DEPOSIT_NETWORKS = ['BEP20', 'ERC20', 'TRC20', 'Polygon', 'CRYPTO'] as const

export const depositCreateSchema = z.object({
  walletId: z.string().max(64).optional().nullable(),
  network: z.string().min(1).max(32),
  amount: z.number({ message: 'Amount must be a number' }).finite().positive('Amount must be greater than 0').max(1_000_000),
  txHash: z.string().max(200).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
}).strict()

export const bidPlaceSchema = z.object({
  amount: z
    .number({ message: 'Bid amount must be a positive number' })
    .finite()
    .positive('Bid amount must be a positive number')
    .max(1_000_000),
}).strict()

export const couponValidateSchema = z.object({
  code: z.string().min(1).max(40),
  productId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(100).default(1),
  unitPrice: z.number().finite().positive().optional(),
}).strict()

export type DepositCreateInput = z.infer<typeof depositCreateSchema>
export type BidPlaceInput = z.infer<typeof bidPlaceSchema>
export type CouponValidateInput = z.infer<typeof couponValidateSchema>

// ----- Auth schemas ---------------------------------------------------------

export const loginSchema = z.object({
  // Accepts either an email address or a username — validated server-side
  // against both columns. Kept as `email` for backwards compatibility with
  // existing clients.
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().optional().default(false),
}).strict()

export const registerSchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  name: z.string().max(80).optional(),
}).strict()

// Username rules: 3–30 chars, letters/numbers/underscore/dot/hyphen, must
// start with a letter or number. Shared by the profile-setup step, the
// availability check, and admin user creation.
export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}$/

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_RE, 'Username must be 3–30 characters (letters, numbers, dot, underscore, hyphen)')

export const completeProfileSchema = z.object({
  username: usernameSchema,
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
}).strict()

export const setPasswordSchema = z.object({
  token: z.string().min(10).max(2000),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
}).strict()

export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(1, 'Display name is required').max(100),
  email: z.string().trim().min(3).max(200),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  role: z.enum(['BUYER', 'VENDOR', 'ADMIN']).default('BUYER'),
  status: z.enum(['ACTIVE', 'PENDING']).default('ACTIVE'),
  sendWelcomeEmail: z.boolean().optional().default(false),
}).strict()

export const forgotPasswordSchema = z.object({
  email: z.string().min(3).max(200),
}).strict()

/**
 * Uniform parse helper matching the routes' existing error contract:
 * returns { ok: true, data } or { ok: false, error } with a single
 * human-readable message (never a Zod issue dump).
 */
export function parseWith<T extends z.ZodType>(schema: T, body: unknown):
  { ok: true; data: z.output<T> } | { ok: false; error: string } {
  const parsed = schema.safeParse(body)
  if (parsed.success) return { ok: true, data: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, error: issue?.message || 'Invalid request' }
}
