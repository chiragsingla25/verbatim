// Copy text to the clipboard, with a legacy fallback for browsers that block the async
// Clipboard API (permission-restricted iframes, older Safari). Returns whether it worked;
// callers show a "Copied" / "press ⌘/Ctrl-C" hint accordingly.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
