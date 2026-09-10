// A small visual identity per instrument — a monogram + a stable tint — so the Library,
// the locked Ask header and the manual page can carry a bit of character without noise.
// Deterministic from the instrument name; no config.

const TINTS = ['#0f6b62', '#7a5b3a', '#4a5b8c', '#8c4a63', '#3f7d3f', '#8a5a1e']

// initials: first letter of up to three "significant" words; for a single word, its
// first three letters. Upper-cased.
function initials(name: string): string {
  const words = name
    .replace(/[()/-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(the|and|of|for|in|a|an|scale|test|inventory|manual)$/i.test(w))
  const src = words.length > 0 ? words : name.split(/\s+/).filter(Boolean)
  if (src.length === 1) return src[0].slice(0, 3).toUpperCase()
  return src
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3)
}

function tintFor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

export function instrumentBadge(name: string | null | undefined): {
  initials: string
  tint: string
} {
  const n = (name ?? '').trim()
  if (!n) return { initials: 'M', tint: TINTS[0] }
  return { initials: initials(n) || 'M', tint: tintFor(n.toLowerCase()) }
}
