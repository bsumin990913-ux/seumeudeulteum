/* ═══════════════════════════════════════
   썸메이트 — 공개 신청 폼
   비로그인 방문자가 쓰는 화면입니다. 관리자 기능은 전혀 없습니다.
   DB에는 '대기(pending)' 상태로만 저장되고, 읽기 권한이 없어
   다른 사람의 신청서는 조회할 수 없습니다. (upgrade_v5.sql 참고)
═══════════════════════════════════════ */

const SUPABASE_URL = 'https://ypvlrgwtelbocuefhwxy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdmxyZ3d0ZWxib2N1ZWZod3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5ODI1MDcsImV4cCI6MjA5ODU1ODUwN30.GBq97NN8gxLbPPPw9U3sszaTG06G3TRI3O_AOMzkFuM';

// ── 운영자가 채워 넣을 값 ──────────────────────────
// 개인정보처리방침(privacy.html)의 문의처와 반드시 같게 맞춰주세요.
const CONTACT = {
  name: '썸메이트',
  email: 'dalwoo997@gmail.com',
  phone: '',          // 개인 번호는 공개하지 않음. 문의는 이메일·스레드로만 받습니다.
  threads: '@somemate_love',
  threadsUrl: 'https://www.threads.com/@somemate_love'
};
const CONSENT_VERSION = '2026-08-06';

// ── 오늘의 검사 연동 ──────────────────────────────
// 결과 화면에서 '소개팅 신청하기'를 누르면 이 폼 주소에 유형 코드가 붙어 넘어옵니다.
//   ?src=oneul&mbti=ENFP&love=SCEM&ideal=FMDL
// 오는 건 네 글자 코드뿐입니다. 이름도 답변도 오지 않아요.
const QUIZ = {
  home:  'https://love-mbti-mu.vercel.app/',
  love:  'https://love-mbti-mu.vercel.app/love.html',
  mbti:  'https://love-mbti-mu.vercel.app/mbti.html',
  ideal: 'https://love-mbti-mu.vercel.app/ideal.html'
};
const QUIZ_LABEL = { mbti: '성격', love: '연애 유형', ideal: '이상형' };
const REFERRAL_FROM_QUIZ = '오늘의 검사';

// 후원 안내 — 완료 화면 맨 아래에 조용한 한 줄로만 나옵니다.
// support.html은 설정 없이도 'DM으로 받기'로 동작하니 언제 켜도 괜찮아요.
// 그래도 기본은 꺼둡니다. 신청을 막 마친 사람에게 돈 얘기를 꺼내는 건 조심스러운 편이 낫습니다.
const SHOW_SUPPORT_LINK = false;
// ────────────────────────────────────────────────

const MAX_PHOTOS = 3;
const MAX_FILE_MB = 8;         // 압축 전 원본 허용 크기
const LAST_STEP = 6;

let sb = null;
const $ = id => document.getElementById(id);

// 사람이 실제로 폼을 만졌는지 세어 둡니다.
// 예전에는 '페이지를 연 지 8초가 안 됐으면 자동 입력'으로 봤는데,
// 임시저장을 불러온 분이 화면을 빠르게 넘겨서 8초 안에 끝내면
// 신청서가 저장되지 않은 채로 완료 화면만 보였습니다. 최악의 경우였어요.
// 이제 시간은 보지 않고, '아무 조작도 없었는지'와 숨은 칸(허니팟)만 봅니다.
let humanTouches = 0;

const TEXT_IDS = ['fName','fBirth','fHeight','fBody','fRegion','fJob','fWork','fEdu','fMbti','fReligion',
                  'fHobby','fPersonality','fDesc','iAge','iHeight','iRegion','iPriority','iJobsPref','iJobsAvoid','iNote',
                  'fThreads','fKakao','fReferral'];

const S = {
  step: 0,
  gender: '',
  chips: { fDrink: '', fSmoke: '', fCar: '' },
  photos: [],
  consent: { privacy: false, sensitive: false, third: false, age: false, marketing: false },
  sending: false,
  tests: {}          // 오늘의 검사에서 들고 온 유형 코드
};
const REQUIRED_CONSENT = ['privacy', 'sensitive', 'third', 'age'];

// ── 유틸 ──
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const val = id => ($(id).value || '').trim();
const digits = s => String(s || '').replace(/[^0-9]/g, '');

// 스레드 아이디를 '@아이디' 한 가지 모양으로 맞춰줌.
// 'somemate_love', '@somemate_love', 'https://www.threads.com/@somemate_love'
// 어떻게 적어 넣어도 모두 '@somemate_love'가 됩니다. 못 알아보면 빈 문자열.
function normThreads(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  const url = s.match(/threads\.(?:com|net)\/@?([A-Za-z0-9._]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '');
  if (!s || s.length > 30) return '';
  return '@' + s;
}

// ═══════════════════════════════════════
//  오늘의 검사에서 넘어온 결과 읽기
// ═══════════════════════════════════════
// 주소창 값은 누구나 손댈 수 있으니 '네 글자 대문자'만 통과시킵니다.
// 이상한 값이 와도 그냥 무시하고 빈 신청서로 이어집니다.
function readTestResults() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return {}; }

  const out = {};
  Object.keys(QUIZ_LABEL).forEach(k => {
    const v = String(q.get(k) || '').trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(v)) out[k] = v;
  });

  if (!Object.keys(out).length) return {};
  out.src = 'oneul';
  out.at = new Date().toISOString();
  return out;
}

/** 들고 온 결과를 사람이 읽는 한 줄로. 예: '연애 유형 SCEM · 성격 ENFP' */
function testSummaryText() {
  return Object.keys(QUIZ_LABEL)
    .filter(k => S.tests[k])
    .map(k => `${QUIZ_LABEL[k]} ${S.tests[k]}`)
    .join(' · ');
}

/**
 * 결과를 들고 왔으면 0단계에 배지를 띄우고, MBTI 칸과 유입 경로를 미리 채웁니다.
 * 둘 다 사용자가 지우거나 고칠 수 있게 값만 넣고 잠그지는 않습니다.
 */
function applyTestResults() {
  const card = $('testCard');
  if (!Object.keys(S.tests).length) { if (card) card.classList.add('hidden'); return; }

  if (card) {
    card.classList.remove('hidden');
    $('testChips').innerHTML = Object.keys(QUIZ_LABEL)
      .filter(k => S.tests[k])
      .map(k => `<span class="test-chip"><b>${escapeHtml(S.tests[k])}</b>${escapeHtml(QUIZ_LABEL[k])}</span>`)
      .join('');
  }

  // 성격 검사 코드는 MBTI 칸과 모양이 같습니다. 비어 있을 때만 채웁니다 —
  // 임시저장으로 돌아온 사람이 직접 적어둔 값을 덮으면 안 됩니다.
  if (S.tests.mbti && !val('fMbti')) $('fMbti').value = S.tests.mbti;
  if (!val('fReferral')) $('fReferral').value = REFERRAL_FROM_QUIZ;
  saveDraft();
}

// ═══════════════════════════════════════
//  단계 이동
// ═══════════════════════════════════════
function goStep(n, fromHistory) {
  S.step = Math.max(0, Math.min(LAST_STEP, n));
  document.querySelectorAll('.step').forEach(el => el.classList.toggle('on', +el.dataset.step === S.step));

  // 휴대폰 뒤로가기로도 앞 단계로 돌아갈 수 있게 단계를 기록에 남깁니다.
  // 예전에는 2단계에서 뒤로가기를 누르면 사이트 밖으로 나가버렸어요.
  if (!fromHistory) {
    try {
      const cur = (history.state || {}).sdtStep;
      if (cur === undefined) history.replaceState({ sdtStep: S.step }, '');
      else if (cur !== S.step) history.pushState({ sdtStep: S.step }, '');
    } catch (e) { }
  }

  const done = S.step === LAST_STEP;
  $('backBtn').classList.toggle('hidden', S.step === 0 || done);
  $('stepCount').textContent = done ? '' : (S.step === 0 ? '' : `${S.step} / 5`);
  $('progressFill').style.width = `${(S.step / 5) * 100}%`;
  $('footbar').classList.toggle('hidden', done);

  const btn = $('nextBtn');
  if (S.step === 0) btn.textContent = '신청 시작하기';
  else if (S.step === 5) btn.textContent = '동의하고 신청하기';
  else btn.textContent = '다음';

  if (S.step === 5) renderSummary();
  syncNext();
  window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
}

// 다음 버튼
// 마지막 단계에서 버튼을 아예 못 누르게 막아두면, 왜 안 되는지 알 수가 없습니다.
// (눌리지 않는 버튼은 눌러도 아무 반응이 없어서 고장 난 것처럼 보여요)
// 그래서 항상 누를 수 있게 두고, 빠진 항목을 짚어주는 쪽으로 바꿨습니다.
function syncNext() {
  const btn = $('nextBtn');
  btn.disabled = !!S.sending;
  const need = S.step === 5 && !REQUIRED_CONSENT.every(k => S.consent[k]);
  btn.classList.toggle('waiting', need);
}

// 빠뜨린 필수 동의를 짚어줍니다
function showConsentMissing() {
  const missing = REQUIRED_CONSENT.filter(k => !S.consent[k]);
  document.querySelectorAll('#consentList .consent-row').forEach(r => {
    r.classList.toggle('need', missing.includes(r.dataset.c));
  });
  toast(`필수 항목 ${missing.length}개에 동의가 필요해요`);
  const first = document.querySelector('#consentList .consent-row.need');
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// 단계별 검사 — 통과하면 true
function validateStep() {
  let ok = true;
  const bad = (inputId, errId, isBad) => {
    if (inputId) $(inputId).classList.toggle('bad', isBad);
    $(errId).classList.toggle('hidden', !isBad);
    if (isBad) ok = false;
  };

  if (S.step === 1) {
    bad('fName', 'errName', !val('fName'));
    bad(null, 'errGender', !S.gender);
    const y = parseInt(val('fBirth'), 10);
    const tooYoung = !!val('fBirth') && (!Number.isFinite(y) || new Date().getFullYear() - y < 19);
    bad('fBirth', 'errBirth', tooYoung);
    if (!ok) {
      const first = document.querySelector('.step.on .bad') || document.querySelector('.step.on .err:not(.hidden)');
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  if (S.step === 4) {
    bad('fThreads', 'errThreads', !normThreads(val('fThreads')));
    if (!ok) $('fThreads').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return ok;
}

// ═══════════════════════════════════════
//  임시 저장 (이 브라우저에만 저장됨)
// ═══════════════════════════════════════
const DRAFT_KEY = 'sdt_apply_draft';
// 사진은 임시저장에 담지 않습니다. 제출 전에는 아직 아무 데도 올라가 있지 않고,
// 이 브라우저 안에만 있기 때문이에요. 중간에 나갔다 오시면 다시 골라주셔야 합니다.
function saveDraft() {
  const d = { gender: S.gender, chips: S.chips, tests: S.tests, fields: {} };
  TEXT_IDS.forEach(id => { d.fields[id] = val(id); });
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { }
}
function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { }
  if (!d) return;
  TEXT_IDS.forEach(id => { if (d.fields && d.fields[id]) $(id).value = d.fields[id]; });
  if (d.gender) setGender(d.gender);
  if (d.chips) { Object.assign(S.chips, d.chips); syncChips(); }
  // 검사 결과는 주소창에 한 번만 실려 옵니다. 중간에 나갔다 그냥 /apply 로
  // 돌아온 사람에게서 결과가 사라지지 않도록 임시저장에도 같이 담아둡니다.
  if (d.tests && typeof d.tests === 'object') S.tests = d.tests;
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { } }

// ═══════════════════════════════════════
//  선택 위젯
// ═══════════════════════════════════════
function setGender(g) {
  S.gender = g;
  document.querySelectorAll('#genderPick .pick').forEach(b => b.classList.toggle('on', b.dataset.v === g));
  $('errGender').classList.add('hidden');
}
function syncChips() {
  document.querySelectorAll('[data-pickone]').forEach(box => {
    const key = box.dataset.pickone;
    box.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === S.chips[key]));
  });
}
function syncConsent() {
  document.querySelectorAll('#consentList .consent-row').forEach(r => {
    r.classList.toggle('on', !!S.consent[r.dataset.c]);
    if (S.consent[r.dataset.c]) r.classList.remove('need');
    r.setAttribute('aria-pressed', S.consent[r.dataset.c] ? 'true' : 'false');
  });
  const all = Object.keys(S.consent).every(k => S.consent[k]);
  $('cAll').classList.toggle('on', all);
  syncNext();
}

// ═══════════════════════════════════════
//  사진
// ═══════════════════════════════════════
function renderPhotos() {
  const box = $('photoBox');
  box.querySelectorAll('.photo').forEach(el => el.remove());
  S.photos.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'photo';
    d.innerHTML = `<img src="${p.url}" alt="고른 사진 ${i + 1}"><button type="button" class="photo-x" aria-label="사진 삭제">✕</button>`;
    d.querySelector('.photo-x').addEventListener('click', () => {
      URL.revokeObjectURL(p.url);
      S.photos.splice(i, 1);
      renderPhotos();
    });
    box.insertBefore(d, $('photoAddBtn'));
  });
  $('photoAddBtn').classList.toggle('hidden', S.photos.length >= MAX_PHOTOS);
}

function compressImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1000;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cv.toBlob(b => resolve(b), 'image/jpeg', 0.82);
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// 고를 때는 확인하고 줄이기만 합니다. 실제로 올리는 건 마지막 제출 때예요.
async function pickPhoto(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) { toast(`사진 한 장은 ${MAX_FILE_MB}MB까지 올릴 수 있어요`); return null; }
  const blob = await compressImage(file);
  if (!blob) { toast('이미지를 읽지 못했어요. 다른 사진으로 시도해 주세요'); return null; }
  return { blob, url: URL.createObjectURL(blob) };   // url 은 이 브라우저 안에서만 쓰는 미리보기 주소
}

async function uploadPhoto(blob) {
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error } = await sb.storage.from('apply').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) {
    console.error('[Storage]', error);
    toast('사진을 올리지 못했어요. 사진 없이 접수됩니다');
    return null;
  }
  return sb.storage.from('apply').getPublicUrl(path).data.publicUrl;
}

// ═══════════════════════════════════════
//  제출 직전 요약
// ═══════════════════════════════════════
function renderSummary() {
  const rows = [
    ['이름', val('fName')],
    ['성별', S.gender === 'm' ? '남자' : S.gender === 'f' ? '여자' : ''],
    ['출생연도', val('fBirth') ? val('fBirth') + '년' : ''],
    ['키', val('fHeight') ? val('fHeight') + 'cm' : ''],
    ['거주지', val('fRegion')],
    ['직업', val('fJob')],
    ['사진', S.photos.length ? `${S.photos.length}장` : '없음'],
    ['스레드', normThreads(val('fThreads'))],
    ['카카오톡', val('fKakao')],
    ['검사 결과', testSummaryText()]
  ].filter(r => r[1]);
  $('summary').innerHTML = rows.map(([k, v]) =>
    `<div class="sum-row"><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ═══════════════════════════════════════
//  제출
// ═══════════════════════════════════════
function buildPayload(photoUrls) {
  return {
    name: val('fName'),
    gender: S.gender,
    birth_year: digits(val('fBirth')),
    height: digits(val('fHeight')),
    body_type: val('fBody'),
    region: val('fRegion'),
    job: val('fJob'),
    work_pattern: val('fWork'),
    education: val('fEdu'),
    religion: val('fReligion'),
    mbti: val('fMbti').toUpperCase(),
    drinking: S.chips.fDrink,
    smoking: S.chips.fSmoke,
    car: S.chips.fCar,
    hobbies: val('fHobby'),
    personality: val('fPersonality'),
    description: val('fDesc'),
    ideal: {
      age: val('iAge'),
      height: val('iHeight'),
      region: val('iRegion'),
      priority: val('iPriority'),
      jobs_pref: val('iJobsPref'),
      jobs_avoid: val('iJobsAvoid'),
      note: val('iNote')
    },
    photos: (photoUrls || []).slice(),
    contact_threads: normThreads(val('fThreads')),
    contact_kakao: val('fKakao'),
    referral: val('fReferral'),
    test_results: S.tests,
    consent: Object.assign({}, S.consent, { version: CONSENT_VERSION, agreed_at: new Date().toISOString() }),
    status: 'pending'
  };
}

/** 'test_results 라는 칸이 없다'는 뜻의 오류인지 본다 (PostgREST: PGRST204) */
function isMissingColumn(error, column) {
  const msg = String((error && error.message) || '');
  return error && (error.code === 'PGRST204' || /column|schema cache/i.test(msg)) && msg.includes(column);
}

async function submit() {
  if (S.sending) return;
  if (!REQUIRED_CONSENT.every(k => S.consent[k])) { showConsentMissing(); return; }

  // 자동 입력 프로그램 거르기 — 사람에게는 아무 표시도 하지 않고 완료 화면만 보여줌.
  // 사람 눈에 보이지 않는 칸(company)이 채워져 있거나, 화면을 한 번도 만지지 않고
  // 제출까지 온 경우만 걸러냅니다. '너무 빨라서' 거르지는 않습니다 —
  // 진짜 신청자를 놓치는 쪽이 스팸 한 건을 받는 것보다 훨씬 큰 손해라서요.
  const looksAutomated = !!val('company') || humanTouches === 0;
  if (looksAutomated) {
    console.warn('[자동 입력으로 판단해 접수하지 않았습니다]');
    clearDraft(); goStep(LAST_STEP); return;
  }

  S.sending = true;
  const btn = $('nextBtn');
  btn.disabled = true;

  // 사진은 여기서 올립니다. 고르자마자 올리지 않는 이유는,
  // 마지막 동의 단계까지 오지 않고 나가신 분의 사진이 동의도 기록도 없이
  // 저장소에 남는 걸 막기 위해서입니다.
  btn.textContent = S.photos.length ? '사진을 올리는 중…' : '신청서를 보내는 중…';
  const photoUrls = [];
  for (const p of S.photos) {
    const url = await uploadPhoto(p.blob);
    if (url) photoUrls.push(url);
  }
  btn.textContent = '신청서를 보내는 중…';

  // 익명 방문자는 읽기 권한이 없으므로 .select() 없이 넣기만 합니다.
  let { error } = await sb.from('applications').insert(buildPayload(photoUrls));

  // test_results 칸이 아직 없는 상태(upgrade_v8.sql 미실행)에서도 신청은 받아야 합니다.
  // 검사 결과 하나 때문에 접수가 통째로 막히는 건 말이 안 됩니다.
  // 그 칸만 빼고 한 번 더 넣고, 결과는 유입 경로 칸에 글자로 남깁니다.
  if (error && isMissingColumn(error, 'test_results')) {
    console.warn('[연동] test_results 칸이 없어요 — database/upgrade_v8.sql 을 실행해 주세요');
    const fallback = buildPayload(photoUrls);
    delete fallback.test_results;
    const summary = testSummaryText();
    if (summary) fallback.referral = [fallback.referral, `(${summary})`].filter(Boolean).join(' ');
    ({ error } = await sb.from('applications').insert(fallback));
  }

  S.sending = false;
  btn.disabled = false;
  btn.textContent = '동의하고 신청하기';

  if (error) {
    console.error('[제출 실패]', error);
    toast(/relation|does not exist/i.test(error.message || '')
      ? '아직 접수 준비가 끝나지 않았어요. 잠시 후 다시 시도해 주세요'
      : '신청서를 보내지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요');
    return;
  }
  clearDraft();
  S.photos.forEach(p => URL.revokeObjectURL(p.url));
  S.photos = [];
  goStep(LAST_STEP);
}

// ═══════════════════════════════════════
//  시작
// ═══════════════════════════════════════
function init() {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  document.querySelectorAll('#genderPick .pick').forEach(b => {
    b.addEventListener('click', () => { setGender(b.dataset.v); saveDraft(); });
  });

  document.querySelectorAll('[data-pickone]').forEach(box => {
    const key = box.dataset.pickone;
    box.querySelectorAll('.chip').forEach(c => {
      c.addEventListener('click', () => {
        S.chips[key] = S.chips[key] === c.dataset.v ? '' : c.dataset.v;  // 한 번 더 누르면 해제
        syncChips();
        saveDraft();
      });
    });
  });

  document.querySelectorAll('#consentList .consent-row').forEach(r => {
    r.addEventListener('click', e => {
      if (e.target.closest('.more')) return;   // '보기' 링크는 그대로 열리게
      S.consent[r.dataset.c] = !S.consent[r.dataset.c];
      syncConsent();
    });
  });
  $('cAll').addEventListener('click', () => {
    const turnOn = !Object.keys(S.consent).every(k => S.consent[k]);
    Object.keys(S.consent).forEach(k => { S.consent[k] = turnOn; });
    syncConsent();
  });

  $('photoAddBtn').addEventListener('click', () => $('photoFile').click());
  $('photoFile').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    for (const f of files) {
      if (S.photos.length >= MAX_PHOTOS) { toast(`사진은 ${MAX_PHOTOS}장까지 고를 수 있어요`); break; }
      const p = await pickPhoto(f);
      if (p) { S.photos.push(p); renderPhotos(); }
    }
  });

  TEXT_IDS.forEach(id => {
    $(id).addEventListener('input', () => {
      $(id).classList.remove('bad');
      saveDraft();
    });
  });

  // 스레드 아이디: 칸에서 빠져나올 때 '@아이디' 모양으로 정리해 줌.
  // 타이핑 도중에 건드리면 커서가 튀기 때문에 blur/change에서만 손댑니다.
  const threads = $('fThreads');
  const tidyThreads = () => {
    const fixed = normThreads(threads.value);
    if (fixed && fixed !== threads.value.trim()) threads.value = fixed;
  };
  ['change', 'blur'].forEach(ev => threads.addEventListener(ev, tidyThreads));
  threads.addEventListener('paste', () => setTimeout(tidyThreads, 0));

  $('nextBtn').addEventListener('click', () => {
    if (S.step === 5) { submit(); return; }
    if (!validateStep()) return;
    goStep(S.step + 1);
  });
  $('backBtn').addEventListener('click', () => history.back());

  // 사람이 실제로 만졌는지 세어 둡니다 (자동 입력 거르기용).
  // 손가락·마우스뿐 아니라 키보드와 화면낭독기로 조작하는 분도 반드시 잡히도록
  // click 과 input 까지 함께 봅니다. 하나라도 있으면 사람으로 봅니다.
  ['pointerdown', 'keydown', 'click', 'input'].forEach(ev => {
    document.addEventListener(ev, () => { humanTouches++; }, { passive: true, capture: true });
  });

  // 뒤로가기 / 앞으로가기
  window.addEventListener('popstate', e => {
    // 접수가 끝난 뒤에는 폼으로 되돌리지 않습니다 (같은 신청서를 두 번 보내게 되니까요).
    // 완료 화면을 그대로 두고, 한 번 더 누르시면 사이트를 나가게 됩니다.
    if (S.step === LAST_STEP) return;
    const st = (e.state || {}).sdtStep;
    goStep(typeof st === 'number' ? st : 0, true);
  });

  // 문의처 안내 — CONTACT를 채우기 전에는 처리방침 쪽으로 안내
  const bits = [];
  if (CONTACT.threads) bits.push(`스레드 <a href="${escapeHtml(CONTACT.threadsUrl)}" target="_blank" rel="noopener">${escapeHtml(CONTACT.threads)}</a>`);
  if (CONTACT.email) bits.push(`이메일 <a href="mailto:${escapeHtml(CONTACT.email)}">${escapeHtml(CONTACT.email)}</a>`);
  if (CONTACT.phone) bits.push(escapeHtml(CONTACT.phone));
  $('contactLine').innerHTML = bits.length
    ? `언제든지 수정·삭제해 드립니다. 아래로 편하게 연락 주세요.<br>${bits.join('<br>')}`
    : `언제든지 수정·삭제해 드립니다. 문의처는 <a href="privacy.html#contact" target="_blank" rel="noopener">개인정보처리방침</a>에서 확인하실 수 있어요.`;

  $('supportLine').classList.toggle('hidden', !SHOW_SUPPORT_LINK);

  loadDraft();
  tidyThreads();   // 임시저장에서 불러온 아이디도 같은 모양으로 맞춰줌

  // 주소창에 실려 온 결과가 임시저장본보다 우선입니다 (방금 검사하고 온 사람)
  const fromUrl = readTestResults();
  if (Object.keys(fromUrl).length) S.tests = fromUrl;
  applyTestResults();
  syncQuizCard();

  syncConsent();
  goStep(0);
}

/** 완료 화면의 검사 안내 — 이미 결과를 들고 온 사람에겐 문구를 바꿔 준다 */
function syncQuizCard() {
  const has = Object.keys(S.tests).some(k => QUIZ_LABEL[k]);
  $('quizCardTitle').textContent = has
    ? '다른 검사도 해보실래요?'
    : 'DM까지 보내셨다면, 검사도 하나 해보실래요?';
  $('quizCardDesc').textContent = has
    ? '보내주신 결과는 잘 받았어요. 성격 검사와 이상형 검사도 있는데, 결과를 DM으로 같이 보내주시면 소개할 때 함께 참고할게요.'
    : '연애할 때 어떤 사람인지 알려주시면, 성향이 맞는 분을 찾을 때 참고해요. 5분이면 끝나고, 결과 화면을 캡처해서 DM으로 같이 보내주시면 됩니다.';
  $('quizCard').href = has ? QUIZ.home : QUIZ.love;
}

document.addEventListener('DOMContentLoaded', init);
