-- Phase 1f fix: publish/reject must also move the ingest_jobs row (published / rejected),
-- but ingest_jobs is service-role-only (no write policy) so a security-invoker function
-- called by a contributor can't touch it. Redefine both as SECURITY DEFINER with explicit
-- authorization checks (creator or admin), search_path pinned.

create or replace function public.publish_manual_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v      record;
    v_job  text;
    v_uid  uuid := auth.uid();
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    select * into v from public.manual_versions where id = p_version_id;
    if not found then
        raise exception 'no such version' using errcode = 'no_data_found';
    end if;
    if not (v.created_by = v_uid or public.auth_role() = 'admin') then
        raise exception 'not permitted to publish this version' using errcode = 'insufficient_privilege';
    end if;
    if v.status <> 'pending' then
        raise exception 'version is % , not pending', v.status using errcode = 'check_violation';
    end if;

    select state into v_job from public.ingest_jobs
    where version_id = p_version_id order by created_at desc limit 1;
    if v_job is distinct from 'review' then
        raise exception 'latest ingest job is % , must be review', coalesce(v_job, 'missing')
            using errcode = 'check_violation';
    end if;

    update public.manual_versions
    set status = 'active', published_by = v_uid, published_at = now()
    where id = p_version_id;

    update public.ingest_jobs set state = 'published', updated_at = now()
    where version_id = p_version_id
      and created_at = (select max(created_at) from public.ingest_jobs where version_id = p_version_id);

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'publish', 'manual_versions:' || p_version_id, '{}'::jsonb);
end;
$$;

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

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'reject', 'manual_versions:' || p_version_id,
            jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function public.publish_manual_version(uuid) from public, anon;
revoke all on function public.reject_manual_version(uuid, text) from public, anon;
grant execute on function public.publish_manual_version(uuid) to authenticated;
grant execute on function public.reject_manual_version(uuid, text) to authenticated;
