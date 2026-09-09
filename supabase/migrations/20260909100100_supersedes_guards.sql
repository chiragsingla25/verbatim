-- v1.1 Phase 2 follow-up (code-review): tighten the supersedes link.
--
-- 1. A version may be superseded by at most ONE other version — a partial unique
--    index on supersedes_id. Without it an admin could point two versions'
--    supersedes_id at the same old edition, and the "superseded by" reverse
--    lookup (.maybeSingle) would then error and the hint would silently vanish.
-- 2. set_supersedes now also rejects a direct 2-cycle (A supersedes B while B
--    already supersedes A). Longer transitive chains are still possible but are
--    an unlikely admin fat-finger and are recoverable by clearing a link.

create unique index if not exists manual_versions_supersedes_unique
    on public.manual_versions (supersedes_id)
    where supersedes_id is not null;

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
    v_back uuid;
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
        select instrument_id, supersedes_id into v_tid, v_back
        from public.manual_versions where id = p_supersedes_id;
        if not found then
            raise exception 'no such superseded version' using errcode = 'no_data_found';
        end if;
        if v_tid <> v_iid then
            raise exception 'both versions must belong to the same instrument' using errcode = 'check_violation';
        end if;
        if v_back = p_version_id then
            raise exception 'that version already supersedes this one' using errcode = 'check_violation';
        end if;
    end if;

    update public.manual_versions set supersedes_id = p_supersedes_id where id = p_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'supersede', 'manual_versions:' || p_version_id,
            jsonb_build_object('supersedes_id', p_supersedes_id));
end;
$$;
