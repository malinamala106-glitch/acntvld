import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, requireAdmin } from '@/lib/auth'

// Public/buyer: list active wallets (for deposit page)
// Admin: list all wallets
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const admin = searchParams.get('admin') === '1'
  if (admin) {
    try {
      await requireAdmin()
      const wallets = await db.cryptoWallet.findMany({ orderBy: { createdAt: 'desc' } })
      return NextResponse.json({ wallets })
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  const wallets = await db.cryptoWallet.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ wallets })
}

// Admin: add wallet
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await req.json()
    const { network, address, label, isActive } = body || {}
    if (!network || !address) {
      return NextResponse.json({ error: 'Network and address are required' }, { status: 400 })
    }
    const wallet = await db.cryptoWallet.create({
      data: {
        network: String(network),
        address: String(address),
        label: label || null,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      },
    })
    return NextResponse.json({ wallet })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to add wallet' }, { status: 500 })
  }
}
