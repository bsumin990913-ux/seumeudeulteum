-- ═══════════════════════════════════════
-- 스며들틈 v3 업그레이드 SQL
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
-- (이미 실행한 적이 있어도 다시 실행해도 안전합니다)
-- ═══════════════════════════════════════

-- 1. 후보: 관리자 메모 컬럼
alter table candidates add column if not exists admin_memo text default '';

-- 2. 매칭: 히스토리(타임라인) 컬럼
alter table matches add column if not exists history jsonb default '[]'::jsonb;

-- 3. 사진 스토리지 버킷 (공개 읽기)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- 4. 스토리지 정책: 로그인한 관리자만 업로드/수정/삭제, 읽기는 공개
drop policy if exists "photos 공개 읽기" on storage.objects;
create policy "photos 공개 읽기" on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists "photos 관리자 업로드" on storage.objects;
create policy "photos 관리자 업로드" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');

drop policy if exists "photos 관리자 수정" on storage.objects;
create policy "photos 관리자 수정" on storage.objects
  for update to authenticated using (bucket_id = 'photos');

drop policy if exists "photos 관리자 삭제" on storage.objects;
create policy "photos 관리자 삭제" on storage.objects
  for delete to authenticated using (bucket_id = 'photos');