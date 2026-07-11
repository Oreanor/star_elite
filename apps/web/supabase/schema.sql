-- Star Elite — минимальная схема для сетевого прогона.
-- Выполнить ОДИН раз в Supabase → SQL Editor. Идемпотентно: можно прогнать повторно.
--
-- Одна таблица: сейв игрока по его аккаунту. Источник правды — сервер (Postgres).
-- RLS гарантирует, что каждый видит и меняет ТОЛЬКО свою строку — чужой прогресс
-- не прочитать даже с валидным anon-ключом (ключ публичен намеренно, доступ рулит RLS).

create table if not exists public.saves (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  save       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Включаем построчную защиту. Без политик ниже таблица закрыта для всех.
alter table public.saves enable row level security;

-- Свою строку — читать, создавать и обновлять. Чужую — нельзя (условие ложно).
-- DROP+CREATE вместо "if not exists" (у политик его нет), чтобы скрипт был идемпотентным.
drop policy if exists "saves_select_own" on public.saves;
create policy "saves_select_own" on public.saves
  for select using (auth.uid() = user_id);

drop policy if exists "saves_insert_own" on public.saves;
create policy "saves_insert_own" on public.saves
  for insert with check (auth.uid() = user_id);

drop policy if exists "saves_update_own" on public.saves;
create policy "saves_update_own" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Отметка времени последнего сейва обновляется сама.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists saves_touch on public.saves;
create trigger saves_touch before update on public.saves
  for each row execute function public.touch_updated_at();
