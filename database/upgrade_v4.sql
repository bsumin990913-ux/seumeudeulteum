-- ═══════════════════════════════════════
-- 썸메이트 v4 업그레이드 SQL — 거절 기록 · 블랙리스트 · 스레드 홍보
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
-- (이미 실행한 적이 있어도 다시 실행해도 안전합니다)
--
-- ※ 이 파일은 원본이 분실되어, 관리자 도구(app.js)가 실제로 읽고 쓰는 값을
--    기준으로 다시 만든 것입니다. 이미 운영 중인 데이터베이스에 돌려도
--    있는 것은 건드리지 않고 없는 것만 채웁니다.
-- ═══════════════════════════════════════

-- ── 1. 거절 기록 ──
-- 누가 누구를 어느 단계에서 거절했는지 남겨둡니다.
-- 매칭이 지워져도 기록 자체는 남아야 하므로 match_id 만 비워집니다(on delete set null).
create table if not exists rejections (
  id bigint generated always as identity primary key,
  from_id bigint references candidates(id) on delete cascade,   -- 거절한 사람
  to_id   bigint references candidates(id) on delete cascade,   -- 거절당한 사람
  match_id bigint references matches(id) on delete set null,    -- 매칭 종료로 생긴 기록이면 그 매칭
  stage text default 'profile' check (stage in ('profile','photo','meet','after')),
  reason text default '',
  created_at timestamptz default now()
);

-- 두 사람 사이의 기록을 자주 찾습니다 (추천 상대에서 제외 / 매칭 맺기 경고)
create index if not exists rejections_from_idx on rejections (from_id);
create index if not exists rejections_to_idx   on rejections (to_id);

-- ── 2. 후보: 블랙리스트 ──
-- 후보 목록·추천·매칭 상대 고르기에서 완전히 제외됩니다.
alter table candidates add column if not exists blacklisted boolean default false;

-- ── 3. 후보: 스레드 홍보 ──
-- 홍보 글 주소를 넣으면 '홍보완료'로 표시되고, 처음 넣은 시각이 promo_at 에 남습니다.
alter table candidates add column if not exists promo_url text default '';
alter table candidates add column if not exists promo_at  timestamptz;

-- ── 4. 보안 ──
alter table rejections enable row level security;

drop policy if exists "거절 기록 관리자 전체 권한" on rejections;
create policy "거절 기록 관리자 전체 권한" on rejections
  for all to authenticated using (true) with check (true);
