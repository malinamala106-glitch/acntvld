import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'

// Admin: manually adjust a user's balance.
// Body: { amount: number (positive for credit, negative for debit), reason: string }
// Records the change as a Deposit row with type ADMIN_CREDIT or ADMIN_DEBIT.
// Logs the adjustment in the Audit Log.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { amount, reason } = body || {}

    if (typeof amount !== 'number' || !isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: 'Amount must be a non-zero number' }, { status: 400 })
    }
    const rounded = Math.round(amount * 100) / 100

    const target = await db.user.findUnique({ where: { id } })
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (target.role === 'ADMIN' && rounded < 0) {
      return NextResponse.json({ error: 'Cannot deduct from an admin account' }, { status: 400 })
    }
    if (rounded < 0 && target.balance + rounded < 0) {
      return NextResponse.json(
        { error: `Insufficient balance. User has ${target.balance.toFixed(2)} but you tried to deduct ${Math.abs(rounded).toFixed(2)}` },
        { status: 400 }
      )
    }

    const reasonText = (typeof reason === 'string' && reason.trim()) ? reason.trim().slice(0, 500) : 'Manual adjustment'
    const isCredit = rounded > 0

    const result = await db.$transaction([
      db.user.update({
        where: { id },
        data: { balance: { increment: rounded } },
      }),
      db.deposit.create({
        data: {
          userId: id,
          network: 'ADMIN',
          amount: rounded,
          type: isCredit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
          status: 'APPROVED',
          note: reasonText,
          adminNote: `By admin ${admin.email}`,
        },
      }),
    ])

    // Log in the audit trail
    await logActivity({
      userId: id,
      userEmail: target.email,
      actionType: 'ADMIN_ACTION',
      action: `Balance ${isCredit ? 'credited' : 'debited'} by admin`,
      description: `Admin ${admin.email} ${isCredit ? 'credited' : 'debited'} ${formatMoney(rounded)} to/from ${target.email}. Reason: ${reasonText}. New balance: ${result[0].balance.toFixed(2)}`,
      status: 'SUCCESS',
      referenceId: generateReferenceId('ADM'),
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
      metadata: {
        action: 'balance_adjust',
        targetUserId: id,
        targetEmail: target.email,
        amount: rounded,
        type: isCredit ? 'CREDIT' : 'DEBIT',
        reason: reasonText,
        oldBalance: target.balance,
        newBalance: result[0].balance,
        adjustedBy: admin.email,
      },
    })

    return NextResponse.json({
      user: { id: result[0].id, balance: result[0].balance },
      deposit: result[1],
    })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to adjust balance' }, { status: 500 })
  }
}

function formatMoney(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`
}
