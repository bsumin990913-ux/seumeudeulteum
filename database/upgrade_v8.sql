-- ═══════════════════════════════════════
-- 썸메이트 v8 업그레이드 SQL — '오늘의 검사' 결과 받아두기
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
-- (이미 실행한 적이 있어도 다시 실행해도 안전합니다)
-- ═══════════════════════════════════════
--
-- 오늘의 검사(love-mbti-mu.vercel.app) 결과 화면에서 '소개팅 신청하기'를 누르면
-- 신청 폼 주소에 유형 코드가 붙어서 넘어옵니다. 그 값을 여기 담아둡니다.
--
--   { "mbti": "ENFP", "love": "SCEM", "ideal": "FMDL", "src": "oneul", "at": "2026-08-06T..." }
--
-- 넘어오는 건 네 글자짜리 유형 코드뿐입니다. 이름도 답변 내용도 오지 않습니다.
-- 검사 쪽은 연락처를 아예 받지 않고, 신원은 이 신청서가 자기 동의 절차 안에서
-- 따로 받습니다. 두 쪽을 일부러 갈라놓은 겁니다.

-- ── 1. 신청서 ──
alter table applications add column if not exists test_results jsonb default '{}'::jsonb;

-- ── 2. 후보 (신청서를 승인하면 이 값이 그대로 넘어옵니다) ──
alter table candidates   add column if not exists test_results jsonb default '{}'::jsonb;

-- ── 3. 유입 경로 집계용 ──
-- 검사에서 넘어온 신청서는 referral 이 '오늘의 검사'로 자동으로 채워집니다.
-- 몇 명이나 그렇게 들어왔는지는 아래 한 줄로 볼 수 있습니다.
--
--   select count(*) from applications where test_results->>'src' = 'oneul';
--
-- 자주 볼 값이라 인덱스를 하나 걸어둡니다.
create index if not exists applications_test_src_idx
  on applications ((test_results->>'src'));
