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
const MIN_FILL_SECONDS = 8;    // 이보다 빨리 제출되면 자동 입력으로 봄
const LAST_STEP = 6;

let sb = null;
const $ = id => document.getElementById(id);
const openedAt = Date.now();

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
function goStep(n) {
  S.step = Math.max(0, Math.min(LAST_STEP, n));
  document.querySelectorAll('.step').forEach(el => el.classList.toggle('on', +el.dataset.step === S.step));

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

// 다음 버튼 활성/비활성
function syncNext() {
  const btn = $('nextBtn');
  if (S.sending) { btn.disabled = true; return; }
  if (S.step === 5) btn.disabled = !REQUIRED_CONSENT.every(k => S.consent[k]);
  else btn.disabled = false;
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
function saveDraft() {
  const d = { gender: S.gender, chips: S.chips, photos: S.photos, tests: S.tests, fields: {} };
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
  if (Array.isArray(d.photos)) { S.photos = d.photos.slice(0, MAX_PHOTOS); renderPhotos(); }
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
  document.querySelectorAll('#consentList .consent-row').forEach(r => r.classList.toggle('on', !!S.consent[r.dataset.c]));
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
    d.innerHTML = `<img src="${p}" alt="올린 사진 ${i + 1}"><button type="button" class="photo-x" aria-label="사진 삭제">✕</button>`;
    d.querySelector('.photo-x').addEventListener('click', () => {
      S.photos.splice(i, 1);
      renderPhotos();
      saveDraft();
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

async function uploadPhoto(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) { toast(`사진 한 장은 ${MAX_FILE_MB}MB까지 올릴 수 있어요`); return null; }
  const blob = await compressImage(file);
  if (!blob) { toast('이미지를 읽지 못했어요. 다른 사진으로 시도해 주세요'); return null; }
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error } = await sb.storage.from('apply').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) {
    console.error('[Storage]', error);
    toast('사진을 올리지 못했어요. 사진 없이도 신청할 수 있어요');
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
function buildPayload() {
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
    photos: S.photos.slice(),
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
  if (!REQUIRED_CONSENT.every(k => S.consent[k])) { toast('필수 항목에 모두 동의해 주세요'); return; }

  // 자동 입력 프로그램 거르기 — 사람에게는 아무 표시도 하지 않고 완료 화면만 보여줌
  const looksAutomated = !!val('company') || (Date.now() - openedAt) / 1000 < MIN_FILL_SECONDS;
  if (looksAutomated) { clearDraft(); goStep(LAST_STEP); return; }

  S.sending = true;
  const btn = $('nextBtn');
  btn.disabled = true;
  btn.textContent = '신청서를 보내는 중…';

  // 익명 방문자는 읽기 권한이 없으므로 .select() 없이 넣기만 합니다.
  let { error } = await sb.from('applications').insert(buildPayload());

  // test_results 칸이 아직 없는 상태(upgrade_v8.sql 미실행)에서도 신청은 받아야 합니다.
  // 검사 결과 하나 때문에 접수가 통째로 막히는 건 말이 안 됩니다.
  // 그 칸만 빼고 한 번 더 넣고, 결과는 유입 경로 칸에 글자로 남깁니다.
  if (error && isMissingColumn(error, 'test_results')) {
    console.warn('[연동] test_results 칸이 없어요 — database/upgrade_v8.sql 을 실행해 주세요');
    const fallback = buildPayload();
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
    toast('사진을 올리는 중이에요…');
    for (const f of files) {
      if (S.photos.length >= MAX_PHOTOS) { toast(`사진은 ${MAX_PHOTOS}장까지 올릴 수 있어요`); break; }
      const url = await uploadPhoto(f);
      if (url) { S.photos.push(url); renderPhotos(); saveDraft(); }
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
  $('backBtn').addEventListener('click', () => goStep(S.step - 1));

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
