import DOMPurify from 'isomorphic-dompurify'

/**
 * Sanitize an admin-authored HTML string (product descriptions with
 * `renderHtml: true`) so it can be rendered with dangerouslySetInnerHTML.
 *
 * DOMPurify's defaults are used on purpose: they strip scripts, event handler
 * attributes (onclick, onerror, …) and `javascript:` URLs while keeping the
 * formatting tags the rich-text editor produces (headings, lists, links,
 * emphasis…). The SVG/MathML profiles stay enabled so mixed content is handled
 * safely on both server and client — the `isomorphic-` package picks jsdom on
 * the server and the real DOM in the browser.
 *
 * Returns '' for null/undefined/non-string input so callers can fall through
 * to the empty-description UI.
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (typeof dirty !== 'string' || !dirty) return ''
  return DOMPurify.sanitize(dirty)
}
