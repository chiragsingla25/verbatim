-- v1.1 Phase 2 — manual lifecycle: archive / re-publish a version, and set the
-- "supersedes" link between two editions of one instrument.
--
-- All three are SECURITY DEFINER (pattern: publish_manual_version, 20260908140200):
-- explicit in-function authz, search_path pinned, audit_log written. Archive is
-- ADMIN ONLY (unlike publish/reject, which also allow the version's creator).
--
-- No RLS policy change is needed. document_chunks_select_via_version and the
-- manuals_select_active_source storage policy (20260908170000) both key on
-- status = 'active', so flipping status to 'archived' already removes a student's
-- access to the version's chunks, match_chunks() results, and source.pdf. The
-- Phase 2 checkpoint proves this end to end.
--
-- Archive/re-publish only toggle manual_versions.status + write audit_log. They do
-- NOT touch ingest_jobs (its lifecycle ended at publish) or published_by /
-- published_at (a visibility toggle is not a re-publish; the original publish
-- metadata is preserved).

-- ── archive_manual_version(uuid) ────────────────────────────────────────────
create or replace function public.archive_manual_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v     record;
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if public.auth_role() <> 'admin' then
        raise exception 'only an admin may archive a manual version' using errcode = 'insufficient_privilege';
    end if;

    select * into v from public.manual_versions where id = p_version_id;
    if not found then
        raise exception 'no such version' using errcode = 'no_data_found';
    end if;
    if v.status <> 'active' then
        raise exception 'version is % , not active', v.status using errcode = 'check_violation';
    end if;

    update public.manual_versions set status = 'archived' where id = p_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'archive', 'manual_versions:' || p_version_id, '{}'::jsonb);
end;
$$;

-- ── republish_manual_version(uuid) ─────────────────────────────────────────
create or replace function public.republish_manual_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v     record;
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if public.auth_role() <> 'admin' then
        raise exception 'only an admin may re-publish a manual version' using errcode = 'insufficient_privilege';
    end if;

    select * into v from public.manual_versions where id = p_version_id;
    if not found then
        raise exception 'no such version' using errcode = 'no_data_found';
    end if;
    if v.status <> 'archived' then
        raise exception 'version is % , not archived', v.status using errcode = 'check_violation';
    end if;

    update public.manual_versions set status = 'active' where id = p_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'unarchive', 'manual_versions:' || p_version_id, '{}'::jsonb);
end;
$$;

-- ── set_supersedes(uuid, uuid) ────────────────────────────────────────────
-- p_supersedes_id = the OLDER edition that p_version_id replaces (or NULL to clear).
create or replace function public.set_supersedes(p_version_id uuid, p_supersedes_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_iid uuid;
    v_tid uuid;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if public.auth_role() <> 'admin' then
        raise exception 'only an admin may set the supersedes link' using errcode = 'insufficient_privilege';
    end if;

    select instrument_id into v_iid from public.manual_versions where id = p_version_id;
    if not found then
        raise exception 'no such version' using errcode = 'no_data_found';
    end if;

    if p_supersedes_id is not null then
        if p_supersedes_id = p_version_id then
            raise exception 'a version cannot supersede itself' using errcode = 'check_violation';
        end if;
        select instrument_id into v_tid from public.manual_versions where id = p_supersedes_id;
        if not found then
            raise exception 'no such superseded version' using errcode = 'no_data_found';
        end if;
        if v_tid <> v_iid then
            raise exception 'both versions must belong to the same instrument' using errcode = 'check_violation';
        end if;
    end if;

    update public.manual_versions set supersedes_id = p_supersedes_id where id = p_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'supersede', 'manual_versions:' || p_version_id,
            jsonb_build_object('supersedes_id', p_supersedes_id));
end;
$$;

revoke all on function public.archive_manual_version(uuid) from public, anon;
revoke all on function public.republish_manual_version(uuid) from public, anon;
revoke all on function public.set_supersedes(uuid, uuid) from public, anon;
grant execute on function public.archive_manual_version(uuid) to authenticated;
grant execute on function public.republish_manual_version(uuid) to authenticated;
grant execute on function public.set_supersedes(uuid, uuid) to authenticated;
