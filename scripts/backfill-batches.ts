// Backfill existing LicenseKeys into a default Batch per product.
//
// For each product that has LicenseKeys with batchId = NULL:
//   1. Create one Batch row labeled with the product's createdAt date
//      (MM/DD/YY format), priceOverride = null (falls back to product.price).
//   2. Set batchId on all that product's batchless LicenseKeys to the new
//      Batch's id.
//
// Idempotent — safe to run multiple times. Products that already have all
// their keys assigned to a batch are skipped.
//
// Run with:
//   npx tsx /home/z/my-project/scripts/backfill-batches.ts

import { db } from '../src/lib/db'

function formatLabel(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${mm}/${dd}/${yy}`
}

async function main() {
  // Find products that have at least one LicenseKey with batchId = null.
  const productsWithBatchlessKeys = await db.product.findMany({
    where: { keys: { some: { batchId: null } } },
    select: { id: true, name: true, createdAt: true },
  })

  console.log(`Found ${productsWithBatchlessKeys.length} product(s) with batchless keys.`)

  let totalBatchesCreated = 0
  let totalKeysAssigned = 0

  for (const p of productsWithBatchlessKeys) {
    // Create a default batch labeled with the product's createdAt.
    const label = formatLabel(p.createdAt)
    const batch = await db.batch.create({
      data: {
        productId: p.id,
        label,
        priceOverride: null, // falls back to product.price
      },
    })
    totalBatchesCreated += 1

    // Assign all batchless keys for this product to the new batch.
    const result = await db.licenseKey.updateMany({
      where: { productId: p.id, batchId: null },
      data: { batchId: batch.id },
    })
    totalKeysAssigned += result.count
    console.log(`  ✓ Product "${p.name}" → batch "${label}" (${result.count} keys assigned)`)
  }

  console.log(`\nDone. Created ${totalBatchesCreated} default batch(es), assigned ${totalKeysAssigned} key(s).`)
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
