import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { ProductDetailPage } from '@/components/public/ProductDetailPage'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ id?: string }> }): Promise<Metadata> {
  const { id } = await searchParams
  if (!id) return { title: 'Product not found' }
  const product = await db.product.findUnique({ where: { id } })
  if (!product || !product.isActive) return { title: 'Product not found' }
  return {
    title: product.name,
    description: product.description?.slice(0, 160) || product.name,
    // Same content is served at /products/[id] — point at that clean URL so
    // the query-string variant never competes with it in search results.
    alternates: { canonical: `/products/${id}` },
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams
  if (!id) notFound()
  const product = await db.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      renderHtml: true,
      category: true,
      metadata: true,
      deliveryFormat: true,
      price: true,
      stock: true,
      image: true,
      isActive: true,
      createdAt: true,
    },
  })
  if (!product || !product.isActive) notFound()
  return <ProductDetailPage product={product} />
}
