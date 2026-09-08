-- Verbatim — Phase 1 schema (specs/2026-09-07-verbatim.md).
-- One migration: extensions -> tables (+ CHECKs, indexes, HNSW) -> RLS (policy per table,
-- same migration per the src rule) -> functions (auth_role, match_chunks, new-user trigger,
-- access-token hook) -> storage bucket + policies -> admin bootstrap.
--
-- Version isolation is enforced HERE, by RLS on document_chunks + the security-invoker
-- match_chunks() RPC. Nothing else may read document_chunks to answer a user question.

-- ────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ────────────────────────────────────────────────────────────────────────────
create extension if not exists vector;      -- pgvector: document_chunks.embedding
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- ────────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth.users, carries the app role
-- ────────────────────────────────────────────────────────────────────────────
create table public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    role        text not null default 'student'
                    check (role in ('student', 'contributor', 'admin')),
    created_at   timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- instruments — a test/instrument family (PHQ-9, PSS, ...)
-- ────────────────────────────────────────────────────────────────────────────
create table public.instruments (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    slug        text not null unique,
    created_by   uuid not null references auth.users (id),
    created_at   timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- manual_versions — one specific edition/version of one instrument's manual
-- ────────────────────────────────────────────────────────────────────────────
create table public.manual_versions (
    id                  uuid primary key default gen_random_uuid(),
    instrument_id       uuid not null references public.instruments (id) on delete cascade,
    title               text not null,
    edition             text,
    year                int,
    publisher           text,
    license_class       text not null default 'public_domain'
                            check (license_class in ('public_domain', 'program_licensed')),
    status              text not null default 'pending'
                            check (status in ('pending', 'active', 'archived')),
    supersedes_id       uuid references public.manual_versions (id),
    source_object_path  text,                       -- storage path in the 'manuals' bucket
    page_count          int,
    created_by           uuid not null references auth.users (id),
    published_by         uuid references auth.users (id),
    published_at         timestamptz,
    created_at           timestamptz not null default now()
);
create index manual_versions_instrument_idx on public.manual_versions (instrument_id);
create index manual_versions_status_idx     on public.manual_versions (status);

-- ────────────────────────────────────────────────────────────────────────────
-- document_chunks — the retrieval corpus. embedding is vector(384) (gte-small).
-- ────────────────────────────────────────────────────────────────────────────
create table public.document_chunks (
    id              uuid primary key default gen_random_uuid(),
    version_id      uuid not null references public.manual_versions (id) on delete cascade,
    page            int,
    section         text,
    content         text not null,
    embedding       vector(384) not null,
    table_ref       text,                           -- non-null when the chunk is a table
    ocr_confidence  real,
    created_at       timestamptz not null default now()
);
create index document_chunks_version_idx on public.document_chunks (version_id);
-- HNSW cosine index for <=> similarity search (pgvector).
create index document_chunks_embedding_hnsw
    on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- ────────────────────────────────────────────────────────────────────────────
-- ingest_jobs — one row per ingestion run of a manual_versions row
-- ────────────────────────────────────────────────────────────────────────────
create table public.ingest_jobs (
    id           uuid primary key default gen_random_uuid(),
    version_id   uuid not null references public.manual_versions (id) on delete cascade,
    state        text not null default 'queued'
                     check (state in ('queued', 'parsing', 'review', 'published', 'rejected', 'failed')),
    ocr_quality  real,
    flags        jsonb not null default '[]'::jsonb,
    error        text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index ingest_jobs_version_idx on public.ingest_jobs (version_id);

-- ────────────────────────────────────────────────────────────────────────────
-- query_log — every /ask call (raw material for Phase 2 evals + later agentic work)
-- ────────────────────────────────────────────────────────────────────────────
create table public.query_log (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users (id),
    version_id   uuid not null references public.manual_versions (id),
    question     text not null,
    answer       text,
    abstained    boolean not null default false,
    citations    jsonb not null default '[]'::jsonb,
    retrieved    jsonb not null default '[]'::jsonb,   -- [{chunkId, page, score}]
    verify       jsonb,                                -- {supported, unsupportedClaims}
    latency_ms   int,
    at            timestamptz not null default now()
);
create index query_log_user_idx on public.query_log (user_id);
create index query_log_at_idx   on public.query_log (at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- audit_log — append-only. no update/delete policy, ever.
-- ────────────────────────────────────────────────────────────────────────────
create table public.audit_log (
    id         uuid primary key default gen_random_uuid(),
    actor_id   uuid references auth.users (id),
    action     text not null,                        -- 'upload' | 'publish' | 'archive' | ...
    target     text,                                 -- 'manual_versions:<uuid>' etc.
    meta       jsonb not null default '{}'::jsonb,
    at          timestamptz not null default now()
);
create index audit_log_at_idx on public.audit_log (at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- Functions & triggers
-- ════════════════════════════════════════════════════════════════════════════

-- auth_role() — the caller's app role, read from profiles WITHOUT triggering RLS
-- (security definer). Used inside RLS policies; safe from recursion on profiles.
create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select role from public.profiles where id = auth.uid()),
        'anon'
    );
$$;
revoke all on function public.auth_role() from public;
grant execute on function public.auth_role() to authenticated, anon;

-- match_chunks() — THE retrieval entry point. security INVOKER: runs under the caller's
-- JWT so RLS on document_chunks decides which version's rows are visible. The version_id
-- filter is a convenience, not the security boundary.
create or replace function public.match_chunks(
    p_version_id       uuid,
    p_query_embedding  vector(384),
    p_k                int default 12
)
returns table (
    chunk_id   uuid,
    page       int,
    section    text,
    content    text,
    table_ref  text,
    score      real
)
language sql
stable
security invoker
set search_path = public
as $$
    select c.id, c.page, c.section, c.content, c.table_ref,
           (1 - (c.embedding <=> p_query_embedding))::real as score
    from public.document_chunks c
    where c.version_id = p_version_id
    order by c.embedding <=> p_query_embedding
    limit greatest(coalesce(p_k, 12), 1);
$$;
revoke all on function public.match_chunks(uuid, vector, int) from public, anon;
grant execute on function public.match_chunks(uuid, vector, int) to authenticated;

-- handle_new_user() — create the profiles row on signup. The bootstrap admin email is
-- promoted here too, so it also works if that user signs up AFTER this migration runs.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, role)
    values (
        new.id,
        case when lower(new.email) = 'singlachirag25@gmail.com' then 'admin' else 'student' end
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- custom_access_token_hook() — injects a `user_role` claim (NOT `role`, which Supabase
-- reserves for the Postgres role) so the SPA and Edge Functions can read the role cheaply.
-- Must be enabled in the dashboard: Auth > Hooks > Custom Access Token.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
    claims jsonb;
    v_role text;
begin
    select role into v_role from public.profiles where id = (event ->> 'user_id')::uuid;
    claims := coalesce(event -> 'claims', '{}'::jsonb);
    claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(v_role, 'student')));
    return jsonb_set(event, '{claims}', claims);
end;
$$;
-- Grants the Supabase auth admin needs to run the hook and read profiles.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.profiles to supabase_auth_admin;

-- ════════════════════════════════════════════════════════════════════════════
-- Row-level security  (enable + policy per table, same migration)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.profiles         enable row level security;
alter table public.instruments      enable row level security;
alter table public.manual_versions  enable row level security;
alter table public.document_chunks  enable row level security;
alter table public.ingest_jobs      enable row level security;
alter table public.query_log        enable row level security;
alter table public.audit_log        enable row level security;

-- profiles: self-read, admin-read-all; role writable by admin only; no self-insert
-- (the trigger does it), no delete.
create policy profiles_select_self_or_admin on public.profiles
    for select to authenticated
    using (id = auth.uid() or public.auth_role() = 'admin');
create policy profiles_update_admin on public.profiles
    for update to authenticated
    using (public.auth_role() = 'admin')
    with check (public.auth_role() = 'admin');
-- supabase_auth_admin reads profiles for the access-token hook
create policy profiles_select_auth_admin on public.profiles
    for select to supabase_auth_admin
    using (true);

-- instruments: any authed reads; contributor/admin writes.
create policy instruments_select_authed on public.instruments
    for select to authenticated
    using (true);
create policy instruments_write_contrib on public.instruments
    for all to authenticated
    using (public.auth_role() in ('contributor', 'admin'))
    with check (public.auth_role() in ('contributor', 'admin'));

-- manual_versions: read active (any authed) OR own pending / admin; write contributor/admin.
create policy manual_versions_select_visible on public.manual_versions
    for select to authenticated
    using (
        status = 'active'
        or created_by = auth.uid()
        or public.auth_role() = 'admin'
    );
create policy manual_versions_insert_contrib on public.manual_versions
    for insert to authenticated
    with check (
        public.auth_role() in ('contributor', 'admin')
        and created_by = auth.uid()
    );
create policy manual_versions_update_owner_or_admin on public.manual_versions
    for update to authenticated
    using (
        public.auth_role() = 'admin'
        or (public.auth_role() = 'contributor' and created_by = auth.uid())
    )
    with check (
        public.auth_role() = 'admin'
        or (public.auth_role() = 'contributor' and created_by = auth.uid())
    );

-- document_chunks: readable ONLY when the parent version is readable AND active
-- (or the caller is its creator/admin, for review). No write policy => service role only.
create policy document_chunks_select_via_version on public.document_chunks
    for select to authenticated
    using (
        exists (
            select 1 from public.manual_versions v
            where v.id = document_chunks.version_id
              and (
                    v.status = 'active'
                    or v.created_by = auth.uid()
                    or public.auth_role() = 'admin'
              )
        )
    );

-- ingest_jobs: read for the version's creator/admin. No write policy => service role only.
create policy ingest_jobs_select_owner_or_admin on public.ingest_jobs
    for select to authenticated
    using (
        public.auth_role() = 'admin'
        or exists (
            select 1 from public.manual_versions v
            where v.id = ingest_jobs.version_id and v.created_by = auth.uid()
        )
    );

-- query_log: insert own row; read own or admin; no update/delete policy.
create policy query_log_insert_self on public.query_log
    for insert to authenticated
    with check (user_id = auth.uid());
create policy query_log_select_self_or_admin on public.query_log
    for select to authenticated
    using (user_id = auth.uid() or public.auth_role() = 'admin');

-- audit_log: read own or admin; insert by authed for their own actions; NO update/delete.
create policy audit_log_select_self_or_admin on public.audit_log
    for select to authenticated
    using (actor_id = auth.uid() or public.auth_role() = 'admin');
create policy audit_log_insert_self on public.audit_log
    for insert to authenticated
    with check (actor_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════
-- Storage: private 'manuals' bucket
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('manuals', 'manuals', false)
on conflict (id) do nothing;

-- contributor/admin may upload to and read from the manuals bucket. Ingestion uses the
-- service role and bypasses these. Students never touch raw PDFs in v1.
create policy manuals_rw_contrib on storage.objects
    for all to authenticated
    using (bucket_id = 'manuals' and public.auth_role() in ('contributor', 'admin'))
    with check (bucket_id = 'manuals' and public.auth_role() in ('contributor', 'admin'));

-- ════════════════════════════════════════════════════════════════════════════
-- Admin bootstrap — promote the program owner if they've already signed up.
-- (handle_new_user() covers the "signs up later" case.)
-- ════════════════════════════════════════════════════════════════════════════
update public.profiles p
set role = 'admin'
from auth.users u
where u.id = p.id and lower(u.email) = 'singlachirag25@gmail.com';
