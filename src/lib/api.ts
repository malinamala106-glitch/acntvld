import type {
  User,
  Product,
  LicenseKey,
  CryptoWallet,
  Deposit,
  Order,
  AdminStats,
  PublicSettings,
} from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) msg = data.error
    } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  async me(): Promise<User | null> {
    const res = await fetch('/api/auth/me')
    if (!res.ok) return null
    const data = await res.json()
    return data.user
  },

  async login(email: string, password: string, rememberMe?: boolean): Promise<User> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe }),
    })
    const data = await json<{ user: User }>(res)
    return data.user
  },

  // One-time profile setup for Google signups: choose a username + password.
  async completeProfile(username: string, password: string): Promise<User> {
    const res = await fetch('/api/auth/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await json<{ user: User }>(res)
    return data.user
  },

  async checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
    const res = await fetch(`/api/auth/username-check?username=${encodeURIComponent(username)}`)
    if (!res.ok) return { available: false }
    return res.json()
  },

  async setPassword(token: string, password: string): Promise<void> {
    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    await json(res)
  },

  /**
   * Create an account.
   *
   * The route deliberately answers identically whether or not the address was
   * already registered (it must not confirm that — see LOW-4 in the audit), so
   * the ambiguous case comes back as `user: null` plus a neutral `notice` the
   * caller can show. Only genuine validation failures throw.
   */
  async register(
    email: string,
    password: string,
    name?: string
  ): Promise<{ user: User | null; notice?: string }> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })
    const data = await json<{ user?: User; accountCreated?: boolean; message?: string }>(res)
    return {
      user: data.user ?? null,
      notice: data.accountCreated === false ? data.message : undefined,
    }
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' })
  },

  // Products
  async listProducts(admin = false): Promise<Product[]> {
    const url = admin ? '/api/products?admin=1' : '/api/products'
    const res = await fetch(url)
    const data = await json<{ products: Product[] }>(res)
    return data.products
  },

  async createProduct(payload: {
    name: string
    description?: string
    renderHtml?: boolean
    category?: string
    metadata?: string | Array<{ name: string; value: string }>
    deliveryFormat?: string
    price: number
    image?: string
    keys?: string | string[]
  }): Promise<Product> {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await json<{ product: Product }>(res)
    return data.product
  },

  // `metadata` accepts either the JSON string the text editor keeps or the
  // structured rows the visual editor produces — the route validates both and
  // normalises to the stored JSON string.
  async updateProduct(
    id: string,
    payload: Partial<Omit<Product, 'metadata'>> & {
      metadata?: string | Array<{ name: string; value: string }>
    }
  ): Promise<Product> {
    const res = await fetch(`/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await json<{ product: Product }>(res)
    return data.product
  },

  async deleteProduct(id: string): Promise<void> {
    await fetch(`/api/products/${id}`, { method: 'DELETE' })
  },

  async listKeys(productId: string): Promise<LicenseKey[]> {
    const res = await fetch(`/api/products/${productId}/keys`)
    const data = await json<{ keys: LicenseKey[] }>(res)
    return data.keys
  },

  async addKeys(productId: string, keys: string | string[]): Promise<{ added: number; stock: number }> {
    const res = await fetch(`/api/products/${productId}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    })
    return json(res)
  },

  // Wallets
  async listWallets(admin = false): Promise<CryptoWallet[]> {
    const url = admin ? '/api/wallets?admin=1' : '/api/wallets'
    const res = await fetch(url)
    const data = await json<{ wallets: CryptoWallet[] }>(res)
    return data.wallets
  },

  async createWallet(payload: { network: string; address: string; label?: string; isActive?: boolean }): Promise<CryptoWallet> {
    const res = await fetch('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await json<{ wallet: CryptoWallet }>(res)
    return data.wallet
  },

  async updateWallet(id: string, payload: Partial<CryptoWallet>): Promise<CryptoWallet> {
    const res = await fetch(`/api/wallets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await json<{ wallet: CryptoWallet }>(res)
    return data.wallet
  },

  async deleteWallet(id: string): Promise<void> {
    await fetch(`/api/wallets/${id}`, { method: 'DELETE' })
  },

  // Deposits
  async listDeposits(admin = false): Promise<Deposit[]> {
    const url = admin ? '/api/deposits?admin=1' : '/api/deposits'
    const res = await fetch(url)
    const data = await json<{ deposits: Deposit[] }>(res)
    return data.deposits
  },

  async createDeposit(payload: {
    walletId?: string
    network: string
    amount: number
    txHash?: string
    note?: string
  }): Promise<Deposit> {
    const res = await fetch('/api/deposits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await json<{ deposit: Deposit }>(res)
    return data.deposit
  },

  async processDeposit(id: string, action: 'approve' | 'reject', adminNote?: string): Promise<Deposit> {
    const res = await fetch(`/api/deposits/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, adminNote }),
    })
    const data = await json<{ deposit: Deposit }>(res)
    return data.deposit
  },

  // Orders
  async purchase(productId: string, quantity = 1, couponCode?: string, batchId?: string): Promise<{ order: Order; keys: { id: string; key: string }[]; newBalance: number; appliedCoupon?: string | null; discountApplied?: number }> {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity, couponCode, batchId }),
    })
    return json(res)
  },

  // Coupon validate
  async validateCoupon(code: string, productId: string, quantity = 1, unitPrice?: number): Promise<{ valid: boolean; code?: string; description?: string | null; discountPercent?: number; discountAmount?: number; discountValue?: number; originalTotal?: number; newTotal?: number; message?: string }> {
    const res = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, productId, quantity, unitPrice }),
    })
    return json(res)
  },

  async listOrders(admin = false): Promise<Order[]> {
    const url = admin ? '/api/orders?admin=1' : '/api/orders'
    const res = await fetch(url)
    const data = await json<{ orders: Order[] }>(res)
    return data.orders
  },

  // Admin
  async adminStats(): Promise<AdminStats> {
    const res = await fetch('/api/admin/stats')
    return json(res)
  },

  async adminListUsers(): Promise<any[]> {
    const res = await fetch('/api/admin/users')
    const data = await json<{ users: any[] }>(res)
    return data.users
  },

  // Admin: manually create a user account.
  async adminCreateUser(payload: {
    name: string
    email: string
    password: string
    role: 'BUYER' | 'VENDOR' | 'ADMIN'
    status: 'ACTIVE' | 'PENDING'
    sendWelcomeEmail?: boolean
  }): Promise<{ user: any; setupUrl?: string | null }> {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return json<{ user: any; setupUrl?: string | null }>(res)
  },

  async adminAdjustBalance(userId: string, amount: number, reason: string): Promise<{ user: { id: string; balance: number }; deposit: Deposit }> {
    const res = await fetch(`/api/admin/users/${userId}/balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, reason }),
    })
    return json(res)
  },

  // Settings
  async getSettings(): Promise<PublicSettings> {
    const res = await fetch('/api/settings')
    return json(res)
  },

  async updateSettings(payload: Partial<PublicSettings>): Promise<PublicSettings> {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return json(res)
  },
}
