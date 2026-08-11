/* ═══════════════════════════════════════
   썸메이트 — 관리자 도구 v3 (Supabase 클라우드 + 스토리지)
═══════════════════════════════════════ */

const SUPABASE_URL = 'https://ypvlrgwtelbocuefhwxy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdmxyZ3d0ZWxib2N1ZWZod3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5ODI1MDcsImV4cCI6MjA5ODU1ODUwN30.GBq97NN8gxLbPPPw9U3sszaTG06G3TRI3O_AOMzkFuM';
let sb = null; // Supabase 클라이언트

// ── 헬퍼 ──
const $ = id => document.getElementById(id);
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
const nowStr = () => new Date().toISOString();

// 로그인이 풀려서 실패한 것인지 (토큰 만료 등) 판별합니다.
// 이걸 구분하지 않으면 "인터넷 연결을 확인해 주세요"만 반복해서 뜨는데,
// 정작 인터넷은 멀쩡하고 다시 로그인해야 하는 상황이라 아무리 눌러도 저장이 안 됩니다.
function isAuthErr(e) {
  if (!e) return false;
  const msg = String(e.message || '');
  return e.status === 401 || e.code === 'PGRST301' || /jwt|token|expired|not authenticated/i.test(msg);
}
function dbErr(e) {
  console.error('[DB]', e);
  if (isAuthErr(e)) { requireLogin(); return; }
  toast('저장에 실패했어요. 인터넷 연결을 확인해 주세요');
}

// 사진 한 장을 안전한 <img> 로 만듭니다.
// 주소에 따옴표가 섞여 들어와도 태그가 깨지지 않고, 목록에서는 보이는 것부터 받습니다.
function photoImg(url, alt, cls) {
  return `<img${cls ? ` class="${cls}"` : ''} src="${escHtml(url)}" alt="${escHtml(alt || '')}" loading="lazy" decoding="async">`;
}

// 값이 있을 때만 괄호를 붙여줍니다. 직업 없이 근무형태만 있으면 ' (평일 9to6)' 처럼
// 앞이 텅 빈 줄이 생기던 것을 막습니다.
function joinParen(main, paren) {
  const m = (main || '').trim(), p = (paren || '').trim();
  if (!m) return p;
  return p ? `${m} (${p})` : m;
}
// 직업 줄. 직업을 안 적고 근무 형태만 적은 경우에는 '근무 형태'라는 제 이름으로 보여줍니다.
function jobRows(o) {
  const job = (o.job || '').trim(), work = (o.work_pattern || '').trim();
  return job
    ? infoRow('briefcase', '직업', joinParen(job, work))
    : infoRow('clock-hour-9', '근무 형태', work);
}

// ═══════════════════════════════════════
//  확인 창 — 브라우저 기본 confirm() 대신
// ═══════════════════════════════════════
// 삭제·블랙리스트처럼 되돌리기 어려운 순간에 씁니다.
//   if (!await ask({ title:'삭제할까요?', desc:'...', okText:'삭제', danger:true })) return;
function ask(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    $('cfTitle').textContent = o.title || '진행할까요?';
    $('cfDesc').textContent = o.desc || '';
    $('cfDesc').classList.toggle('hidden', !o.desc);

    // 이름 목록처럼 여러 줄로 보여줄 내용은 회색 칸에 따로 담습니다
    $('cfList').textContent = o.list || '';
    $('cfList').classList.toggle('hidden', !o.list);

    $('cfWarnText').textContent = o.warn || '';
    $('cfWarn').classList.toggle('hidden', !o.warn);

    const ok = $('cfOkBtn'), cancel = $('cfCancelBtn');
    ok.innerHTML = o.okText ? escHtml(o.okText) : '확인';
    ok.className = 'btn ' + (o.danger ? 'danger-solid' : 'primary');
    cancel.textContent = o.cancelText || '취소';

    const done = v => {
      ok.onclick = null; cancel.onclick = null;
      $('confirmModal').removeEventListener('modal-dismiss', onDismiss);
      closeModal('confirmModal');
      resolve(v);
    };
    const onDismiss = () => done(false);
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    // 배경 누르기 · Esc · 아래로 끌어내리기로 닫아도 '취소'로 봅니다
    $('confirmModal').addEventListener('modal-dismiss', onDismiss, { once: true });

    openModal('confirmModal');
    setTimeout(() => ok.focus(), 60);
  });
}

// ── 엑셀 모듈은 쓸 때만 내려받기 ──
// 900KB 짜리를 모든 방문에서 받을 이유가 없습니다. [등록 → 엑셀] 에서만 씁니다.
let xlsxLoading = null;
function loadXlsx() {
  if (typeof XLSX !== 'undefined') return Promise.resolve(true);
  if (xlsxLoading) return xlsxLoading;
  xlsxLoading = new Promise(resolve => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => resolve(true);
    sc.onerror = () => { xlsxLoading = null; resolve(false); };
    document.head.appendChild(sc);
  });
  return xlsxLoading;
}

// ═══════════════════════════════════════
//  데이터 저장소 (Supabase + 메모리 캐시)
// ═══════════════════════════════════════
const DB = {
  data: { candidates: [], matches: [], rejections: [], applications: [], reviews: [], stats: null },

  async init() {
    const [c, m, r, a, rv, st] = await Promise.all([
      sb.from('candidates').select('*').order('id', { ascending: false }),
      sb.from('matches').select('*').order('id', { ascending: false }),
      sb.from('rejections').select('*').order('id', { ascending: false }),
      sb.from('applications').select('*').order('id', { ascending: false }),
      sb.from('reviews').select('*').order('sort_order', { ascending: false }).order('id', { ascending: false }),
      sb.from('site_stats').select('*').eq('id', 1).maybeSingle()
    ]);
    if (c.error || m.error) throw (c.error || m.error);
    this.data.candidates = c.data || [];
    this.data.matches = m.data || [];
    // 아래 표들은 업그레이드 SQL을 아직 안 돌렸을 수 있으므로, 없으면 빈 목록으로 진행
    if (r.error) { console.warn('[DB] rejections 테이블 없음 — upgrade_v4.sql을 실행해 주세요', r.error); this.data.rejections = []; }
    else this.data.rejections = r.data || [];
    if (a.error) { console.warn('[DB] applications 테이블 없음 — upgrade_v5.sql을 실행해 주세요', a.error); this.data.applications = []; }
    else this.data.applications = a.data || [];
    if (rv.error) { console.warn('[DB] reviews 테이블 없음 — upgrade_v7.sql을 실행해 주세요', rv.error); this.data.reviews = []; }
    else this.data.reviews = rv.data || [];
    this.data.stats = st.error ? null : (st.data || null);
  },

  async addCandidate(cand) {
    const { data, error } = await sb.from('candidates').insert(cand).select().single();
    if (error) { dbErr(error); return null; }
    this.data.candidates.unshift(data);
    return data;
  },
  async addCandidates(list) {
    const { data, error } = await sb.from('candidates').insert(list).select();
    if (error) { dbErr(error); return null; }
    this.data.candidates = [...data.slice().reverse(), ...this.data.candidates];
    return data;
  },
  async updateCandidate(id, patch) {
    patch.updated_at = nowStr();
    const { data, error } = await sb.from('candidates').update(patch).eq('id', id).select().single();
    if (error) { dbErr(error); return null; }
    const i = this.data.candidates.findIndex(x => x.id === id);
    if (i > -1) this.data.candidates[i] = data;
    return data;
  },
  async updateCandidates(ids, patch) {
    if (!ids.length) return true;
    patch.updated_at = nowStr();
    const { data, error } = await sb.from('candidates').update(patch).in('id', ids).select();
    if (error) { dbErr(error); return false; }
    (data || []).forEach(row => {
      const i = this.data.candidates.findIndex(x => x.id === row.id);
      if (i > -1) this.data.candidates[i] = row;
    });
    return true;
  },
  async deleteCandidates(ids) {
    if (!ids.length) return true;
    const targets = this.data.candidates.filter(c => ids.includes(c.id));
    const { error } = await sb.from('candidates').delete().in('id', ids);
    if (error) { dbErr(error); return false; }
    // 스토리지에 올라간 사진도 정리 (실패해도 무시)
    const paths = [];
    targets.forEach(c => paths.push(...storagePathsOf(c.photos)));
    if (paths.length) { try { sb.storage.from('photos').remove(paths); } catch (e) { } }
    this.data.candidates = this.data.candidates.filter(x => !ids.includes(x.id));
    this.data.matches = this.data.matches.filter(m => !ids.includes(m.male_id) && !ids.includes(m.female_id));
    this.data.rejections = this.data.rejections.filter(r => !ids.includes(r.from_id) && !ids.includes(r.to_id));
    return true;
  },
  async deleteCandidate(id) {
    const cand = this.data.candidates.find(x => x.id === id);
    const { error } = await sb.from('candidates').delete().eq('id', id);
    if (error) { dbErr(error); return false; }
    // 스토리지에 올라간 사진도 정리 (실패해도 무시)
    const paths = storagePathsOf(cand && cand.photos);
    if (paths.length) { try { sb.storage.from('photos').remove(paths); } catch (e) { } }
    this.data.candidates = this.data.candidates.filter(x => x.id !== id);
    this.data.matches = this.data.matches.filter(m => m.male_id !== id && m.female_id !== id);
    this.data.rejections = this.data.rejections.filter(r => r.from_id !== id && r.to_id !== id);
    return true;
  },

  async addMatch(maleId, femaleId) {
    const { data, error } = await sb.from('matches').insert({ male_id: maleId, female_id: femaleId, history: [] }).select().single();
    if (error) { dbErr(error); return null; }
    this.data.matches.unshift(data);
    return data;
  },
  async updateMatch(id, patch) {
    patch.updated_at = nowStr();
    const { data, error } = await sb.from('matches').update(patch).eq('id', id).select().single();
    if (error) { dbErr(error); return null; }
    const i = this.data.matches.findIndex(x => x.id === id);
    if (i > -1) this.data.matches[i] = data;
    return data;
  },
  async deleteMatch(id) {
    const { error } = await sb.from('matches').delete().eq('id', id);
    if (error) { dbErr(error); return false; }
    this.data.matches = this.data.matches.filter(x => x.id !== id);
    // 매칭이 지워져도 거절 기록 자체는 남김 (match_id만 비워짐)
    this.data.rejections.forEach(r => { if (r.match_id === id) r.match_id = null; });
    return true;
  },

  async addRejections(rows) {
    if (!rows.length) return [];
    const { data, error } = await sb.from('rejections').insert(rows).select();
    if (error) {
      console.error('[DB] 거절 기록 저장 실패', error);
      toast(/relation|does not exist/i.test(error.message || '')
        ? '거절 기록 테이블이 아직 없어요. upgrade_v4.sql을 실행해 주세요'
        : '거절 기록을 저장하지 못했어요');
      return null;
    }
    this.data.rejections = [...data.slice().reverse(), ...this.data.rejections];
    return data;
  },
  async deleteRejection(id) {
    const { error } = await sb.from('rejections').delete().eq('id', id);
    if (error) { dbErr(error); return false; }
    this.data.rejections = this.data.rejections.filter(x => x.id !== id);
    return true;
  },

  // 백업 복원 때만 씁니다 (신청 폼으로 들어오는 것은 apply.js 가 직접 넣습니다)
  async addApplication(row) {
    const { data, error } = await sb.from('applications').insert(row).select().single();
    if (error) { console.error('[DB] 신청서 복원 실패', error); return null; }
    this.data.applications.unshift(data);
    return data;
  },
  async updateApplication(id, patch) {
    const { data, error } = await sb.from('applications').update(patch).eq('id', id).select().single();
    if (error) { dbErr(error); return null; }
    const i = this.data.applications.findIndex(x => x.id === id);
    if (i > -1) this.data.applications[i] = data;
    return data;
  },
  async deleteApplication(id) {
    const { error } = await sb.from('applications').delete().eq('id', id);
    if (error) { dbErr(error); return false; }
    this.data.applications = this.data.applications.filter(x => x.id !== id);
    return true;
  },
  async deleteApplications(ids) {
    if (!ids.length) return true;
    const { error } = await sb.from('applications').delete().in('id', ids);
    if (error) { dbErr(error); return false; }
    this.data.applications = this.data.applications.filter(x => !ids.includes(x.id));
    return true;
  },

  // ── 후기 ──
  // quiet: 백업 복원처럼 여러 건을 연달아 넣을 때는 토스트를 띄우지 않습니다
  async addReview(row, quiet) {
    const { data, error } = await sb.from('reviews').insert(row).select().single();
    if (error) {
      console.error('[DB] 후기 저장 실패', error);
      if (!quiet) toast(/relation|does not exist/i.test(error.message || '')
        ? '후기 테이블이 아직 없어요. upgrade_v7.sql을 실행해 주세요'
        : '후기를 저장하지 못했어요');
      return null;
    }
    this.data.reviews.unshift(data);
    return data;
  },
  async updateReview(id, patch) {
    patch.updated_at = nowStr();
    const { data, error } = await sb.from('reviews').update(patch).eq('id', id).select().single();
    if (error) { dbErr(error); return null; }
    const i = this.data.reviews.findIndex(x => x.id === id);
    if (i > -1) this.data.reviews[i] = data;
    return data;
  },
  async deleteReview(id) {
    const row = this.data.reviews.find(x => x.id === id);
    const { error } = await sb.from('reviews').delete().eq('id', id);
    if (error) { dbErr(error); return false; }
    // 캡처 파일도 함께 정리 (실패해도 무시)
    const paths = storagePathsOf(row && row.image_url ? [row.image_url] : [], 'reviews');
    if (paths.length) { try { sb.storage.from('reviews').remove(paths); } catch (e) { } }
    this.data.reviews = this.data.reviews.filter(x => x.id !== id);
    return true;
  },
  async saveStats(patch) {
    const row = Object.assign({ id: 1, updated_at: nowStr() }, patch);
    const { data, error } = await sb.from('site_stats').upsert(row).select().single();
    if (error) {
      console.error('[DB] 숫자 저장 실패', error);
      toast(/relation|does not exist/i.test(error.message || '')
        ? '숫자 표가 아직 없어요. upgrade_v7.sql을 실행해 주세요'
        : '숫자를 저장하지 못했어요');
      return null;
    }
    this.data.stats = data;
    return data;
  }

};

// ── 별표 고정 (기기별 개인 설정) ──
const Pin = {
  get: () => { try { return JSON.parse(localStorage.getItem('sdt_pinned') || '[]'); } catch (e) { return []; } },
  toggle(id) {
    let p = this.get();
    p = p.includes(id) ? p.filter(x => x !== id) : [...p, id];
    localStorage.setItem('sdt_pinned', JSON.stringify(p));
  },
  has(id) { return this.get().includes(id); }
};

// ── 화면 상태 ──
const S = {
  view: 'candidates',
  gender: 'all',
  statusFilters: new Set(),   // 상태 필터는 여러 개를 동시에 걸 수 있습니다
  search: '',
  sort: localStorage.getItem('sdt_sort') || 'latest',
  listMode: localStorage.getItem('sdt_view') || 'list',
  selectMode: false,
  selected: new Set(),
  regMode: 'paste',
  editingId: null,
  formPhotos: [],
  matchFilter: 'all',
  appFilter: 'pending',
  pick: { m: null, f: null },
  pickSearch: '',
  excelRows: null
};

// ═══════════════════════════════════════
//  파생 정보
// ═══════════════════════════════════════
const STATUS_LABEL = { candidate: '대기중', exchanging: '사진교환', some: '썸', success: '성사', ended: '종료', archived: '보류', blacklist: '블랙' };

function activeMatchOf(cid) {
  return DB.data.matches.find(m => (m.male_id === cid || m.female_id === cid) && m.status !== 'ended');
}
function candStatus(c) {
  if (c.blacklisted) return 'blacklist';
  const m = activeMatchOf(c.id);
  if (m) return m.status;
  return c.archived ? 'archived' : 'candidate';
}
function candName(id) {
  const c = DB.data.candidates.find(x => x.id === id);
  return c ? c.name : '(삭제됨)';
}
function candOf(id) { return DB.data.candidates.find(x => x.id === id); }

// ── 상세 화면 발자국 (뒤로가기) ──
// 후보 → 거절 기록 → 다른 후보 → 매칭 … 이렇게 타고 들어가도
// 바로 앞에서 보던 사람에게 한 번에 돌아올 수 있게 지나온 길을 남겨둡니다.
const Trail = {
  stack: [],                                  // [{ t:'cand'|'match', id }]
  clear() { this.stack = []; },
  push(t, id) { if (id != null) this.stack.push({ t, id }); },

  labelOf(e) {
    if (e.t !== 'match') return candName(e.id);
    const m = DB.data.matches.find(x => x.id === e.id);
    return m ? `${candName(m.male_id)} ♥ ${candName(m.female_id)}` : '(삭제된 매칭)';
  },

  // 발자국 줄. 화살표를 누르면 한 칸 뒤로, 이름을 누르면 그 지점으로 한 번에 돌아갑니다.
  html() {
    if (!this.stack.length) return '';
    const path = this.stack
      .map((e, i) => `<button type="button" class="trail-item" data-trail="${i}">${escHtml(this.labelOf(e))}</button>`)
      .join('<i class="ti ti-chevron-right trail-sep"></i>');
    return `<div class="trail">
      <button type="button" class="trail-back" data-trail="${this.stack.length - 1}" title="이전 화면으로"><i class="ti ti-arrow-left"></i></button>
      <div class="trail-path">${path}<i class="ti ti-chevron-right trail-sep"></i><span class="trail-now">지금 보는 중</span></div>
    </div>`;
  },

  bind(rootId) {
    $(rootId).querySelectorAll('[data-trail]').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.trail, 10);
        const target = this.stack[i];
        if (!target) return;
        this.stack = this.stack.slice(0, i);   // 돌아간 지점보다 뒤의 발자국은 지움
        closeModal('detailModal');
        closeModal('matchModal');
        if (target.t === 'match') openMatchDetail(target.id, true);
        else openDetail(target.id, true);
      });
    });
  }
};

// ── 거절 기록 ──
const REJECT_STAGE = { profile: '프로필 보고', photo: '사진 교환 후', meet: '만나기 전', after: '만난 후' };

function rejectionsBy(cid) { return DB.data.rejections.filter(r => r.from_id === cid); }  // 내가 거절한
function rejectionsOf(cid) { return DB.data.rejections.filter(r => r.to_id === cid); }    // 나를 거절한
// 두 사람 사이의 거절 기록 (누가 거절했든 전부)
function rejectionsBetween(a, b) {
  return DB.data.rejections.filter(r =>
    (r.from_id === a && r.to_id === b) || (r.from_id === b && r.to_id === a));
}
function rejectLabel(r) {
  const d = String(r.created_at).slice(0, 10).replace(/-/g, '.');
  return `${d} · ${REJECT_STAGE[r.stage] || r.stage}`;
}
function ageLabel(c) {
  if (!c.birth_year) return '';
  return String(c.birth_year).slice(2) + '년생';
}
// '160', '160cm', '' 등 어떻게 들어와 있어도 숫자만 뽑아냄. 값이 없으면 null
function heightNum(v) {
  const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function metaLine(c) {
  // 키 정렬 중일 때는 카드에서 바로 키가 보이게 함
  const hn = heightNum(c.height);
  const h = (S.sort === 'tall' || S.sort === 'short') && hn ? hn + 'cm' : '';
  return [ageLabel(c), h, c.job, c.region].filter(Boolean).join(' · ');
}
function subLine(c) {
  return [c.education, c.religion, c.smoking].filter(Boolean).join(' · ');
}

// ── 사진 스토리지 헬퍼 ──
function storagePathsOf(photos, bucket) {
  const re = new RegExp(`/storage/v1/object/public/${bucket || 'photos'}/(.+)$`);
  return (photos || []).map(p => {
    const m = String(p).match(re);
    return m ? decodeURIComponent(m[1].split('?')[0]) : null;
  }).filter(Boolean);
}
function blobToDataURL(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(blob); });
}
function dataURLToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function uploadPhotoBlob(blob, hint) {
  const path = `cand/${hint || ''}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) { console.warn('[Storage] 업로드 실패', error); return null; }
  return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

// ═══════════════════════════════════════
//  카톡 프로필 자동 인식 파서
// ═══════════════════════════════════════
function normBirth(v) {
  const m = String(v).match(/(\d{2,4})\s*년/) || String(v).match(/^(\d{2,4})$/);
  if (!m) return '';
  let y = parseInt(m[1], 10);
  if (y < 100) y = y >= 40 ? 1900 + y : 2000 + y;
  return (y >= 1900 && y <= 2020) ? String(y) : '';
}
function extractParen(v) {
  const m = String(v).match(/^(.*?)\s*[\(（](.+?)[\)）]\s*(.*)$/);
  if (!m) return { main: String(v).trim(), paren: '' };
  return { main: (m[1] + (m[3] ? ' ' + m[3] : '')).trim(), paren: m[2].trim() };
}

const JOB_WORDS = /소방관|전문직|대기업|공무원|공기업|의사|약사|교사|군인|경찰|회계사|변호사|간호사|자영업|프리랜서|사업|회사원|엔지니어|개발자/;
const REGION_WORDS = /서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|수도권/;
const AVOID_WORDS = /ㄴㄴ|비선호|기피|싫|제외|안\s*됨|빼고|어려|힘들/;

function parseProfile(text) {
  const r = { fields: {}, ideal: {}, descLines: [], found: [] };
  let mode = 'basic';

  const setF = (k, v, label) => { if (v && !r.fields[k]) { r.fields[k] = v; r.found.push(label); } };
  const setI = (k, v, label) => {
    if (!v) return;
    if (r.ideal[k]) r.ideal[k] += ', ' + v; else { r.ideal[k] = v; r.found.push(label); }
  };

  const keyBasic = (key, val, raw) => {
    if (/이름|별명|닉네임/.test(key)) return setF('name', val, '이름');
    if (/나이|출생|생년/.test(key)) return setF('birth_year', normBirth(val), '출생연도');
    if (/^키/.test(key)) {
      const p = extractParen(val);
      const h = p.main.match(/(1[2-9]\d|2[01]\d)/);
      setF('height', h ? h[1] : p.main, '키');
      if (p.paren) setF('body_type', p.paren, '체형');
      return;
    }
    if (/체형/.test(key)) return setF('body_type', val, '체형');
    if (/거주|사는\s*곳|지역/.test(key)) return setF('region', val, '거주지');
    if (/직업|하는\s*일/.test(key)) {
      const p = extractParen(val);
      setF('job', p.main, '직업');
      if (p.paren) setF('work_pattern', p.paren, '근무형태');
      return;
    }
    if (/근무/.test(key)) return setF('work_pattern', val, '근무형태');
    if (/종교/.test(key)) return setF('religion', val, '종교');
    if (/mbti|엠비티아이/i.test(key)) return setF('mbti', val, 'MBTI');
    if (/학력|학교/.test(key)) return setF('education', val, '학력');
    if (/음주|술/.test(key)) return setF('drinking', val, '음주');
    if (/흡연|담배/.test(key)) return setF('smoking', val, '흡연');
    if (/취미|관심/.test(key)) return setF('hobbies', val, '취미');
    if (/성격/.test(key)) return setF('personality', val, '성격');
    if (/자차|차량|^차$/.test(key)) return setF('car', val, '자차');
    r.descLines.push(raw);
  };

  const keyIdeal = (key, val) => {
    if (/나이|연령/.test(key)) return setI('age', val, '이상형 나이');
    if (/^키/.test(key)) return setI('height', val, '이상형 키');
    if (/거주|지역/.test(key)) return setI('region', val, '이상형 지역');
    if (/직업/.test(key)) return setI('jobs_pref', val, '선호 직업');
    if (/중요|우선/.test(key)) return setI('priority', val, '중요 순위');
    if (/종교/.test(key)) return setI('note', '종교: ' + val, '이상형 기타');
    return setI('note', val, '이상형 기타');
  };

  const freeIdeal = line => {
    if (/연상|연하|동갑|살\s*까지|살\s*차이|살\s*아래|살\s*위/.test(line)) return setI('age', line, '이상형 나이');
    if (/[>＞]|순으로\s*중요|가\s*제일\s*중요|1순위/.test(line)) return setI('priority', line, '중요 순위');
    if (/^키|키\s*1\d{2}|1\d{2}\s*(cm)?\s*이상/.test(line)) {
      const parts = line.split(/,(.+)/);
      if (parts.length > 1 && !/1\d{2}/.test(parts[1])) {
        setI('height', parts[0].trim(), '이상형 키');
        setI('note', parts[1].trim(), '이상형 기타');
      } else setI('height', line, '이상형 키');
      return;
    }
    if (JOB_WORDS.test(line)) {
      return AVOID_WORDS.test(line) ? setI('jobs_avoid', line.replace(/^[\(（]|[\)）]$/g, ''), '기피 직업')
                                    : setI('jobs_pref', line, '선호 직업');
    }
    if (REGION_WORDS.test(line)) return setI('region', line, '이상형 지역');
    setI('note', line, '이상형 기타');
  };

  const freeBasic = line => {
    if (/비흡연|흡연/.test(line)) return setF('smoking', /비흡연/.test(line) ? '비흡연' : line, '흡연');
    if (/^음주|술\s/.test(line)) return setF('drinking', line.replace(/^음주\s*/, ''), '음주');
    if (/자차|면허/.test(line)) return setF('car', line, '자차');
    const by = line.match(/(\d{2,4})\s*년생/);
    if (by && !r.fields.birth_year) return setF('birth_year', normBirth(by[1] + '년'), '출생연도');
    r.descLines.push(line);
  };

  for (let raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/^[-•·*※]\s*/, '');
    if (!line) continue;
    if (/^[\[\(（【]?\s*이상형/.test(line) && line.length <= 12) { mode = 'ideal'; continue; }
    if (/^[\[\(（【]?\s*(기본\s*정보|프로필)/.test(line) && line.length <= 12) { mode = 'basic'; continue; }

    const kv = line.match(/^([^:：]{1,14})[:：]\s*(.+)$/);
    if (kv) {
      const key = kv[1].trim().replace(/\s/g, '');
      const val = kv[2].trim();
      mode === 'ideal' ? keyIdeal(key, val) : keyBasic(key, val, line);
    } else {
      mode === 'ideal' ? freeIdeal(line) : freeBasic(line);
    }
  }
  if (r.descLines.length) r.fields.description = r.descLines.join('\n');
  return r;
}

// ═══════════════════════════════════════
//  렌더링 — 통계 / 후보 목록
// ═══════════════════════════════════════
function renderStats() {
  const ms = DB.data.matches;
  // '전체 후보'는 목록에서 실제로 볼 수 있는 사람 수입니다.
  // 블랙리스트는 목록에서 숨겨지므로 여기서도 빼야 숫자와 화면이 어긋나지 않습니다.
  const visible = DB.data.candidates.filter(c => !c.blacklisted).length;
  const ex = ms.filter(m => m.status === 'exchanging').length;
  const some = ms.filter(m => m.status === 'some').length;
  const suc = ms.filter(m => m.status === 'success').length;
  $('statAll').textContent = visible;
  $('statEx').textContent = ex;
  $('statSome').textContent = some;
  $('statSuc').textContent = suc;
  // 눈으로는 선으로 갈라뒀지만, 소리로 듣는 분에게도 단위를 알려줍니다
  const aria = (sel, txt) => { const el = document.querySelector(sel); if (el) el.setAttribute('aria-label', txt); };
  aria('[data-stat="all"]', `전체 후보 ${visible}명 보기`);
  aria('[data-stat="exchanging"]', `사진교환 중인 매칭 ${ex}건 보기`);
  aria('[data-stat="some"]', `썸 단계 매칭 ${some}건 보기`);
  aria('[data-stat="success"]', `성사된 매칭 ${suc}건 보기`);
  syncStatActive();
}

// 지금 보고 있는 화면·필터에 맞춰 어느 칸이 켜져 있는지 표시합니다
function syncStatActive() {
  document.querySelectorAll('.stat-box').forEach(box => {
    const st = box.dataset.stat;
    const on = st === 'all'
      ? (S.view === 'candidates' && !S.statusFilters.size)
      : (S.view === 'matches' && S.matchFilter === st);
    box.classList.toggle('active', on);
  });
}

// 상태 칩은 성격이 다른 두 묶음입니다.
//   stage — 진행 단계(대기중·매칭중·보류·블랙리스트). 한 사람은 한 단계에만 속합니다.
//   promo — 스레드 홍보 여부(홍보전·홍보완료). 진행 단계와는 상관없이 정해집니다.
const STATUS_GROUP = {
  candidate: 'stage', matched: 'stage', archived: 'stage', blacklist: 'stage',
  nopromo: 'promo', promo: 'promo'
};

function matchStage(c, key) {
  if (key === 'candidate') return candStatus(c) === 'candidate';
  if (key === 'matched') return !!activeMatchOf(c.id);
  if (key === 'archived') return !!c.archived;
  if (key === 'blacklist') return !!c.blacklisted;
  return false;
}

function filteredCandidates() {
  const q = S.search.toLowerCase();
  const picked = [...S.statusFilters];
  const stage = picked.filter(k => STATUS_GROUP[k] === 'stage');
  const promo = picked.filter(k => STATUS_GROUP[k] === 'promo');
  let list = DB.data.candidates.filter(c => {
    if (S.gender !== 'all' && c.gender !== S.gender) return false;
    // 블랙리스트 탭에서만 블랙리스트 후보를 보여주고, 나머지 탭에서는 숨김
    // 블랙리스트는 직접 고른 경우에만 보여줍니다
    if (!stage.includes('blacklist') && c.blacklisted) return false;
    // 같은 묶음 안에서는 '둘 중 아무거나', 다른 묶음끼리는 '둘 다'.
    // 그래서 [대기중 + 홍보전]은 '대기중이면서 홍보 전인 사람',
    // [대기중 + 매칭중]은 '대기중이거나 매칭중인 사람'이 됩니다.
    if (stage.length && !stage.some(k => matchStage(c, k))) return false;
    if (promo.length && !promo.some(k => k === 'promo' ? !!c.promo_url : !c.promo_url)) return false;
    if (q) {
      const hay = [c.name, c.job, c.region, c.description, c.personality, c.hobbies, c.mbti, c.education, c.religion, c.admin_memo, c.contact_threads, c.phone].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const pinned = Pin.get();
  list.sort((a, b) => {
    const pa = pinned.includes(a.id) ? 1 : 0, pb = pinned.includes(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (S.sort === 'tall' || S.sort === 'short') {
      const ha = heightNum(a.height), hb = heightNum(b.height);
      // 키를 안 적은 사람은 방향과 상관없이 항상 맨 뒤
      if (ha === null || hb === null) return (ha === null ? 1 : 0) - (hb === null ? 1 : 0);
      return S.sort === 'tall' ? hb - ha : ha - hb;
    }
    if (S.sort === 'young') return (parseInt(b.birth_year) || 0) - (parseInt(a.birth_year) || 0);
    if (S.sort === 'old') return (parseInt(a.birth_year) || 9999) - (parseInt(b.birth_year) || 9999);
    if (S.sort === 'name') return (a.name || '').localeCompare(b.name || '', 'ko');
    if (S.sort === 'oldest') return a.id - b.id;
    return b.id - a.id;
  });
  return list;
}

function emptyHtml(text, sub, action) {
  return `<div class="empty">
    <svg width="64" height="64" viewBox="0 0 64 64"><path d="M32 6C48 6 58 18 58 34C58 50 46 58 32 58C18 58 6 50 6 34C6 18 16 6 32 6Z" fill="#FFE9F1"/><circle cx="24" cy="30" r="3" fill="#FD1569"/><circle cx="40" cy="30" r="3" fill="#FD1569"/><path d="M26 42Q32 38 38 42" stroke="#FD1569" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>
    <p class="empty-text">${escHtml(text)}</p>
    <p class="empty-sub">${escHtml(sub)}</p>
    ${action ? `<button class="empty-action" id="${action.id}"><i class="ti ti-${action.icon || 'x'}"></i>${escHtml(action.label)}</button>` : ''}
  </div>`;
}

function avatarHtml(c, cls) {
  const photo = c.photos && c.photos[0];
  const inner = photo ? photoImg(photo, '') : `<i class="ti ti-${c.gender === 'm' ? 'leaf' : 'flower'}"></i>`;
  return `<div class="${cls} ${c.gender === 'm' ? 'male' : ''}">${inner}</div>`;
}

// ── 지금 걸려 있는 필터 ──
const STATUS_FILTER_LABEL = {
  candidate: '대기중', matched: '매칭중', archived: '보류',
  nopromo: '홍보전', promo: '홍보완료', blacklist: '블랙리스트'
};
const GENDER_LABEL = { m: '남자', f: '여자' };

// 받침에 따라 '로 / 으로'를 골라줍니다. ('홍보전로' 같은 말이 나오지 않게)
function josaRo(word) {
  const s = String(word || '');
  if (!s) return '로';
  const code = s.charCodeAt(s.length - 1);
  if (code < 0xAC00 || code > 0xD7A3) return '로';   // 한글이 아니면(따옴표 등) 기본값
  const jong = (code - 0xAC00) % 28;
  return (jong === 0 || jong === 8) ? '로' : '으로'; // 받침이 없거나 'ㄹ' 이면 '로'
}

function activeFilters() {
  const out = [];
  if (S.gender !== 'all') out.push(GENDER_LABEL[S.gender]);
  S.statusFilters.forEach(k => out.push(STATUS_FILTER_LABEL[k] || k));
  if (S.search) out.push(`"${S.search}"`);
  return out;
}

// 필터가 하나라도 걸려 있으면 무엇으로 걸러 보고 있는지 한 줄로 알려줍니다.
// 검색어를 지웠는데 목록이 비어 있어서 당황하는 일을 줄이려는 장치예요.
function renderFilterSummary(shown) {
  const f = activeFilters();
  const bar = $('filterSummary');
  bar.classList.toggle('hidden', !f.length);
  if (!f.length) return;
  const txt = f.join(' · ');
  $('filterSummaryText').innerHTML =
    `<b>${escHtml(txt)}</b>${josaRo(txt)} 거른 결과 ${shown}명`;
}

function resetFilters() {
  S.gender = 'all';
  S.statusFilters.clear();
  S.search = '';
  $('searchInput').value = '';
  syncFilterChips();
  renderCandidates();
}

// 화면의 칩·세그먼트를 지금 상태에 맞춰 다시 칠합니다
function syncFilterChips() {
  document.querySelectorAll('#genderChips .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.g === S.gender));
  document.querySelectorAll('#statusChips .chip').forEach(c => {
    const on = S.statusFilters.has(c.dataset.s);
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  syncStatActive();
}

function renderCandidates() {
  const box = $('candidateList');
  const list = filteredCandidates();
  renderFilterSummary(list.length);
  if (!list.length) {
    const filtered = activeFilters().length;
    box.innerHTML = filtered
      ? emptyHtml(
          '조건에 맞는 후보가 없어요',
          `${activeFilters().join(' · ')} 조건으로는 아무도 나오지 않았어요`,
          { id: 'emptyResetBtn', label: '필터 해제하고 전체 보기', icon: 'x' })
      : emptyHtml('아직 등록된 후보가 없어요', '아래 + 버튼으로 첫 후보를 등록해 보세요');
    const rb = $('emptyResetBtn');
    if (rb) rb.onclick = resetFilters;
    syncBulkBar();
    return;
  }
  const pinned = Pin.get();
  const selTick = c => S.selectMode ? `<span class="sel-tick"><i class="ti ti-check"></i></span>` : '';
  const selCls = c => S.selectMode && S.selected.has(c.id) ? 'selected' : '';
  const promoTag = c => c.promo_url ? `<span class="promo-tag"><i class="ti ti-speakerphone"></i>홍보완료</span>` : '';
  if (S.listMode === 'album') {
    box.innerHTML = `<div class="album-grid">` + list.map(c => {
      const st = candStatus(c);
      const photo = c.photos && c.photos[0];
      return `<div class="a-card ${pinned.includes(c.id) ? 'pinned' : ''} ${selCls(c)}" data-id="${c.id}">
        ${selTick(c)}
        <div class="a-photo ${c.gender === 'm' ? 'male' : ''}">
          ${photo ? photoImg(photo, c.name + ' 사진') : `<i class="ti ti-${c.gender === 'm' ? 'leaf' : 'flower'}"></i>`}
          <span class="badge ${st}">${STATUS_LABEL[st]}</span>
          ${promoTag(c)}
          ${pinned.includes(c.id) ? '<i class="ti ti-star-filled pin-star"></i>' : ''}
        </div>
        <div class="a-body">
          <div class="a-name">${escHtml(c.name)}</div>
          <div class="a-meta">${escHtml(metaLine(c))}</div>
        </div>
      </div>`;
    }).join('') + `</div>`;
  } else {
    box.innerHTML = list.map(c => {
      const st = candStatus(c);
      return `<div class="c-card ${pinned.includes(c.id) ? 'pinned' : ''} ${selCls(c)}" data-id="${c.id}">
        ${selTick(c)}
        <div class="c-row">
          ${avatarHtml(c, 'c-avatar')}
          <div class="c-info">
            <div class="c-name">${escHtml(c.name)} ${pinned.includes(c.id) ? '<i class="ti ti-star-filled pin-star"></i>' : ''} ${promoTag(c)} <span class="c-meta">${escHtml(metaLine(c))}</span></div>
            <div class="c-sub">${escHtml(subLine(c))}</div>
          </div>
          <span class="badge ${st}" ${S.selectMode ? 'style="margin-right:22px"' : ''}>${STATUS_LABEL[st]}</span>
        </div>
      </div>`;
    }).join('');
  }
  box.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.dataset.id, 10);
      if (S.selectMode) {
        if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
        el.classList.toggle('selected', S.selected.has(id));
        syncBulkBar();
        return;
      }
      openDetail(id);
    });
  });
  syncBulkBar();
}

// ── 선택 모드 / 일괄 작업 ──
function syncBulkBar() {
  const show = S.selectMode && S.view === 'candidates';
  $('bulkBar').classList.toggle('hidden', !show);
  if (!show) return;
  const n = S.selected.size;
  $('bulkCount').textContent = n ? `${n}명 선택` : '카드를 눌러 선택하세요';
  $('bulkBlacklistBtn').disabled = !n;
  $('bulkDeleteBtn').disabled = !n;
}

function setSelectMode(on) {
  S.selectMode = on;
  S.selected.clear();
  $('selectToggle').classList.toggle('on', on);
  renderCandidates();
}

async function bulkBlacklist() {
  const ids = [...S.selected];
  if (!ids.length) return;
  const names = ids.slice(0, 5).map(candName).join(', ') + (ids.length > 5 ? ` 외 ${ids.length - 5}명` : '');
  if (!await ask({
    title: `${ids.length}명을 블랙리스트에 등록할까요?`,
    desc: '후보 목록·추천·매칭 상대에서 제외됩니다. 나중에 되돌릴 수 있어요.',
    list: names, okText: '블랙리스트 등록', danger: true
  })) return;
  if (!(await DB.updateCandidates(ids, { blacklisted: true }))) return;
  setSelectMode(false);
  renderAll();
  toast(`${ids.length}명을 블랙리스트에 등록했어요`);
}

async function bulkDelete() {
  const ids = [...S.selected];
  if (!ids.length) return;
  const names = ids.slice(0, 5).map(candName).join(', ') + (ids.length > 5 ? ` 외 ${ids.length - 5}명` : '');
  if (!await ask({
    title: `${ids.length}명을 완전히 삭제할까요?`,
    desc: '연결된 매칭·거절 기록과 사진도 함께 삭제됩니다.',
    list: names, warn: '되돌릴 수 없습니다', okText: '삭제', danger: true
  })) return;
  if (!(await DB.deleteCandidates(ids))) return;
  setSelectMode(false);
  renderAll();
  toast(`${ids.length}명을 삭제했어요`);
}

// ═══════════════════════════════════════
//  매칭 추천 (이상형 조건 대조)
// ═══════════════════════════════════════
function ageFit(p, t) {
  const ia = (p.ideal || {}).age;
  const pb = parseInt(p.birth_year), tb = parseInt(t.birth_year);
  if (!ia || !pb || !tb) return 0;
  const diff = tb - pb; // 양수 = 연하, 음수 = 연상
  let lo = -3, hi = 3;  // 조건이 애매하면 ±3살 기본 허용
  const younger = String(ia).match(/연하\s*(\d+)/), older = String(ia).match(/연상\s*(\d+)/);
  if (younger) hi = parseInt(younger[1]);
  if (older) lo = -parseInt(older[1]);
  if (/동갑/.test(ia) && !younger && !older) { lo = -1; hi = 1; }
  return (diff >= lo && diff <= hi) ? 2 : -2;
}
function heightFit(p, t) {
  const ih = (p.ideal || {}).height;
  const th = parseInt(t.height);
  if (!ih || !th) return 0;
  const n = (String(ih).match(/1\d{2}/) || [])[0];
  if (!n) return 0;
  const v = parseInt(n);
  if (/이상|넘|커/.test(ih)) return th >= v ? 2 : -1;
  if (/이하|아래|작/.test(ih)) return th <= v ? 2 : -1;
  return Math.abs(th - v) <= 3 ? 2 : 0;
}
function regionFit(p, t) {
  const ir = (p.ideal || {}).region;
  if (!ir || !t.region) return 0;
  const words = String(ir).match(REGION_WORDS_G);
  if (!words) return 0;
  return words.some(w => t.region.includes(w)) ? 2 : -1;
}
const REGION_WORDS_G = /서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주/g;
function jobFit(p, t) {
  const I = p.ideal || {};
  if (!t.job) return 0;
  const hit = list => String(list).split(/[,、\/·]/).map(x => x.trim()).filter(Boolean)
    .some(k => t.job.includes(k) || (k.length >= 2 && k.includes(t.job)));
  if (I.jobs_avoid && hit(I.jobs_avoid)) return -4;
  if (I.jobs_pref && hit(I.jobs_pref)) return 3;
  return 0;
}
// a의 이상형 기준으로 b를 채점 + b의 이상형 기준으로 a를 채점
function matchScore(a, b) {
  const reasons = [];
  let score = 0;
  const check = (fn, label, badLabel) => {
    const s1 = fn(a, b), s2 = fn(b, a);
    score += s1 + s2;
    if (s1 > 0 && s2 >= 0 || s2 > 0 && s1 >= 0) reasons.push({ ok: true, label });
    else if (s1 < 0 || s2 < 0) reasons.push({ ok: false, label: badLabel });
  };
  check(ageFit, '나이 조건 맞음', '나이 조건 안 맞음');
  check(heightFit, '키 조건 맞음', '키 조건 안 맞음');
  check(regionFit, '지역 맞음', '지역 안 맞음');
  const j1 = jobFit(a, b), j2 = jobFit(b, a);
  score += j1 + j2;
  if (j1 < 0 || j2 < 0) reasons.push({ ok: false, label: '기피 직업 포함' });
  else if (j1 > 0 || j2 > 0) reasons.push({ ok: true, label: '선호 직업' });
  if (a.religion && b.religion && a.religion.slice(0, 2) === b.religion.slice(0, 2)) { score += 1; reasons.push({ ok: true, label: '같은 종교' }); }
  return { score, reasons };
}
// 추천 상대를 몇 명까지 펼쳐 볼지. 다른 사람의 상세를 열면 다시 접힙니다.
const RECO_FOLDED = 3, RECO_MAX = 20;
let recoOpen = false;
let recoDetailId = null;

function renderRecoSection(c) {
  if (activeMatchOf(c.id)) return ''; // 이미 매칭 진행 중이면 추천 생략
  // 이미 거절 기록이 있는 상대는 추천에서 뺌
  const targets = DB.data.candidates.filter(t =>
    t.gender !== c.gender && !t.archived && !t.blacklisted && !activeMatchOf(t.id) && !rejectionsBetween(c.id, t.id).length);
  const all = targets.map(t => Object.assign({ t }, matchScore(c, t)))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, RECO_MAX);
  if (!all.length) return '';
  const scored = recoOpen ? all : all.slice(0, RECO_FOLDED);
  const rest = all.length - scored.length;

  // 더 볼 사람이 남았으면 펼치는 버튼을, 다 펼쳤으면 접는 버튼을 붙입니다
  const more = rest > 0
    ? `<button type="button" class="reco-more" id="recoMoreBtn"><i class="ti ti-chevron-down"></i>추천 상대 ${rest}명 더 보기</button>`
    : (recoOpen && all.length > RECO_FOLDED
        ? `<button type="button" class="reco-more" id="recoFoldBtn"><i class="ti ti-chevron-up"></i>접기</button>`
        : '');

  // 펼쳤을 때는 목록 자체에 스크롤을 주어, 상세 화면이 끝없이 길어지지 않게 합니다
  return `<div class="d-section-title"><i class="ti ti-sparkles"></i> 추천 상대
      <span class="c-meta" style="font-weight:500">${all.length}명</span></div>
    <div class="reco-list${recoOpen ? ' scroll' : ''}">`
    + scored.map(x => `
    <div class="reco-item" data-rid="${x.t.id}">
      ${avatarHtml(x.t, 'c-avatar')}
      <div style="min-width:0;flex:1">
        <div class="reco-name">${escHtml(x.t.name)} <span class="c-meta">${escHtml(metaLine(x.t))}</span></div>
        <div class="reco-tags">${x.reasons.map(r => `<span class="reco-tag ${r.ok ? '' : 'bad'}">${escHtml(r.label)}</span>`).join('')}</div>
      </div>
      <button class="icon-btn reco-link" data-rid="${x.t.id}" title="이어주기" aria-label="${escHtml(x.t.name)}님과 이어주기" style="background:var(--pink-soft);color:var(--pink-dark);flex-shrink:0"><i class="ti ti-heart-plus"></i></button>
    </div>`).join('') + `</div>` + more;
}

// ── 후보의 전체 매칭 기록 (종료 포함) ──
function renderCandHistory(cid) {
  const hist = DB.data.matches.filter(m => m.male_id === cid || m.female_id === cid);
  if (!hist.length) return '';
  return `<div class="d-section-title"><i class="ti ti-history"></i> 매칭 기록</div>` + hist.map(m => {
    const otherId = m.male_id === cid ? m.female_id : m.male_id;
    return `<div class="cand-hist" data-hmid="${m.id}">
      <span class="badge ${m.status}">${STATUS_LABEL[m.status]}</span>
      <span class="cand-hist-name">${escHtml(candName(otherId))}</span>
      <span class="cand-hist-date">${String(m.created_at).slice(0, 10).replace(/-/g, '.')} 시작</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════
//  사진 갤러리 — 상세 캐러셀 + 라이트박스
// ═══════════════════════════════════════

// ── 상세 모달 안의 사진 캐러셀 (버튼 / 도트 / 드래그 / 스와이프) ──
const Gal = {
  photos: [],
  idx: 0,
  track: null,

  html(photos) {
    return `<div class="d-gallery ${photos.length > 1 ? '' : 'single'}">
      <div class="d-track" id="galTrack">
        ${photos.map((p, i) => `<img src="${escHtml(p)}" data-pi="${i}" alt="사진 ${i + 1}" decoding="async">`).join('')}
      </div>
      <button class="gal-nav prev" id="galPrev" aria-label="이전 사진"><i class="ti ti-chevron-left"></i></button>
      <button class="gal-nav next" id="galNext" aria-label="다음 사진"><i class="ti ti-chevron-right"></i></button>
      <div class="gal-count" id="galCount"></div>
      <div class="gal-dots" id="galDots">${photos.map((_, i) => `<button class="gal-dot" data-gd="${i}" aria-label="${i + 1}번째 사진"></button>`).join('')}</div>
    </div>`;
  },

  mount(photos) {
    this.photos = (photos || []).slice();
    this.idx = 0;
    const track = $('galTrack');
    this.track = track;
    if (!track) return;

    let moved = 0;

    // 스크롤 위치로 현재 장수 파악 (터치 스와이프도 여기로 잡힘)
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / (track.clientWidth || 1));
      if (i !== this.idx) { this.idx = i; this.sync(); }
    }, { passive: true });

    // 마우스로 끌어서 넘기기
    let down = false, startX = 0, startLeft = 0;
    track.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || this.photos.length < 2) return;
      down = true; moved = 0;
      startX = e.clientX; startLeft = track.scrollLeft;
      track.classList.add('dragging');
    });
    track.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      track.scrollLeft = startLeft - dx;
      e.preventDefault();
    });
    const endDrag = () => {
      if (!down) return;
      down = false;
      track.classList.remove('dragging');
      this.to(Math.round(track.scrollLeft / (track.clientWidth || 1)));
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointerleave', endDrag);
    track.addEventListener('pointercancel', endDrag);

    // 사진 클릭 → 크게 보기 (끌어서 넘긴 직후에는 열지 않음)
    track.querySelectorAll('img').forEach(img => {
      img.addEventListener('click', () => {
        const wasDrag = moved > 5;
        moved = 0;
        if (wasDrag) return;
        LB.open(this.photos, parseInt(img.dataset.pi, 10));
      });
    });

    $('galPrev').onclick = () => this.go(-1);
    $('galNext').onclick = () => this.go(1);
    $('galDots').querySelectorAll('.gal-dot').forEach(d => {
      d.onclick = () => this.to(parseInt(d.dataset.gd, 10));
    });
    this.sync();
  },

  to(i) {
    if (!this.track || !this.photos.length) return;
    this.idx = Math.max(0, Math.min(this.photos.length - 1, i));
    this.track.scrollTo({ left: this.idx * this.track.clientWidth, behavior: 'smooth' });
    this.sync();
  },
  go(d) { this.to(this.idx + d); },

  sync() {
    const n = this.photos.length;
    const cnt = $('galCount'), prev = $('galPrev'), next = $('galNext'), dots = $('galDots');
    if (cnt) cnt.textContent = `${this.idx + 1} / ${n}`;
    if (prev) prev.disabled = this.idx <= 0;
    if (next) next.disabled = this.idx >= n - 1;
    if (dots) dots.querySelectorAll('.gal-dot').forEach((d, i) => d.classList.toggle('on', i === this.idx));
  }
};

// ── 라이트박스 (사진 크게 보기) ──
const LB = {
  photos: [],
  idx: 0,

  open(photos, idx) {
    this.photos = (photos || []).filter(Boolean);
    if (!this.photos.length) return;
    this.idx = Math.max(0, Math.min(this.photos.length - 1, idx || 0));
    const box = $('lightbox');
    box.classList.toggle('single', this.photos.length < 2);
    $('lbDots').innerHTML = this.photos.map((_, i) => `<button class="lb-dot" data-ld="${i}" aria-label="${i + 1}번째 사진"></button>`).join('');
    $('lbDots').querySelectorAll('.lb-dot').forEach(d => {
      d.onclick = e => { e.stopPropagation(); this.to(parseInt(d.dataset.ld, 10)); };
    });
    this.render();
    box.classList.add('open');
  },

  close() { $('lightbox').classList.remove('open'); },
  isOpen() { return $('lightbox').classList.contains('open'); },

  to(i) {
    if (!this.photos.length) return;
    this.idx = Math.max(0, Math.min(this.photos.length - 1, i));
    this.render();
  },
  go(d) { this.to(this.idx + d); },

  render() {
    $('lightboxImg').src = this.photos[this.idx];
    $('lbCount').textContent = `${this.idx + 1} / ${this.photos.length}`;
    $('lbPrev').disabled = this.idx <= 0;
    $('lbNext').disabled = this.idx >= this.photos.length - 1;
    $('lbDots').querySelectorAll('.lb-dot').forEach((d, i) => d.classList.toggle('on', i === this.idx));
    // 앞뒤 사진 미리 받아두기 (넘길 때 깜빡임 방지)
    [this.idx - 1, this.idx + 1].forEach(i => { if (this.photos[i]) new Image().src = this.photos[i]; });
  }
};

// ═══════════════════════════════════════
//  거절 기록 모달
// ═══════════════════════════════════════
const Rej = {
  mode: 'match',   // 'match' = 매칭 종료하면서 기록 / 'direct' = 후보 상세에서 직접 추가
  matchId: null,
  memo: '',
  left: null,      // 매칭이면 남자 / 직접 추가면 기준 후보
  right: null,     // 매칭이면 여자 / 직접 추가면 고른 상대
  who: null,       // 'left' | 'right' | 'both'
  stage: 'profile',
  after: null,
  query: '',       // 상대 검색어

  openForMatch(m, memoNow) {
    this.mode = 'match';
    this.matchId = m.id;
    this.memo = memoNow || '';
    this.left = candOf(m.male_id);
    this.right = candOf(m.female_id);
    this.after = () => { openMatchDetail(m.id, true); renderAll(); };
    this._open('매칭 종료', true);
  },

  openForCandidate(c) {
    this.mode = 'direct';
    this.matchId = null;
    this.memo = '';
    this.left = c;
    this.right = null;
    this.after = () => { openDetail(c.id, true); renderCandidates(); };
    this._open('거절 기록 추가', false);
  },

  _open(title, isMatch) {
    this.who = null;
    this.stage = 'profile';
    this.query = '';
    $('rejSearch').value = '';
    $('rejTitle').innerHTML = `<i class="ti ti-heart-broken"></i> ${escHtml(title)}`;
    $('rejHint').textContent = isMatch
      ? '누가 마음을 접었는지 남겨두면, 나중에 같은 조합을 다시 이어주는 실수를 막을 수 있어요.'
      : '매칭을 맺지 않고 프로필만 보고 거절한 경우에도 여기에 남겨두세요.';
    $('rejReason').value = '';
    $('rejPickWrap').classList.toggle('hidden', isMatch);
    $('rejSkipBtn').classList.toggle('hidden', !isMatch);
    document.querySelectorAll('#rejStage .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.st === 'profile'));
    if (!isMatch) this._renderPicker();
    this._renderWho();
    openModal('rejectModal');
  },

  _renderPicker() {
    const box = $('rejPickList');
    const q = this.query.trim().toLowerCase();
    const all = DB.data.candidates.filter(c => c.gender !== this.left.gender);
    const list = all.filter(c => {
      if (!q) return true;
      // 고른 사람은 검색어와 무관하게 목록에 남겨둬야 선택이 풀리지 않음
      if (this.right && this.right.id === c.id) return true;
      const hay = [c.name, c.job, c.region, c.birth_year, ageLabel(c), c.education, c.mbti, c.hobbies].join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (!list.length) {
      box.innerHTML = `<div style="padding:16px;text-align:center;font-size:13.5px;color:var(--gray-mid)">${
        all.length ? `"${escHtml(this.query.trim())}" 검색 결과가 없어요` : '상대로 고를 후보가 없어요'
      }</div>`;
      return;
    }
    box.innerHTML = list.map(c => {
      const done = rejectionsBetween(this.left.id, c.id).length;
      return `<div class="pick-item ${this.right && this.right.id === c.id ? 'sel' : ''} ${c.gender === 'f' ? 'f-side' : ''}" data-rp="${c.id}">
        ${escHtml(c.name)}${done ? '<span class="rej-tag">기록 있음</span>' : ''}
        <span class="sub">${escHtml([ageLabel(c), c.job, c.region].filter(Boolean).join(' · '))}</span>
      </div>`;
    }).join('');
    box.querySelectorAll('.pick-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.rp, 10);
        this.right = (this.right && this.right.id === id) ? null : candOf(id);
        this.who = null;
        this._renderPicker();
        this._renderWho();
      });
    });
  },

  _renderWho() {
    const box = $('rejWho');
    if (!this.right) {
      box.innerHTML = `<p class="hint-text" style="grid-column:1/-1;margin:0">먼저 위에서 상대를 골라주세요</p>`;
      this._syncSave();
      return;
    }
    const L = this.left, R = this.right;
    box.innerHTML = `
      <button type="button" class="rej-who-btn ${this.who === 'left' ? 'on' : ''}" data-who="left">${escHtml(L.name)}님이 거절<span class="sub">${escHtml(R.name)}님을 거절함</span></button>
      <button type="button" class="rej-who-btn ${this.who === 'right' ? 'on' : ''}" data-who="right">${escHtml(R.name)}님이 거절<span class="sub">${escHtml(L.name)}님을 거절함</span></button>
      <button type="button" class="rej-who-btn ${this.who === 'both' ? 'on' : ''}" data-who="both" style="grid-column:1/-1">서로 거절<span class="sub">두 사람 모두 기록됩니다</span></button>`;
    box.querySelectorAll('.rej-who-btn').forEach(b => {
      b.addEventListener('click', () => { this.who = b.dataset.who; this._renderWho(); });
    });
    this._syncSave();
  },

  _syncSave() { $('rejSaveBtn').disabled = !(this.right && this.who); },

  async save() {
    if (!(this.right && this.who)) return;
    const btn = $('rejSaveBtn');
    btn.disabled = true;
    const base = { match_id: this.matchId, stage: this.stage, reason: $('rejReason').value.trim() };
    const rows = [];
    if (this.who === 'left' || this.who === 'both') rows.push(Object.assign({}, base, { from_id: this.left.id, to_id: this.right.id }));
    if (this.who === 'right' || this.who === 'both') rows.push(Object.assign({}, base, { from_id: this.right.id, to_id: this.left.id }));
    const saved = await DB.addRejections(rows);
    btn.disabled = false;
    if (!saved) return;
    if (this.mode === 'match') await this._endMatch();
    closeModal('rejectModal');
    if (this.after) this.after();
    toast('거절 기록이 저장되었어요');
  },

  // 기록은 남기지 않고 매칭만 종료
  async skip() {
    if (this.mode === 'match') await this._endMatch();
    closeModal('rejectModal');
    if (this.after) this.after();
  },

  async _endMatch() {
    const m = DB.data.matches.find(x => x.id === this.matchId);
    if (!m || m.status === 'ended') return;
    const hist = [...(m.history || []), { t: 'status', to: 'ended', at: nowStr() }];
    await DB.updateMatch(this.matchId, { status: 'ended', memo: this.memo, history: hist });
  }
};

// ── 후보 상세의 거절 기록 섹션 ──
function renderRejectionSection(cid) {
  const out = rejectionsBy(cid), inc = rejectionsOf(cid);
  const row = (r, dir) => {
    const otherId = dir === 'out' ? r.to_id : r.from_id;
    return `<div class="rej-item" data-rother="${otherId}">
      <span class="rej-dir ${dir}">${dir === 'out' ? '내가 거절' : '나를 거절'}</span>
      <div class="rej-body">
        <div class="rej-name">${escHtml(candName(otherId))} <span class="rej-meta">${escHtml(rejectLabel(r))}</span></div>
        ${r.reason ? `<div class="rej-reason">${escHtml(r.reason)}</div>` : ''}
      </div>
      <button class="rej-del" data-rdel="${r.id}" title="기록 삭제"><i class="ti ti-x"></i></button>
    </div>`;
  };
  const items = [...out.map(r => row(r, 'out')), ...inc.map(r => row(r, 'in'))].join('');
  return `<div class="d-section-title"><i class="ti ti-heart-broken"></i> 거절 기록${out.length || inc.length ? ` <span class="c-meta" style="font-weight:500">내가 ${out.length} · 나를 ${inc.length}</span>` : ''}</div>
    ${items || '<p class="d-desc" style="color:var(--gray-mid)">아직 거절 기록이 없어요</p>'}
    <button class="btn soft" id="dRejAddBtn" style="margin-top:var(--sp-3)"><i class="ti ti-plus"></i> 거절 기록 추가</button>`;
}

// ═══════════════════════════════════════
//  후보 상세 모달
// ═══════════════════════════════════════
function infoRow(icon, label, value) {
  if (!value) return '';
  return `<tr><td><i class="ti ti-${icon}"></i>${label}</td><td>${escHtml(value)}</td></tr>`;
}

// 스레드 아이디는 눌러서 바로 그 사람 프로필로 갈 수 있게 링크로 보여줍니다.
function threadsRow(handle) {
  if (!handle) return '';
  const id = String(handle).trim().replace(/^@+/, '');
  if (!id) return '';
  const url = 'https://www.threads.com/@' + encodeURIComponent(id);
  return `<tr><td><i class="ti ti-at"></i>스레드</td>
    <td><a class="threads-link" href="${escHtml(url)}" target="_blank" rel="noopener">@${escHtml(id)} <i class="ti ti-external-link"></i></a></td></tr>`;
}

// ── 오늘의 검사 결과 ──
// 신청 폼이 test_results 에 담아 보내고, 승인하면 후보로 그대로 넘어옵니다.
// { mbti:'ENFP', love:'SCEM', ideal:'FMDL', src:'oneul' }
const QUIZ_LABEL = { mbti: '성격 검사', love: '연애 유형', ideal: '이상형 검사' };
const QUIZ_PAGE = {
  mbti: 'https://love-mbti-mu.vercel.app/types.html?test=mbti',
  love: 'https://love-mbti-mu.vercel.app/types.html?test=love',
  ideal: 'https://love-mbti-mu.vercel.app/types.html?test=ideal'
};
const QUIZ_HOME = 'https://love-mbti-mu.vercel.app/';

/** 유형 설명 페이지로 바로 갈 수 있게 링크로 보여줍니다 */
function testRows(t) {
  const r = t || {};
  return Object.keys(QUIZ_LABEL).filter(k => r[k]).map(k =>
    `<tr><td><i class="ti ti-heart-code"></i>${QUIZ_LABEL[k]}</td>
      <td><a class="threads-link" href="${escHtml(QUIZ_PAGE[k])}" target="_blank" rel="noopener">${escHtml(r[k])} <i class="ti ti-external-link"></i></a></td></tr>`
  ).join('');
}

// keepTrail: 같은 화면을 다시 그리거나 발자국을 따라 되돌아올 때는 true.
//            목록에서 새로 열 때는 넘기지 않으면 되고, 그러면 발자국이 초기화됩니다.
function openDetail(id, keepTrail) {
  const c = candOf(id);
  if (!c) return;
  if (!keepTrail) Trail.clear();
  if (recoDetailId !== id) { recoOpen = false; recoDetailId = id; }   // 다른 사람을 열면 추천 목록은 다시 접습니다
  const st = candStatus(c);
  const pinnedNow = Pin.has(id);
  const photos = c.photos || [];
  const ideal = c.ideal || {};
  const hobbies = (c.hobbies || '').split(/[,、·\/]/).map(s => s.trim()).filter(Boolean);
  const activeM = activeMatchOf(id);

  const recoHtml = renderRecoSection(c);

  // 화면을 네 덩어리로 나눠 둡니다.
  //   A 사진·이름   B 지금 할 일(추천·매칭)   C 프로필 내용   D 관리 도구
  // 휴대폰에서는 A→B→C→D 순서로 쌓이고, PC에서는 A+C / B+D 두 칸으로 나뉩니다. (style.css의 .d-main/.d-side)
  $('detailBody').innerHTML = `
   <div class="d-main">
    <div class="d-blk-a">
      ${Trail.html()}
      ${photos.length
        ? Gal.html(photos)
        : `<div class="d-nophoto"><i class="ti ti-${c.gender === 'm' ? 'leaf' : 'flower'}"></i>등록된 사진이 없어요</div>`}
      <div class="d-head">
        <span class="d-name">${escHtml(c.name)}</span>
        <span class="badge ${st}">${STATUS_LABEL[st]}</span>
        ${c.promo_url ? `<span class="promo-tag"><i class="ti ti-speakerphone"></i>홍보완료</span>` : ''}
        <button class="icon-btn" id="dPinBtn" style="margin-left:auto;background:var(--gray-bg);color:${pinnedNow ? '#E9B949' : 'var(--gray-mid)'}"><i class="ti ti-star${pinnedNow ? '-filled' : ''}"></i></button>
      </div>
      <div class="d-headline">${escHtml([c.birth_year ? c.birth_year + '년생' : '', c.height ? c.height + 'cm' : '', c.body_type, c.region].filter(Boolean).join(' · '))}</div>

      <div class="d-actions">
        <button class="d-act" id="dCopyBtn"><i class="ti ti-copy"></i>정보 복사</button>
        <button class="d-act" id="dPhotoBtn"><i class="ti ti-photo-down"></i>사진 저장</button>
        <button class="d-act accent" id="dEditBtn"><i class="ti ti-edit"></i>수정</button>
        <button class="d-act" id="dDelBtn" style="color:#C13515"><i class="ti ti-trash"></i>삭제</button>
      </div>
    </div>

    <div class="d-blk-c">
      <table class="info-table">
        ${threadsRow(c.contact_threads)}
        ${infoRow('phone', '연락처', c.phone)}
        ${jobRows(c)}
        ${infoRow('school', '학력', c.education)}
        ${infoRow('building-church', '종교', c.religion)}
        ${infoRow('puzzle', 'MBTI', c.mbti)}
        ${infoRow('glass-full', '음주', c.drinking)}
        ${infoRow('smoking-no', '흡연', c.smoking)}
        ${infoRow('car', '자차', c.car)}
        ${testRows(c.test_results)}
      </table>
      ${hobbies.length ? `<div class="d-section-title">취미</div><div class="tag-row">${hobbies.map(h => `<span class="tag">${escHtml(h)}</span>`).join('')}</div>` : ''}
      ${c.personality ? `<div class="d-section-title">성격</div><p class="d-desc">${escHtml(c.personality)}</p>` : ''}
      ${c.description ? `<div class="d-section-title">특징 메모</div><p class="d-desc">${escHtml(c.description)}</p>` : ''}

      ${Object.values(ideal).some(Boolean) ? `
      <div class="ideal-card">
        <div class="ideal-title"><i class="ti ti-sparkles"></i> 이런 분을 기다려요</div>
        <table class="info-table">
          ${infoRow('calendar', '나이', ideal.age)}
          ${infoRow('ruler-2', '키', ideal.height)}
          ${infoRow('map-pin', '지역', ideal.region)}
          ${infoRow('list-numbers', '중요 순위', ideal.priority)}
          ${infoRow('thumb-up', '선호 직업', ideal.jobs_pref)}
          ${infoRow('thumb-down', '기피 직업', ideal.jobs_avoid)}
          ${infoRow('message-heart', '기타', ideal.note)}
        </table>
      </div>` : ''}
    </div>
   </div>

   <div class="d-side">
    <div class="d-blk-b">
      <div class="d-nextup">
        ${activeM
          ? `<div class="d-section-title" style="margin-top:0"><i class="ti ti-heart"></i> 진행 중인 매칭</div>
             <button class="btn soft" id="dGoMatchBtn"><i class="ti ti-heart"></i> ${escHtml(candName(activeM.male_id))} ♥ ${escHtml(candName(activeM.female_id))} 보기</button>`
          : `${recoHtml || `<div class="d-section-title" style="margin-top:0"><i class="ti ti-sparkles"></i> 추천 상대</div>
               <p class="d-desc" style="font-size:14px;color:var(--gray-mid)">조건이 맞는 상대를 아직 못 찾았어요. 아래 버튼으로 직접 고를 수 있어요.</p>`}
             <div class="gap"></div>
             <button class="btn primary" id="dMatchBtn"><i class="ti ti-heart-plus"></i> 매칭 맺어주기</button>`}
      </div>
    </div>

    <div class="d-blk-d">
      <div class="d-section-title"><i class="ti ti-speakerphone"></i> 스레드 홍보
        ${c.promo_url
          ? `<span class="promo-tag"><i class="ti ti-check"></i>홍보완료</span>${c.promo_at ? `<span class="c-meta" style="font-weight:500">${String(c.promo_at).slice(0, 10).replace(/-/g, '.')}</span>` : ''}`
          : '<span class="c-meta" style="font-weight:500">아직 홍보 전</span>'}
      </div>
      <div class="promo-link-row">
        <input id="dPromoUrl" type="url" placeholder="홍보 글 주소(URL)를 붙여넣어 주세요" value="${escHtml(c.promo_url || '')}">
        ${c.promo_url ? `<a class="promo-open" href="${escHtml(c.promo_url)}" target="_blank" rel="noopener" title="홍보 글 열기"><i class="ti ti-external-link"></i></a>` : ''}
      </div>
      <button class="btn soft" id="dPromoSaveBtn" style="margin-top:var(--sp-2)"><i class="ti ti-check"></i> 홍보 링크 저장</button>
      <div class="gap-lg"></div>

      <div class="d-section-title"><i class="ti ti-notes"></i> 관리자 메모</div>
      <textarea id="dAdminMemo" class="admin-memo-input" placeholder="예: 5월에 ○○님과 소개 → 애프터 없이 종료. 지인 소개로 등록됨.">${escHtml(c.admin_memo || '')}</textarea>
      <button class="btn soft" id="dMemoSaveBtn" style="margin-top:var(--sp-2)"><i class="ti ti-check"></i> 메모 저장</button>
      <div class="gap-lg"></div>

      ${renderCandHistory(id)}
      ${renderRejectionSection(id)}
      <div class="gap-lg"></div>

      <button class="btn ghost" id="dArchiveBtn">${c.archived ? '보류 해제하기' : '보류 처리하기'}</button>
      <p class="hint-text" style="margin:var(--sp-2) 0 0">${c.archived
        ? '지금은 보류 상태예요. 해제하면 추천·매칭 후보로 다시 나타납니다.'
        : '잠시 쉬어가는 분에게 쓰세요. 목록에는 그대로 남지만 추천 상대와 매칭 상대 고르기에서는 빠집니다. 언제든 되돌릴 수 있어요.'}</p>
      <div class="gap"></div>
      <button class="btn ghost" id="dBlacklistBtn" style="color:#C13515;border-color:#C13515">${c.blacklisted ? '블랙리스트 해제하기' : '블랙리스트 등록하기'}</button>
      <p class="hint-text" style="margin:var(--sp-2) 0 0">후보 목록에서 숨기고 추천·매칭에서도 완전히 제외해요. 블랙리스트 필터에서 다시 볼 수 있습니다.</p>
    </div>
   </div>
  `;

  Gal.mount(photos);
  Trail.bind('detailBody');
  $('dPinBtn').onclick = () => { Pin.toggle(id); openDetail(id, true); renderCandidates(); };
  $('dCopyBtn').onclick = () => copyProfile(c);
  $('dPhotoBtn').onclick = () => downloadPhoto(c);
  $('dEditBtn').onclick = () => { closeModal('detailModal'); startEdit(id); };
  $('dDelBtn').onclick = async () => {
    if (!await ask({
      title: `'${c.name}' 후보를 삭제할까요?`,
      desc: '연결된 매칭 기록과 사진도 함께 삭제됩니다.',
      warn: '되돌릴 수 없습니다', okText: '삭제', danger: true
    })) return;
    if (!(await DB.deleteCandidate(id))) return;
    closeModal('detailModal');
    renderAll();
    toast('삭제되었습니다');
  };
  $('dArchiveBtn').onclick = async () => {
    const r = await DB.updateCandidate(id, { archived: !c.archived });
    if (!r) return;
    openDetail(id, true);
    renderCandidates();
  };
  $('dBlacklistBtn').onclick = async () => {
    if (!c.blacklisted && !await ask({
      title: `'${c.name}' 님을 블랙리스트에 등록할까요?`,
      desc: '후보 목록·추천·매칭 상대에서 제외됩니다. 블랙리스트 필터에서 다시 볼 수 있어요.',
      okText: '블랙리스트 등록', danger: true
    })) return;
    const r = await DB.updateCandidate(id, { blacklisted: !c.blacklisted });
    if (!r) return;
    toast(c.blacklisted ? '블랙리스트에서 해제했어요' : '블랙리스트에 등록했어요');
    openDetail(id, true);
    renderCandidates();
  };
  const goM = $('dGoMatchBtn'), newM = $('dMatchBtn');
  if (goM) goM.onclick = () => { Trail.push('cand', id); closeModal('detailModal'); openMatchDetail(activeM.id, true); };
  if (newM) newM.onclick = () => { closeModal('detailModal'); openCreateMatch(c); };

  // 관리자 메모 저장
  $('dMemoSaveBtn').onclick = async () => {
    const r = await DB.updateCandidate(id, { admin_memo: $('dAdminMemo').value.trim() });
    if (r) toast('관리자 메모가 저장되었어요');
  };
  // 스레드 홍보 링크 저장
  $('dPromoSaveBtn').onclick = async () => {
    const url = $('dPromoUrl').value.trim();
    if (url && !/^https?:\/\//i.test(url)) { toast('http:// 또는 https:// 로 시작하는 주소를 넣어주세요'); return; }
    const r = await DB.updateCandidate(id, { promo_url: url, promo_at: url ? (c.promo_at || nowStr()) : null });
    if (!r) return;
    toast(url ? '홍보완료로 표시했어요' : '홍보 표시를 지웠어요');
    openDetail(id, true);
    renderCandidates();
  };
  // 매칭 기록 → 해당 매칭 상세로
  $('detailBody').querySelectorAll('.cand-hist').forEach(el => {
    el.addEventListener('click', () => {
      Trail.push('cand', id);
      closeModal('detailModal');
      openMatchDetail(parseInt(el.dataset.hmid, 10), true);
    });
  });
  // 거절 기록: 카드 클릭 → 상대 프로필 / × → 기록 삭제 / 추가 버튼
  $('dRejAddBtn').onclick = () => { closeModal('detailModal'); Rej.openForCandidate(c); };
  $('detailBody').querySelectorAll('.rej-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.rej-del')) return;
      Trail.push('cand', id);
      openDetail(parseInt(el.dataset.rother, 10), true);
    });
  });
  $('detailBody').querySelectorAll('.rej-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!await ask({ title: '이 거절 기록을 삭제할까요?', okText: '삭제', danger: true })) return;
      if (!(await DB.deleteRejection(parseInt(btn.dataset.rdel, 10)))) return;
      openDetail(id, true);
      toast('기록이 삭제되었어요');
    });
  });
  // 추천 상대: 카드 클릭 → 그 사람 상세 / 하트 → 바로 매칭 맺기
  $('detailBody').querySelectorAll('.reco-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.reco-link')) return;
      Trail.push('cand', id);
      openDetail(parseInt(el.dataset.rid, 10), true);
    });
  });
  const recoMore = $('recoMoreBtn'), recoFold = $('recoFoldBtn');
  if (recoMore) recoMore.onclick = () => { recoOpen = true; openDetail(id, true); };
  if (recoFold) recoFold.onclick = () => { recoOpen = false; openDetail(id, true); };
  $('detailBody').querySelectorAll('.reco-link').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeModal('detailModal');
      openCreateMatch(c, candOf(parseInt(btn.dataset.rid, 10)));
    });
  });

  openModal('detailModal');
}

function copyProfile(c) {
  const ideal = c.ideal || {};
  const L = [];
  L.push('[썸메이트 프로필]');
  L.push(`이름: ${c.name}`);
  L.push(`성별: ${c.gender === 'm' ? '남성' : '여성'}`);
  if (c.birth_year) L.push(`나이: ${c.birth_year}년생`);
  if (c.height) L.push(`키: ${c.height}cm${c.body_type ? ` (${c.body_type})` : ''}`);
  if (c.region) L.push(`거주지: ${c.region}`);
  if (c.job || c.work_pattern) L.push(`직업: ${joinParen(c.job, c.work_pattern)}`);
  if (c.education) L.push(`학력: ${c.education}`);
  if (c.religion) L.push(`종교: ${c.religion}`);
  if (c.mbti) L.push(`MBTI: ${c.mbti}`);
  // 검사 결과 — 스레드 홍보 글에 한 줄 들어가면 사람 소개가 훨씬 잘 읽힙니다
  Object.keys(QUIZ_LABEL).forEach(k => {
    const v = (c.test_results || {})[k];
    if (v) L.push(`${QUIZ_LABEL[k]}: ${v}`);
  });
  if (c.drinking) L.push(`음주: ${c.drinking}`);
  if (c.smoking) L.push(`흡연: ${c.smoking}`);
  if (c.car) L.push(`자차: ${c.car}`);
  if (c.hobbies) L.push(`취미: ${c.hobbies}`);
  if (c.personality) L.push(`성격: ${c.personality}`);
  if (c.description) L.push(`\n[특징]\n${c.description}`);
  if (Object.values(ideal).some(Boolean)) {
    L.push('\n[이상형]');
    if (ideal.age) L.push(`나이: ${ideal.age}`);
    if (ideal.height) L.push(`키: ${ideal.height}`);
    if (ideal.region) L.push(`지역: ${ideal.region}`);
    if (ideal.priority) L.push(`중요 순위: ${ideal.priority}`);
    if (ideal.jobs_pref) L.push(`선호 직업: ${ideal.jobs_pref}`);
    if (ideal.jobs_avoid) L.push(`기피 직업: ${ideal.jobs_avoid}`);
    if (ideal.note) L.push(`기타: ${ideal.note}`);
  }
  const text = L.join('\n');
  const done = () => toast('프로필이 복사되었어요');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('복사에 실패했어요'); }
  document.body.removeChild(ta);
}

function downloadPhoto(c) {
  const photos = c.photos || [];
  if (!photos.length) return toast('저장할 사진이 없어요');
  photos.forEach((p, i) => {
    const a = document.createElement('a');
    a.href = p;
    a.download = `썸메이트_${c.name}_${i + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
  toast(`사진 ${photos.length}장이 저장되었어요`);
}

// ═══════════════════════════════════════
//  등록 / 수정 폼
// ═══════════════════════════════════════
const FORM_IDS = ['fName','fBirth','fHeight','fBody','fThreads','fPhone','fRegion','fJob','fWork','fEdu','fReligion','fMbti','fDrink','fSmoke','fCar','fHobby','fPersonality','fDesc','iAge','iHeight','iRegion','iPriority','iJobsPref','iJobsAvoid','iNote'];

// 스레드 아이디를 '@아이디' 한 가지 모양으로 맞춰줌.
// 주소를 통째로 붙여넣어도 아이디만 뽑아냅니다. 못 알아보면 빈 문자열.
function normThreads(v) {
  let s = String(v ?? '').trim();
  if (!s) return '';
  const url = s.match(/threads\.(?:com|net)\/@?([A-Za-z0-9._]+)/i);
  if (url) s = url[1];
  s = s.replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '');
  if (!s || s.length > 30) return '';
  return '@' + s;
}

// '010-1234-5678' 꼴로 정리 (하이픈 포함 최대 13자)
function formatPhone(v) {
  const d = String(v ?? '').replace(/[^0-9]/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
let formGender = '';

function setRegMode(mode) {
  S.regMode = mode;
  document.querySelectorAll('#regTabs .seg-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('regPaste').classList.toggle('hidden', mode !== 'paste');
  $('regExcel').classList.toggle('hidden', mode !== 'excel');
  $('regForm').classList.toggle('hidden', mode !== 'form');
}

function clearForm() {
  FORM_IDS.forEach(id => { $(id).value = ''; });
  formGender = '';
  $('gBtnM').classList.remove('active');
  $('gBtnF').classList.remove('active');
  S.formPhotos = [];
  S.editingId = null;
  $('regTitle').textContent = '새 후보 등록';
  $('formSaveBtn').innerHTML = '<i class="ti ti-check"></i> 저장';
  $('parseSummary').innerHTML = '';
  renderFormPhotos();
}

function setGender(g) {
  formGender = g;
  $('gBtnM').classList.toggle('active', g === 'm');
  $('gBtnF').classList.toggle('active', g === 'f');
}

function fillFormFrom(c) {
  $('fName').value = c.name || '';
  $('fBirth').value = c.birth_year || '';
  $('fHeight').value = c.height || '';
  $('fBody').value = c.body_type || '';
  $('fThreads').value = c.contact_threads || '';
  $('fPhone').value = formatPhone(c.phone || '');
  $('fRegion').value = c.region || '';
  $('fJob').value = c.job || '';
  $('fWork').value = c.work_pattern || '';
  $('fEdu').value = c.education || '';
  $('fReligion').value = c.religion || '';
  $('fMbti').value = c.mbti || '';
  $('fDrink').value = c.drinking || '';
  $('fSmoke').value = c.smoking || '';
  $('fCar').value = c.car || '';
  $('fHobby').value = c.hobbies || '';
  $('fPersonality').value = c.personality || '';
  $('fDesc').value = c.description || '';
  const i = c.ideal || {};
  $('iAge').value = i.age || '';
  $('iHeight').value = i.height || '';
  $('iRegion').value = i.region || '';
  $('iPriority').value = i.priority || '';
  $('iJobsPref').value = i.jobs_pref || '';
  $('iJobsAvoid').value = i.jobs_avoid || '';
  $('iNote').value = i.note || '';
  if (c.gender) setGender(c.gender);
}

function collectForm() {
  return {
    name: $('fName').value.trim(),
    gender: formGender,
    birth_year: $('fBirth').value.trim(),
    height: $('fHeight').value.trim().replace(/[^0-9]/g, ''),
    body_type: $('fBody').value.trim(),
    contact_threads: normThreads($('fThreads').value),
    phone: formatPhone($('fPhone').value),
    region: $('fRegion').value.trim(),
    job: $('fJob').value.trim(),
    work_pattern: $('fWork').value.trim(),
    education: $('fEdu').value.trim(),
    religion: $('fReligion').value.trim(),
    mbti: $('fMbti').value.trim(),
    drinking: $('fDrink').value.trim(),
    smoking: $('fSmoke').value.trim(),
    car: $('fCar').value.trim(),
    hobbies: $('fHobby').value.trim(),
    personality: $('fPersonality').value.trim(),
    description: $('fDesc').value.trim(),
    photos: S.formPhotos.slice(),
    ideal: {
      age: $('iAge').value.trim(),
      height: $('iHeight').value.trim(),
      region: $('iRegion').value.trim(),
      priority: $('iPriority').value.trim(),
      jobs_pref: $('iJobsPref').value.trim(),
      jobs_avoid: $('iJobsAvoid').value.trim(),
      note: $('iNote').value.trim()
    }
  };
}

function startEdit(id) {
  const c = candOf(id);
  if (!c) return;
  switchView('register');
  setRegMode('form');
  clearForm();
  S.editingId = id;
  fillFormFrom(c);
  S.formPhotos = (c.photos || []).slice();
  renderFormPhotos();
  $('regTitle').textContent = `'${c.name}' 정보 수정`;
  $('formSaveBtn').innerHTML = '<i class="ti ti-check"></i> 수정 저장';
  window.scrollTo(0, 0);
}

function renderFormPhotos() {
  const row = $('photoRow');
  row.querySelectorAll('.photo-thumb-wrap').forEach(el => el.remove());
  const n = S.formPhotos.length;
  const move = (from, to) => {
    const [p] = S.formPhotos.splice(from, 1);
    S.formPhotos.splice(to, 0, p);
    renderFormPhotos();
  };
  S.formPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap' + (i === 0 ? ' main' : '');
    wrap.innerHTML = `<img class="photo-thumb" src="${escHtml(p)}" alt="">
      <button type="button" class="photo-move l" title="앞으로" ${i === 0 ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button>
      <button type="button" class="photo-move r" title="뒤로" ${i === n - 1 ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button>
      <button type="button" class="photo-del" title="삭제"><i class="ti ti-x"></i></button>
      ${i === 0 ? '<span class="photo-main-tag">대표</span>' : ''}`;
    wrap.querySelector('.photo-del').addEventListener('click', () => {
      S.formPhotos.splice(i, 1);
      renderFormPhotos();
    });
    wrap.querySelector('.photo-move.l').addEventListener('click', () => move(i, i - 1));
    wrap.querySelector('.photo-move.r').addEventListener('click', () => move(i, i + 1));
    row.insertBefore(wrap, $('photoAddBtn'));
  });
}

// maxPx: 긴 변 기준 최대 크기. 후기 캡처처럼 글씨를 읽어야 하는 그림은 크게 넘깁니다.
function compressImageBlob(file, maxPx, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = maxPx || 900;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          const r = Math.min(MAX / w, MAX / h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cv.toBlob(b => resolve(b), 'image/jpeg', quality || 0.82);
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// 사진 1장: 압축 → 스토리지 업로드 → URL 반환 (스토리지 실패 시 base64로 대체)
async function addPhotoFromFile(file) {
  const blob = await compressImageBlob(file);
  if (!blob) { toast('이미지를 읽지 못했어요'); return null; }
  const url = await uploadPhotoBlob(blob);
  return url || blobToDataURL(blob);
}

async function saveForm() {
  const d = collectForm();
  if (!d.name) { toast('이름을 입력해 주세요'); $('fName').focus(); return; }
  if (!d.gender) { toast('성별을 선택해 주세요'); return; }
  const btn = $('formSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '저장 중…';
  let ok = false;
  if (S.editingId) {
    ok = !!(await DB.updateCandidate(S.editingId, d));
    if (ok) toast(`'${d.name}' 정보가 수정되었어요`);
  } else {
    ok = !!(await DB.addCandidate(d));
    if (ok) toast(`'${d.name}' 후보가 등록되었어요`);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-check"></i> 저장';
  if (!ok) return;
  clearForm();
  $('pasteInput').value = '';
  switchView('candidates');
  renderAll();
}

// ── 붙여넣기 → 파싱 → 폼 채우기 ──
function runParse() {
  const text = $('pasteInput').value.trim();
  if (!text) return toast('먼저 프로필 내용을 붙여넣어 주세요');
  const r = parseProfile(text);
  clearForm();
  fillFormFrom(Object.assign({}, r.fields, { ideal: r.ideal }));
  setRegMode('form');
  const missing = [];
  if (!r.fields.name) missing.push('이름');
  missing.push(!formGender ? '성별' : null);
  const missTxt = missing.filter(Boolean).length
    ? `<span style="color:var(--peach-mid);font-weight:600"> · ${missing.filter(Boolean).join(', ')} 직접 입력 필요</span>` : '';
  $('parseSummary').innerHTML = `
    <div class="parse-head" style="margin-bottom:14px">
      <span class="title"><i class="ti ti-wand"></i> 자동 인식 결과</span>
      <span class="count-pill">${r.found.length}개 항목</span>${missTxt}
    </div>`;
  window.scrollTo(0, 0);
}

// ═══════════════════════════════════════
//  엑셀 / CSV 대량 등록
// ═══════════════════════════════════════
const XL_HEADERS = ['이름','성별(남/여)','출생연도','키','체형','스레드ID','연락처','거주지','직업','근무형태','학력','종교','MBTI','음주','흡연','자차','취미','성격','특징','이상형나이','이상형키','이상형지역','중요순위','선호직업','기피직업','이상형기타'];

function downloadTemplate() {
  const example = ['봄이','여','1997','160','마른체형','@somemate_love','010-1234-5678','대구 북구','간호사','평일 9to6 고정','전문대졸','기독교','ISFP','월 1-2회','비흡연','없음 (면허 있음)','러닝, 필라테스, 독서','낯가리지만 친해지면 엉뚱함','','연하2~연상4 (연상선호)','175cm 이상','대구, 경북','성격 > 직업안정성 > 경제력','소방관, 전문직, 공무원','간호사, 자영업, 프리랜서','다정다감하고 자상한 사람'];
  const csv = '﻿' + XL_HEADERS.join(',') + '\n' + example.map(v => `"${v}"`).join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '썸메이트_등록양식.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('양식 파일이 저장되었어요');
}

async function handleExcelFile(file) {
  toast('엑셀 파일을 읽는 중…');
  if (!(await loadXlsx())) return toast('엑셀 처리 모듈을 불러오지 못했어요. 인터넷 연결을 확인해 주세요');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (!rows.length) return toast('데이터가 없어요. 양식을 확인해 주세요');
      const get = (row, key) => String(row[key] ?? row[key.replace('(남/여)', '')] ?? '').trim();
      const parsed = [];
      const skipped = [];
      rows.forEach((row, idx) => {
        const name = get(row, '이름');
        const gRaw = get(row, '성별(남/여)') || get(row, '성별');
        const gender = /^남|^m/i.test(gRaw) ? 'm' : /^여|^f/i.test(gRaw) ? 'f' : '';
        if (!name || !gender) { skipped.push(idx + 2); return; }
        parsed.push({
          name, gender,
          birth_year: normBirth(get(row, '출생연도')) || get(row, '출생연도'),
          height: get(row, '키').replace(/[^0-9]/g, ''),
          body_type: get(row, '체형'),
          contact_threads: normThreads(get(row, '스레드ID')),
          phone: formatPhone(get(row, '연락처')),
          region: get(row, '거주지'),
          job: get(row, '직업'), work_pattern: get(row, '근무형태'),
          education: get(row, '학력'), religion: get(row, '종교'),
          mbti: get(row, 'MBTI'), drinking: get(row, '음주'), smoking: get(row, '흡연'),
          car: get(row, '자차'), hobbies: get(row, '취미'),
          personality: get(row, '성격'), description: get(row, '특징'),
          photos: [],
          ideal: {
            age: get(row, '이상형나이'), height: get(row, '이상형키'),
            region: get(row, '이상형지역'), priority: get(row, '중요순위'),
            jobs_pref: get(row, '선호직업'), jobs_avoid: get(row, '기피직업'),
            note: get(row, '이상형기타')
          }
        });
      });
      S.excelRows = parsed;
      $('excelResult').innerHTML = `
        <div class="parse-head">
          <span class="title">읽기 완료</span>
          <span class="count-pill">${parsed.length}명</span>
          ${skipped.length ? `<span style="font-size:13.5px;color:var(--peach-mid)">이름/성별 누락 ${skipped.length}행 제외</span>` : ''}
        </div>
        <table class="parse-table">
          ${parsed.slice(0, 8).map(p => `<tr><td>${escHtml(p.name)} (${p.gender === 'm' ? '남' : '여'})</td><td>${escHtml([p.birth_year ? p.birth_year + '년생' : '', p.job, p.region].filter(Boolean).join(' · '))}</td></tr>`).join('')}
          ${parsed.length > 8 ? `<tr><td colspan="2" style="color:var(--gray-mid)">외 ${parsed.length - 8}명…</td></tr>` : ''}
        </table>
        <div class="gap"></div>
        <button class="btn primary" id="excelConfirmBtn"><i class="ti ti-check"></i> ${parsed.length}명 모두 등록하기</button>`;
      $('excelConfirmBtn').addEventListener('click', async () => {
        const btn = $('excelConfirmBtn');
        btn.disabled = true;
        btn.textContent = '등록 중…';
        const r = await DB.addCandidates(S.excelRows);
        if (!r) { btn.disabled = false; btn.textContent = '다시 시도'; return; }
        toast(`${r.length}명이 등록되었어요`);
        S.excelRows = null;
        $('excelResult').innerHTML = '';
        switchView('candidates');
        renderAll();
      });
    } catch (err) {
      console.error(err);
      toast('파일을 읽지 못했어요. 양식 파일 형식을 확인해 주세요');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════
//  매칭
// ═══════════════════════════════════════
// ── 진행 중인 매칭 카드 ──
// 두 사람을 좌우로 마주 보게 놓고, 하트로 이어져 있다는 걸 보여줍니다.
function liveCardHtml(m) {
  const mc = candOf(m.male_id), fc = candOf(m.female_id);
  return `<div class="m-card" data-mid="${m.id}">
    <div class="m-pair">
      <div class="m-person">
        <div class="m-avatar">${mc && mc.photos && mc.photos[0] ? photoImg(mc.photos[0], '') : '<i class="ti ti-leaf"></i>'}</div>
        <div style="min-width:0"><div class="m-name">${escHtml(candName(m.male_id))}</div><div class="m-meta">${mc ? escHtml([ageLabel(mc), mc.job].filter(Boolean).join(' · ')) : ''}</div></div>
      </div>
      <i class="ti ti-heart m-heart"></i>
      <div class="m-person right">
        <div class="m-avatar f">${fc && fc.photos && fc.photos[0] ? photoImg(fc.photos[0], '') : '<i class="ti ti-flower"></i>'}</div>
        <div style="min-width:0"><div class="m-name">${escHtml(candName(m.female_id))}</div><div class="m-meta">${fc ? escHtml([ageLabel(fc), fc.job].filter(Boolean).join(' · ')) : ''}</div></div>
      </div>
    </div>
    ${m.memo ? `<div class="m-memo-preview"><i class="ti ti-note" style="font-size:13.5px"></i> ${escHtml(m.memo)}</div>` : ''}
    <div class="m-foot">
      <span class="m-date">${String(m.created_at).slice(0, 10).replace(/-/g, '.')} 시작</span>
      <span class="badge ${m.status}">${STATUS_LABEL[m.status]}</span>
    </div>
  </div>`;
}

// ── 끝난 매칭 카드 ──
// 끝난 매칭에서 정작 알고 싶은 건 '누가 왜 접었는지'입니다.
// 그래서 두 사람을 마주 보게 두는 대신 한 줄로 눕히고, 그 아래에
// 거절 기록을 사유까지 펼쳐 놓습니다. 상세를 열지 않아도 목록에서 바로 읽혀요.
function endedCardHtml(m) {
  const mc = candOf(m.male_id), fc = candOf(m.female_id);
  const face = (c, side) => {
    const photo = c && c.photos && c.photos[0];
    return `<span class="me-face ${side === 'f' ? 'f' : ''}">${photo ? photoImg(photo, '') : `<i class="ti ti-${side === 'f' ? 'flower' : 'leaf'}"></i>`}</span>`;
  };
  const rejs = rejectionsBetween(m.male_id, m.female_id);
  const ended = lastStatusAt(m, 'ended');

  // 사유를 안 적었으면 그 줄은 아예 그리지 않습니다.
  // '사유를 남기지 않았어요'는 알려주는 게 없으면서 자리만 차지해요.
  const reasons = rejs.length
    ? rejs.map(r => `<div class="me-reason${r.reason ? '' : ' bare'}">
        <div class="me-reason-head">
          <b>${escHtml(candName(r.from_id))}</b>님이 접었어요
          <span class="me-stage">${escHtml(REJECT_STAGE[r.stage] || r.stage)}</span>
        </div>
        ${r.reason ? `<p class="me-reason-text">${escHtml(r.reason)}</p>` : ''}
      </div>`).join('')
    : `<div class="me-reason none-box"><i class="ti ti-info-circle"></i>거절 기록 없이 종료</div>`;

  return `<div class="m-card ended" data-mid="${m.id}">
    <div class="me-top">
      <div class="me-names">
        ${face(mc, 'm')}${face(fc, 'f')}
        <span class="me-name">${escHtml(candName(m.male_id))} <span class="me-x">×</span> ${escHtml(candName(m.female_id))}</span>
      </div>
      <span class="badge ended">종료</span>
    </div>
    <div class="me-body">${reasons}</div>
    ${m.memo ? `<div class="m-memo-preview"><i class="ti ti-note" style="font-size:13.5px"></i> ${escHtml(m.memo)}</div>` : ''}
    <div class="me-foot">${escHtml(periodLabel(m.created_at, ended))}</div>
  </div>`;
}

// '2026.07.31 → 08.10' 처럼 한 줄로 줄여 씁니다.
// 같은 날 끝났으면 날짜를 두 번 쓰지 않고, 종료 기록이 없으면 시작일만 보여줍니다.
function periodLabel(from, to) {
  const d = v => String(v || '').slice(0, 10).replace(/-/g, '.');
  const a = d(from), b = d(to);
  if (!b) return `${a} 시작`;
  if (a === b) return `${a} 시작·종료`;
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${a} → ${sameYear ? b.slice(5) : b} 종료`;
}

// 타임라인에서 그 상태로 바뀐 마지막 시각을 찾습니다
function lastStatusAt(m, status) {
  const hit = (m.history || []).filter(h => h.t === 'status' && h.to === status).pop();
  return hit ? hit.at : null;
}

function renderMatches() {
  const box = $('matchList');
  let list = DB.data.matches.slice();
  if (S.matchFilter !== 'all') list = list.filter(m => m.status === S.matchFilter);
  if (!list.length) {
    box.innerHTML = emptyHtml('해당하는 매칭이 없어요', '위의 [매칭 맺기] 버튼으로 두 사람을 이어주세요');
    return;
  }
  box.innerHTML = list.map(m => m.status === 'ended' ? endedCardHtml(m) : liveCardHtml(m)).join('');
  box.querySelectorAll('[data-mid]').forEach(el => {
    el.addEventListener('click', () => openMatchDetail(parseInt(el.dataset.mid, 10)));
  });
}

// ── 매칭 타임라인 ──
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// 타임라인.
// '매칭 시작'은 매칭이 만들어진 시각 그 자체라 손댈 수 없고,
// 그 뒤의 기록은 실수로 눌러 생긴 것을 지울 수 있습니다.
// 메모 기록은 글자를 고칠 수도 있어요.
function renderTimeline(m) {
  const hist = m.history || [];
  return `<div class="d-section-title"><i class="ti ti-timeline-event"></i> 진행 타임라인</div>
  <div class="tl">
    <div class="tl-item">
      <div class="tl-dot"></div>
      <div class="tl-body">
        <div class="tl-date">${fmtDateTime(m.created_at)}</div>
        <div class="tl-text">매칭 시작</div>
      </div>
    </div>
    ${hist.map((ev, i) => `
    <div class="tl-item" data-tli="${i}">
      <div class="tl-dot ${ev.t === 'status' ? (ev.to || '') : ''}"></div>
      <div class="tl-body">
        <div class="tl-date">${fmtDateTime(ev.at)}</div>
        <div class="tl-text">${escHtml(ev.t === 'status' ? `상태 변경 → ${STATUS_LABEL[ev.to] || ev.to}` : ev.text || '')}</div>
      </div>
      <div class="tl-tools">
        ${ev.t === 'memo' ? `<button type="button" class="tl-btn" data-tledit="${i}" title="이 기록 고치기" aria-label="이 기록 고치기"><i class="ti ti-edit"></i></button>` : ''}
        <button type="button" class="tl-btn danger" data-tldel="${i}" title="이 기록 지우기" aria-label="이 기록 지우기"><i class="ti ti-x"></i></button>
      </div>
    </div>`).join('')}
  </div>
  ${hist.length ? '<p class="hint-text tl-note">잘못 눌러 생긴 기록은 지울 수 있어요. 기록만 사라지고 <b>지금 상태는 그대로</b>입니다.</p>' : ''}`;
}

// 타임라인 기록 고치기 · 지우기
function bindTimeline(m) {
  const save = async hist => {
    if (!(await DB.updateMatch(m.id, { history: hist }))) return false;
    openMatchDetail(m.id, true);
    return true;
  };

  $('matchBody').querySelectorAll('[data-tldel]').forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.tldel, 10);
      const ev = (m.history || [])[i];
      if (!ev) return;
      const what = ev.t === 'status' ? `상태 변경 → ${STATUS_LABEL[ev.to] || ev.to}` : (ev.text || '메모');
      if (!await ask({
        title: '이 기록을 지울까요?',
        desc: '타임라인에서만 사라지고, 지금 매칭 상태는 그대로 남습니다.',
        list: `${fmtDateTime(ev.at)}\n${what}`,
        okText: '지우기', danger: true
      })) return;
      const hist = (m.history || []).slice();
      hist.splice(i, 1);
      if (await save(hist)) toast('기록을 지웠어요');
    };
  });

  $('matchBody').querySelectorAll('[data-tledit]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.tledit, 10);
      const item = btn.closest('.tl-item');
      const ev = (m.history || [])[i];
      if (!ev || !item || item.querySelector('.tl-edit')) return;
      const box = document.createElement('div');
      box.className = 'tl-edit';
      box.innerHTML = `<textarea class="tl-edit-input"></textarea>
        <div class="btn-row">
          <button class="btn ghost tl-edit-cancel">취소</button>
          <button class="btn primary tl-edit-save"><i class="ti ti-check"></i> 저장</button>
        </div>`;
      box.querySelector('.tl-edit-input').value = ev.text || '';
      item.querySelector('.tl-body').appendChild(box);
      box.querySelector('.tl-edit-input').focus();
      box.querySelector('.tl-edit-cancel').onclick = () => box.remove();
      box.querySelector('.tl-edit-save').onclick = async () => {
        const text = box.querySelector('.tl-edit-input').value.trim();
        if (!text) { toast('내용을 적어주세요'); return; }
        const hist = (m.history || []).slice();
        hist[i] = Object.assign({}, hist[i], { text });
        if (await save(hist)) toast('기록을 고쳤어요');
      };
    };
  });
}

// 매칭 상세 위쪽의 두 사람 카드. 얼굴이나 이름을 누르면 그 사람 프로필이 열립니다.
function matchPersonHtml(c, cid, side) {
  const photo = c && c.photos && c.photos[0];
  const icon = side === 'f' ? 'flower' : 'leaf';
  const inner = photo ? photoImg(photo, '') : `<i class="ti ti-${icon}"></i>`;
  const meta = c ? escHtml([ageLabel(c), c.job, c.region].filter(Boolean).join(' · ')) : '';
  return `<button type="button" class="m-person" data-open-cand="${cid}" ${c ? '' : 'disabled'}>
    <div class="m-avatar ${side === 'f' ? 'f' : ''}">${inner}</div>
    <div class="m-person-body">
      <div class="m-name">${escHtml(candName(cid))}</div>
      <div class="m-meta">${meta}</div>
      ${c ? '<span class="m-tap-hint"><i class="ti ti-user"></i>프로필 보기</span>' : ''}
    </div>
  </button>`;
}

// keepTrail: 발자국을 이어갈 때 true (openDetail과 같은 규칙)
function openMatchDetail(id, keepTrail) {
  const m = DB.data.matches.find(x => x.id === id);
  if (!m) return;
  if (!keepTrail) Trail.clear();
  const mc = candOf(m.male_id), fc = candOf(m.female_id);
  const steps = ['exchanging', 'some', 'success', 'ended'];
  $('matchBody').innerHTML = `
    ${Trail.html()}
    <div class="m-pair big">
      ${matchPersonHtml(mc, m.male_id, 'm')}
      <i class="ti ti-heart m-heart"></i>
      ${matchPersonHtml(fc, m.female_id, 'f')}
    </div>
    <p class="m-date" style="text-align:center;margin:var(--sp-2) 0 var(--sp-4)">${String(m.created_at).slice(0, 10).replace(/-/g, '.')} 시작</p>
    ${rejectionsBetween(m.male_id, m.female_id).map(r => `<div class="rej-warn"><i class="ti ti-heart-broken"></i><div><b>${escHtml(candName(r.from_id))}</b>님이 <b>${escHtml(candName(r.to_id))}</b>님을 거절 · ${escHtml(rejectLabel(r))}${r.reason ? `<br>${escHtml(r.reason)}` : ''}</div></div>`).join('')}
    <div class="status-steps">
      ${steps.map(s => `<button class="step ${m.status === s ? 'on ' + s : ''}" data-st="${s}">${STATUS_LABEL[s]}</button>`).join('')}
    </div>
    <div class="f-field">
      <label>진행 메모</label>
      <textarea id="matchMemoInput" placeholder="예: 사진 교환 완료, 이번 주말 첫 만남 예정">${escHtml(m.memo || '')}</textarea>
    </div>
    <div class="gap"></div>
    <button class="btn dark" id="matchMemoSaveBtn"><i class="ti ti-check"></i> 메모 저장</button>
    ${renderTimeline(m)}
    <div class="gap"></div>
    <button class="btn danger-soft" id="matchDelBtn"><i class="ti ti-trash"></i> 매칭 삭제</button>
  `;
  Trail.bind('matchBody');
  bindTimeline(m);
  // 두 사람 카드 → 그 사람 프로필 (돌아올 수 있게 발자국을 남김)
  $('matchBody').querySelectorAll('[data-open-cand]').forEach(el => {
    el.addEventListener('click', () => {
      const cid = parseInt(el.dataset.openCand, 10);
      if (!candOf(cid)) return;
      Trail.push('match', id);
      closeModal('matchModal');
      openDetail(cid, true);
    });
  });
  $('matchBody').querySelectorAll('.step').forEach(btn => {
    btn.addEventListener('click', async () => {
      const st = btn.dataset.st;
      if (st === m.status) return;
      // 저장 안 한 메모도 함께 저장해서 상태 변경 시 메모가 사라지지 않게 함
      const memoNow = $('matchMemoInput').value.trim();
      // 종료할 때는 누가 거절했는지 먼저 물어봄
      if (st === 'ended') { Rej.openForMatch(m, memoNow); return; }
      const hist = [...(m.history || []), { t: 'status', to: st, at: nowStr() }];
      if (!(await DB.updateMatch(id, { status: st, memo: memoNow, history: hist }))) return;
      openMatchDetail(id, true);
      renderAll();
      if (st === 'success') toast('축하해요, 성사되었어요!');
    });
  });
  $('matchMemoSaveBtn').onclick = async () => {
    const memoNow = $('matchMemoInput').value.trim();
    const hist = [...(m.history || [])];
    if (memoNow && memoNow !== (m.memo || '')) hist.push({ t: 'memo', text: memoNow, at: nowStr() });
    if (!(await DB.updateMatch(id, { memo: memoNow, history: hist }))) return;
    openMatchDetail(id, true);
    renderMatches();
    toast('메모가 저장되었어요');
  };
  $('matchDelBtn').onclick = async () => {
    if (!await ask({
      title: '이 매칭 기록을 삭제할까요?',
      desc: '진행 타임라인과 메모가 함께 사라집니다. 거절 기록은 그대로 남아요.',
      warn: '되돌릴 수 없습니다', okText: '삭제', danger: true
    })) return;
    if (!(await DB.deleteMatch(id))) return;
    closeModal('matchModal');
    renderAll();
    toast('매칭이 삭제되었어요');
  };
  openModal('matchModal');
}

// ── 매칭 맺기 ──
function openCreateMatch(preselect, partner) {
  S.pick = { m: null, f: null };
  if (preselect) S.pick[preselect.gender] = preselect.id;
  if (partner) S.pick[partner.gender] = partner.id;
  S.pickSearch = '';
  $('pickSearchInput').value = '';
  renderPickLists();
  openModal('createMatchModal');
}

function renderPickLists() {
  const q = (S.pickSearch || '').toLowerCase();
  const render = (gender, boxId) => {
    const box = $(boxId);
    const list = DB.data.candidates.filter(c => {
      if (c.gender !== gender) return false;
      // 이미 고른 사람은 검색어·보류·블랙리스트와 무관하게 계속 보여줍니다.
      // (추천이나 후보 상세에서 바로 넘어온 경우, 목록에 안 보이는데 선택만 돼 있으면
      //  '누구를 고른 건지 모르는 채로' 매칭 버튼이 켜져 버립니다)
      if (S.pick[gender] === c.id) return true;
      if (c.archived || c.blacklisted) return false;
      if (q) {
        const hay = [c.name, c.job, c.region].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!list.length) {
      box.innerHTML = `<div style="padding:16px;text-align:center;font-size:13.5px;color:var(--gray-mid)">${q ? '검색 결과가 없어요' : `등록된 ${gender === 'm' ? '남자' : '여자'} 후보가 없어요`}</div>`;
      return;
    }
    const otherPick = S.pick[gender === 'm' ? 'f' : 'm'];
    const other = otherPick ? candOf(otherPick) : null;

    // 반대편에서 한 명을 고르면, 그 사람과 잘 맞는 순서로 다시 줄을 세웁니다
    const fitOf = {};
    if (other) {
      list.forEach(c => { fitOf[c.id] = matchScore(other, c).score; });
      list.sort((a, b) => {
        if (S.pick[gender] === a.id) return -1;   // 이미 고른 사람은 항상 맨 위
        if (S.pick[gender] === b.id) return 1;
        return fitOf[b.id] - fitOf[a.id];
      });
    }
    $(gender === 'm' ? 'pickLabelM' : 'pickLabelF').textContent =
      `${gender === 'm' ? '남자' : '여자'} 후보${other ? ' · 잘 맞는 순' : ''}`;

    box.innerHTML = list.map(c => {
      const busy = activeMatchOf(c.id);
      const sel = S.pick[gender] === c.id;
      // 반대편에서 고른 사람과 거절 이력이 있으면 표시
      const rej = otherPick ? rejectionsBetween(c.id, otherPick).length : 0;
      const s = other ? fitOf[c.id] : null;
      const fitTag = s === null ? ''
        : s >= 6 ? '<span class="fit-tag best">잘 맞음</span>'
        : s >= 1 ? '<span class="fit-tag ok">조건 맞음</span>'
        : s <= -1 ? '<span class="fit-tag bad">안 맞음</span>' : '';
      // 보류·블랙리스트인데 이미 골라져 있는 경우에는 그 사실을 알려줍니다
      const off = c.blacklisted ? '블랙리스트' : c.archived ? '보류 중' : '';
      return `<div class="pick-item ${sel ? 'sel' : ''} ${gender === 'f' ? 'f-side' : ''}" data-pid="${c.id}">
        ${escHtml(c.name)}${busy ? ' <i class="ti ti-heart" style="font-size:12.5px;color:var(--orange)"></i>' : ''}${fitTag}${rej ? '<span class="rej-tag">거절 이력</span>' : ''}${off ? `<span class="rej-tag">${off}</span>` : ''}
        <span class="sub">${escHtml([ageLabel(c), c.job].filter(Boolean).join(' · '))}${busy ? ' · 매칭 진행중' : ''}</span>
      </div>`;
    }).join('');
    box.querySelectorAll('.pick-item').forEach(el => {
      el.addEventListener('click', () => {
        const pid = parseInt(el.dataset.pid, 10);
        S.pick[gender] = S.pick[gender] === pid ? null : pid;
        renderPickLists();
      });
    });
  };
  render('m', 'pickMale');
  render('f', 'pickFemale');
  $('createMatchBtn').disabled = !(S.pick.m && S.pick.f);
}

async function createMatch() {
  if (!(S.pick.m && S.pick.f)) return;
  // 거절 이력이 있으면 먼저 알려줌
  const rejs = rejectionsBetween(S.pick.m, S.pick.f);
  if (rejs.length) {
    const lines = rejs.map(r => `· ${candName(r.from_id)}님이 ${candName(r.to_id)}님을 거절 (${rejectLabel(r)})${r.reason ? `\n   "${r.reason}"` : ''}`).join('\n');
    if (!await ask({
      title: '이 두 분은 이미 거절 이력이 있어요',
      desc: '그래도 이어줄까요?',
      list: lines, okText: '그래도 이어주기'
    })) return;
  }
  const busyM = activeMatchOf(S.pick.m), busyF = activeMatchOf(S.pick.f);
  if ((busyM || busyF) && !await ask({
    title: '진행 중인 매칭이 있어요',
    desc: '두 분 중 이미 다른 분과 매칭이 진행 중인 후보가 있습니다. 그래도 이어줄까요?',
    okText: '그래도 이어주기'
  })) return;
  const btn = $('createMatchBtn');
  btn.disabled = true;
  const m = await DB.addMatch(S.pick.m, S.pick.f);
  btn.disabled = false;
  if (!m) return;
  closeModal('createMatchModal');
  switchView('matches');
  renderAll();
  toast(`${candName(m.male_id)} ♥ ${candName(m.female_id)} 매칭이 시작되었어요`);
}

// ═══════════════════════════════════════
//  신청 관리 (공개 폼으로 들어온 신청서)
// ═══════════════════════════════════════
const APP_STATUS_LABEL = { pending: '대기', approved: '승인', rejected: '반려' };
const CONSENT_LABEL = {
  privacy: '개인정보 수집·이용', sensitive: '민감정보', third: '제3자 제공',
  age: '만 19세 이상', marketing: '소식 수신'
};

function pendingApps() { return DB.data.applications.filter(a => a.status === 'pending'); }

function renderAppBadge() {
  const n = pendingApps().length;
  const b = $('appBadge');
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('hidden', n === 0);
}

function whenLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return String(iso).slice(0, 10).replace(/-/g, '.');
}

// 상태별 건수를 칩 안에 바로 보여줍니다 (대기 3 · 승인 12 · 반려 1 · 전체 16)
function renderAppCounts() {
  const all = DB.data.applications;
  const n = {
    pending: all.filter(a => a.status === 'pending').length,
    approved: all.filter(a => a.status === 'approved').length,
    rejected: all.filter(a => a.status === 'rejected').length,
    all: all.length
  };
  document.querySelectorAll('#appChips .chip-num').forEach(el => {
    const v = n[el.dataset.count] || 0;
    el.textContent = v;
    el.classList.toggle('zero', v === 0);
  });
}

function renderApplications() {
  const box = $('appList');
  renderAppCounts();
  let list = DB.data.applications.slice();
  if (S.appFilter !== 'all') list = list.filter(a => a.status === S.appFilter);
  if (!list.length) {
    box.innerHTML = emptyHtml(
      S.appFilter === 'pending' ? '처리할 신청서가 없어요' : '해당하는 신청서가 없어요',
      '신청 폼 주소를 안내하면 여기로 신청서가 들어와요'
    );
    return;
  }
  box.innerHTML = list.map(a => {
    const photos = a.photos || [];
    return `<div class="app-card ${a.status}" data-aid="${a.id}">
      <div class="app-top">
        <span class="app-name">${escHtml(a.name)}</span>
        <span class="badge ${a.status}">${APP_STATUS_LABEL[a.status]}</span>
        <span class="app-when">${escHtml(whenLabel(a.created_at))}</span>
      </div>
      <div class="app-meta">${escHtml([a.gender === 'm' ? '남자' : '여자', a.birth_year ? a.birth_year + '년생' : '', a.height ? a.height + 'cm' : '', a.job, a.region].filter(Boolean).join(' · '))}</div>
      ${a.contact_threads || a.phone ? `<div class="app-sub">${escHtml(a.contact_threads || a.phone)}</div>` : ''}
      ${photos.length ? `<div class="app-thumbs">${photos.slice(0, 3).map(p => photoImg(p, '')).join('')}</div>` : ''}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-aid]').forEach(el => {
    el.addEventListener('click', () => openAppDetail(parseInt(el.dataset.aid, 10)));
  });
}

function openAppDetail(id) {
  const a = DB.data.applications.find(x => x.id === id);
  if (!a) return;
  const photos = a.photos || [];
  const ideal = a.ideal || {};
  const consent = a.consent || {};
  const linked = a.candidate_id ? candOf(a.candidate_id) : null;

  // 후보 상세와 같은 규칙으로 두 덩어리로 나눕니다.
  // 휴대폰에서는 위아래로 쌓이고, PC에서는 왼쪽 프로필 / 오른쪽 검토로 갈라집니다. (style.css의 #appBody)
  $('appBody').innerHTML = `
   <div class="a-main">
    ${photos.length ? Gal.html(photos) : `<div class="d-nophoto"><i class="ti ti-photo-off"></i>사진을 올리지 않았어요</div>`}
    <div class="d-head">
      <span class="d-name">${escHtml(a.name)}</span>
      <span class="badge ${a.status}">${APP_STATUS_LABEL[a.status]}</span>
    </div>
    <div class="d-headline">${escHtml([a.gender === 'm' ? '남자' : '여자', a.birth_year ? a.birth_year + '년생' : '', a.height ? a.height + 'cm' : '', a.body_type, a.region].filter(Boolean).join(' · '))}</div>

    <table class="info-table">
      ${threadsRow(a.contact_threads)}
      ${infoRow('phone', '연락처', a.phone)}
      ${infoRow('brand-hipchat', '카카오톡', a.contact_kakao)}
      ${infoRow('clock', '접수', String(a.created_at).slice(0, 16).replace('T', ' '))}
      ${infoRow('route', '유입 경로', a.referral)}
      ${jobRows(a)}
      ${infoRow('school', '학력', a.education)}
      ${infoRow('building-church', '종교', a.religion)}
      ${infoRow('puzzle', 'MBTI', a.mbti)}
      ${infoRow('glass-full', '음주', a.drinking)}
      ${infoRow('smoking-no', '흡연', a.smoking)}
      ${infoRow('car', '자차', a.car)}
      ${infoRow('ball-tennis', '취미', a.hobbies)}
      ${testRows(a.test_results)}
    </table>
    ${a.personality ? `<div class="d-section-title">성격</div><p class="d-desc">${escHtml(a.personality)}</p>` : ''}
    ${a.description ? `<div class="d-section-title">하고 싶은 말</div><p class="d-desc">${escHtml(a.description)}</p>` : ''}

    ${Object.values(ideal).some(Boolean) ? `
    <div class="ideal-card">
      <div class="ideal-title"><i class="ti ti-sparkles"></i> 이런 분을 기다려요</div>
      <table class="info-table">
        ${infoRow('calendar', '나이', ideal.age)}
        ${infoRow('ruler-2', '키', ideal.height)}
        ${infoRow('map-pin', '지역', ideal.region)}
        ${infoRow('list-numbers', '중요 순위', ideal.priority)}
        ${infoRow('thumb-up', '선호 직업', ideal.jobs_pref)}
        ${infoRow('thumb-down', '기피 직업', ideal.jobs_avoid)}
        ${infoRow('message-heart', '기타', ideal.note)}
      </table>
    </div>` : ''}
   </div>

   <div class="a-side">
    <div class="d-section-title"><i class="ti ti-shield-check"></i> 동의 내역</div>
    <div class="consent-view">
      ${Object.keys(CONSENT_LABEL).map(k => `<span class="${consent[k] ? '' : 'no'}">${consent[k] ? '✓' : '✕'} ${CONSENT_LABEL[k]}</span>`).join('')}
    </div>
    <p class="hint-text">${consent.agreed_at ? escHtml(String(consent.agreed_at).slice(0, 16).replace('T', ' ')) + ' 동의' : '동의 시각 기록 없음'}${consent.version ? ` · 약관 ${escHtml(consent.version)}` : ''}</p>

    <div class="d-section-title"><i class="ti ti-notes"></i> 검토 메모</div>
    <textarea id="appMemo" class="admin-memo-input" placeholder="반려 사유나 확인한 내용을 적어두세요">${escHtml(a.review_memo || '')}</textarea>
    <div class="gap"></div>

    ${a.status === 'pending' ? `
      <button class="btn primary" id="appApproveBtn"><i class="ti ti-user-check"></i> 승인하고 후보로 등록</button>
      <div class="gap-sm"></div>
      <button class="btn ghost" id="appRejectBtn"><i class="ti ti-user-x"></i> 반려 처리</button>
    ` : `
      ${linked ? `<button class="btn soft" id="appGoCandBtn"><i class="ti ti-user"></i> 등록된 후보 보기 (${escHtml(linked.name)})</button>`
               : a.status === 'approved' ? `<p class="hint-text">승인 처리됐지만 연결된 후보를 찾을 수 없어요 (삭제된 것 같아요)</p>` : ''}
      <div class="gap-sm"></div>
      <button class="btn ghost" id="appReopenBtn"><i class="ti ti-rotate"></i> 대기 상태로 되돌리기</button>
    `}
    <div class="gap-sm"></div>
    <button class="btn soft" id="appMemoSaveBtn"><i class="ti ti-check"></i> 메모만 저장</button>
    <div class="gap-sm"></div>
    <button class="btn danger-soft" id="appDelBtn"><i class="ti ti-trash"></i> 신청서 삭제</button>
   </div>
  `;

  Gal.mount(photos);

  $('appMemoSaveBtn').onclick = async () => {
    if (await DB.updateApplication(id, { review_memo: $('appMemo').value.trim() })) toast('메모가 저장되었어요');
  };
  const approveBtn = $('appApproveBtn'), rejectBtn = $('appRejectBtn');
  if (approveBtn) approveBtn.onclick = () => approveApplication(a);
  if (rejectBtn) rejectBtn.onclick = async () => {
    const memo = $('appMemo').value.trim();
    if (!await ask({
      title: `'${a.name}' 신청서를 반려할까요?`,
      desc: '후보로 등록되지 않습니다. 나중에 대기 상태로 되돌릴 수 있어요.',
      okText: '반려'
    })) return;
    if (!(await DB.updateApplication(id, { status: 'rejected', review_memo: memo, reviewed_at: nowStr() }))) return;
    openAppDetail(id);
    renderAll();
    toast('반려 처리했어요');
  };
  const goCand = $('appGoCandBtn');
  if (goCand) goCand.onclick = () => { closeModal('appModal'); switchView('candidates'); openDetail(a.candidate_id); };
  const reopen = $('appReopenBtn');
  if (reopen) reopen.onclick = async () => {
    if (!(await DB.updateApplication(id, { status: 'pending', reviewed_at: null }))) return;
    openAppDetail(id);
    renderAll();
    toast('대기 상태로 되돌렸어요');
  };
  $('appDelBtn').onclick = async () => {
    if (!await ask({
      title: `'${a.name}' 신청서를 완전히 삭제할까요?`,
      desc: '이미 후보로 등록된 경우 후보 정보는 그대로 남습니다.',
      warn: '되돌릴 수 없습니다', okText: '삭제', danger: true
    })) return;
    if (!(await DB.deleteApplication(id))) return;
    closeModal('appModal');
    renderAll();
    toast('신청서를 삭제했어요');
  };

  openModal('appModal');
}

// ── 보유기간(6개월)이 지난 신청서 정리 ──
// 개인정보처리방침에 6개월로 적어뒀기 때문에, 지난 것은 실제로 지워야 말과 행동이 맞습니다.
const RETENTION_MONTHS = 6;

function retentionCutoff() {
  const d = new Date();
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return d;
}
function oldApplications() {
  const cut = retentionCutoff().getTime();
  return DB.data.applications
    .filter(a => new Date(a.created_at).getTime() < cut)
    .sort((x, y) => new Date(x.created_at) - new Date(y.created_at));   // 오래된 것부터
}

function renderPurgeBar() {
  const n = oldApplications().length;
  $('purgeBar').classList.toggle('hidden', n === 0);
  if (n) $('purgeCount').textContent = `보유기간이 지난 신청서 ${n}건`;
}

const Purge = {
  picked: new Set(),

  open() {
    const list = oldApplications();
    if (!list.length) { toast('보유기간이 지난 신청서가 없어요'); return; }
    this.picked = new Set(list.map(a => a.id));   // 기본은 전체 선택
    this.render();
    openModal('purgeModal');
  },

  render() {
    const list = oldApplications();
    if (!list.length) { closeModal('purgeModal'); renderAll(); return; }
    const cut = retentionCutoff();
    $('purgeHint').textContent =
      `${cut.getFullYear()}년 ${cut.getMonth() + 1}월 ${cut.getDate()}일 이전에 접수된 신청서예요. 지울 것만 골라주세요.`;

    $('purgeList').innerHTML = list.map(a => {
      const linked = a.candidate_id ? candOf(a.candidate_id) : null;
      const days = Math.floor((Date.now() - new Date(a.created_at)) / 86400000);
      const meta = [a.gender === 'm' ? '남자' : '여자', a.birth_year ? a.birth_year + '년생' : '', a.contact_threads || a.phone].filter(Boolean).join(' · ');
      return `<div class="purge-item ${this.picked.has(a.id) ? 'on' : ''}" data-pgid="${a.id}">
        <span class="purge-tick"><i class="ti ti-check"></i></span>
        <div class="purge-body">
          <div class="purge-name">${escHtml(a.name)}<span class="badge ${a.status}">${APP_STATUS_LABEL[a.status]}</span></div>
          <div class="purge-meta">${escHtml(meta)}</div>
          <div class="purge-meta">${String(a.created_at).slice(0, 10).replace(/-/g, '.')} 접수 · ${days}일 지남</div>
          ${linked ? `<div class="purge-keep">후보 '${escHtml(linked.name)}'로 등록된 분이에요 — 후보 정보와 사진은 그대로 남습니다</div>` : ''}
        </div>
      </div>`;
    }).join('');

    $('purgeList').querySelectorAll('[data-pgid]').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.pgid, 10);
        if (this.picked.has(id)) this.picked.delete(id); else this.picked.add(id);
        this.render();
      });
    });
    $('purgeSel').textContent = `${this.picked.size} / ${list.length}건 선택`;
    $('purgeRunBtn').disabled = this.picked.size === 0;
  },

  setAll(on) {
    this.picked = on ? new Set(oldApplications().map(a => a.id)) : new Set();
    this.render();
  },

  async run() {
    const ids = [...this.picked];
    if (!ids.length) return;
    const targets = DB.data.applications.filter(a => ids.includes(a.id));
    const names = targets.slice(0, 5).map(a => a.name).join(', ');
    const more = targets.length > 5 ? ` 외 ${targets.length - 5}명` : '';
    if (!await ask({
      title: `신청서 ${ids.length}건을 삭제할까요?`,
      desc: '후보로 등록된 분의 후보 정보와 사진은 그대로 남습니다.',
      list: names + more, warn: '되돌릴 수 없습니다', okText: '삭제', danger: true
    })) return;

    // 승인된 신청서는 후보와 사진 주소를 공유하므로, 후보가 쓰는 사진은 남겨둠
    const inUse = new Set();
    DB.data.candidates.forEach(c => (c.photos || []).forEach(p => inUse.add(p)));
    const paths = [];
    targets.forEach(a => (a.photos || []).forEach(p => {
      if (!inUse.has(p)) paths.push(...storagePathsOf([p], 'apply'));
    }));

    const btn = $('purgeRunBtn');
    btn.disabled = true;
    btn.innerHTML = '삭제 중…';
    const ok = await DB.deleteApplications(ids);
    if (ok && paths.length) {
      const { error } = await sb.storage.from('apply').remove(paths);
      if (error) console.warn('[Storage] 신청 사진 삭제 실패', error);
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-trash"></i> 선택한 신청서 삭제';
    if (!ok) return;

    this.picked.clear();
    renderAll();
    this.render();
    toast(`신청서 ${ids.length}건을 정리했어요`);
  }
};

// 신청서 → 후보 등록
async function approveApplication(a) {
  if (a.status !== 'pending') return;
  const dupe = DB.data.candidates.find(c => c.name === a.name && c.gender === a.gender
    && (a.contact_threads ? c.contact_threads === a.contact_threads : a.phone ? c.phone === a.phone : true));
  if (dupe && !await ask({
    title: `'${a.name}'님과 같은 이름의 후보가 이미 있어요`,
    desc: '같은 분이라면 신청서를 반려하고 기존 후보를 수정하는 편이 깔끔해요. 그래도 새로 등록할까요?',
    okText: '새로 등록'
  })) return;

  // 아직 저장 안 한 검토 메모도 함께 넘김
  const memo = $('appMemo') ? $('appMemo').value.trim() : (a.review_memo || '');
  const btn = $('appApproveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '등록 중…'; }
  const row = await DB.addCandidate({
    name: a.name, gender: a.gender,
    birth_year: a.birth_year || '', height: a.height || '', body_type: a.body_type || '',
    region: a.region || '', job: a.job || '', work_pattern: a.work_pattern || '',
    education: a.education || '', religion: a.religion || '', mbti: a.mbti || '',
    drinking: a.drinking || '', smoking: a.smoking || '', car: a.car || '',
    hobbies: a.hobbies || '', personality: a.personality || '', description: a.description || '',
    ideal: a.ideal || {}, photos: a.photos || [],
    contact_threads: a.contact_threads || '', phone: a.phone || '', source: 'apply',
    test_results: a.test_results || {},
    admin_memo: memo
  });
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-user-check"></i> 승인하고 후보로 등록'; }
  if (!row) return;

  await DB.updateApplication(a.id, {
    status: 'approved',
    candidate_id: row.id,
    review_memo: memo,
    reviewed_at: nowStr()
  });
  openAppDetail(a.id);
  renderAll();
  toast(`${a.name}님이 후보로 등록되었어요`);
}

// ═══════════════════════════════════════
//  후기 관리 (공개 후기 페이지 /reviews 에 바로 반영됨)
// ═══════════════════════════════════════
const RV_STAGE_LABEL = { success: '성사', meet: '첫 만남 후', progress: '진행 중', etc: '기타' };
const RV_STAT_SLOTS = 3;

const Rev = {
  stage: 'success',
  shot: null,        // 업로드가 끝난 캡처 주소
  busy: false,
  statsOpen: false,
  moreOpen: false,
  editingId: null,   // 지금 수정 중인 후기 id
  editStage: null,

  open() {
    this.stage = 'success';
    this.shot = null;
    this.editingId = null;
    $('rvWho').value = '';
    $('rvDate').value = '';
    $('rvNote').value = '';
    $('rvPreview').classList.add('hidden');
    $('rvPreview').src = '';
    $('rvDropHint').classList.remove('hidden');
    document.querySelectorAll('#rvStage .chip').forEach(c => c.classList.toggle('active', c.dataset.rvs === 'success'));
    this.closeMore();
    this.syncAdd();
    this.renderStats();
    this.closeStats();   // 평소엔 접어둬서, 열 때마다 숫자판이 화면을 다 차지하지 않게 함
    this.renderList();
    openModal('reviewModal');
  },

  syncAdd() { $('rvAddBtn').disabled = this.busy || !this.shot; },

  // ── '누구인지 · 날짜' 접기/펼치기 (평소엔 안 보이는 선택 항목) ──
  closeMore() {
    this.moreOpen = false;
    $('rvMoreFields').classList.add('hidden');
    $('rvMoreToggle').innerHTML = '<i class="ti ti-plus"></i> 누구인지 · 날짜 (선택)';
  },
  toggleMore() {
    this.moreOpen = !this.moreOpen;
    $('rvMoreFields').classList.toggle('hidden', !this.moreOpen);
    $('rvMoreToggle').innerHTML = this.moreOpen
      ? '<i class="ti ti-minus"></i> 접기'
      : '<i class="ti ti-plus"></i> 누구인지 · 날짜 (선택)';
  },

  // ── 숫자 스트립 (평소엔 요약 한 줄만 보여주고, 눌러야 펼쳐짐) ──
  closeStats() {
    this.statsOpen = false;
    $('rvStatsBox').classList.add('hidden');
    $('rvStatsToggle').classList.remove('open');
    this.updateStatsSummary();
  },
  toggleStats() {
    this.statsOpen = !this.statsOpen;
    $('rvStatsBox').classList.toggle('hidden', !this.statsOpen);
    $('rvStatsToggle').classList.toggle('open', this.statsOpen);
  },
  updateStatsSummary() {
    const s = DB.data.stats || {};
    const items = (Array.isArray(s.items) ? s.items : []).filter(x => x && x.num && x.label);
    $('rvStatsSummary').textContent = (s.updated_label && items.length)
      ? `${s.updated_label} · ${items.map(i => `${i.label} ${i.num}`).join(' · ')}`
      : '아직 안 채웠어요 (후기 페이지에서 숨김)';
  },
  renderStats() {
    const s = DB.data.stats || {};
    $('rvStatLabel').value = s.updated_label || '';
    const items = Array.isArray(s.items) ? s.items : [];
    $('rvStatRows').innerHTML = Array.from({ length: RV_STAT_SLOTS }, (_, i) => {
      const it = items[i] || {};
      return `<div class="rvm-stat-row">
        <input class="rvm-stat-num" data-si="${i}" placeholder="128" value="${escHtml(it.num || '')}" inputmode="numeric">
        <input class="rvm-stat-label" data-sl="${i}" placeholder="누적 신청" value="${escHtml(it.label || '')}">
      </div>`;
    }).join('');
  },

  collectStats() {
    const items = [];
    for (let i = 0; i < RV_STAT_SLOTS; i++) {
      const num = $('rvStatRows').querySelector(`[data-si="${i}"]`).value.trim();
      const label = $('rvStatRows').querySelector(`[data-sl="${i}"]`).value.trim();
      if (num && label) items.push({ num, label });
    }
    return { updated_label: $('rvStatLabel').value.trim(), items };
  },

  // 지금 데이터에서 바로 뽑아 채워줌 — 손으로 세다가 틀리는 걸 막으려고.
  // 셋 다 '누적' 기준입니다. 진행 중인 건수로 넣으면 성사될 때마다 숫자가 줄어서,
  // 공개 페이지에서는 오히려 일이 줄어드는 것처럼 보여요.
  fillStatsFromData() {
    const ms = DB.data.matches;
    const vals = [
      { num: String(DB.data.candidates.length), label: '누적 신청' },
      { num: String(ms.length), label: '누적 소개' },
      { num: String(ms.filter(m => m.status === 'success').length), label: '커플 성사' }
    ];
    vals.forEach((v, i) => {
      $('rvStatRows').querySelector(`[data-si="${i}"]`).value = v.num;
      $('rvStatRows').querySelector(`[data-sl="${i}"]`).value = v.label;
    });
    const d = new Date();
    if (!$('rvStatLabel').value.trim()) $('rvStatLabel').value = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    toast('지금 수치로 채웠어요. 확인하고 저장해 주세요');
  },

  async saveStats() {
    const btn = $('rvStatSaveBtn');
    btn.disabled = true;
    const r = await DB.saveStats(this.collectStats());
    btn.disabled = false;
    if (!r) return;
    toast('숫자가 저장되었어요');
    this.closeStats();   // 저장했으면 다시 요약 한 줄로 접어서 화면을 비워줌
  },

  // ── 캡처 올리기 ──
  async pickShot(file) {
    if (!file) return;
    toast('캡처 올리는 중…');
    // 캡처는 글씨를 읽어야 해서 후보 사진(900px)보다 크게 남깁니다
    const blob = await compressImageBlob(file, 1400, 0.88);
    if (!blob) { toast('이미지를 읽지 못했어요'); return; }
    const path = `shot/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await sb.storage.from('reviews').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) {
      console.warn('[Storage] 후기 캡처 업로드 실패', error);
      toast('캡처를 올리지 못했어요. upgrade_v7.sql을 실행했는지 확인해 주세요');
      return;
    }
    this.shot = sb.storage.from('reviews').getPublicUrl(path).data.publicUrl;
    $('rvPreview').src = this.shot;
    $('rvPreview').classList.remove('hidden');
    $('rvDropHint').classList.add('hidden');
    this.syncAdd();
    toast('캡처가 올라갔어요');
  },

  async add() {
    if (!this.shot || this.busy) return;
    const note = $('rvNote').value.trim();
    if (!note && !await ask({
      title: '주선자 코멘트 없이 올릴까요?',
      desc: '캡처만 있으면 "감사 인사 모음"으로 보이고, 한 줄이라도 코멘트가 있어야 "신경 써주는 곳"으로 읽혀요.',
      okText: '그냥 올리기'
    })) return;
    this.busy = true;
    this.syncAdd();
    const top = DB.data.reviews.reduce((mx, r) => Math.max(mx, r.sort_order || 0), 0);
    const row = await DB.addReview({
      image_url: this.shot,
      who: $('rvWho').value.trim(),
      stage: this.stage,
      note,
      shown_at: $('rvDate').value.trim(),
      published: true,
      sort_order: top + 1
    });
    this.busy = false;
    if (!row) { this.syncAdd(); return; }
    // 다음 후기를 바로 이어 올릴 수 있게 입력칸을 비움
    this.shot = null;
    $('rvPreview').classList.add('hidden');
    $('rvPreview').src = '';
    $('rvDropHint').classList.remove('hidden');
    $('rvWho').value = '';
    $('rvDate').value = '';
    $('rvNote').value = '';
    this.closeMore();
    this.syncAdd();
    this.renderList();
    toast('후기가 올라갔어요');
  },

  // ── 올린 후기 목록 ──
  sorted() {
    return DB.data.reviews.slice().sort((a, b) =>
      (b.sort_order || 0) - (a.sort_order || 0) || b.id - a.id);
  },

  renderList() {
    const list = this.sorted();
    const shown = list.filter(r => r.published).length;
    $('rvCount').textContent = list.length ? `공개 ${shown} · 숨김 ${list.length - shown}` : '';
    const box = $('rvList');
    if (!list.length) {
      box.innerHTML = `<p class="hint-text" style="text-align:center;padding:20px 0">아직 올린 후기가 없어요</p>`;
      return;
    }
    box.innerHTML = list.map((r, i) => this.editingId === r.id
      ? this.itemEditHtml(r)
      : this.itemViewHtml(r, i, list.length)
    ).join('');

    list.forEach(r => {
      const el = box.querySelector(`[data-rvid="${r.id}"]`);
      if (this.editingId === r.id) this.bindEdit(el, r);
      else this.bindView(el, r);
    });
  },

  itemViewHtml(r, i, total) {
    return `<div class="rvm-item ${r.published ? '' : 'off'}" data-rvid="${r.id}">
      <img class="rvm-thumb" src="${escHtml(r.image_url)}" alt="">
      <div class="rvm-body">
        <div class="rvm-head">
          <span class="rvm-stage rvm-${escHtml(r.stage)}">${escHtml(RV_STAGE_LABEL[r.stage] || r.stage)}</span>
          ${r.who ? `<span class="rvm-who">${escHtml(r.who)}</span>` : ''}
          ${r.shown_at ? `<span class="rvm-date">${escHtml(r.shown_at)}</span>` : ''}
        </div>
        <div class="rvm-note">${r.note ? escHtml(r.note) : '<i style="color:var(--gray-mid)">코멘트 없음 — 한 줄 적어주세요</i>'}</div>
        <div class="rvm-tools">
          <button class="rvm-btn" data-rvedit title="수정"><i class="ti ti-edit"></i>수정</button>
          <button class="rvm-btn" data-rvmove="up" ${i === 0 ? 'disabled' : ''} title="위로"><i class="ti ti-arrow-up"></i></button>
          <button class="rvm-btn" data-rvmove="down" ${i === total - 1 ? 'disabled' : ''} title="아래로"><i class="ti ti-arrow-down"></i></button>
          <button class="rvm-btn" data-rvtoggle title="${r.published ? '숨기기' : '공개하기'}"><i class="ti ti-eye${r.published ? '' : '-off'}"></i>${r.published ? '공개중' : '숨김'}</button>
          <button class="rvm-btn danger" data-rvdel title="삭제"><i class="ti ti-trash"></i></button>
        </div>
      </div>
    </div>`;
  },

  bindView(el, r) {
    const id = r.id;
    el.querySelector('[data-rvedit]').onclick = () => { this.editingId = id; this.editStage = r.stage; this.renderList(); };
    el.querySelector('[data-rvtoggle]').onclick = async () => {
      if (!(await DB.updateReview(id, { published: !r.published }))) return;
      this.renderList();
      toast(r.published ? '후기 페이지에서 숨겼어요' : '후기 페이지에 다시 올렸어요');
    };
    el.querySelector('[data-rvdel]').onclick = async () => {
      if (!await ask({
        title: '이 후기를 삭제할까요?',
        desc: '캡처 파일도 함께 지워집니다.',
        warn: '되돌릴 수 없습니다', okText: '삭제', danger: true
      })) return;
      if (!(await DB.deleteReview(id))) return;
      this.renderList();
      toast('후기를 삭제했어요');
    };
    el.querySelectorAll('[data-rvmove]').forEach(b => {
      b.onclick = () => this.move(id, b.dataset.rvmove === 'up' ? -1 : 1);
    });
    el.querySelector('.rvm-thumb').onclick = () => LB.open([r.image_url], 0);
  },

  // ── 후기 한 건 수정 (사진은 그대로 두고, 문구만 고칩니다) ──
  itemEditHtml(r) {
    const chip = (v, t) => `<button type="button" class="chip ${this.editStage === v ? 'active' : ''}" data-rves="${v}">${t}</button>`;
    return `<div class="rvm-item editing" data-rvid="${r.id}">
      <img class="rvm-thumb" src="${escHtml(r.image_url)}" alt="">
      <div class="rvm-body">
        <div class="filter-row" data-rvestage style="margin-bottom:var(--sp-2)">
          ${chip('success', '성사')}${chip('meet', '첫 만남 후')}${chip('progress', '진행 중')}${chip('etc', '기타')}
        </div>
        <div class="f-field"><textarea data-rvenote placeholder="주선자 코멘트">${escHtml(r.note || '')}</textarea></div>
        <div class="form-grid" style="margin:var(--sp-3) 0">
          <div class="f-field"><label>누구인지</label><input data-rvewho value="${escHtml(r.who || '')}" placeholder="예: 96년생 · 여성 · 대구"></div>
          <div class="f-field"><label>날짜</label><input data-rvedate value="${escHtml(r.shown_at || '')}" placeholder="예: 2026.07"></div>
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-rvecancel>취소</button>
          <button class="btn primary" data-rvesave><i class="ti ti-check"></i> 저장</button>
        </div>
      </div>
    </div>`;
  },

  bindEdit(el, r) {
    el.querySelectorAll('[data-rvestage] [data-rves]').forEach(chip => {
      chip.onclick = () => {
        this.editStage = chip.dataset.rves;
        el.querySelectorAll('[data-rvestage] [data-rves]').forEach(c => c.classList.toggle('active', c === chip));
      };
    });
    el.querySelector('[data-rvecancel]').onclick = () => { this.editingId = null; this.renderList(); };
    el.querySelector('[data-rvesave]').onclick = async () => {
      const patch = {
        stage: this.editStage,
        note: el.querySelector('[data-rvenote]').value.trim(),
        who: el.querySelector('[data-rvewho]').value.trim(),
        shown_at: el.querySelector('[data-rvedate]').value.trim()
      };
      const btn = el.querySelector('[data-rvesave]');
      btn.disabled = true;
      const ok = await DB.updateReview(r.id, patch);
      btn.disabled = false;
      if (!ok) return;
      this.editingId = null;
      this.renderList();
      toast('후기를 수정했어요');
    };
  },

  async move(id, dir) {
    const list = this.sorted();
    const i = list.findIndex(r => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;

    // 번호가 서로 겹치거나 비어 있으면 자리를 바꿔도 순서가 그대로일 수 있습니다.
    // 그럴 때만 전체에 번호를 새로 매기고, 평소에는 두 건만 맞바꿉니다.
    // (후기가 쉰 건이면 예전에는 화살표 한 번에 쉰 번을 저장했습니다)
    const nums = list.map(r => r.sort_order || 0);
    const messy = new Set(nums).size !== nums.length || nums.some(n => !n);

    const btnBusy = this.busy;
    this.busy = true;
    if (messy) {
      const order = list.map(r => r.id);
      [order[i], order[j]] = [order[j], order[i]];
      await Promise.all(order.map((rid, k) => DB.updateReview(rid, { sort_order: order.length - k })));
    } else {
      await Promise.all([
        DB.updateReview(list[i].id, { sort_order: nums[j] }),
        DB.updateReview(list[j].id, { sort_order: nums[i] })
      ]);
    }
    this.busy = btnBusy;
    this.renderList();
  }
};

// ═══════════════════════════════════════
//  설정 — 백업 / 사진 이전 / 계정
// ═══════════════════════════════════════

// 예전 방식(base64)으로 DB에 저장된 사진을 스토리지로 이전
async function migratePhotosToStorage() {
  const targets = DB.data.candidates.filter(c => (c.photos || []).some(p => String(p).startsWith('data:')));
  if (!targets.length) return toast('이전할 사진이 없어요. 모두 최신 상태예요!');
  if (!await ask({
    title: `${targets.length}명의 사진을 스토리지로 옮길까요?`,
    desc: '데이터베이스가 가벼워지고 목록 로딩이 빨라집니다. 사진은 그대로 보입니다.',
    okText: '옮기기'
  })) return;
  toast('사진 이전 중… 잠시만요');
  let done = 0, fail = 0;
  for (const c of targets) {
    const newPhotos = [];
    for (const p of c.photos) {
      if (!String(p).startsWith('data:')) { newPhotos.push(p); continue; }
      const url = await uploadPhotoBlob(dataURLToBlob(p), c.id + '_');
      if (url) newPhotos.push(url); else { newPhotos.push(p); fail++; }
    }
    if (await DB.updateCandidate(c.id, { photos: newPhotos })) done++;
  }
  renderAll();
  toast(fail
    ? `이전 완료 (${done}명), ${fail}장 실패 — Supabase에서 upgrade_v3.sql 실행 여부를 확인해 주세요`
    : `사진 이전 완료! (${done}명)`);
}

function exportData() {
  const blob = new Blob([JSON.stringify(DB.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `썸메이트_백업_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('백업 파일이 저장되었어요');
}

// 백업 파일에 무엇이 들어 있는지 한눈에 (복원 전 확인 창에 그대로 보여줍니다)
function summarizeDataset(d) {
  const n = k => (Array.isArray(d[k]) ? d[k].length : 0);
  return [
    `후보 ${n('candidates')}명`,
    `매칭 ${n('matches')}건`,
    `거절 기록 ${n('rejections')}건`,
    `신청서 ${n('applications')}건`,
    `후기 ${n('reviews')}건`
  ].join('\n');
}

// 백업 데이터를 서버에 업로드 (id 재발급 + 매칭 연결 유지)
async function uploadDataset(dataset) {
  const candidates = dataset.candidates || [];
  const matches = dataset.matches || [];

  const idMap = {};
  let added = 0;
  for (const c of candidates) {
    const oldId = c.id;
    const payload = { ...c };
    delete payload.id; delete payload.created_at; delete payload.updated_at;
    const row = await DB.addCandidate(payload);
    if (row) { idMap[oldId] = row.id; added++; }
  }
  let addedM = 0;
  for (const m of matches) {
    const mid = idMap[m.male_id], fid = idMap[m.female_id];
    if (!mid || !fid) continue;
    const row = await DB.addMatch(mid, fid);
    if (row) {
      addedM++;
      if (m.status !== 'exchanging' || m.memo) await DB.updateMatch(row.id, { status: m.status || 'exchanging', memo: m.memo || '' });
    }
  }
  // 거절 기록 (match_id는 새로 맺어진 매칭과 짝을 지을 수 없어 비워둠)
  const rejRows = (dataset.rejections || []).map(r => {
    const f = idMap[r.from_id], t = idMap[r.to_id];
    return (f && t) ? { from_id: f, to_id: t, stage: r.stage || 'profile', reason: r.reason || '' } : null;
  }).filter(Boolean);
  let addedR = 0;
  if (rejRows.length) {
    const saved = await DB.addRejections(rejRows);
    addedR = saved ? saved.length : 0;
  }

  // ── 신청서 ──
  // 예전에는 백업 파일에 담아 내보내기만 하고 복원은 하지 않아서,
  // '복원 완료'라고 해놓고 신청서와 후기가 조용히 사라졌습니다.
  let addedA = 0;
  for (const a of (dataset.applications || [])) {
    const row = { ...a };
    delete row.id; delete row.created_at;
    // 후보 쪽 번호가 새로 발급됐으므로 연결도 새 번호로 바꿔줍니다
    row.candidate_id = idMap[a.candidate_id] || null;
    if (await DB.addApplication(row)) addedA++;
  }

  // ── 후기 ──
  let addedRv = 0;
  for (const rv of (dataset.reviews || [])) {
    const row = { ...rv };
    delete row.id; delete row.created_at; delete row.updated_at;
    if (await DB.addReview(row, true)) addedRv++;
  }

  // ── 숫자 스트립 ──
  // 지금 채워둔 숫자가 있으면 건드리지 않습니다. 덮어써서 잃는 쪽이 더 아프니까요.
  const st = dataset.stats;
  const cur = DB.data.stats;
  if (st && st.updated_label && !(cur && cur.updated_label)) {
    await DB.saveStats({ updated_label: st.updated_label, items: st.items || [] });
  }

  return { added, addedM, addedR, addedA, addedRv };
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const d = JSON.parse(e.target.result);
      if (!Array.isArray(d.candidates)) throw new Error('형식 오류');
      if (!await ask({
        title: '백업 파일을 복원할까요?',
        desc: '서버에 있는 지금 데이터는 그대로 두고, 백업 내용을 뒤에 덧붙입니다(병합).',
        list: summarizeDataset(d),
        warn: '이미 있는 사람도 다시 추가되어 같은 이름이 두 번 생길 수 있어요',
        okText: '복원'
      })) return;
      toast('복원 중… 잠시만요');
      const r = await uploadDataset(d);
      renderAll();
      toast(`복원 완료: 후보 ${r.added}명 · 매칭 ${r.addedM}건 · 거절 ${r.addedR}건 · 신청서 ${r.addedA}건 · 후기 ${r.addedRv}건`);
    } catch (err) {
      console.error(err);
      toast('백업 파일을 읽지 못했어요');
    }
  };
  reader.readAsText(file);
}

// ── 예전 로컬(v1) 데이터 자동 이전 ──
async function maybeMigrateLocal() {
  if (localStorage.getItem('sdt_migrated_v1')) return;
  let local = null;
  try { local = JSON.parse(localStorage.getItem('sdt_db_v1') || 'null'); } catch (e) { }
  if (!local || !local.candidates || !local.candidates.length) {
    localStorage.setItem('sdt_migrated_v1', '1');
    return;
  }
  if (DB.data.candidates.length) { localStorage.setItem('sdt_migrated_v1', '1'); return; }
  if (await ask({
    title: '예전 데이터를 발견했어요',
    desc: `이 브라우저에 저장돼 있던 후보 ${local.candidates.length}명을 클라우드로 옮길까요?`,
    okText: '옮기기'
  })) {
    toast('데이터 이전 중… 잠시만요');
    const r = await uploadDataset(local);
    toast(`이전 완료: 후보 ${r.added}명, 매칭 ${r.addedM}건`);
  }
  localStorage.setItem('sdt_migrated_v1', '1');
}

// ═══════════════════════════════════════
//  로그인 / 인증
// ═══════════════════════════════════════
async function doLogin() {
  const email = $('loginEmail').value.trim();
  const pw = $('loginPw').value;
  if (!email || !pw) { $('loginError').textContent = '이메일과 비밀번호를 입력해 주세요'; return; }
  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = '로그인 중…';
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-login-2"></i> 로그인';
  if (error) {
    console.error(error);
    $('loginError').textContent =
      /invalid/i.test(error.message) ? '이메일 또는 비밀번호가 올바르지 않아요'
      : /confirm/i.test(error.message) ? '이메일 인증이 필요해요. Supabase에서 계정을 다시 확인해 주세요'
      : '로그인에 실패했어요. 잠시 후 다시 시도해 주세요';
    return;
  }
  $('loginError').textContent = '';
  await enterApp();
}

async function enterApp() {
  loginRequired = false;
  $('gate').classList.add('hidden');
  $('gate').classList.remove('checking');
  $('candidateList').innerHTML = '<div class="empty"><p class="empty-text">데이터를 불러오는 중…</p></div>';
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (user) $('accountEmail').textContent = `${user.email} 로 로그인 중`;
    await DB.init();
    await maybeMigrateLocal();
    renderAll();
  } catch (e) {
    console.error(e);
    $('candidateList').innerHTML = '<div class="empty"><p class="empty-text">데이터를 불러오지 못했어요</p><p class="empty-sub">새로고침 후 다시 시도해 주세요</p></div>';
  }
}

// ═══════════════════════════════════════
//  네비게이션 / 모달 / 초기화
// ═══════════════════════════════════════
function switchView(view) {
  S.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  // 등록(가운데 + 버튼)도 하나의 화면입니다. 예전에는 .nav-item 만 칠해서
  // 등록 화면에 들어가면 아래 다섯 칸이 전부 회색이 되어 지금 어디인지 알 수 없었어요.
  document.querySelectorAll('.bottom-nav [data-view]').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  syncBulkBar();   // 후보 탭을 벗어나면 일괄 작업 바 숨김
  syncStatActive();
  window.scrollTo(0, 0);
}

// ── 모달 열고 닫기 ──
// 열려 있는 창을 순서대로 기억해 둡니다. 하나라도 열려 있으면
// 뒤 배경(목록)이 같이 스크롤되지 않게 body를 잠급니다.
const modalStack = [];
let modalLastFocus = null;

function openModal(id) {
  const el = $(id);
  if (!el || el.classList.contains('open')) return;
  if (!modalStack.length) modalLastFocus = document.activeElement;
  modalStack.push(id);
  el.classList.add('open');
  document.body.classList.add('modal-open');
  // 창이 열리면 읽기 시작점을 창 안으로 옮겨줍니다 (키보드·스크린리더)
  const sheet = el.querySelector('.modal-sheet');
  if (sheet) { sheet.setAttribute('tabindex', '-1'); sheet.scrollTop = 0; sheet.focus({ preventScroll: true }); }
}

function closeModal(id) {
  const el = $(id);
  if (!el || !el.classList.contains('open')) return;
  el.classList.remove('open');
  const i = modalStack.lastIndexOf(id);
  if (i > -1) modalStack.splice(i, 1);
  if (!modalStack.length) {
    document.body.classList.remove('modal-open');
    if (modalLastFocus && document.contains(modalLastFocus)) modalLastFocus.focus({ preventScroll: true });
    modalLastFocus = null;
  }
}

// 사용자가 직접 닫은 경우(배경 누르기 · Esc · 아래로 끌어내리기).
// 화면 사이를 오갈 때 쓰는 closeModal과 달리, 여기서는 지나온 발자국도 함께 지웁니다.
function dismissModal(bg) {
  if (!bg) return;
  closeModal(bg.id);
  bg.dispatchEvent(new CustomEvent('modal-dismiss'));   // 확인 창은 이걸 '취소'로 받습니다
  if (bg.id === 'detailModal' || bg.id === 'matchModal') Trail.clear();
}

// 창 안에서만 Tab이 돌게 잡아둡니다. 안 그러면 뒤에 가려진 목록으로 포커스가 새어 나갑니다.
function trapTab(e) {
  if (!modalStack.length || e.key !== 'Tab') return;
  const top = $(modalStack[modalStack.length - 1]);
  if (!top) return;
  const items = [...top.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) {
    last.focus(); e.preventDefault();
  } else if (!e.shiftKey && document.activeElement === last) {
    first.focus(); e.preventDefault();
  }
}

// 로그인이 풀렸을 때 — 게이트를 다시 띄웁니다
let loginRequired = false;
function requireLogin() {
  if (loginRequired) return;
  loginRequired = true;
  modalStack.slice().forEach(closeModal);
  $('gate').classList.remove('hidden', 'checking');
  $('loginError').textContent = '로그인이 만료되었어요. 다시 로그인해 주세요';
  toast('로그인이 만료되었어요');
}

function renderAll() {
  renderStats();
  renderCandidates();
  renderMatches();
  renderApplications();
  renderAppBadge();
  renderPurgeBar();
}

async function init() {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const d = new Date();
  $('todayDate').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${['일','월','화','수','목','금','토'][d.getDay()]}요일`;

  // 하단 네비
  document.querySelectorAll('.bottom-nav [data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === 'register' && S.view !== 'register') { clearForm(); setRegMode('paste'); }
      switchView(v);
    });
  });

  // 통계 박스 — 왼쪽은 후보 목록으로, 오른쪽 세 칸은 그 상태의 매칭 목록으로
  document.querySelectorAll('.stat-box').forEach(box => {
    box.addEventListener('click', () => {
      const st = box.dataset.stat;
      if (st === 'all') {
        // 필터를 풀었으면 목록도 다시 그려야 합니다. 예전에는 상태만 바꾸고
        // 다시 그리지 않아서, 칩은 눌린 채로 남고 화면은 그대로였어요.
        S.statusFilters.clear();
        syncFilterChips();
        switchView('candidates');
        renderCandidates();
      } else {
        S.matchFilter = st;
        document.querySelectorAll('#matchChips .chip').forEach(c => c.classList.toggle('active', c.dataset.ms === st));
        switchView('matches');
        renderMatches();
      }
    });
  });

  // 검색 / 필터
  $('searchInput').addEventListener('input', e => { S.search = e.target.value.trim(); renderCandidates(); });
  // 성별 — 하나만 고르는 조건
  document.querySelectorAll('#genderChips .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.gender = btn.dataset.g;
      syncFilterChips();
      renderCandidates();
    });
  });
  // 상태 — 한 번 더 누르면 해제되는 토글
  document.querySelectorAll('#statusChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const s = chip.dataset.s;
      if (S.statusFilters.has(s)) S.statusFilters.delete(s); else S.statusFilters.add(s);
      syncFilterChips();
      renderCandidates();
    });
  });
  $('filterResetBtn').addEventListener('click', resetFilters);
  syncFilterChips();   // 시작할 때 칩 상태를 한 번 맞춰둡니다
  $('sortSelect').value = S.sort;
  $('sortSelect').addEventListener('change', e => {
    S.sort = e.target.value;
    localStorage.setItem('sdt_sort', S.sort);
    renderCandidates();
  });
  $('viewToggle').addEventListener('click', () => {
    S.listMode = S.listMode === 'list' ? 'album' : 'list';
    localStorage.setItem('sdt_view', S.listMode);
    $('viewToggle').innerHTML = `<i class="ti ti-${S.listMode === 'list' ? 'layout-grid' : 'list'}"></i>`;
    renderCandidates();
  });

  // 선택 모드 / 일괄 작업
  $('selectToggle').addEventListener('click', () => setSelectMode(!S.selectMode));
  $('bulkAllBtn').addEventListener('click', () => {
    const list = filteredCandidates();
    // 화면에 보이는 후보 기준: 전부 선택돼 있으면 해제, 아니면 전체 선택
    const allOn = list.length && list.every(c => S.selected.has(c.id));
    S.selected = allOn ? new Set() : new Set(list.map(c => c.id));
    renderCandidates();
  });
  $('bulkBlacklistBtn').addEventListener('click', bulkBlacklist);
  $('bulkDeleteBtn').addEventListener('click', bulkDelete);
  $('viewToggle').innerHTML = `<i class="ti ti-${S.listMode === 'list' ? 'layout-grid' : 'list'}"></i>`;

  // 등록
  document.querySelectorAll('#regTabs .seg-tab').forEach(btn => {
    btn.addEventListener('click', () => setRegMode(btn.dataset.mode));
  });
  $('parseBtn').addEventListener('click', runParse);
  // 연락처 칸: 숫자만 쳐도 하이픈이 들어가게
  const fPhone = $('fPhone');
  const fixPhone = () => {
    const before = fPhone.value, after = formatPhone(before);
    if (before === after) return;
    let atEnd = true;
    try { atEnd = fPhone.selectionStart === before.length; } catch (e) { }
    fPhone.value = after;
    if (atEnd) { try { fPhone.setSelectionRange(after.length, after.length); } catch (e) { } }
  };
  ['input', 'change', 'blur'].forEach(ev => fPhone.addEventListener(ev, fixPhone));
  fPhone.addEventListener('paste', () => setTimeout(fixPhone, 0));

  $('gBtnM').addEventListener('click', () => setGender('m'));
  $('gBtnF').addEventListener('click', () => setGender('f'));
  $('formSaveBtn').addEventListener('click', saveForm);
  $('formCancelBtn').addEventListener('click', () => {
    clearForm();
    setRegMode('paste');
    switchView('candidates');
  });
  $('photoAddBtn').addEventListener('click', () => $('photoFile').click());
  $('photoFile').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) toast('사진 올리는 중…');
    for (const f of files) {
      if (S.formPhotos.length >= 5) { toast('사진은 최대 5장까지예요'); break; }
      const url = await addPhotoFromFile(f);
      if (url) S.formPhotos.push(url);
      renderFormPhotos();
    }
  });

  // 엑셀
  $('templateBtn').addEventListener('click', downloadTemplate);
  $('excelBtn').addEventListener('click', () => $('excelFile').click());
  $('excelFile').addEventListener('change', e => {
    if (e.target.files[0]) handleExcelFile(e.target.files[0]);
    e.target.value = '';
  });

  // 매칭
  $('newMatchBtn').addEventListener('click', () => openCreateMatch());
  $('pickSearchInput').addEventListener('input', e => { S.pickSearch = e.target.value.trim(); renderPickLists(); });
  $('createMatchBtn').addEventListener('click', createMatch);
  document.querySelectorAll('#matchChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      S.matchFilter = chip.dataset.ms;
      document.querySelectorAll('#matchChips .chip').forEach(c => c.classList.toggle('active', c === chip));
      renderMatches();
    });
  });

  // 신청 관리
  document.querySelectorAll('#appChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      S.appFilter = chip.dataset.as;
      document.querySelectorAll('#appChips .chip').forEach(c => c.classList.toggle('active', c === chip));
      renderApplications();
    });
  });

  // 오래된 신청서 정리
  $('purgeOpenBtn').addEventListener('click', () => Purge.open());
  $('purgeAllBtn').addEventListener('click', () => Purge.setAll(true));
  $('purgeNoneBtn').addEventListener('click', () => Purge.setAll(false));
  $('purgeRunBtn').addEventListener('click', () => Purge.run());
  $('purgeCancelBtn').addEventListener('click', () => closeModal('purgeModal'));

  // 거절 기록 모달
  document.querySelectorAll('#rejStage .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      Rej.stage = chip.dataset.st;
      document.querySelectorAll('#rejStage .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });
  $('rejSearch').addEventListener('input', e => { Rej.query = e.target.value; Rej._renderPicker(); });
  $('rejSaveBtn').addEventListener('click', () => Rej.save());
  $('rejSkipBtn').addEventListener('click', () => Rej.skip());

  // 오늘의 검사 주소
  // 이 두 버튼은 index.html 설정 탭에만 있습니다. app.js 만 먼저 올라가고 화면이
  // 아직 예전 것이면 버튼이 없는데, 여기서 터지면 아래 로그인 연결까지 통째로
  // 안 걸려서 로그인이 안 됩니다. 없으면 그냥 건너뜁니다.
  const quizCopyBtn = $('copyQuizBtn'), quizOpenBtn = $('openQuizBtn');
  if (quizCopyBtn) quizCopyBtn.addEventListener('click', () => {
    const done = () => toast('검사 주소가 복사되었어요');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(QUIZ_HOME).then(done).catch(() => fallbackCopy(QUIZ_HOME, done));
    } else fallbackCopy(QUIZ_HOME, done);
  });
  if (quizOpenBtn) quizOpenBtn.addEventListener('click', () => window.open(QUIZ_HOME, '_blank', 'noopener'));

  // 공개 신청 폼 주소
  const applyUrl = location.origin + location.pathname.replace(/\/[^/]*$/, '/') + 'apply';
  $('applyUrl').textContent = applyUrl;
  $('copyApplyBtn').addEventListener('click', () => {
    const done = () => toast('신청 폼 주소가 복사되었어요');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(applyUrl).then(done).catch(() => fallbackCopy(applyUrl, done));
    } else fallbackCopy(applyUrl, done);
  });
  $('openApplyBtn').addEventListener('click', () => window.open(applyUrl, '_blank', 'noopener'));

  // 후기 관리
  const reviewsUrl = location.origin + location.pathname.replace(/\/[^/]*$/, '/') + 'reviews';
  $('reviewsUrl').textContent = reviewsUrl;
  $('openReviewsBtn').addEventListener('click', () => window.open(reviewsUrl, '_blank', 'noopener'));
  $('reviewManageBtn').addEventListener('click', () => Rev.open());
  $('rvDrop').addEventListener('click', () => $('rvFile').click());
  $('rvFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    await Rev.pickShot(f);
  });
  document.querySelectorAll('#rvStage .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      Rev.stage = chip.dataset.rvs;
      document.querySelectorAll('#rvStage .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });
  $('rvAddBtn').addEventListener('click', () => Rev.add());
  $('rvStatsToggle').addEventListener('click', () => Rev.toggleStats());
  $('rvMoreToggle').addEventListener('click', () => Rev.toggleMore());
  $('rvStatFillBtn').addEventListener('click', () => Rev.fillStatsFromData());
  $('rvStatSaveBtn').addEventListener('click', () => Rev.saveStats());

  // 설정
  $('exportBtn').addEventListener('click', exportData);
  $('migratePhotosBtn').addEventListener('click', migratePhotosToStorage);
  $('backupBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  // 로그인 / 로그아웃
  $('loginBtn').addEventListener('click', doLogin);
  // 이메일 칸에서 Enter를 눌러도 넘어가게 (예전에는 비밀번호 칸에서만 됐습니다)
  ['loginEmail', 'loginPw'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });
  $('loginPwToggle').addEventListener('click', () => {
    const pw = $('loginPw'), show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    $('loginPwToggle').innerHTML = `<i class="ti ti-eye${show ? '-off' : ''}" aria-hidden="true"></i>`;
    $('loginPwToggle').setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
    pw.focus();
  });
  $('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });

  // 모달 공통
  document.querySelectorAll('.modal-bg').forEach(bg => {
    bg.addEventListener('click', e => { if (e.target === bg) dismissModal(bg); });
  });
  // ── 라이트박스: 마우스 / 휠 / 스와이프 ──
  const lb = $('lightbox');
  lb.addEventListener('click', e => {
    // 배경(또는 사진 바깥 여백)을 눌렀을 때만 닫음 — 사진·버튼 클릭은 유지
    if (e.target === lb || e.target === $('lbStage')) LB.close();
  });
  $('lbClose').addEventListener('click', e => { e.stopPropagation(); LB.close(); });
  $('lbPrev').addEventListener('click', e => { e.stopPropagation(); LB.go(-1); });
  $('lbNext').addEventListener('click', e => { e.stopPropagation(); LB.go(1); });

  let wheelAt = 0;
  lb.addEventListener('wheel', e => {
    if (!LB.isOpen() || LB.photos.length < 2) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 8 || Date.now() - wheelAt < 220) return;
    wheelAt = Date.now();
    LB.go(d > 0 ? 1 : -1);
  }, { passive: false });

  let lbX = 0, lbY = 0, lbTouch = false;
  lb.addEventListener('touchstart', e => {
    lbTouch = e.touches.length === 1;
    if (lbTouch) { lbX = e.touches[0].clientX; lbY = e.touches[0].clientY; }
  }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (!lbTouch) return;
    lbTouch = false;
    const dx = e.changedTouches[0].clientX - lbX, dy = e.changedTouches[0].clientY - lbY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) LB.go(dx < 0 ? 1 : -1);
    else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) LB.close();
  }, { passive: true });

  // ── 키보드: ← → 이동, Esc 닫기, Home/End 처음·끝 ──
  document.addEventListener('keydown', e => {
    // 창이 열려 있는 동안에는 Tab이 창 밖으로 새어 나가지 않게 잡아둡니다
    if (!LB.isOpen()) trapTab(e);
    if (LB.isOpen()) {
      if (e.key === 'Escape') LB.close();
      else if (e.key === 'ArrowLeft') LB.go(-1);
      else if (e.key === 'ArrowRight') LB.go(1);
      else if (e.key === 'Home') LB.to(0);
      else if (e.key === 'End') LB.to(LB.photos.length - 1);
      else return;
      e.preventDefault();
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ($('detailModal').classList.contains('open') && Gal.photos.length > 1) {
      if (e.key === 'ArrowLeft') { Gal.go(-1); e.preventDefault(); return; }
      if (e.key === 'ArrowRight') { Gal.go(1); e.preventDefault(); return; }
    }
    if (e.key === 'Escape') {
      // 모달이 겹쳐 있으면 맨 위(가장 나중에 열린) 것부터 닫음
      const opens = document.querySelectorAll('.modal-bg.open');
      if (opens.length) dismissModal(opens[opens.length - 1]);
    }
  });

  // 바텀시트 아래로 끌어서 닫기 (토스/카뱅 스타일)
  document.querySelectorAll('.modal-sheet').forEach(sheet => {
    const bg = sheet.closest('.modal-bg');
    let startY = 0, curY = 0, dragging = false, startT = 0;
    sheet.addEventListener('touchstart', e => {
      if (sheet.scrollTop > 0) return; // 스크롤이 맨 위일 때만 드래그 시작
      dragging = true;
      startY = e.touches[0].clientY;
      curY = 0;
      startT = Date.now();
    }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      if (!dragging) return;
      curY = e.touches[0].clientY - startY;
      if (curY <= 0) { sheet.classList.remove('dragging'); sheet.style.transform = ''; return; }
      sheet.classList.add('dragging');
      sheet.style.transform = `translateY(${curY}px)`;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('dragging');
      const quick = curY > 60 && (Date.now() - startT) < 250; // 빠르게 휙 내리면 바로 닫힘
      if (curY > 120 || quick) {
        dismissModal(bg);
        setTimeout(() => { sheet.style.transform = ''; }, 250);
      } else {
        sheet.style.transform = '';
      }
    };
    sheet.addEventListener('touchend', endDrag);
    sheet.addEventListener('touchcancel', endDrag);
  });

  // 로그인이 풀리면(토큰 만료·다른 기기에서 로그아웃) 바로 게이트를 다시 띄웁니다
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (!session && event === 'TOKEN_REFRESHED')) requireLogin();
  });

  // 세션 확인 후 시작 — 확인이 끝날 때까지 로그인 상자를 잠깐 감춰둡니다
  // (로그인돼 있는데도 로그인 화면이 번쩍이는 걸 막습니다)
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enterApp();
  else $('gate').classList.remove('checking');
}

document.addEventListener('DOMContentLoaded', init);