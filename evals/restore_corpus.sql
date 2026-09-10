-- Restore the known public-domain eval corpus.
-- Spec: specs/2026-09-11-verbatim-accuracy-mvp.md — Phase 1.
--
-- The 3 sample manuals (PSS / PHQ-GAD7 / AUDIT) were archived during v1.2
-- admin-console testing; a copyrighted MCMI-III ("1994") was left as the only
-- active version, so `evals/run_evals.py` could not run (manifest.json still
-- points at the 3 sample ids).
--
-- This is a ONE-OFF ops script, not a schema migration — a fresh DB clone never
-- had the archived state, so it must not live in supabase/migrations/. Idempotent:
-- re-running it is a no-op. Applied via `psycopg` against SUPABASE_DB_URL
-- (see evals/restore_corpus.py) rather than the `republish_manual_version` /
-- `archive_manual_version` RPCs, which are admin-JWT-gated and can't be invoked
-- from a service-side connection.

begin;

-- ── re-activate the 3 public-domain sample manuals ──────────────────────────
update public.manual_versions
   set status = 'active'
 where id in (
        'a8d5138c-057f-47ca-a6e2-e599731d6e9c',  -- PSS-10, 1994 scoring sheet
        '520b140b-ff17-49fb-878a-2e3ac19c6d68',  -- PHQ & GAD-7 Instruction Manual
        'd0a4d5ec-2cc1-4e4f-b498-5bc4473d53ea'   -- AUDIT Guidelines for Use in Primary Care, 2nd ed.
      )
   and status = 'archived';

insert into public.audit_log (actor_id, action, target, meta)
select 'd004cb50-cdfa-43c5-92a7-00dcb4e66bfe',  -- bootstrap admin (singlachirag25@gmail.com)
       'unarchive',
       'manual_versions:' || id,
       jsonb_build_object('via', 'restore_corpus.sql', 'title', title)
  from public.manual_versions
 where id in (
        'a8d5138c-057f-47ca-a6e2-e599731d6e9c',
        '520b140b-ff17-49fb-878a-2e3ac19c6d68',
        'd0a4d5ec-2cc1-4e4f-b498-5bc4473d53ea'
      )
   and status = 'active'
   and not exists (
        select 1 from public.audit_log a
         where a.target = 'manual_versions:' || public.manual_versions.id
           and a.action = 'unarchive'
           and a.meta ->> 'via' = 'restore_corpus.sql'
      );

-- ── archive the copyrighted MCMI-III that was uploaded in their place ───────
update public.manual_versions
   set status = 'archived'
 where id = '8cfe4d5f-876c-4afa-b4a1-af1ac1c85037'  -- "1994" == MCMI-III (copyrighted)
   and status = 'active';

insert into public.audit_log (actor_id, action, target, meta)
select 'd004cb50-cdfa-43c5-92a7-00dcb4e66bfe',
       'archive',
       'manual_versions:8cfe4d5f-876c-4afa-b4a1-af1ac1c85037',
       jsonb_build_object('via', 'restore_corpus.sql',
                          'reason', 'copyrighted MCMI-III; corpus is public-domain only')
 where exists (
        select 1 from public.manual_versions
         where id = '8cfe4d5f-876c-4afa-b4a1-af1ac1c85037' and status = 'archived'
      )
   and not exists (
        select 1 from public.audit_log a
         where a.target = 'manual_versions:8cfe4d5f-876c-4afa-b4a1-af1ac1c85037'
           and a.action = 'archive'
           and a.meta ->> 'via' = 'restore_corpus.sql'
      );

commit;

-- expected end state:
--   a8d5138c… PSS       active
--   520b140b… PHQ/GAD-7 active
--   d0a4d5ec… AUDIT     active
--   8cfe4d5f… "1994"    archived
