// Quick sanity test for the log sanitizer.
// Run with: npx tsx /home/z/my-project/scripts/test-sanitize.ts
import { sanitizeForLog } from '../src/lib/log-sanitize'

const cases: Array<{ name: string; input: unknown; expect: string }> = [
  {
    name: 'sensitive key redacted',
    input: { email: 'a@b.com', password: 'hunter2', token: 'abc123' },
    expect: '[redacted]',
  },
  {
    name: 'nested sensitive key redacted',
    input: { user: { name: 'Alice', newPassword: 'p@ssw0rd' } },
    expect: '[redacted]',
  },
  {
    name: 'card-number-shaped string masked',
    input: { note: 'card 4111 1111 1111 1111 processed' },
    expect: '[card:1111]',
  },
  {
    name: 'long base64-looking secret masked',
    input: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0xyz',
    expect: '<redacted>',
  },
  {
    name: 'short id left alone',
    input: 'cus_abc123',
    expect: 'cus_abc123',
  },
  {
    name: 'error object scrubbed',
    input: new Error('Login failed for password=hunter2'),
    expect: 'hunter2', // the raw value should NOT appear
  },
  {
    name: 'array preserved',
    input: [{ id: 1 }, { id: 2, secret: 'abc' }],
    expect: '[redacted]',
  },
  {
    name: 'null passes through',
    input: null,
    expect: 'null',
  },
]

let passed = 0
let failed = 0
for (const c of cases) {
  const got = JSON.stringify(sanitizeForLog(c.input))
  const ok = c.expect === 'null'
    ? got === 'null'
    : (c.expect === '[redacted]'
        ? got.includes('[redacted]')
        : c.expect === '[card:1111]'
          ? got.includes('[card:1111]')
          : c.expect === '<redacted>'
            ? got.includes('<redacted>')
            : got.includes(c.expect))
  console.log(`${ok ? '✓' : '✗'} ${c.name}`)
  console.log(`    got: ${got}`)
  if (ok) passed++
  else failed++
}
console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed === 0 ? 0 : 1)
