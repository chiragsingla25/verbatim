-- release-qa verify-pass fixes A + B (2026-09-08).
--
-- A: `instruments` and the `manuals` storage bucket had FOR ALL policies scoped only by
--    role, so any contributor could DELETE another contributor's instrument (FK-cascading
--    to manual_versions -> document_chunks) or delete/overwrite any source PDF.
-- B: `audit_log` accepted arbitrary client inserts (any authed user, any action/target).
--
-- Both are closed by routing all contributor writes through request_manual_upload, which
-- becomes SECURITY DEFINER, and dropping the broad client-facing policies.

-- ── request_manual_upload -> SECURITY DEFINER ────────────────────────────────
-- Same behaviour, but writes instruments / manual_versions / audit_log as the function
-- owner so those tables no longer need contributor-writable RLS policies. Authorization
-- is enforced explicitly in-function.
create or replace function public.request_manual_upload(
    p_instrument_name text,
    p_slug            text,
    p_title           text,
    p_license_class   text default 'public_domain',
    p_attestation     boolean default false,
    p_edition         text default null,
    p_year            int default null,
    p_publisher       text default null,
    p_supersedes_id   uuid default null
)
returns table (version_id uuid, object_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid           uuid := auth.uid();
    v_instrument_id uuid;
    v_version_id    uuid;
    v_path          text;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if coalesce(p_attestation, false) is not true then
        raise exception 'rights attestation is required' using errcode = 'check_violation';
    end if;
    if public.auth_role() not in ('contributor', 'admin') then
        raise exception 'only contributors may upload manuals' using errcode = 'insufficient_privilege';
    end if;
    if p_license_class <> 'public_domain' then
        raise exception 'v1 accepts public_domain manuals only' using errcode = 'check_violation';
    end if;

    insert into public.instruments (name, slug, created_by)
    values (trim(p_instrument_name), trim(p_slug), v_uid)
    on conflict (slug) do nothing;
    select id into v_instrument_id from public.instruments where slug = trim(p_slug);

    insert into public.manual_versions
        (instrument_id, title, edition, year, publisher, license_class,
         status, supersedes_id, created_by)
    values
        (v_instrument_id, trim(p_title), p_edition, p_year, p_publisher, p_license_class,
         'pending', p_supersedes_id, v_uid)
    returning id into v_version_id;

    v_path := 'v/' || v_version_id || '/source.pdf';
    update public.manual_versions set source_object_path = v_path where id = v_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (
        v_uid,
        'upload',
        'manual_versions:' || v_version_id,
        jsonb_build_object(
            'instrument', trim(p_instrument_name),
            'slug', trim(p_slug),
            'title', trim(p_title),
            'license_class', p_license_class,
            'attestation', true
        )
    );

    return query select v_version_id, v_path;
end;
$$;

revoke all on function public.request_manual_upload(text, text, text, text, boolean, text, int, text, uuid) from public, anon;
grant execute on function public.request_manual_upload(text, text, text, text, boolean, text, int, text, uuid) to authenticated;

-- ── A: instruments — contributors read only; writes via the definer RPC or an admin ──
drop policy if exists instruments_write_contrib on public.instruments;
create policy instruments_write_admin on public.instruments
    for all to authenticated
    using (public.auth_role() = 'admin')
    with check (public.auth_role() = 'admin');

-- ── A: manuals storage bucket — contributors may INSERT + SELECT (needed for signed
--     upload / download URLs); no client-reachable UPDATE or DELETE ──
drop policy if exists manuals_rw_contrib on storage.objects;
create policy manuals_insert_contrib on storage.objects
    for insert to authenticated
    with check (bucket_id = 'manuals' and public.auth_role() in ('contributor', 'admin'));
create policy manuals_select_contrib on storage.objects
    for select to authenticated
    using (bucket_id = 'manuals' and public.auth_role() in ('contributor', 'admin'));

-- ── B: audit_log — no client inserts. Only the SECURITY DEFINER RPCs
--     (request_manual_upload, publish_manual_version, reject_manual_version) write it. ──
drop policy if exists audit_log_insert_self on public.audit_log;
