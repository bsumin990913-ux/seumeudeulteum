-- ═══════════════════════════════════════
-- 스며들틈 — Supabase 테이블 생성 SQL
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
-- ═══════════════════════════════════════

-- 후보
create table if not exists candidates (
  id bigint generated always as identity primary key,
  name text not null,
  gender text not null check (gender in ('m','f')),
  birth_year text default '',
  height text default '',
  body_type text default '',
  region text default '',
  job text default '',
  work_pattern text default '',
  education text default '',
  religion text default '',
  mbti text default '',
  drinking text default '',
  smoking text default '',
  car text default '',
  hobbies text default '',
  personality text default '',
  description text default '',
  manager text default '',
  archived boolean default false,
  ideal jsonb default '{}'::jsonb,
  photos jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 매칭
create table if not exists matches (
  id bigint generated always as identity primary key,
  male_id bigint references candidates(id) on delete cascade,
  female_id bigint references candidates(id) on delete cascade,
  status text default 'exchanging' check (status in ('exchanging','some','success','ended')),
  memo text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 담당자(주선자)
create table if not exists managers (
  id bigint generated always as identity primary key,
  name text unique not null
);

insert into managers (name) values ('수민') on conflict (name) do nothing;

-- ═══ 보안: 로그인한 관리자만 읽기/쓰기 가능 ═══
alter table candidates enable row level security;
alter table matches enable row level security;
alter table managers enable row level security;

create policy "관리자 전체 권한" on candidates
  for all to authenticated using (true) with check (true);
create policy "관리자 전체 권한" on matches
  for all to authenticated using (true) with check (true);
create policy "관리자 전체 권한" on managers
  for all to authenticated using (true) with check (true);