// Shared confirm for the destructive "delete a pending version" action, so the wording
// is identical on the review screen, the library, and the admin console.
export function confirmDeleteVersion(title: string): boolean {
  return window.confirm(
    `Delete “${title}”? This removes the version, its uploaded file, and everything ` +
      `ingestion extracted. It cannot be undone.`,
  )
}
