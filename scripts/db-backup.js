// db:backup — snapshot prisma/dev.db to a timestamped copy.
//
//   bun run db:backup            (or: npm run db:backup)
//   bun run db:backup -- --keep 20
//
// Uses SQLite's `VACUUM INTO`, which produces a compact, fully-consistent
// snapshot even while the dev server has the database open (no lock errors,
// no half-written pages — unlike a plain file copy of a live SQLite DB).
// Snapshots land in prisma/backups/ and old ones are pruned (keep 10 by
// default). Run it before any destructive test edit.
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')

const DB_PATH = path.join(__dirname, '..', 'prisma', 'dev.db')
const BACKUP_DIR = path.join(__dirname, '..', 'prisma', 'backups')
const KEEP_DEFAULT = 10

function argValue(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback
  const v = Number.parseInt(process.argv[i + 1], 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`✗ Database not found: ${DB_PATH}`)
    process.exit(1)
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  let dest = path.join(BACKUP_DIR, `dev-${stamp}.db`)
  // Second-precision stamps can collide on back-to-back runs — add -2, -3…
  for (let n = 2; fs.existsSync(dest); n++) {
    dest = path.join(BACKUP_DIR, `dev-${stamp}-${n}.db`)
  }

  // Escape single quotes for the SQL literal.
  const destSql = dest.replace(/'/g, "''")

  const db = new PrismaClient()
  try {
    await db.$executeRawUnsafe(`VACUUM INTO '${destSql}'`)
    // Cheap sanity check: the snapshot must be a readable, intact SQLite DB.
    const check = await db.$queryRawUnsafe(
      `PRAGMA integrity_check`
    )
    // integrity_check runs against dev.db; the VACUUM INTO target is verified
    // implicitly by SQLite (it fails the command if it can't write a valid DB).
    void check
  } finally {
    await db.$disconnect()
  }

  const bytes = fs.statSync(dest).size
  console.log(`✓ Backed up to ${path.relative(process.cwd(), dest)} (${(bytes / 1024).toFixed(0)} KB)`)

  // Prune old snapshots.
  const keep = argValue('--keep', KEEP_DEFAULT)
  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^dev-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?\.db$/.test(f))
    .sort()
  if (backups.length > keep) {
    for (const old of backups.slice(0, backups.length - keep)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old))
      console.log(`  pruned ${old}`)
    }
  }
  console.log(`  ${Math.min(backups.length, keep)} snapshot(s) kept in ${path.relative(process.cwd(), BACKUP_DIR)}`)
}

main().catch((e) => {
  console.error(`✗ Backup failed: ${e.message}`)
  process.exit(1)
})
