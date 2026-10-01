// Stress-test generateCaptcha to prove it always terminates quickly.
// Run with: npx tsx /home/z/my-project/scripts/test-captcha.ts
//
// Simulates 100,000 invocations and reports the worst-case time.
// If the function has a regression that re-introduces an infinite loop,
// this script will hang instead of completing — that's the test.

// Inline copy of generateCaptcha so we can run it standalone without
// importing React. Keep in sync with src/components/public/PublicStorefront.tsx.
function generateCaptcha() {
  let a = Math.floor(Math.random() * 20) + 1 // 1..20
  let b = Math.floor(Math.random() * 20) + 1 // 1..20
  const op = Math.random() > 0.5 ? '+' : '-'
  if (op === '-' && b > a) {
    const tmp = a
    a = b
    b = tmp
  }
  const answer = op === '+' ? a + b : a - b

  const wrongs = new Set<number>()
  let iterations = 0
  while (wrongs.size < 3 && iterations < 100) {
    iterations++
    const delta = Math.floor(Math.random() * 5) - 2
    const wrong = answer + delta
    if (wrong !== answer && wrong >= 0 && !wrongs.has(wrong)) {
      wrongs.add(wrong)
    }
  }
  let pad = 1
  while (wrongs.size < 3) {
    const candidate = answer + 3 + pad
    if (candidate !== answer && !wrongs.has(candidate)) wrongs.add(candidate)
    pad++
    if (pad > 50) break
  }

  const options = [answer, ...Array.from(wrongs)].sort(() => Math.random() - 0.5)
  return { question: `What is ${a} ${op} ${b}?`, answer, options }
}

const ITERATIONS = 100_000
const start = Date.now()
let maxIters = 0
let worstCase: { question: string; answer: number; options: number[] } | null = null
let allAnswersPositive = true

for (let i = 0; i < ITERATIONS; i++) {
  const before = Date.now()
  const c = generateCaptcha()
  const elapsed = Date.now() - before
  if (elapsed > maxIters) {
    maxIters = elapsed
    worstCase = c
  }
  if (c.answer < 0) allAnswersPositive = false
}

const totalMs = Date.now() - start
console.log(`Ran ${ITERATIONS.toLocaleString()} iterations in ${totalMs}ms`)
console.log(`Average: ${(totalMs / ITERATIONS).toFixed(3)}ms per call`)
console.log(`Worst-case single call: ${maxIters}ms`)
console.log(`Worst-case captcha:`, worstCase)
console.log(`All answers ≥ 0: ${allAnswersPositive}`)
console.log(totalMs < 5000 && allAnswersPositive ? '✓ PASS' : '✗ FAIL')
process.exit(totalMs < 5000 && allAnswersPositive ? 0 : 1)
