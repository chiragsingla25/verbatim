-- Phase 1d wiring: when a manual PDF lands at manuals/v/<version_id>/source.pdf, POST the
-- ingest-dispatch Edge Function (which creates the ingest_jobs row + fires the GitHub
-- repository_dispatch). Replaces the dashboard "Database Webhook" with a versioned trigger.
--
-- The x-webhook-secret value lives in Supabase Vault under 'storage_webhook_secret' (set
-- out of band, never committed). The function URL is this project's — not a secret.
-- The trigger function lives in `public` (the `storage` schema is owned by
-- supabase_storage_admin and won't accept new functions), the trigger itself on
-- storage.objects.

create extension if not exists pg_net;

create or replace function public.notify_ingest_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
    v_secret text;
begin
    if new.bucket_id <> 'manuals' then
        return new;
    end if;
    if new.name !~ '^v/[0-9a-fA-F-]{36}/source\.pdf$' then
        return new;
    end if;

    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'storage_webhook_secret';
    if v_secret is null then
        raise warning 'notify_ingest_dispatch: vault secret storage_webhook_secret not set; skipping';
        return new;
    end if;

    perform net.http_post(
        url := 'https://pisnrzifesroatzisamw.supabase.co/functions/v1/ingest-dispatch',
        headers := jsonb_build_object(
            'content-type', 'application/json',
            'x-webhook-secret', v_secret
        ),
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', 'objects',
            'schema', 'storage',
            'record', jsonb_build_object('bucket_id', new.bucket_id, 'name', new.name)
        )
    );
    return new;
end;
$$;

drop trigger if exists on_manual_source_uploaded on storage.objects;
create trigger on_manual_source_uploaded
    after insert on storage.objects
    for each row execute function public.notify_ingest_dispatch();
