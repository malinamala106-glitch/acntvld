/**
 * URL-slug helper shared by the admin create/update routes.
 *
 * Produces lowercase, hyphen-separated ASCII so slugs stay safe in a URL and
 * stable when a title contains punctuation, emoji or accented characters.
 */
export function slugify(input: string, fallbackPrefix = 'post', maxLength = 80): string {
  const slug = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Drop combining accents so "Café" becomes "cafe" rather than "caf".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')

  return slug || `${fallbackPrefix}-${Date.now()}`
}

/** Append a short random suffix — used to break a slug collision. */
export function withSlugSuffix(slug: string, maxLength = 80): string {
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${slug.slice(0, Math.max(1, maxLength - suffix.length - 1))}-${suffix}`
}
