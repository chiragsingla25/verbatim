-- Phase 1f — publish / reject a reviewed manual version.
-- security invoker: the manual_versions UPDATE policy already restricts this to the
-- version's creator (contributor) or an admin; these functions add the state-machine
-- guards and the audit_log write in one transaction.

create or replace function public.publish_manual_version(p_version_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_status text;
    v_job    text;
begin
    select status into v_status from public.manual_versions where id = p_version_id;
    if v_status is null then
        raise exception 'no such version' using errcode = 'no_data_found';
    end if;
    if v_status <> 'pending' then
        raise exception 'version is % , not pending', v_status using errcode = 'check_violation';
    end if;

    select state into v_job from public.ingest_jobs
    where version_id = p_version_id order by created_at desc limit 1;
    if v_job is distinct from 'review' then
        raise exception 'latest ingest job is % , must be review', coalesce(v_job, 'missing')
            using errcode = 'check_violation';
    end if;

    update public.manual_versions
    set status = 'active', published_by = auth.uid(), published_at = now()
    where id = p_version_id;

    update public.ingest_jobs set state = 'published', updated_at = now()
    where version_id = p_version_id
      and created_at = (select max(created_at) from public.ingest_jobs where version_id = p_version_id);

    insert into public.audit_log (actor_id, action, target, meta)
    values (auth.uid(), 'publish', 'manual_versions:' || p_version_id, '{}'::jsonb);
end;
$$;

create or replace function public.reject_manual_version(p_version_id uuid, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_status text;
begin
    select status into v_status from public.manual_versions where id = p_version_id;
    if v_status is null then
        raise exception 'no such version' using errcode = 'no_data_found';
    end if;
    if v_status <> 'pending' then
        raise exception 'version is % , not pending', v_status using errcode = 'check_violation';
    end if;

    update public.ingest_jobs
    set state = 'rejected', error = coalesce(p_reason, error), updated_at = now()
    where version_id = p_version_id
      and created_at = (select max(created_at) from public.ingest_jobs where version_id = p_version_id);

    insert into public.audit_log (actor_id, action, target, meta)
    values (auth.uid(), 'reject', 'manual_versions:' || p_version_id,
            jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function public.publish_manual_version(uuid) from public, anon;
revoke all on function public.reject_manual_version(uuid, text) from public, anon;
grant execute on function public.publish_manual_version(uuid) to authenticated;
grant execute on function public.reject_manual_version(uuid, text) to authenticated;
