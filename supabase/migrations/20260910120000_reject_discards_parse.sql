-- Rejecting an upload should throw away what ingestion produced.
--
-- Before: reject_manual_version only moved the ingest_jobs row to 'rejected'. The
-- parsed document_chunks (text + 384-dim vectors) and the version's page_count
-- stayed in the database forever, even though the version will never be published.
-- Those chunks are already inert for students (document_chunks_select_via_version
-- and every /ask path require status = 'active'), so this is a storage / tidiness
-- fix, not a leak fix — but on the free tier that dead weight counts against the
-- corpus ceiling.
--
-- After: reject also deletes the version's document_chunks and nulls page_count.
-- The source PDF in Storage is left as-is (audit trail; a re-upload overwrites it).

create or replace function public.reject_manual_version(p_version_id uuid, p_reason text default null)
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

    select * into v from public.manual_versions where id = p_version_id;
    if not found then
        raise exception 'no such version' using errcode = 'no_data_found';
    end if;
    if not (v.created_by = v_uid or public.auth_role() = 'admin') then
        raise exception 'not permitted to reject this version' using errcode = 'insufficient_privilege';
    end if;
    if v.status <> 'pending' then
        raise exception 'version is % , not pending', v.status using errcode = 'check_violation';
    end if;

    update public.ingest_jobs
    set state = 'rejected', error = coalesce(p_reason, error), updated_at = now()
    where version_id = p_version_id
      and created_at = (select max(created_at) from public.ingest_jobs where version_id = p_version_id);

    -- discard the parse: the version is dead, keep nothing but the audit trail
    delete from public.document_chunks where version_id = p_version_id;
    update public.manual_versions set page_count = null where id = p_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'reject', 'manual_versions:' || p_version_id,
            jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function public.reject_manual_version(uuid, text) from public, anon;
grant execute on function public.reject_manual_version(uuid, text) to authenticated;
