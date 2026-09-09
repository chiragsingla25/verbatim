-- v1.1 Phase 3 — admin console RPCs. All SECURITY DEFINER, each body re-checks
-- auth_role() = 'admin'. profiles has no email column (it's in auth.users, which
-- PostgREST can't read), so listing users / activity needs the definer join.
--
-- The Manuals tab needs no RPC: admin RLS on manual_versions / ingest_jobs
-- already returns every row to an admin.

-- ── admin_list_users() ─────────────────────────────────────────────────────
create or replace function public.admin_list_users()
returns table (id uuid, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.auth_role() <> 'admin' then
        raise exception 'admins only' using errcode = 'insufficient_privilege';
    end if;
    return query
        select p.id, u.email::text, p.role, p.created_at, u.last_sign_in_at
        from public.profiles p
        join auth.users u on u.id = p.id
        order by p.created_at;
end;
$$;

-- ── admin_set_role(uuid, text) ────────────────────────────────────────────
-- Full role control including granting 'admin' (a deliberate v1.1 change from
-- v1's "no admin UI"). Guard: an admin may not change their OWN role, so the
-- system can never be left with zero admins.
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := auth.uid();
    v_from text;
begin
    if public.auth_role() <> 'admin' then
        raise exception 'admins only' using errcode = 'insufficient_privilege';
    end if;
    if p_role not in ('student', 'contributor', 'admin') then
        raise exception 'invalid role %', p_role using errcode = 'check_violation';
    end if;
    if p_user_id = v_uid then
        raise exception 'you cannot change your own role' using errcode = 'check_violation';
    end if;

    select role into v_from from public.profiles where id = p_user_id;
    if not found then
        raise exception 'no such user' using errcode = 'no_data_found';
    end if;
    if v_from = p_role then
        return; -- no-op
    end if;

    update public.profiles set role = p_role where id = p_user_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (v_uid, 'role_change', 'profiles:' || p_user_id,
            jsonb_build_object('from', v_from, 'to', p_role));
end;
$$;

-- ── admin_list_activity(int) ──────────────────────────────────────────────
create or replace function public.admin_list_activity(p_limit int default 100)
returns table (id uuid, at timestamptz, actor_email text, action text, target text, meta jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.auth_role() <> 'admin' then
        raise exception 'admins only' using errcode = 'insufficient_privilege';
    end if;
    return query
        select a.id, a.at, u.email::text, a.action, a.target, a.meta
        from public.audit_log a
        left join auth.users u on u.id = a.actor_id
        order by a.at desc
        limit greatest(coalesce(p_limit, 100), 1);
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
revoke all on function public.admin_list_activity(int) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_list_activity(int) to authenticated;
