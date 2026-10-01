import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, requireAdmin } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { depositCreateSchema } from '@/lib/validation'

// Buyer: create a deposit request (always manual approval, no auto-credit)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Abuse guard: 3 deposit submissions per hour per user (blunts spray-and-
    // pray txhash spam while leaving genuine retries unaffected).
    const rl = rateLimit({ scope: 'deposits:create', identifier: user.id, limit: 3, windowMs: 60 * 60 * 1000 })
    if (!rl.ok) return rateLimitResponse(rl)

    const body = await req.json()

    // ---- Schema validation (Zod) ----
    const parsed = depositCreateSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ error: issue?.message || 'Invalid deposit details' }, { status: 400 })
    }
    const { walletId, network, txHash, note } = parsed.data
    const amount = parsed.data.amount
    const roundedAmount = Math.round(amount * 100) / 100

    // Validate against global minDepositAmount
    const setting = await db.setting.findUnique({ where: { key: 'minDepositAmount' } })
    const minAmount = setting ? (parseFloat(setting.value) || 0) : 0
    if (roundedAmount < minAmount) {
      return NextResponse.json(
        { error: `Minimum deposit amount is ${minAmount.toFixed(2)} USD` },
        { status: 400 }
      )
    }

    // If walletId provided, it must exist, be active, and match the network
    let wallet: { id: string; network: string; isActive: boolean } | null = null
    if (walletId) {
      wallet = await db.cryptoWallet.findUnique({
        where: { id: walletId },
        select: { id: true, network: true, isActive: true },
      })
      if (!wallet) {
        return NextResponse.json({ error: 'Selected wallet not found' }, { status: 400 })
      }
      if (!wallet.isActive) {
        return NextResponse.json({ error: 'Selected wallet is no longer active' }, { status: 400 })
      }
      if (wallet.network !== network) {
        return NextResponse.json({ error: 'Wallet does not match the selected network' }, { status: 400 })
      }
    }

    // txHash optional but if provided must be a reasonable string
    const txHashStr = txHash ? String(txHash).trim().slice(0, 256) : null
    const noteStr = note ? String(note).trim().slice(0, 500) : null

    const deposit = await db.deposit.create({
      data: {
        userId: user.id,
        walletId: wallet?.id ?? null,
        network: String(network),
        amount: roundedAmount,
        txHash: txHashStr,
        note: noteStr,
        type: 'CRYPTO',
        status: 'PENDING', // Always manual approval
      },
    })

    // Log the deposit request
    const refId = generateReferenceId('TXN')
    await logActivity({
      userId: user.id,
      userEmail: user.email,
      actionType: 'DEPOSIT',
      action: 'Deposit submitted',
      description: `Deposited $${roundedAmount.toFixed(2)} via ${network}${txHashStr ? ` (TX: ${txHashStr.slice(0, 16)}…)` : ''}`,
      status: 'PENDING',
      referenceId: refId,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: { depositId: deposit.id, amount: roundedAmount, network, txHash: txHashStr },
    })

    return NextResponse.json({ deposit })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create deposit' }, { status: 500 })
  }
}

// Buyer: list own deposits. Admin: list all deposits
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const admin = searchParams.get('admin') === '1'

    if (admin) {
      try {
        await requireAdmin()
        const deposits = await db.deposit.findMany({
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, email: true, name: true } },
            wallet: { select: { id: true, network: true, address: true } },
          },
        })
        return NextResponse.json({ deposits })
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Bounded at 100 (newest first) — same rationale as the orders list.
    const deposits = await db.deposit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        wallet: { select: { id: true, network: true, address: true } },
      },
    })
    return NextResponse.json({ deposits })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load deposits' }, { status: 500 })
  }
}
