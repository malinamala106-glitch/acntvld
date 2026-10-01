import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { DepositPage } from '@/components/public/DepositPage'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

// Transactional page — keep it out of the index.
export const metadata: Metadata = {
  title: 'Deposit',
  robots: { index: false, follow: false },
}

export default async function Page() {
  const user = await getCurrentUser()
  if (!user) redirect('/?signin=1')

  const [wallets, settingsRows] = await Promise.all([
    db.cryptoWallet.findMany({ orderBy: { network: 'asc' } }),
    db.setting.findMany({
      where: {
        key: {
          in: [
            'minDepositAmount',
            'siteName',
            'supportEmail',
            // USDT deposit addresses per network (set by admin via settings)
            'usdtWalletBEP20',
            'usdtWalletERC20',
            'usdtWalletTRX20',
            'usdtWalletPolygon20',
            // Optional Telegram support link shown on the pending page
            'telegramSupportUrl',
          ],
        },
      },
    }),
  ])

  const settingsMap: Record<string, string> = {}
  for (const r of settingsRows) settingsMap[r.key] = r.value

  return (
    <DepositPage
      user={user}
      wallets={wallets}
      minDeposit={parseFloat(settingsMap.minDepositAmount ?? '0') || 0}
      siteName={settingsMap.siteName ?? 'DigitalVault'}
      usdtAddresses={{
        usdtWalletBEP20: settingsMap.usdtWalletBEP20 ?? '',
        usdtWalletERC20: settingsMap.usdtWalletERC20 ?? '',
        usdtWalletTRX20: settingsMap.usdtWalletTRX20 ?? '',
        usdtWalletPolygon20: settingsMap.usdtWalletPolygon20 ?? '',
      }}
      telegramUrl={settingsMap.telegramSupportUrl || null}
    />
  )
}
