import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, getCurrentUser } from '@/lib/auth'
import { logActivity, getRequestIp, getRequestUserAgent, generateReferenceId } from '@/lib/activity-log'

// Admin: approve or reject a deposit. Body: { action: 'approve' | 'reject', adminNote? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json()
    const { action, adminNote } = body || {}
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const deposit = await db.deposit.findUnique({ where: { id } })
    if (!deposit) return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })

    // Claim the row atomically — this is the whole fix for the double-credit
    // race found in the 2026-10-02 audit: two parallel approvals each passed the
    // old `status === 'PENDING'` read, then each incremented the balance, so one
    // $5 deposit paid out $10.
    //
    // Putting the expected status in the WHERE clause makes the predicate and
    // the write a single atomic operation on both SQLite and Postgres, so
    // exactly one concurrent request can move a row out of PENDING. The losers
    // get count 0 and a truthful 409 instead of a second credit.
    const claimed = await db.deposit.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        adminNote: adminNote || null,
      },
    })
    if (claimed.count === 0) {
      return NextResponse.json({ error: 'Deposit already processed' }, { status: 409 })
    }

    if (action === 'approve') {
      // Safe now: the claim above succeeded exactly once for this deposit, so
      // this increment can never run twice. Deliberately at-most-once rather
      // than exactly-once — if the process dies between the two writes the
      // deposit reads APPROVED and the balance is short, which an admin can see
      // and fix. Never the other way round.
      await db.$transaction([
        db.user.update({
          where: { id: deposit.userId },
          data: { balance: { increment: deposit.amount } },
        }),
      ])
      // Log deposit approval (under the depositing user's activity + admin action trail)
      await logActivity({
        userId: deposit.userId,
        userEmail: (await db.user.findUnique({ where: { id: deposit.userId }, select: { email: true } }))?.email ?? null,
        actionType: 'DEPOSIT',
        action: 'Deposit approved',
        description: `Deposit of $${deposit.amount.toFixed(2)} via ${deposit.network} approved by admin. Balance credited.`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('TXN'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { depositId: deposit.id, amount: deposit.amount, network: deposit.network, approvedBy: admin.email },
      })
      // Admin audit entry
      await logActivity({
        userId: admin.id,
        userEmail: admin.email,
        actionType: 'ADMIN_ACTION',
        action: `Approved deposit ${deposit.id.slice(0, 8)}`,
        description: `Admin approved a $${deposit.amount.toFixed(2)} deposit (${deposit.network}) for user ${deposit.userId}`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('ADM'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { depositId: deposit.id, action: 'deposit_approve' },
      })
    } else {
      // Status was already set to REJECTED by the claim above — no second write.
      await logActivity({
        userId: deposit.userId,
        userEmail: (await db.user.findUnique({ where: { id: deposit.userId }, select: { email: true } }))?.email ?? null,
        actionType: 'DEPOSIT',
        action: 'Deposit rejected',
        description: `Deposit of $${deposit.amount.toFixed(2)} via ${deposit.network} was rejected by admin.${adminNote ? ` Note: ${adminNote}` : ''}`,
        status: 'FAILED',
        referenceId: generateReferenceId('TXN'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { depositId: deposit.id, amount: deposit.amount, network: deposit.network, rejectedBy: admin.email, adminNote: adminNote || null },
      })
      await logActivity({
        userId: admin.id,
        userEmail: admin.email,
        actionType: 'ADMIN_ACTION',
        action: `Rejected deposit ${deposit.id.slice(0, 8)}`,
        description: `Admin rejected a $${deposit.amount.toFixed(2)} deposit (${deposit.network}) for user ${deposit.userId}`,
        status: 'SUCCESS',
        referenceId: generateReferenceId('ADM'),
        ipAddress: getRequestIp(req),
        userAgent: getRequestUserAgent(req),
        metadata: { depositId: deposit.id, action: 'deposit_reject' },
      })
    }

    const updated = await db.deposit.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true, balance: true } } },
    })
    return NextResponse.json({ deposit: updated })
  } catch (e: any) {
    if (e.message === 'FORBIDDEN' || e.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to process deposit' }, { status: 500 })
  }
}
