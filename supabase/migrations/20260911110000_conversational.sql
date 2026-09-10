-- v1.2 Phase 2 — conversational /ask.
--   (a) query_log.kind: 'grounded' | 'abstained' | 'meta'. Nullable so pre-v1.2 rows read
--       as grounded/abstained from the existing `abstained` flag.
--   (b) chat_session_next_turn also refuses a session whose version_id doesn't match (the
--       Phase 1 self-review item: a crafted client could otherwise span two versions).

alter table public.query_log add column kind text
    check (kind is null or kind in ('grounded', 'abstained', 'meta'));

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
          and public.chat_sessions.version_id = p_version_id
    returning turn_count into v_turn;

    if v_turn is null then
        raise exception 'not your session (or wrong manual version)'
            using errcode = 'insufficient_privilege';
    end if;
    return v_turn;
end;
$$;

revoke all on function public.chat_session_next_turn(uuid, uuid, text) from public, anon;
grant execute on function public.chat_session_next_turn(uuid, uuid, text) to authenticated;
