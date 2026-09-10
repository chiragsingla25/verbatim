-- v1.1.1 Phase 1 fix — Supabase blocks direct DML on storage.objects even from a
-- SECURITY DEFINER function ("Direct deletion from storage tables is not allowed.
-- Use the Storage API instead."). So delete_manual_version drops the storage delete;
-- the SPA removes the source object through the Storage API first (guarded by the new
-- manuals_delete_contrib policy), then calls this RPC for the row + cascade + audit.

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

    -- FK ON DELETE CASCADE handles document_chunks + ingest_jobs. The source object is
    -- removed by the caller via the Storage API before this runs.
    delete from public.manual_versions where id = p_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'delete', 'manual_versions:' || p_version_id,
            jsonb_build_object('title', v.title, 'instrument_id', v.instrument_id));
end;
$$;

revoke all on function public.delete_manual_version(uuid) from public, anon;
grant execute on function public.delete_manual_version(uuid) to authenticated;

-- Let a contributor / admin delete the source object of a *pending* version they own
-- (or any, for admins). Name-matched by construction — no split_part()::uuid that could
-- throw on a crafted object name.
drop policy if exists manuals_delete_contrib on storage.objects;
create policy manuals_delete_contrib on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'manuals'
        and public.auth_role() in ('contributor', 'admin')
        and exists (
            select 1 from public.manual_versions v
            where 'v/' || v.id::text || '/source.pdf' = storage.objects.name
              and v.status = 'pending'
              and (v.created_by = auth.uid() or public.auth_role() = 'admin')
        )
    );
