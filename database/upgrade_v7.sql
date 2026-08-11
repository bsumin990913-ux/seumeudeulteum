-- ═══════════════════════════════════════
-- 썸메이트 v7 업그레이드 SQL — 후기를 사이트에서 직접 올리기
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
-- (이미 실행한 적이 있어도 다시 실행해도 안전합니다)
-- ═══════════════════════════════════════

-- ── 1. 후기 ──
create table if not exists reviews (
  id bigint generated always as identity primary key,
  image_url text not null default '',
  who text default '',                       -- 익명 라벨. 예: '96년생 · 여성 · 대구'
  stage text default 'etc',                  -- success | meet | progress | etc
  note text default '',                      -- 주선자 코멘트
  shown_at text default '',                  -- 화면에 보일 날짜. 예: '2026.07'
  published boolean default true,            -- 끄면 공개 페이지에서 숨겨집니다
  sort_order int default 0,                  -- 클수록 위. 관리 화면의 ↑↓ 로 바뀝니다
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 2. 숫자 스트립 (한 줄짜리 표) ──
create table if not exists site_stats (
  id int primary key default 1,
  updated_label text default '',             -- 예: '2026년 8월'. 비우면 스트립이 통째로 숨겨집니다
  items jsonb default '[]'::jsonb,           -- [{ "num": "128", "label": "누적 신청" }, ...]
  updated_at timestamptz default now(),
  constraint site_stats_one_row check (id = 1)
);
insert into site_stats (id) values (1) on conflict (id) do nothing;

-- ── 3. 보안 ──
-- 후기 페이지는 로그인 없이 열리므로, 방문자에게는 '게시된 후기'만 읽기를 허용합니다.
-- 신청서·후보 같은 다른 표에는 접근할 수 없습니다.
alter table reviews enable row level security;
alter table site_stats enable row level security;

drop policy if exists "후기 공개 읽기" on reviews;
create policy "후기 공개 읽기" on reviews
  for select to anon using (published = true);

drop policy if exists "후기 관리자 전체 권한" on reviews;
create policy "후기 관리자 전체 권한" on reviews
  for all to authenticated using (true) with check (true);

drop policy if exists "숫자 공개 읽기" on site_stats;
create policy "숫자 공개 읽기" on site_stats
  for select to anon using (true);

drop policy if exists "숫자 관리자 전체 권한" on site_stats;
create policy "숫자 관리자 전체 권한" on site_stats
  for all to authenticated using (true) with check (true);

-- ── 4. 후기 캡처 저장소 ──
insert into storage.buckets (id, name, public)
values ('reviews', 'reviews', true)
on conflict (id) do nothing;

drop policy if exists "reviews 공개 읽기" on storage.objects;
create policy "reviews 공개 읽기" on storage.objects
  for select using (bucket_id = 'reviews');

drop policy if exists "reviews 관리자 업로드" on storage.objects;
create policy "reviews 관리자 업로드" on storage.objects
  for insert to authenticated with check (bucket_id = 'reviews');

drop policy if exists "reviews 관리자 수정" on storage.objects;
create policy "reviews 관리자 수정" on storage.objects
  for update to authenticated using (bucket_id = 'reviews');

drop policy if exists "reviews 관리자 삭제" on storage.objects;
create policy "reviews 관리자 삭제" on storage.objects
  for delete to authenticated using (bucket_id = 'reviews');
