-- v1.1 release-qa fix — lock down direct UPDATE on manual_versions.
--
-- The v1 policy manual_versions_update_owner_or_admin let a contributor run a
-- direct PostgREST UPDATE on any manual_versions row they created, with no
-- column or value restriction. A contributor could therefore:
--   * set status = 'active' on their own 'pending' version — self-publishing an
--     unreviewed manual, bypassing publish_manual_version (authz + audit); and
--   * set status = 'archived' / 'active' directly — bypassing the admin-only
--     archive_manual_version / republish_manual_version RPCs added in v1.1
--     (the spec's "archive = admin only" decision).
--
-- No client path needs a contributor UPDATE: every contributor mutation of
-- manual_versions goes through a SECURITY DEFINER RPC (request_manual_upload,
-- publish_manual_version, reject_manual_version) that runs as the function owner
-- and is unaffected by this policy. So direct UPDATE is now admin-only; the
-- SECURITY DEFINER RPCs remain the sole path for a contributor.

drop policy if exists manual_versions_update_owner_or_admin on public.manual_versions;

create policy manual_versions_update_admin_only on public.manual_versions
    for update to authenticated
    using (public.auth_role() = 'admin')
    with check (public.auth_role() = 'admin');
