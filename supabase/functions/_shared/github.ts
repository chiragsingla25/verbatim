// GitHub repository_dispatch — shared by ingest-dispatch (Storage webhook trigger) and
// ingest-trigger (signed-in retry / replace). Fires the `ingest` workflow in ingest.yml.
export async function dispatchToGitHub(repo: string, token: string, body: unknown): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'verbatim-ingest-dispatch',
    },
    body: JSON.stringify(body),
  })
  return res.status
}
