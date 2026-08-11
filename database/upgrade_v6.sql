-- ═══════════════════════════════════════
-- 썸메이트 v6 업그레이드 SQL — 연락처를 스레드(Threads) 계정으로
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
-- (이미 실행한 적이 있어도 다시 실행해도 안전합니다)
-- ═══════════════════════════════════════

-- 신청서: 스레드 계정 칸
-- 기존에 들어온 신청서의 phone 컬럼은 그대로 둡니다. 지우면 예전 신청자에게
-- 연락할 방법이 사라지기 때문에, 보유기간(6개월)이 지나면 '오래된 신청서 정리'로 함께 사라집니다.
alter table applications add column if not exists contact_threads text default '';

-- 후보: 스레드 계정 칸 (신청서를 승인하면 이 값이 그대로 넘어옵니다)
alter table candidates add column if not exists contact_threads text default '';
