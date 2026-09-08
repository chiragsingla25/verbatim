-- Phase 3d: the Ask citation slide-over renders the cited source PDF page. Any
-- authenticated user may SELECT a source PDF object when its version is `active`
-- (the version boundary still holds — you can only open a PDF you could ask about).
-- Contributors keep their broader read (manuals_select_contrib) for pending review.

create policy manuals_select_active_source on storage.objects
    for select to authenticated
    using (
        bucket_id = 'manuals'
        and name ~ '^v/[0-9a-fA-F-]{36}/source\.pdf$'
        and exists (
            select 1 from public.manual_versions v
            where v.id = (split_part(name, '/', 2))::uuid
              and v.status = 'active'
        )
    );
