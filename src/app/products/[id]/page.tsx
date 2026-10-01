import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { ProductDetailPage } from '@/components/public/ProductDetailPage'
import type { Metadata } from 'next'

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://digitalvault.example'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const product = await db.product.findUnique({ where: { id } })
  if (!product || !product.isActive) return { title: 'Product not found' }
  return {
    title: product.name,
    description: product.description?.slice(0, 160) || product.name,
    alternates: { canonical: `/products/${id}` },
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await db.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      renderHtml: true,
      category: true,
      price: true,
      stock: true,
      image: true,
      isActive: true,
      createdAt: true,
    },
  })
  if (!product || !product.isActive) notFound()

  // Product structured data — lets Google show price/availability rich results.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || product.name,
    category: product.category,
    image: product.image && (product.image.startsWith('/') || product.image.startsWith('http'))
      ? product.image.startsWith('/') ? `${baseUrl}${product.image}` : product.image
      : undefined,
    offers: {
      '@type': 'Offer',
      url: `${baseUrl}/products/${product.id}`,
      price: product.price.toFixed(2),
      priceCurrency: 'USD',
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ProductDetailPage product={product} />
    </>
  )
}
