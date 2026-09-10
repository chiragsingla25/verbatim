-- v1.2 Phase 1 — sessions. Every /ask turn belongs to a chat_sessions row; query_log gains
-- session_id + turn. chat_sessions is a real table (not a view) because Phase 2 stores a
-- rolling conversation summary on it. Spec: specs/2026-09-10-verbatim-v1.2.md.

create table public.chat_sessions (
    id                   uuid primary key default gen_random_uuid(),
    user_id              uuid not null references auth.users (id),
    version_id           uuid not null references public.manual_versions (id),
    title                text not null default '',
    summary              text not null default '',           -- rolling summary (Phase 2)
    summary_through_turn int  not null default 0,             -- turns 1..N folded into summary
    turn_count           int  not null default 0,
    started_at           timestamptz not null default now(),
    last_at              timestamptz not null default now()
);
create index chat_sessions_user_recent_idx on public.chat_sessions (user_id, last_at desc);

alter table public.chat_sessions enable row level security;

-- Same trust model as query_log: own rows readable (admin reads all), own rows writable by
-- the caller (so /ask, running under the caller's JWT, maintains the row); NO delete.
create policy chat_sessions_select_self_or_admin on public.chat_sessions
    for select to authenticated
    using (user_id = auth.uid() or public.auth_role() = 'admin');
create policy chat_sessions_insert_self on public.chat_sessions
    for insert to authenticated
    with check (user_id = auth.uid());
create policy chat_sessions_update_self on public.chat_sessions
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- ── query_log: session_id + turn ─────────────────────────────────────────────
alter table public.query_log add column session_id uuid;
alter table public.query_log add column turn       int;

-- Backfill: each existing row is a complete 1-turn session.
insert into public.chat_sessions (id, user_id, version_id, title, turn_count, started_at, last_at)
select q.id, q.user_id, q.version_id, left(q.question, 120), 1, q.at, q.at
from public.query_log q
on conflict (id) do nothing;

update public.query_log set session_id = id, turn = 1 where session_id is null;

alter table public.query_log alter column session_id set not null;
alter table public.query_log alter column turn       set not null;
alter table public.query_log alter column turn       set default 1;
alter table public.query_log add constraint query_log_turn_pos check (turn >= 1);
alter table public.query_log
    add constraint query_log_session_fk foreign key (session_id) references public.chat_sessions (id);

create index query_log_session_idx on public.query_log (session_id, turn);

-- Atomic "start-or-advance a session, give me this turn's number". SECURITY DEFINER so the
-- upsert is race-free, but it refuses to touch a session that isn't the caller's.
create or replace function public.chat_session_next_turn(
    p_session_id uuid, p_version_id uuid, p_title text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid  uuid := auth.uid();
    v_turn int;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    insert into public.chat_sessions (id, user_id, version_id, title, turn_count)
        values (p_session_id, v_uid, p_version_id, left(coalesce(p_title, ''), 120), 1)
    on conflict (id) do update
        set turn_count = public.chat_sessions.turn_count + 1, last_at = now()
        where public.chat_sessions.user_id = v_uid
    returning turn_count into v_turn;

    if v_turn is null then
        raise exception 'not your session' using errcode = 'insufficient_privilege';
    end if;
    return v_turn;
end;
$$;

revoke all on function public.chat_session_next_turn(uuid, uuid, text) from public, anon;
grant execute on function public.chat_session_next_turn(uuid, uuid, text) to authenticated;

