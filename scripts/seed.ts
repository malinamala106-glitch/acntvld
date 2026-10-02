// Seed script: create an admin user, demo buyer, crypto wallets, sample products, and default settings
// Run with: bun run /home/z/my-project/scripts/seed.ts
import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/password'

/**
 * Resolve a password for a seeded account.
 *
 * There is deliberately no default password in this file any more. A password
 * hard-coded here lives in git, in every environment that runs the seeder, and
 * (until 2026-10-02) was printed on the public login screen — anyone who
 * visited the site could sign in as admin. Supply one through the environment,
 * or let the seeder mint a random one and print it exactly once.
 */
function seedPassword(envVar: string, label: string): string {
  const fromEnv = process.env[envVar]?.trim()
  if (fromEnv) {
    if (fromEnv.length < 8) {
      throw new Error(`${envVar} is too short (minimum 8 characters).`)
    }
    return fromEnv
  }
  const generated = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
  console.log(
    `\n  ${envVar} is not set — generated a random password for the ${label}:\n` +
      `     ${generated}\n` +
      `     Save it now in your password manager. It is not stored anywhere else.\n`,
  )
  return generated
}

async function main() {
  // Seeding writes an admin account. Never do that against a production
  // database, whatever the rest of the environment looks like.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed while NODE_ENV=production.')
  }

  const adminEmail = 'admin@asset.shop'

  // 1. Admin user
  let admin = await db.user.findUnique({ where: { email: adminEmail } })
  if (!admin) {
    const adminPass = seedPassword('ADMIN_SEED_PASSWORD', 'admin account')
    admin = await db.user.create({
      data: {
        email: adminEmail,
        passwordHash: hashPassword(adminPass),
        name: 'Admin',
        role: 'ADMIN',
        balance: 0,
      },
    })
    console.log(`Admin created: ${adminEmail}`)
  } else {
    if (admin.role !== 'ADMIN') {
      admin = await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } })
    }
    console.log(`Admin exists: ${adminEmail}`)
  }

  // 2. Demo buyer
  let buyer = await db.user.findUnique({ where: { email: 'demo@buyer.shop' } })
  if (!buyer) {
    const buyerPass = seedPassword('BUYER_SEED_PASSWORD', 'demo buyer account')
    buyer = await db.user.create({
      data: {
        email: 'demo@buyer.shop',
        passwordHash: hashPassword(buyerPass),
        name: 'Demo Buyer',
        role: 'BUYER',
        balance: 100,
      },
    })
    console.log('Demo buyer created: demo@buyer.shop (balance 100)')
  } else {
    console.log('Demo buyer exists')
  }

  // 3. Default settings
  const existingSettings = await db.setting.count()
  if (existingSettings === 0) {
    await db.setting.createMany({
      data: [
        { key: 'minDepositAmount', value: '1' },
        { key: 'siteName', value: 'DigitalVault' },
        { key: 'supportEmail', value: 'support@digitalvault.example' },
        // USDT deposit addresses per network (demo values — admin can change from dashboard)
        { key: 'usdtWalletBEP20', value: '0x8924A4fBc21B5fB08d42e9Bc7C9e7F3d2B1c8dE5' },
        { key: 'usdtWalletERC20', value: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1' },
        { key: 'usdtWalletTRX20', value: 'TJYjsWqz9XqZyRqLpN8yYpXvWqF3hT8kQ5' },
        { key: 'usdtWalletPolygon20', value: '0x4f3eD5C8b7a2E1f3b9C4d5E6f7A8B9C0D1E2F3a4B' },
        // Telegram support URL shown on the deposit pending page
        { key: 'telegramSupportUrl', value: 'https://t.me/digitalvault_support' },
      ],
    })
    console.log('Default settings created (minDeposit=1, USDT wallets configured)')
  } else {
    // Settings already exist — make sure the USDT wallet keys exist (idempotent insert)
    const requiredKeys = ['usdtWalletBEP20', 'usdtWalletERC20', 'usdtWalletTRX20', 'usdtWalletPolygon20', 'telegramSupportUrl']
    for (const key of requiredKeys) {
      const exists = await db.setting.findUnique({ where: { key } })
      if (!exists) {
        let value = ''
        if (key === 'usdtWalletBEP20') value = '0x8924A4fBc21B5fB08d42e9Bc7C9e7F3d2B1c8dE5'
        else if (key === 'usdtWalletERC20') value = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1'
        else if (key === 'usdtWalletTRX20') value = 'TJYjsWqz9XqZyRqLpN8yYpXvWqF3hT8kQ5'
        else if (key === 'usdtWalletPolygon20') value = '0x4f3eD5C8b7a2E1f3b9C4d5E6f7A8B9C0D1E2F3a4B'
        else if (key === 'telegramSupportUrl') value = 'https://t.me/digitalvault_support'
        if (value) {
          await db.setting.create({ data: { key, value } })
        }
      }
    }
  }

  // 4. Crypto wallets — keep at least one per network so the network-first picker works
  const walletCount = await db.cryptoWallet.count()
  if (walletCount === 0) {
    await db.cryptoWallet.createMany({
      data: [
        { network: 'USDT-TRC20', address: 'TJYjsWqz9XqZyRqLpN8yYpXvWqF3hT8kQ5', label: 'Primary TRC20' },
        { network: 'USDT-TRC20', address: 'TRwb3y2n9kYxQmBpN4tZsWqfLpVhXk1jRu', label: 'Backup TRC20' },
        { network: 'USDT-ERC20', address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1', label: 'Primary ERC20' },
        { network: 'USDT-BEP20', address: '0x8924A4fBc21B5fB08d42e9Bc7C9e7F3d2B1c8dE5', label: 'BSC wallet' },
        { network: 'BTC', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', label: 'Cold storage' },
        { network: 'ETH', address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1', label: 'Primary ETH' },
        { network: 'SOL', address: '5FHwkrdxkTd3LBn9pQwEFkQz8m4Hxqk7FwvG7VcKqXJz', label: 'Solana main' },
        { network: 'LTC', address: 'ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', label: 'Litecoin' },
        { network: 'TRX', address: 'TJYjsWqz9XqZyRqLpN8yYpXvWqF3hT8kQ5', label: 'Tron native' },
      ],
    })
    console.log('9 crypto wallets created across 7 networks')
  }

  // 5. Sample products — comprehensive catalog (idempotent: skip if name exists)
  const products = [
    {
      name: 'Windows 11 Pro License',
      description: 'Genuine Windows 11 Pro activation key. Lifetime activation for one device. Works worldwide, supports all languages. Activation via Microsoft activation wizard.',
      category: 'Operating Systems',
      price: 19.99,
      image: '🪟',
      keys: [
        'W11P-XXXXX-AAAAA-BBBBB-11111',
        'W11P-XXXXX-CCCCC-DDDDD-22222',
        'W11P-XXXXX-EEEEE-FFFFF-33333',
        'W11P-XXXXX-GGGGG-HHHHH-44444',
        'W11P-XXXXX-IIIII-JJJJJ-55555',
      ],
    },
    {
      name: 'Office 2021 Pro Plus',
      description: 'Microsoft Office 2021 Professional Plus key. Includes Word, Excel, PowerPoint, Outlook, Access, Publisher. Lifetime activation on one PC.',
      category: 'Productivity',
      price: 29.99,
      image: '📄',
      keys: [
        'OFF21-AAAAA-BBBBB-CCCCC-11111',
        'OFF21-DDDDD-EEEEE-FFFFF-22222',
        'OFF21-GGGGG-HHHHH-IIIII-33333',
      ],
    },
    {
      name: 'NordVPN 1-Year',
      description: 'NordVPN 1-year premium subscription activation code. Activate at nordvpn.com/redeem. Connect up to 6 devices. Includes 5400+ servers in 60 countries.',
      category: 'VPN',
      price: 12.5,
      image: '🛡️',
      keys: [
        'NORD-1YR-AAAA-1111',
        'NORD-1YR-BBBB-2222',
        'NORD-1YR-CCCC-3333',
        'NORD-1YR-DDDD-4444',
        'NORD-1YR-EEEE-5555',
        'NORD-1YR-FFFF-6666',
        'NORD-1YR-GGGG-7777',
      ],
    },
    {
      name: 'Adobe Creative Cloud 1M',
      description: 'Adobe Creative Cloud All Apps — 1 month subscription. Includes Photoshop, Illustrator, InDesign, Premiere Pro, After Effects, and 20+ other apps.',
      category: 'Productivity',
      price: 9.99,
      image: '🎨',
      keys: [
        'ADBE-1M-AAAA-BBBB-1111',
        'ADBE-1M-CCCC-DDDD-2222',
      ],
    },
    {
      name: 'Spotify Premium 3M',
      description: 'Spotify Premium 3-month subscription. Ad-free music, offline listening, high-quality audio. Activate at spotify.com/redeem. Works worldwide.',
      category: 'Streaming',
      price: 8.99,
      image: '🎵',
      keys: [
        'SPOT-3M-AAAA-1111',
        'SPOT-3M-BBBB-2222',
        'SPOT-3M-CCCC-3333',
        'SPOT-3M-DDDD-4444',
      ],
    },
    {
      name: 'Netflix Premium 1M',
      description: 'Netflix Premium 1-month gift code. 4K Ultra HD streaming on 4 devices simultaneously. Activate at netflix.com/redeem.',
      category: 'Streaming',
      price: 14.99,
      image: '🎬',
      keys: [
        'NFLX-1M-AAAA-1111',
        'NFLX-1M-BBBB-2222',
        'NFLX-1M-CCCC-3333',
      ],
    },
    {
      name: 'ExpressVPN 6M',
      description: 'ExpressVPN 6-month subscription. 3000+ servers in 94 countries. Includes split tunneling, kill switch, and 24/7 support.',
      category: 'VPN',
      price: 24.99,
      image: '⚡',
      keys: [
        'EXPV-6M-AAAA-1111',
        'EXPV-6M-BBBB-2222',
        'EXPV-6M-CCCC-3333',
        'EXPV-6M-DDDD-4444',
      ],
    },
    {
      name: 'ChatGPT Plus 1M',
      description: 'ChatGPT Plus 1-month subscription. Access to GPT-4, faster response times, priority access to new features. Activate via OpenAI account.',
      category: 'AI Tools',
      price: 19.99,
      image: '🤖',
      keys: [
        'GPT-1M-AAAA-1111',
        'GPT-1M-BBBB-2222',
        'GPT-1M-CCCC-3333',
        'GPT-1M-DDDD-4444',
        'GPT-1M-EEEE-5555',
      ],
    },
    {
      name: 'Steam Gift Card $50',
      description: 'Steam digital gift card worth $50 USD. Redeem on Steam store for any game, DLC, or in-game purchase. Works in any region.',
      category: 'Gaming',
      price: 47.5,
      image: '🎮',
      keys: [
        'STM-GC-AAAA-1111-XXXX',
        'STM-GC-BBBB-2222-YYYY',
        'STM-GC-CCCC-3333-ZZZZZ',
      ],
    },
    {
      name: 'PlayStation Plus 12M',
      description: 'PlayStation Plus 12-month subscription (Essential tier). Online multiplayer, 2 free games monthly, exclusive discounts. Region: US account.',
      category: 'Gaming',
      price: 39.99,
      image: '🕹️',
      keys: [
        'PSN-12M-AAAA-1111',
        'PSN-12M-BBBB-2222',
      ],
    },
    {
      name: 'Microsoft 365 Family 12M',
      description: 'Microsoft 365 Family — 12 months. Up to 6 users, each gets 1TB OneDrive storage. Includes Word, Excel, PowerPoint, Outlook. Activation via microsoft365.com/setup.',
      category: 'Productivity',
      price: 49.99,
      image: '💼',
      keys: [
        'M365-FAM-AAAA-1111',
        'M365-FAM-BBBB-2222',
        'M365-FAM-CCCC-3333',
      ],
    },
    {
      name: 'Discord Nitro 1M',
      description: 'Discord Nitro 1-month subscription. Includes 2 Server Boosts, 500MB upload limit, HD video streaming, custom profile, and access to Nitro-exclusive stickers.',
      category: 'Social',
      price: 6.99,
      image: '💬',
      keys: [
        'NITRO-1M-AAAA-1111',
        'NITRO-1M-BBBB-2222',
        'NITRO-1M-CCCC-3333',
        'NITRO-1M-DDDD-4444',
      ],
    },
  ]

  let addedCount = 0
  for (const p of products) {
    const existing = await db.product.findFirst({ where: { name: p.name } })
    if (existing) {
      // Already exists — skip
      continue
    }
    await db.product.create({
      data: {
        name: p.name,
        description: p.description,
        category: p.category,
        price: p.price,
        image: p.image,
        stock: p.keys.length,
        keys: p.keys.length ? { create: p.keys.map((k) => ({ key: k })) } : undefined,
      },
    })
    addedCount++
  }
  if (addedCount > 0) {
    console.log(`${addedCount} new sample products added (out of ${products.length} total defined)`)
  } else {
    console.log('All sample products already exist')
  }

  // 6. Demo auctions (special deals)
  const existingAuctions = await db.auction.count()
  if (existingAuctions === 0) {
    const now = Date.now()
    const HOUR = 60 * 60 * 1000
    const DAY = 24 * HOUR
    await db.auction.createMany({
      data: [
        {
          title: 'Netflix Premium 4K — 1 month',
          slug: 'netflix-premium-4k-1-month',
          description: 'Netflix Premium account with 4K UHD streaming. Works on all devices. Email + password delivery.',
          category: 'Streaming',
          askingPrice: 5,
          currentBid: 5,
          image: '🎬',
          endsAt: new Date(now + 2 * DAY + 4 * HOUR),
          status: 'ACTIVE',
          deliveryFormat: 'Email + password',
          isActive: true,
        },
        {
          title: 'ChatGPT Plus — 1 month',
          slug: 'chatgpt-plus-1-month',
          description: 'OpenAI ChatGPT Plus subscription account. Access GPT-4, DALL·E, and priority access during peak hours.',
          category: 'AI Tools',
          askingPrice: 10,
          currentBid: 12.5,
          image: '🤖',
          endsAt: new Date(now + 18 * HOUR),
          status: 'ACTIVE',
          deliveryFormat: 'Email + password',
          isActive: true,
        },
        {
          title: 'Spotify Premium Family — 3 months',
          slug: 'spotify-premium-family-3-months',
          description: 'Spotify Premium Family plan slot. Ad-free music + offline downloads + unlimited skips.',
          category: 'Music',
          askingPrice: 8,
          currentBid: 8,
          image: '🎵',
          endsAt: new Date(now + 5 * DAY),
          status: 'ACTIVE',
          deliveryFormat: 'Invitation link',
          isActive: true,
        },
        {
          title: 'Steam Gift Card $50',
          slug: 'steam-gift-card-50',
          description: 'Steam digital gift card worth $50 USD. Redeemable on any Steam account.',
          category: 'Gaming',
          askingPrice: 40,
          currentBid: 45,
          image: '🎮',
          endsAt: new Date(now + 3 * DAY + 12 * HOUR),
          status: 'ACTIVE',
          deliveryFormat: 'Gift card code',
          isActive: true,
        },
        {
          title: 'NordVPN 2-Year Subscription',
          slug: 'nordvpn-2-year-subscription',
          description: 'NordVPN 2-year premium subscription account. Protect your privacy, bypass geo-blocks, ultra-fast streaming.',
          category: 'VPN',
          askingPrice: 20,
          currentBid: 22,
          image: '🔒',
          endsAt: new Date(now + 8 * HOUR),
          status: 'ACTIVE',
          deliveryFormat: 'Email + password',
          isActive: true,
        },
        {
          title: 'YouTube Premium Family — 6 months',
          slug: 'youtube-premium-family-6-months',
          description: 'YouTube Premium family plan slot. Ad-free YouTube + YouTube Music + background play.',
          category: 'Streaming',
          askingPrice: 12,
          currentBid: 12,
          image: '📺',
          endsAt: new Date(now + 6 * DAY + 6 * HOUR),
          status: 'ACTIVE',
          deliveryFormat: 'Invitation link',
          isActive: true,
        },
      ],
    })
    console.log('Demo auctions created (6 special deals)')
  } else {
    console.log(`${existingAuctions} auctions already exist`)
  }

  // 7. Demo blog posts
  const existingBlogPosts = await db.blogPost.count()
  if (existingBlogPosts === 0) {
    await db.blogPost.createMany({
      data: [
        {
          title: 'How to Buy Digital Accounts Safely',
          slug: 'how-to-buy-digital-accounts-safely',
          excerpt: 'A complete buyer\'s guide to safely purchasing digital accounts, license keys, and subscriptions online.',
          content: `Buying digital accounts and license keys online can be risky if you don't know what to look for. In this guide, we'll walk through the essential steps every buyer should take to protect themselves.

## 1. Always use escrow or trusted platforms

When you buy from a marketplace like DigitalVault, your funds are held safely until the transaction completes. This protects both you and the seller.

## 2. Verify the seller's reputation

Check the seller's history — number of completed sales, ratings, and how long they've been active. New sellers with no track record should be approached with caution.

## 3. Use a unique password

After receiving your account credentials, immediately change the password to something only you know. Don't reuse passwords across services.

## 4. Enable two-factor authentication

If the service supports it, enable 2FA. This prevents the original seller from reclaiming the account later.

## 5. Keep proof of purchase

Save your order confirmation, transaction ID, and any chat logs. If anything goes wrong, you'll need these to file a dispute or contact support.

Stay safe out there, and happy shopping!`,
          coverImage: '🛡️',
          tags: 'safety,buyer-guide,security',
          isPublished: true,
        },
        {
          title: 'Top 5 Streaming Deals This Week',
          slug: 'top-5-streaming-deals-this-week',
          excerpt: 'Hand-picked deals on Netflix, Spotify, YouTube Premium, and more — updated weekly.',
          content: `Looking for the best streaming deals? Here are this week's top 5 picks, all available on the DigitalVault marketplace.

## 1. Netflix Premium 4K — 1 month

The gold standard of streaming. 4K UHD quality, 4 simultaneous streams, and access to the full Netflix library. Perfect for families.

## 2. Spotify Premium Family — 3 months

Six Premium accounts for family members under one roof. Ad-free music, offline downloads, and unlimited skips.

## 3. YouTube Premium Family — 6 months

Ad-free YouTube, background play, YouTube Music Premium, and YouTube Originals. One of the best value deals around.

## 4. Disney+ Hotstar Premium — 1 month

All the Marvel, Star Wars, Pixar, and Disney content you can handle. Plus live sports in select regions.

## 5. HBO Max — 3 months

Watch Westworld, Succession, Game of Thrones, and the full HBO back catalog. A must-have for prestige TV fans.

All deals are verified and delivered instantly after purchase. Don't miss out!`,
          coverImage: '🎬',
          tags: 'streaming,deals,weekly-picks',
          isPublished: true,
        },
        {
          title: 'Understanding Crypto Deposits: A Beginner\'s Guide',
          slug: 'understanding-crypto-deposits-beginners-guide',
          excerpt: 'New to crypto payments? Learn how to deposit USDT and start buying digital goods in minutes.',
          content: `Crypto deposits can feel intimidating if you've never done one before. This guide walks you through the entire process step by step.

## What you'll need

- A crypto wallet (like Trust Wallet, MetaMask, or Binance)
- Some USDT (Tether) in your wallet
- Your DigitalVault account

## Step 1: Choose how much to deposit

Head to the Deposit page and enter the amount you want to add to your balance. The minimum is $1 USD.

## Step 2: Pick a network

We support four networks for USDT deposits:
- **BEP20 (BSC)** — usually the cheapest network fees
- **ERC20 (Ethereum)** — the most widely supported
- **TRX20 (Tron)** — fast and low-cost
- **Polygon20** — great for small amounts

## Step 3: Send the USDT

Copy the deposit address shown on the review page (or scan the QR code with your wallet app). Send exactly the amount you entered.

## Step 4: Submit the transaction ID

After sending, your wallet will give you a transaction hash (TRX ID). Paste it into the confirmation box and click "Confirm Deposit."

## Step 5: Wait for admin verification

Our team manually verifies each deposit. Your balance will be credited once approved — usually within a few minutes.

That's it! Once your balance is funded, you can start shopping immediately.`,
          coverImage: '💰',
          tags: 'crypto,deposits,guide,usdt',
          isPublished: true,
        },
        {
          title: 'How Special Deals Auctions Work',
          slug: 'how-special-deals-auctions-work',
          excerpt: 'Everything you need to know about bidding on our exclusive special deals auctions.',
          content: `Our Special Deals section lets you bid on premium digital accounts at prices you won't find anywhere else. Here's how it works.

## What are Special Deals?

Special Deals are time-limited auctions for premium digital accounts — things like Netflix Premium, ChatGPT Plus, NordVPN subscriptions, and more.

## How do I bid?

1. **Sign in** — you need a registered account to bid.
2. **Browse** the active auctions on the Special Deals page.
3. **Click "Place Bid"** on any auction you're interested in.
4. **Enter your bid amount** — it must be at least $0.01 higher than the current highest bid.
5. **Confirm** — the bid amount is locked from your wallet.

## What happens to my locked funds?

When you place a bid, the bid amount is moved from your free balance to your "locked balance." It's still your money — it's just held as a guarantee that you'll pay if you win.

- If someone **outbids you**, your locked funds are automatically refunded to your free balance.
- If you **win the auction**, your locked funds are used to pay for the item.
- If you need your funds back early, contact support — the admin can release them manually.

## What if I win?

When the auction countdown ends, the highest bidder wins. The locked funds are converted to payment, and the digital account credentials are delivered to your account.

## Tips for successful bidding

- **Bid late** — sniping in the last few seconds can prevent bidding wars
- **Set a max bid** — decide beforehand how much you're willing to pay, and stick to it
- **Watch the countdown** — auctions can end any second

Happy bidding!`,
          coverImage: '🔨',
          tags: 'auctions,special-deals,guide',
          isPublished: true,
        },
      ],
    })
    console.log('Demo blog posts created (4 posts)')
  } else {
    console.log(`${existingBlogPosts} blog posts already exist`)
  }

  // 8. Demo social links (admin-managed contact buttons shown in footer + top nav)
  const existingSocialLinks = await db.socialLink.count()
  if (existingSocialLinks === 0) {
    await db.socialLink.createMany({
      data: [
        { platform: 'telegram',  url: 'https://t.me/digitalvault_support', label: 'Telegram',  order: 0, isActive: true },
        { platform: 'facebook',  url: 'https://facebook.com/digitalvault', label: 'Facebook',  order: 1, isActive: true },
        { platform: 'instagram', url: 'https://instagram.com/digitalvault', label: 'Instagram', order: 2, isActive: true },
        { platform: 'reddit',    url: 'https://reddit.com/r/digitalvault', label: 'Reddit',    order: 3, isActive: true },
        { platform: 'email',     url: 'mailto:support@digitalvault.example', label: 'Email',  order: 4, isActive: true },
      ],
    })
    console.log('Demo social links created (5 channels: Telegram, Facebook, Instagram, Reddit, Email)')
  } else {
    console.log(`${existingSocialLinks} social links already exist`)
  }

  console.log('\nSeed complete.')
  console.log(`Admin login: ${adminEmail}`)
  console.log('Buyer login: demo@buyer.shop')
  console.log(
    'Passwords are never printed here: they come from ADMIN_SEED_PASSWORD /\n' +
      'BUYER_SEED_PASSWORD, or from the random values printed once at creation.',
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
