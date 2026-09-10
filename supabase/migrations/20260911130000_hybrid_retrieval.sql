-- accuracy-mvp Phase 3 — hybrid dense + lexical retrieval (C2).
-- Spec: specs/2026-09-11-verbatim-accuracy-mvp.md
--
-- Dense-only retrieval misses the chunk that holds the answer when the query is a
-- paraphrase of a terse row ("what labels are used for the response options?" vs a
-- bare "0 = Never  1 = Almost Never … 4 = Very Often"). match_chunks_hybrid fuses
-- the pgvector <=> ranking with a Postgres full-text ranking via Reciprocal Rank
-- Fusion (k = 60): score = Σ 1/(60 + rank_arm). Rank-only fusion — cosine distance
-- and ts_rank_cd never have to be normalised against each other.
--
-- Still ONE retrieval entry point, still `security invoker` (RLS on document_chunks
-- decides visibility), still filtered to p_version_id in BOTH arms. The pgvector-only
-- match_chunks() is kept for rollback / A-B; /ask switches to the hybrid RPC.

-- ── lexical index: a generated tsvector column, self-maintaining, no re-ingest ──
alter table public.document_chunks
    add column if not exists tsv tsvector
    generated always as (to_tsvector('english', content)) stored;

create index if not exists document_chunks_tsv_gin
    on public.document_chunks using gin (tsv);

-- ── match_chunks_hybrid ───────────────────────────────────────────────────────
create or replace function public.match_chunks_hybrid(
    p_version_id       uuid,
    p_query_embedding  vector(384),
    p_query_text       text,
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
    with params as (
        select
            greatest(coalesce(p_k, 12), 1) * 4                        as n,
            -- OR-of-lexemes query: match a chunk that shares ANY content word with the
            -- question, rank by overlap density (ts_rank_cd). websearch_/plainto_tsquery
            -- AND all terms, which for a natural-language question almost never matches
            -- the terse target chunk. Lexemes come pre-normalised from to_tsvector and are
            -- quoted, so no operator can leak into to_tsquery.
            nullif(
                (select string_agg(quote_literal(lexeme), ' | ')
                   from unnest(to_tsvector('english', coalesce(p_query_text, '')))),
                ''
            )::text                                                   as or_query
    ),
    lex_tsq as (
        select case when or_query is null then null
                    else to_tsquery('english', or_query) end as tsq
        from params
    ),
    dense as (
        select c.id,
               row_number() over (order by c.embedding <=> p_query_embedding) as rnk
        from public.document_chunks c
        where c.version_id = p_version_id
        order by c.embedding <=> p_query_embedding
        limit (select greatest(n, 40) from params)
    ),
    lexical as (
        select c.id,
               row_number() over (order by ts_rank_cd(c.tsv, t.tsq) desc) as rnk
        from public.document_chunks c, lex_tsq t
        where t.tsq is not null
          and c.version_id = p_version_id
          and c.tsv @@ t.tsq
        order by ts_rank_cd(c.tsv, t.tsq) desc
        limit (select greatest(n, 40) from params)
    ),
    fused as (
        select coalesce(d.id, l.id) as id,
               coalesce(1.0 / (60 + d.rnk), 0.0) + coalesce(1.0 / (60 + l.rnk), 0.0) as rrf
        from dense d
        full outer join lexical l on d.id = l.id
    )
    select c.id, c.page, c.section, c.content, c.table_ref, f.rrf::real
    from fused f
    join public.document_chunks c on c.id = f.id
    order by f.rrf desc
    limit greatest(coalesce(p_k, 12), 1);
$$;

revoke all on function public.match_chunks_hybrid(uuid, vector, text, int) from public, anon;
grant execute on function public.match_chunks_hybrid(uuid, vector, text, int) to authenticated;
