import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { CheckoutPage } from '@/components/public/CheckoutPage'
import { toProductProps, toUserProps } from '@/lib/props'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

// Transactional page — keep it out of the index and out of the sitemap.
export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
}

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams
  if (!id) notFound()
  const [product, user] = await Promise.all([
    db.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        metadata: true,
        deliveryFormat: true,
        price: true,
        stock: true,
        image: true,
        isActive: true,
      },
    }),
    getCurrentUser(),
  ])

  if (!product || !product.isActive) notFound()
  if (!user) redirect(`/?buy=${id}`)

  return <CheckoutPage product={toProductProps(product)} user={toUserProps(user)} />
}
