-- v1.1.1 Phase 1 code-review fix — scope manuals_update_contrib.
--
-- 20260910130000 added a blanket UPDATE policy (any contributor / admin, any object
-- in the bucket) so createSignedUploadUrl({ upsert: true }) could overwrite a source
-- PDF. That also lets a contributor overwrite an *active* manual's source.pdf. Scope
-- it to a pending version the caller owns (or any, for admins) — same predicate shape
-- as manuals_delete_contrib, name-matched by construction (no split_part()::uuid).

drop policy if exists manuals_update_contrib on storage.objects;
create policy manuals_update_contrib on storage.objects
    for update to authenticated
    using (
        bucket_id = 'manuals'
        and public.auth_role() in ('contributor', 'admin')
        and exists (
            select 1 from public.manual_versions v
            where 'v/' || v.id::text || '/source.pdf' = storage.objects.name
              and v.status = 'pending'
              and (v.created_by = auth.uid() or public.auth_role() = 'admin')
        )
    )
    with check (
        bucket_id = 'manuals'
        and public.auth_role() in ('contributor', 'admin')
        and exists (
            select 1 from public.manual_versions v
            where 'v/' || v.id::text || '/source.pdf' = storage.objects.name
              and v.status = 'pending'
              and (v.created_by = auth.uid() or public.auth_role() = 'admin')
        )
    );
