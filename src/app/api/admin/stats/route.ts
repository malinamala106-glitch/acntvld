import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

export async function GET() {
  try {
    await requireAdmin()
    const [products, users, deposits, orders, wallets, pendingDeposits, totalSales, availableKeys] = await Promise.all([
      db.product.count(),
      db.user.count(),
      db.deposit.count(),
      db.order.count(),
      db.cryptoWallet.count(),
      db.deposit.count({ where: { status: 'PENDING' } }),
      db.order.aggregate({ _sum: { totalAmount: true } }),
      db.licenseKey.count({ where: { status: 'AVAILABLE' } }),
    ])

    return NextResponse.json({
      products,
      users,
      deposits,
      orders,
      wallets,
      pendingDeposits,
      totalSales: totalSales._sum.totalAmount || 0,
      availableKeys,
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
