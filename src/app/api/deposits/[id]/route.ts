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
    if (deposit.status !== 'PENDING') {
      return NextResponse.json({ error: 'Deposit already processed' }, { status: 400 })
    }

    if (action === 'approve') {
      await db.$transaction([
        db.deposit.update({
          where: { id },
          data: { status: 'APPROVED', adminNote: adminNote || null },
        }),
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
      await db.deposit.update({
        where: { id },
        data: { status: 'REJECTED', adminNote: adminNote || null },
      })
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
