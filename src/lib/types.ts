import type { SiteContent } from './site-content'

export type Role = 'ADMIN' | 'BUYER' | 'VENDOR'
export type UserStatus = 'ACTIVE' | 'MUTED' | 'BANNED' | 'PENDING'

export interface User {
  id: string
  email: string
  username?: string | null
  name: string | null
  role: Role
  status: UserStatus
  balance: number
  lockedBalance?: number
  // false until a Google signup finishes the one-time username + password step.
  profileCompleted?: boolean
  createdAt?: string
}

export interface Product {
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
  // Manual storefront order: lower sortOrder = higher in the list. `pinned`
  // floats a product above every unpinned one regardless of sortOrder.
  sortOrder?: number
  pinned?: boolean
  createdAt?: string
  // Batch pricing — populated by the product list endpoint for the public
  // storefront. `hasBatchPricing` is true only when the product has more
  // than one distinct effective price across its in-stock batches.
  fromPrice?: number
  maxPrice?: number
  hasBatchPricing?: boolean
}

export interface LicenseKey {
  id: string
  key: string
  status: 'AVAILABLE' | 'SOLD' | 'HOLD'
  orderId?: string | null
  batchId?: string | null
  createdAt?: string
  // When fetched with batch include
  batch?: { id: string; label: string; priceOverride: number | null } | null
  // When fetched with order+user include
  order?: {
    user: { email: string | null; name: string | null } | null
    createdAt: string
  } | null
}

export interface CryptoWallet {
  id: string
  network: string
  address: string
  label: string | null
  isActive: boolean
  createdAt?: string
}

export interface Deposit {
  id: string
  userId: string
  walletId?: string | null
  network: string
  amount: number
  txHash: string | null
  note: string | null
  type?: 'CRYPTO' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  adminNote: string | null
  createdAt: string
  user?: Pick<User, 'id' | 'email' | 'name' | 'balance'>
  wallet?: Pick<CryptoWallet, 'id' | 'network' | 'address'> | null
}

export interface PublicSettings {
  minDepositAmount: number
  siteName: string
  supportEmail: string
  /**
   * Editable section copy (headings, hero text, badges, empty states) keyed by
   * field id — see `@/lib/site-content` for the full schema and defaults.
   */
  content?: SiteContent
}

// Re-exported so consumers can `import type { SiteContent } from '@/lib/types'`.
export type { SiteContent }

export interface Order {
  id: string
  shortId?: number
  userId: string
  productId: string
  batchId?: string | null
  quantity: number
  unitPrice: number
  totalAmount: number
  status: 'COMPLETED' | 'FAILED' | 'PENDING' | 'REFUNDED' | 'DISPUTED' | 'CANCELLED'
  createdAt: string
  user?: Pick<User, 'id' | 'email' | 'name'>
  product?: Pick<Product, 'id' | 'name' | 'image'>
  // When fetched with batch include
  batch?: { id: string; label: string; priceOverride: number | null } | null
  keys?: { id: string; key: string }[]
}

export interface AdminStats {
  products: number
  users: number
  deposits: number
  orders: number
  wallets: number
  pendingDeposits: number
  totalSales: number
  availableKeys: number
}

// ----- Special Deals (auctions) -----

export interface Auction {
  id: string
  title: string
  slug: string
  description: string | null
  category: string
  askingPrice: number
  currentBid: number
  currentBidderId: string | null
  image: string | null
  endsAt: string
  status: 'ACTIVE' | 'ENDED' | 'CANCELLED'
  deliveryFormat: string | null
  isActive: boolean
  createdAt: string
  bidCount?: number
  // When fetched with bidder info
  currentBidderEmail?: string | null
}

export interface Bid {
  id: string
  auctionId: string
  userId: string
  amount: number
  released: boolean
  cancelStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'
  cancelRequestedAt?: string | null
  cancelDecidedAt?: string | null
  cancelAdminNote?: string | null
  createdAt: string
  // When fetched with user info
  userEmail?: string | null
  userName?: string | null
  // When fetched with auction info
  auctionTitle?: string | null
  auctionSlug?: string | null
  auctionImage?: string | null
  auctionEndsAt?: string | null
  auctionStatus?: string | null
}

// ----- Blog -----

export interface BlogPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  coverImage: string | null
  tags: string | null
  isPublished: boolean
  createdAt: string
  updatedAt: string
}
