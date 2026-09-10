// Stale-tab guard for GitHub Pages.
//
// Pages serves index.html with a ~10-minute cache, and an already-open SPA tab
// never re-fetches index.html on its own — so after a deploy a stale tab can keep
// running the old bundle indefinitely. Each build bakes in __BUILD_ID__ and emits
// a matching /version.json (see vite.config.ts). On load, on tab refocus, and
// every few minutes we fetch version.json uncached; if it names a different build
// than the one we're running, we reload once to pick up the fresh index.html.

const CURRENT = __BUILD_ID__
const GUARD_KEY = 'verbatim-reload-for' // the build id we've already reloaded toward
const POLL_MS = 5 * 60 * 1000

export function startVersionCheck() {
  if (import.meta.env.DEV) return

  // We're now running some build; clear a guard left from reloading toward it.
  try {
    if (sessionStorage.getItem(GUARD_KEY) === CURRENT) sessionStorage.removeItem(GUARD_KEY)
  } catch {
    /* sessionStorage unavailable — the check still works, just without the guard */
  }

  let busy = false
  const check = async () => {
    if (busy || document.visibilityState !== 'visible') return
    busy = true
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const { id } = (await res.json()) as { id?: string }
      if (!id || id === CURRENT) return
      let alreadyTried = false
      try {
        alreadyTried = sessionStorage.getItem(GUARD_KEY) === id
        sessionStorage.setItem(GUARD_KEY, id)
      } catch {
        /* no sessionStorage: fall through and reload once per page load */
      }
      if (!alreadyTried) window.location.reload()
    } catch {
      /* offline or blocked — try again on the next tick */
    } finally {
      busy = false
    }
  }

  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  setInterval(check, POLL_MS)
  check()
}
