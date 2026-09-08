-- Phase 1c — one transactional entry point for "start a manual upload".
-- security invoker: every write below is still checked by the RLS policies from
-- 20260908120000 (contributor/admin only, created_by = caller, audit actor = caller).
--
-- Returns the new version's id and the storage object path the client should then get a
-- short-TTL signed upload URL for (storage.from('manuals').createSignedUploadUrl(path)).

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
security invoker
set search_path = public
as $$
declare
    v_instrument_id uuid;
    v_version_id    uuid;
    v_path          text;
begin
    if coalesce(p_attestation, false) is not true then
        raise exception 'rights attestation is required' using errcode = 'check_violation';
    end if;
    if public.auth_role() not in ('contributor', 'admin') then
        raise exception 'only contributors may upload manuals' using errcode = 'insufficient_privilege';
    end if;
    if p_license_class <> 'public_domain' then
        raise exception 'v1 accepts public_domain manuals only' using errcode = 'check_violation';
    end if;

    -- reuse the instrument for this slug, or create it
    insert into public.instruments (name, slug, created_by)
    values (trim(p_instrument_name), trim(p_slug), auth.uid())
    on conflict (slug) do nothing;
    select id into v_instrument_id from public.instruments where slug = trim(p_slug);

    insert into public.manual_versions
        (instrument_id, title, edition, year, publisher, license_class,
         status, supersedes_id, created_by)
    values
        (v_instrument_id, trim(p_title), p_edition, p_year, p_publisher, p_license_class,
         'pending', p_supersedes_id, auth.uid())
    returning id into v_version_id;

    v_path := 'v/' || v_version_id || '/source.pdf';
    update public.manual_versions set source_object_path = v_path where id = v_version_id;

    insert into public.audit_log (actor_id, action, target, meta)
    values (
        auth.uid(),
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
