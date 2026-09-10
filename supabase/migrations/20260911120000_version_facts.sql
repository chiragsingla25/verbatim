-- accuracy-mvp Phase 2 — the document facts block (C1).
-- Spec: specs/2026-09-11-verbatim-accuracy-mvp.md
--
-- Metadata questions ("how many pages", "what edition / year / publisher", "which
-- instrument is this") are answerable from manual_versions but invisible to /ask
-- today, so they abstain. version_facts() returns one deterministic row that the
-- Edge Function turns into a synthetic __facts__ chunk in the answer + verify
-- context. It is NOT a retriever and NOT the open web — it is catalog data about
-- the one version already in scope.
--
-- security INVOKER: RLS on manual_versions (active OR own OR admin) and
-- document_chunks decides visibility, exactly like match_chunks / /ask. A version
-- the caller can't see returns 0 rows -> the pipeline proceeds with no facts block.

create or replace function public.version_facts(p_version_id uuid)
returns table (
    instrument_name      text,
    title                text,
    edition              text,
    year                 int,
    publisher            text,
    page_count           int,
    section_count        int,
    superseded_by_title  text
)
language sql
stable
security invoker
set search_path = public
as $$
    select
        i.name,
        v.title,
        v.edition,
        v.year,
        v.publisher,
        v.page_count,
        (select count(distinct c.section)::int
           from public.document_chunks c
          where c.version_id = v.id
            and c.section is not null),
        (select s.title
           from public.manual_versions s
          where s.supersedes_id = v.id
            and s.status = 'active'
          limit 1)
    from public.manual_versions v
    join public.instruments i on i.id = v.instrument_id
    where v.id = p_version_id;
$$;

revoke all on function public.version_facts(uuid) from public, anon;
grant execute on function public.version_facts(uuid) to authenticated;
