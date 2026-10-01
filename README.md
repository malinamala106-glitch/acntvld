# acntvld

DigitalVault — a Next.js storefront with products, auctions, deposits, licenses, and an admin audit trail.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui
- Prisma 6 + SQLite (`prisma/dev.db`)
- Bun (dev server, scripts)

## Getting started

```bash
bun install
cp .env.example .env   # then fill in your secrets
bun run db:push        # push the Prisma schema to the DB
bun run dev            # http://localhost:3000
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start the dev server on :3000 |
| `bun run build` | Production build (standalone output) |
| `bun run start` | Run the production server |
| `bun run db:push` | Push schema changes to the database |
| `bun run db:backup` | Snapshot the local DB to `prisma/backups/` |
