-- v1.1.1 Phase 1 — recover a stuck / failed upload.
-- Spec: specs/2026-09-10-verbatim-v1.1.1-upload-recovery.md
--
-- (a) delete_manual_version — remove a pending version outright: the row (FK cascade
--     clears document_chunks + ingest_jobs), its source object, and an audit entry.
--     Pending only; an active / archived version goes through archive / supersede.
-- (b) a storage UPDATE policy so Replace's createSignedUploadUrl({ upsert: true }) can
--     overwrite manuals/v/<id>/source.pdf — the bucket has INSERT + SELECT for
--     contributors (20260908160000) but no UPDATE.

create or replace function public.delete_manual_version(p_version_id uuid)
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
        raise exception 'not permitted to delete this version' using errcode = 'insufficient_privilege';
    end if;
    if v.status <> 'pending' then
        raise exception 'only a pending version can be deleted (this one is %)', v.status
            using errcode = 'check_violation';
    end if;

    delete from storage.objects
    where bucket_id = 'manuals' and name = 'v/' || p_version_id || '/source.pdf';

    -- FK ON DELETE CASCADE handles document_chunks + ingest_jobs
    delete from public.manual_versions where id = p_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'delete', 'manual_versions:' || p_version_id,
            jsonb_build_object('title', v.title, 'instrument_id', v.instrument_id));
end;
$$;

revoke all on function public.delete_manual_version(uuid) from public, anon;
grant execute on function public.delete_manual_version(uuid) to authenticated;

-- Replace = overwrite the same object path. Mirror manuals_insert_contrib.
drop policy if exists manuals_update_contrib on storage.objects;
create policy manuals_update_contrib on storage.objects
    for update to authenticated
    using (bucket_id = 'manuals' and public.auth_role() in ('contributor', 'admin'))
    with check (bucket_id = 'manuals' and public.auth_role() in ('contributor', 'admin'));
