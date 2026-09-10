-- v1.1.2 infra-fix — harden manuals_select_active_source (20260908170000).
--
-- Before: `name ~ '^v/[0-9a-fA-F-]{36}/source\.pdf$'` plus
--         `where v.id = (split_part(name, '/', 2))::uuid`
-- The cast takes an attacker-controlled substring of the object name and coerces it to
-- uuid, which raises 22P02 on a crafted name (a contributor can insert arbitrary object
-- names via manuals_insert_contrib). No live code path scans storage.objects multi-row
-- today, so there's no current impact — but a raise inside a policy is a latent footgun.
--
-- After: match the object by CONSTRUCTING the expected name from each active version's id
-- (same shape as manuals_delete_contrib / manuals_update_contrib) — no regex on the name,
-- no cast of a name substring.

drop policy if exists manuals_select_active_source on storage.objects;
create policy manuals_select_active_source on storage.objects
    for select to authenticated
    using (
        bucket_id = 'manuals'
        and exists (
            select 1 from public.manual_versions v
            where 'v/' || v.id::text || '/source.pdf' = storage.objects.name
              and v.status = 'active'
        )
    );
