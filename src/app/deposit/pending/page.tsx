import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { DepositPendingPage } from '@/components/public/DepositPendingPage'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

// Transactional page — keep it out of the index.
export const metadata: Metadata = {
  title: 'Deposit pending',
  robots: { index: false, follow: false },
}

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams
  if (!id) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/?signin=1')

  const deposit = await db.deposit.findUnique({
    where: { id },
    include: {
      wallet: { select: { id: true, network: true, address: true } },
    },
  })
  if (!deposit || deposit.userId !== user.id) notFound()

  // Fetch Telegram support URL + siteName from settings for the contact buttons
  const settingsRows = await db.setting.findMany({
    where: { key: { in: ['siteName', 'telegramSupportUrl', 'supportEmail'] } },
  })
  const settingsMap: Record<string, string> = {}
  for (const r of settingsRows) settingsMap[r.key] = r.value

  return (
    <DepositPendingPage
      deposit={{
        id: deposit.id,
        network: deposit.network,
        amount: deposit.amount,
        txHash: deposit.txHash,
        status: deposit.status as 'PENDING' | 'APPROVED' | 'REJECTED',
        createdAt: deposit.createdAt.toISOString(),
        walletAddress: deposit.wallet?.address ?? null,
      }}
      siteName={settingsMap.siteName ?? 'DigitalVault'}
      telegramUrl={settingsMap.telegramSupportUrl || null}
      supportEmail={settingsMap.supportEmail || null}
    />
  )
}
