-- Full Gaz ! : base des scores
-- À coller dans Supabase > SQL Editor > New query, puis "Run".
-- Le script peut être relancé sans risque.

-- 1. Une ligne par partie jouée
create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  pseudo      text        not null,
  pseudo_key  text        generated always as (lower(btrim(pseudo))) stored,
  score       integer     not null,
  eaten       integer     not null default 0,
  kos         integer     not null default 0,
  duration_s  integer     not null default 0,
  created_at  timestamptz not null default now(),

  -- pseudo de 2 à 16 caractères, sans caractères gênants
  constraint pseudo_ok check (char_length(btrim(pseudo)) between 2 and 16
                              and pseudo !~ '[<>"\\/]'),
  -- garde-fous contre les scores impossibles (300 points par seconde au maximum)
  constraint score_ok  check (score between 0 and 100000
                              and score <= 500 + duration_s * 300),
  constraint stats_ok  check (eaten between 0 and 5000
                              and kos between 0 and 5000
                              and duration_s between 0 and 7200)
);

create index if not exists scores_pseudo_idx on public.scores (pseudo_key, score desc);
create index if not exists scores_score_idx  on public.scores (score desc);

-- 2. Règles d'accès : tout le monde lit et ajoute des parties,
--    personne ne peut modifier ou supprimer un score depuis le jeu.
alter table public.scores enable row level security;

drop policy if exists "lecture publique" on public.scores;
create policy "lecture publique" on public.scores
  for select to anon, authenticated using (true);

drop policy if exists "ajout de parties" on public.scores;
create policy "ajout de parties" on public.scores
  for insert to anon, authenticated with check (true);

revoke all on public.scores from anon, authenticated;
grant select, insert on public.scores to anon, authenticated;

-- 3. Classement : meilleur score et nombre de parties par pseudo
create or replace view public.leaderboard
with (security_invoker = true) as
select b.pseudo_key,
       b.pseudo,
       b.score        as best,
       s.games,
       s.total_kos,
       s.last_play
from (
  select distinct on (pseudo_key) pseudo_key, pseudo, score
  from public.scores
  order by pseudo_key, score desc, created_at asc
) b
join (
  select pseudo_key,
         count(*)::int  as games,
         sum(kos)::int  as total_kos,
         max(created_at) as last_play
  from public.scores
  group by pseudo_key
) s using (pseudo_key);

grant select on public.leaderboard to anon, authenticated;

-- Pour effacer un score de triche plus tard (depuis Supabase uniquement) :
--   delete from public.scores where pseudo_key = 'pseudo-a-effacer';
