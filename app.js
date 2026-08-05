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
function dbErr(e) {
  console.error('[DB]', e);
  toast('저장에 실패했어요. 인터넷 연결을 확인해 주세요');
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
  async addReview(row) {
    const { data, error } = await sb.from('reviews').insert(row).select().single();
    if (error) {
      console.error('[DB] 후기 저장 실패', error);
      toast(/relation|does not exist/i.test(error.message || '')
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
  statusFilter: null,
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
  appDetailId: null,
  detailId: null,
  matchDetailId: null,
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
  $('statAll').textContent = DB.data.candidates.length;
  $('statEx').textContent = ms.filter(m => m.status === 'exchanging').length;
  $('statSome').textContent = ms.filter(m => m.status === 'some').length;
  $('statSuc').textContent = ms.filter(m => m.status === 'success').length;
}

function filteredCandidates() {
  const q = S.search.toLowerCase();
  let list = DB.data.candidates.filter(c => {
    if (S.gender !== 'all' && c.gender !== S.gender) return false;
    // 블랙리스트 탭에서만 블랙리스트 후보를 보여주고, 나머지 탭에서는 숨김
    if (S.statusFilter === 'blacklist') { if (!c.blacklisted) return false; }
    else if (c.blacklisted) return false;
    if (S.statusFilter === 'candidate' && candStatus(c) !== 'candidate') return false;
    if (S.statusFilter === 'matched' && !activeMatchOf(c.id)) return false;
    if (S.statusFilter === 'promo' && !c.promo_url) return false;
    if (S.statusFilter === 'nopromo' && c.promo_url) return false;
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

function emptyHtml(text, sub) {
  return `<div class="empty">
    <svg width="64" height="64" viewBox="0 0 64 64"><path d="M32 6C48 6 58 18 58 34C58 50 46 58 32 58C18 58 6 50 6 34C6 18 16 6 32 6Z" fill="#FFE9F1"/><circle cx="24" cy="30" r="3" fill="#FD1569"/><circle cx="40" cy="30" r="3" fill="#FD1569"/><path d="M26 42Q32 38 38 42" stroke="#FD1569" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>
    <p class="empty-text">${escHtml(text)}</p>
    <p class="empty-sub">${escHtml(sub)}</p>
  </div>`;
}

function avatarHtml(c, cls) {
  const photo = c.photos && c.photos[0];
  const inner = photo ? `<img src="${photo}" alt="">` : `<i class="ti ti-${c.gender === 'm' ? 'leaf' : 'flower'}"></i>`;
  return `<div class="${cls} ${c.gender === 'm' ? 'male' : ''}">${inner}</div>`;
}

function renderCandidates() {
  const box = $('candidateList');
  const list = filteredCandidates();
  if (!list.length) {
    box.innerHTML = emptyHtml(
      S.search ? `"${S.search}" 검색 결과가 없어요` : '아직 등록된 후보가 없어요',
      S.search ? '다른 검색어를 시도해 보세요' : '아래 + 버튼으로 첫 후보를 등록해 보세요'
    );
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
          ${photo ? `<img src="${photo}" alt="">` : `<i class="ti ti-${c.gender === 'm' ? 'leaf' : 'flower'}"></i>`}
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
  if (!confirm(`${ids.length}명을 블랙리스트에 등록할까요?\n\n${names}\n\n후보 목록·추천·매칭 상대에서 제외됩니다.`)) return;
  if (!(await DB.updateCandidates(ids, { blacklisted: true }))) return;
  setSelectMode(false);
  renderAll();
  toast(`${ids.length}명을 블랙리스트에 등록했어요`);
}

async function bulkDelete() {
  const ids = [...S.selected];
  if (!ids.length) return;
  const names = ids.slice(0, 5).map(candName).join(', ') + (ids.length > 5 ? ` 외 ${ids.length - 5}명` : '');
  if (!confirm(`${ids.length}명을 완전히 삭제할까요?\n\n${names}\n\n연결된 매칭·거절 기록도 함께 삭제되고, 되돌릴 수 없습니다.`)) return;
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
function renderRecoSection(c) {
  if (activeMatchOf(c.id)) return ''; // 이미 매칭 진행 중이면 추천 생략
  // 이미 거절 기록이 있는 상대는 추천에서 뺌
  const targets = DB.data.candidates.filter(t =>
    t.gender !== c.gender && !t.archived && !t.blacklisted && !activeMatchOf(t.id) && !rejectionsBetween(c.id, t.id).length);
  const scored = targets.map(t => Object.assign({ t }, matchScore(c, t)))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (!scored.length) return '';
  return `<div class="d-section-title"><i class="ti ti-sparkles"></i> 추천 상대</div>` + scored.map(x => `
    <div class="reco-item" data-rid="${x.t.id}">
      ${avatarHtml(x.t, 'c-avatar')}
      <div style="min-width:0;flex:1">
        <div style="font-size:15.5px;font-weight:700">${escHtml(x.t.name)} <span class="c-meta">${escHtml(metaLine(x.t))}</span></div>
        <div class="reco-tags">${x.reasons.map(r => `<span class="reco-tag ${r.ok ? '' : 'bad'}">${escHtml(r.label)}</span>`).join('')}</div>
      </div>
      <button class="icon-btn reco-link" data-rid="${x.t.id}" title="이어주기" style="background:var(--peach-soft);color:var(--peach-mid);flex-shrink:0"><i class="ti ti-heart-plus"></i></button>
    </div>`).join('');
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
        ${photos.map((p, i) => `<img src="${p}" data-pi="${i}" alt="사진 ${i + 1}">`).join('')}
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
    <button class="btn soft" id="dRejAddBtn" style="margin-top:8px"><i class="ti ti-plus"></i> 거절 기록 추가</button>`;
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

// keepTrail: 같은 화면을 다시 그리거나 발자국을 따라 되돌아올 때는 true.
//            목록에서 새로 열 때는 넘기지 않으면 되고, 그러면 발자국이 초기화됩니다.
function openDetail(id, keepTrail) {
  const c = candOf(id);
  if (!c) return;
  if (!keepTrail) Trail.clear();
  S.detailId = id;
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
        ${infoRow('briefcase', '직업', c.job + (c.work_pattern ? ` (${c.work_pattern})` : ''))}
        ${infoRow('school', '학력', c.education)}
        ${infoRow('building-church', '종교', c.religion)}
        ${infoRow('puzzle', 'MBTI', c.mbti)}
        ${infoRow('glass-full', '음주', c.drinking)}
        ${infoRow('smoking-no', '흡연', c.smoking)}
        ${infoRow('car', '자차', c.car)}
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
             <div style="height:10px"></div>
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
      <button class="btn soft" id="dPromoSaveBtn" style="margin-top:8px"><i class="ti ti-check"></i> 홍보 링크 저장</button>
      <div style="height:14px"></div>

      <div class="d-section-title"><i class="ti ti-notes"></i> 관리자 메모</div>
      <textarea id="dAdminMemo" class="admin-memo-input" placeholder="예: 5월에 ○○님과 소개 → 애프터 없이 종료. 지인 소개로 등록됨.">${escHtml(c.admin_memo || '')}</textarea>
      <button class="btn soft" id="dMemoSaveBtn" style="margin-top:8px"><i class="ti ti-check"></i> 메모 저장</button>
      <div style="height:14px"></div>

      ${renderCandHistory(id)}
      ${renderRejectionSection(id)}
      <div style="height:14px"></div>

      <button class="btn ghost" id="dArchiveBtn">${c.archived ? '보류 해제하기' : '보류 처리하기'}</button>
      <p class="hint-text" style="margin:6px 0 0">${c.archived
        ? '지금은 보류 상태예요. 해제하면 추천·매칭 후보로 다시 나타납니다.'
        : '잠시 쉬어가는 분에게 쓰세요. 목록에는 그대로 남지만 추천 상대와 매칭 상대 고르기에서는 빠집니다. 언제든 되돌릴 수 있어요.'}</p>
      <div style="height:12px"></div>
      <button class="btn ghost" id="dBlacklistBtn" style="color:#C13515;border-color:#C13515">${c.blacklisted ? '블랙리스트 해제하기' : '블랙리스트 등록하기'}</button>
      <p class="hint-text" style="margin:6px 0 0">후보 목록에서 숨기고 추천·매칭에서도 완전히 제외해요. 블랙리스트 필터에서 다시 볼 수 있습니다.</p>
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
    if (!confirm(`'${c.name}' 후보를 삭제할까요?\n연결된 매칭 기록도 함께 삭제됩니다.`)) return;
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
    if (!c.blacklisted && !confirm(`'${c.name}' 님을 블랙리스트에 등록할까요?\n후보 목록·추천·매칭 상대에서 제외됩니다.`)) return;
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
      if (!confirm('이 거절 기록을 삭제할까요?')) return;
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
  if (c.job) L.push(`직업: ${c.job}${c.work_pattern ? ` (${c.work_pattern})` : ''}`);
  if (c.education) L.push(`학력: ${c.education}`);
  if (c.religion) L.push(`종교: ${c.religion}`);
  if (c.mbti) L.push(`MBTI: ${c.mbti}`);
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
    wrap.innerHTML = `<img class="photo-thumb" src="${p}" alt="">
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

function handleExcelFile(file) {
  if (typeof XLSX === 'undefined') return toast('엑셀 처리 모듈을 불러오지 못했어요. 인터넷 연결을 확인해 주세요');
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
        <div style="height:10px"></div>
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
function renderMatches() {
  const box = $('matchList');
  let list = DB.data.matches.slice();
  if (S.matchFilter !== 'all') list = list.filter(m => m.status === S.matchFilter);
  if (!list.length) {
    box.innerHTML = emptyHtml('해당하는 매칭이 없어요', '위의 [매칭 맺기] 버튼으로 두 사람을 이어주세요');
    return;
  }
  box.innerHTML = list.map(m => {
    const mc = candOf(m.male_id), fc = candOf(m.female_id);
    return `<div class="m-card" data-mid="${m.id}">
      <div class="m-pair">
        <div class="m-person">
          <div class="m-avatar">${mc && mc.photos && mc.photos[0] ? `<img src="${mc.photos[0]}">` : '<i class="ti ti-leaf"></i>'}</div>
          <div style="min-width:0"><div class="m-name">${escHtml(candName(m.male_id))}</div><div class="m-meta">${mc ? escHtml([ageLabel(mc), mc.job].filter(Boolean).join(' · ')) : ''}</div></div>
        </div>
        <i class="ti ti-heart m-heart"></i>
        <div class="m-person right">
          <div class="m-avatar f">${fc && fc.photos && fc.photos[0] ? `<img src="${fc.photos[0]}">` : '<i class="ti ti-flower"></i>'}</div>
          <div style="min-width:0"><div class="m-name">${escHtml(candName(m.female_id))}</div><div class="m-meta">${fc ? escHtml([ageLabel(fc), fc.job].filter(Boolean).join(' · ')) : ''}</div></div>
        </div>
      </div>
      ${m.memo ? `<div class="m-memo-preview"><i class="ti ti-note" style="font-size:13.5px"></i> ${escHtml(m.memo)}</div>` : ''}
      <div class="m-foot">
        <span class="m-date">${String(m.created_at).slice(0, 10).replace(/-/g, '.')} 시작</span>
        <span class="badge ${m.status}">${STATUS_LABEL[m.status]}</span>
      </div>
    </div>`;
  }).join('');
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
function renderTimeline(m) {
  const evs = [{ t: 'created', at: m.created_at }, ...(m.history || [])];
  return `<div class="d-section-title" style="margin-top:16px"><i class="ti ti-timeline-event"></i> 진행 타임라인</div>
  <div class="tl">${evs.map(ev => `
    <div class="tl-item"><div class="tl-dot ${ev.t === 'status' ? (ev.to || '') : ''}"></div>
      <div class="tl-body">
        <div class="tl-date">${fmtDateTime(ev.at)}</div>
        <div class="tl-text">${escHtml(ev.t === 'created' ? '매칭 시작' : ev.t === 'status' ? `상태 변경 → ${STATUS_LABEL[ev.to] || ev.to}` : ev.text || '')}</div>
      </div>
    </div>`).join('')}</div>`;
}

// 매칭 상세 위쪽의 두 사람 카드. 얼굴이나 이름을 누르면 그 사람 프로필이 열립니다.
function matchPersonHtml(c, cid, side) {
  const photo = c && c.photos && c.photos[0];
  const icon = side === 'f' ? 'flower' : 'leaf';
  const inner = photo ? `<img src="${escHtml(photo)}" alt="">` : `<i class="ti ti-${icon}"></i>`;
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
  S.matchDetailId = id;
  const mc = candOf(m.male_id), fc = candOf(m.female_id);
  const steps = ['exchanging', 'some', 'success', 'ended'];
  $('matchBody').innerHTML = `
    ${Trail.html()}
    <div class="m-pair big">
      ${matchPersonHtml(mc, m.male_id, 'm')}
      <i class="ti ti-heart m-heart"></i>
      ${matchPersonHtml(fc, m.female_id, 'f')}
    </div>
    <p class="m-date" style="text-align:center;margin-top:6px">${String(m.created_at).slice(0, 10).replace(/-/g, '.')} 시작</p>
    ${rejectionsBetween(m.male_id, m.female_id).map(r => `<div class="rej-warn"><i class="ti ti-heart-broken"></i><div><b>${escHtml(candName(r.from_id))}</b>님이 <b>${escHtml(candName(r.to_id))}</b>님을 거절 · ${escHtml(rejectLabel(r))}${r.reason ? `<br>${escHtml(r.reason)}` : ''}</div></div>`).join('')}
    <div class="status-steps">
      ${steps.map(s => `<button class="step ${m.status === s ? 'on ' + s : ''}" data-st="${s}">${STATUS_LABEL[s]}</button>`).join('')}
    </div>
    <div class="f-field">
      <label>진행 메모</label>
      <textarea id="matchMemoInput" placeholder="예: 사진 교환 완료, 이번 주말 첫 만남 예정">${escHtml(m.memo || '')}</textarea>
    </div>
    <div style="height:10px"></div>
    <button class="btn dark" id="matchMemoSaveBtn"><i class="ti ti-check"></i> 메모 저장</button>
    ${renderTimeline(m)}
    <div style="height:12px"></div>
    <button class="btn danger-soft" id="matchDelBtn"><i class="ti ti-trash"></i> 매칭 삭제</button>
  `;
  Trail.bind('matchBody');
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
    if (!confirm('이 매칭 기록을 삭제할까요?')) return;
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
      if (c.gender !== gender || c.archived || c.blacklisted) return false;
      if (S.pick[gender] === c.id) return true; // 이미 고른 사람은 검색어와 무관하게 계속 보여줌
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
      return `<div class="pick-item ${sel ? 'sel' : ''} ${gender === 'f' ? 'f-side' : ''}" data-pid="${c.id}">
        ${escHtml(c.name)}${busy ? ' <i class="ti ti-heart" style="font-size:12.5px;color:var(--orange)"></i>' : ''}${fitTag}${rej ? '<span class="rej-tag">거절 이력</span>' : ''}
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
    if (!confirm(`이 두 분은 이미 거절 이력이 있어요.\n\n${lines}\n\n그래도 이어줄까요?`)) return;
  }
  const busyM = activeMatchOf(S.pick.m), busyF = activeMatchOf(S.pick.f);
  if ((busyM || busyF) && !confirm('이미 진행 중인 매칭이 있는 후보가 포함돼 있어요. 그래도 이어줄까요?')) return;
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

function renderApplications() {
  const box = $('appList');
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
      ${photos.length ? `<div class="app-thumbs">${photos.slice(0, 3).map(p => `<img src="${p}" alt="">`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-aid]').forEach(el => {
    el.addEventListener('click', () => openAppDetail(parseInt(el.dataset.aid, 10)));
  });
}

function openAppDetail(id) {
  const a = DB.data.applications.find(x => x.id === id);
  if (!a) return;
  S.appDetailId = id;
  const photos = a.photos || [];
  const ideal = a.ideal || {};
  const consent = a.consent || {};
  const linked = a.candidate_id ? candOf(a.candidate_id) : null;

  $('appBody').innerHTML = `
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
      ${infoRow('briefcase', '직업', a.job + (a.work_pattern ? ` (${a.work_pattern})` : ''))}
      ${infoRow('school', '학력', a.education)}
      ${infoRow('building-church', '종교', a.religion)}
      ${infoRow('puzzle', 'MBTI', a.mbti)}
      ${infoRow('glass-full', '음주', a.drinking)}
      ${infoRow('smoking-no', '흡연', a.smoking)}
      ${infoRow('car', '자차', a.car)}
      ${infoRow('ball-tennis', '취미', a.hobbies)}
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

    <div class="d-section-title"><i class="ti ti-shield-check"></i> 동의 내역</div>
    <div class="consent-view">
      ${Object.keys(CONSENT_LABEL).map(k => `<span class="${consent[k] ? '' : 'no'}">${consent[k] ? '✓' : '✕'} ${CONSENT_LABEL[k]}</span>`).join('')}
    </div>
    <p class="hint-text">${consent.agreed_at ? escHtml(String(consent.agreed_at).slice(0, 16).replace('T', ' ')) + ' 동의' : '동의 시각 기록 없음'}${consent.version ? ` · 약관 ${escHtml(consent.version)}` : ''}</p>

    <div class="d-section-title"><i class="ti ti-notes"></i> 검토 메모</div>
    <textarea id="appMemo" class="admin-memo-input" placeholder="반려 사유나 확인한 내용을 적어두세요">${escHtml(a.review_memo || '')}</textarea>
    <div style="height:12px"></div>

    ${a.status === 'pending' ? `
      <button class="btn primary" id="appApproveBtn"><i class="ti ti-user-check"></i> 승인하고 후보로 등록</button>
      <div style="height:8px"></div>
      <button class="btn ghost" id="appRejectBtn"><i class="ti ti-user-x"></i> 반려 처리</button>
    ` : `
      ${linked ? `<button class="btn soft" id="appGoCandBtn"><i class="ti ti-user"></i> 등록된 후보 보기 (${escHtml(linked.name)})</button>`
               : a.status === 'approved' ? `<p class="hint-text">승인 처리됐지만 연결된 후보를 찾을 수 없어요 (삭제된 것 같아요)</p>` : ''}
      <div style="height:8px"></div>
      <button class="btn ghost" id="appReopenBtn"><i class="ti ti-rotate"></i> 대기 상태로 되돌리기</button>
    `}
    <div style="height:8px"></div>
    <button class="btn soft" id="appMemoSaveBtn"><i class="ti ti-check"></i> 메모만 저장</button>
    <div style="height:8px"></div>
    <button class="btn danger-soft" id="appDelBtn"><i class="ti ti-trash"></i> 신청서 삭제</button>
  `;

  Gal.mount(photos);

  $('appMemoSaveBtn').onclick = async () => {
    if (await DB.updateApplication(id, { review_memo: $('appMemo').value.trim() })) toast('메모가 저장되었어요');
  };
  const approveBtn = $('appApproveBtn'), rejectBtn = $('appRejectBtn');
  if (approveBtn) approveBtn.onclick = () => approveApplication(a);
  if (rejectBtn) rejectBtn.onclick = async () => {
    const memo = $('appMemo').value.trim();
    if (!confirm(`'${a.name}' 신청서를 반려할까요?\n후보로 등록되지 않습니다.`)) return;
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
    if (!confirm(`'${a.name}' 신청서를 완전히 삭제할까요?\n이미 후보로 등록된 경우 후보는 남습니다.`)) return;
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
    if (!confirm(`신청서 ${ids.length}건을 삭제할까요?\n\n${names}${more}\n\n되돌릴 수 없습니다.`)) return;

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
  if (dupe && !confirm(`'${a.name}'님과 같은 이름의 후보가 이미 있어요.\n그래도 새로 등록할까요?`)) return;

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
    if (!note && !confirm('주선자 코멘트 없이 올릴까요?\n\n캡처만 있으면 "감사 인사 모음"으로 보이고,\n코멘트가 있어야 "신경 써주는 곳"으로 읽혀요.')) return;
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
          <span class="rvm-stage ${escHtml(r.stage)}">${escHtml(RV_STAGE_LABEL[r.stage] || r.stage)}</span>
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
      if (!confirm('이 후기를 삭제할까요?\n캡처 파일도 함께 지워지고, 되돌릴 수 없습니다.')) return;
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
        <div class="filter-row" data-rvestage style="margin-bottom:8px">
          ${chip('success', '성사')}${chip('meet', '첫 만남 후')}${chip('progress', '진행 중')}${chip('etc', '기타')}
        </div>
        <div class="f-field"><textarea data-rvenote placeholder="주선자 코멘트">${escHtml(r.note || '')}</textarea></div>
        <div class="form-grid" style="margin:8px 0">
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
    // sort_order가 서로 같은 경우에도 확실히 자리가 바뀌도록, 목록 전체에 번호를 새로 매깁니다
    const order = list.map(r => r.id);
    [order[i], order[j]] = [order[j], order[i]];
    await Promise.all(order.map((rid, k) => DB.updateReview(rid, { sort_order: order.length - k })));
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
  if (!confirm(`${targets.length}명의 사진을 클라우드 스토리지로 옮길까요?\n(DB가 가벼워지고 로딩이 빨라져요)`)) return;
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
  return { added, addedM, addedR };
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const d = JSON.parse(e.target.result);
      if (!Array.isArray(d.candidates)) throw new Error('형식 오류');
      if (!confirm(`백업에 후보 ${d.candidates.length}명, 매칭 ${(d.matches || []).length}건, 거절 기록 ${(d.rejections || []).length}건이 있어요.\n서버의 기존 데이터에 추가(병합)합니다. 진행할까요?`)) return;
      toast('복원 중… 잠시만요');
      const r = await uploadDataset(d);
      renderAll();
      toast(`복원 완료: 후보 ${r.added}명, 매칭 ${r.addedM}건, 거절 ${r.addedR}건 추가`);
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
  if (confirm(`이 브라우저에 저장돼 있던 예전 데이터(후보 ${local.candidates.length}명)를 발견했어요.\n클라우드로 옮길까요?`)) {
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
  $('gate').classList.add('hidden');
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
  document.querySelectorAll('.bottom-nav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  syncBulkBar();   // 후보 탭을 벗어나면 일괄 작업 바 숨김
  window.scrollTo(0, 0);
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

// 사용자가 직접 닫은 경우(배경 누르기 · Esc · 아래로 끌어내리기).
// 화면 사이를 오갈 때 쓰는 closeModal과 달리, 여기서는 지나온 발자국도 함께 지웁니다.
function dismissModal(bg) {
  if (!bg) return;
  bg.classList.remove('open');
  if (bg.id === 'detailModal' || bg.id === 'matchModal') Trail.clear();
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

  // 통계 박스
  document.querySelectorAll('.stat-box').forEach(box => {
    box.addEventListener('click', () => {
      const st = box.dataset.stat;
      if (st === 'all') { S.statusFilter = null; switchView('candidates'); }
      else {
        S.matchFilter = st;
        document.querySelectorAll('#matchChips .chip').forEach(c => c.classList.toggle('active', c.dataset.ms === st));
        switchView('matches');
        renderMatches();
      }
    });
  });

  // 검색 / 필터
  $('searchInput').addEventListener('input', e => { S.search = e.target.value.trim(); renderCandidates(); });
  document.querySelectorAll('#genderChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.g === '__status') {
        const s = chip.dataset.s;
        S.statusFilter = S.statusFilter === s ? null : s;
        document.querySelectorAll('#genderChips .chip[data-g="__status"]').forEach(c => c.classList.toggle('active', c.dataset.s === S.statusFilter));
      } else {
        S.gender = chip.dataset.g;
        document.querySelectorAll('#genderChips .chip:not([data-g="__status"])').forEach(c => c.classList.toggle('active', c.dataset.g === S.gender));
      }
      renderCandidates();
    });
  });
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
  $('loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
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

  // 세션 확인 후 시작
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enterApp();
}

document.addEventListener('DOMContentLoaded', init);