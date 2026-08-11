-- ═══════════════════════════════════════
-- 썸메이트 v5 업그레이드 SQL — 공개 신청 폼(/apply)
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
-- (이미 실행한 적이 있어도 다시 실행해도 안전합니다)
--
-- ※ 이 파일은 원본이 분실되어, 신청 폼(apply.js)과 관리자 도구(app.js)가
--    실제로 읽고 쓰는 값을 기준으로 다시 만든 것입니다.
--
-- ■ 여기서 가장 중요한 것은 맨 아래 '보안' 부분입니다.
--   익명 방문자에게는 '넣기(insert)'만 열어주고 '읽기(select)'는 닫습니다.
--   그래서 신청자는 남의 신청서를 볼 수 없고, 자기가 방금 넣은 것도 못 읽습니다.
--   (apply.js 가 .select() 없이 insert 만 하는 이유가 이것입니다)
-- ═══════════════════════════════════════

-- ── 1. 신청서 ──
create table if not exists applications (
  id bigint generated always as identity primary key,

  -- 기본 정보
  name text not null,
  gender text not null check (gender in ('m','f')),
  birth_year text default '',
  height text default '',
  body_type text default '',
  region text default '',
  job text default '',
  work_pattern text default '',
  education text default '',
  religion text default '',            -- 민감정보. 별도 동의를 받은 경우에만 들어옵니다
  mbti text default '',
  drinking text default '',
  smoking text default '',
  car text default '',
  hobbies text default '',
  personality text default '',
  description text default '',

  -- 이상형 · 사진
  ideal jsonb default '{}'::jsonb,
  photos jsonb default '[]'::jsonb,    -- 민감정보. apply 버킷의 공개 URL 목록

  -- 연락 수단 (phone 은 2026-08-05 이전 신청서에만 남아 있는 예전 칸입니다)
  contact_kakao text default '',
  phone text default '',
  referral text default '',

  -- 동의 내역 { privacy, sensitive, third, age, marketing, version, agreed_at }
  consent jsonb default '{}'::jsonb,

  -- 검토
  status text default 'pending' check (status in ('pending','approved','rejected')),
  review_memo text default '',
  reviewed_at timestamptz,
  candidate_id bigint references candidates(id) on delete set null,  -- 승인하면 만들어진 후보

  created_at timestamptz default now()
);

create index if not exists applications_status_idx  on applications (status);
create index if not exists applications_created_idx on applications (created_at);

-- ── 2. 후보: 신청 폼에서 넘어오는 칸 ──
alter table candidates add column if not exists phone  text default '';
alter table candidates add column if not exists source text default '';   -- 'apply' 면 공개 폼으로 들어온 분

-- ── 3. 보안 ──
alter table applications enable row level security;

-- 익명 방문자: 넣기만 가능. 그것도 '대기' 상태로만 넣을 수 있습니다.
-- (status 를 'approved' 로 적어 보내는 장난을 막습니다)
drop policy if exists "신청서 익명 접수" on applications;
create policy "신청서 익명 접수" on applications
  for insert to anon with check (
    status = 'pending'
    and candidate_id is null
    and reviewed_at is null
    and length(name) between 1 and 40
  );

-- 주선자: 전체 권한
drop policy if exists "신청서 관리자 전체 권한" on applications;
create policy "신청서 관리자 전체 권한" on applications
  for all to authenticated using (true) with check (true);

-- ── 4. 신청 사진 저장소 ──
-- 신청 폼은 로그인 없이 쓰기 때문에 익명 업로드를 열어야 합니다.
-- 대신 덮어쓰기(update)와 지우기(delete)는 주선자만 할 수 있게 막아둡니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('apply', 'apply', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "apply 공개 읽기" on storage.objects;
create policy "apply 공개 읽기" on storage.objects
  for select using (bucket_id = 'apply');

drop policy if exists "apply 익명 업로드" on storage.objects;
create policy "apply 익명 업로드" on storage.objects
  for insert to anon with check (bucket_id = 'apply');

drop policy if exists "apply 관리자 업로드" on storage.objects;
create policy "apply 관리자 업로드" on storage.objects
  for insert to authenticated with check (bucket_id = 'apply');

drop policy if exists "apply 관리자 수정" on storage.objects;
create policy "apply 관리자 수정" on storage.objects
  for update to authenticated using (bucket_id = 'apply');

drop policy if exists "apply 관리자 삭제" on storage.objects;
create policy "apply 관리자 삭제" on storage.objects
  for delete to authenticated using (bucket_id = 'apply');
