// Backfill Product.sortOrder from createdAt.
//
// Manual ordering ("lower sortOrder = higher in the list") is new, so every
// existing row starts at the schema default 0 — which would make the admin
// list look arbitrary. The storefront has always listed products
// newest-first, so seeding the newest product with 0 and the oldest with N-1
// reproduces the current listing exactly: nothing changes for buyers until an
// admin deliberately reorders.
//
// Safety: refuses to run when any product already has a non-zero sortOrder,
// because that means an admin has since reordered by hand and re-running
// would clobber their work. Pass --force to overwrite anyway.
//
// Run with:
//   bun scripts/backfill-product-order.ts

import { db } from '../src/lib/db'

async function main() {
  const force = process.argv.includes('--force')

  const products = await db.product.findMany({
    select: { id: true, name: true, sortOrder: true, createdAt: true },
  })

  if (products.length === 0) {
    console.log('No products — nothing to backfill.')
    return
  }

  const alreadyOrdered = products.filter((p) => p.sortOrder !== 0)
  if (alreadyOrdered.length > 0 && !force) {
    console.log(
      `${alreadyOrdered.length} product(s) already have a manual sortOrder — ` +
        'skipping. Re-run with --force to overwrite the current order.',
    )
    return
  }

  // Newest first, matching the previous `orderBy: { createdAt: 'desc' }`.
  const ordered = [...products].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )

  await db.$transaction(
    ordered.map((p, index) =>
      db.product.update({ where: { id: p.id }, data: { sortOrder: index } }),
    ),
  )

  console.log(`Backfilled sortOrder for ${ordered.length} product(s):`)
  ordered.forEach((p, index) => {
    if (index < 10) console.log(`  ${index}  ${p.name}`)
  })
  if (ordered.length > 10) console.log(`  … and ${ordered.length - 10} more`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })