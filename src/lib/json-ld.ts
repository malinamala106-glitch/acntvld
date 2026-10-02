/**
 * Safe JSON-LD serialisation.
 *
 * Why this exists: every JSON-LD block on the site is rendered with
 * `dangerouslySetInnerHTML={{ __html: JSON.stringify(x) }}`. React does not
 * escape the *contents* of a script element when you inject HTML, and the HTML
 * parser terminates a `<script>` element at the first `</script` it sees. So a
 * product name of
 *
 *     AuditXSS </script><script>window.__xss_executed=1</script>
 *
 * closed the JSON-LD block early and the remainder was parsed by the browser as
 * a real script element — stored XSS for every visitor of the page. (Verified in
 * the 2026-10-02 audit: the injected script executed in a real browser.)
 *
 * Escaping `<`, `>` and `&` as their JSON `\uXXXX` equivalents keeps the value
 * semantically identical JSON — `JSON.parse` yields exactly the same object —
 * while making it impossible for the payload to leave the script element. The
 * two Unicode line separators are escaped because they are literal line
 * terminators in JavaScript source, which is the classic
 * "JSON is not JavaScript" trap.
 *
 * This is the same escaping the Next.js documentation recommends for
 * `application/ld+json` blocks.
 */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
