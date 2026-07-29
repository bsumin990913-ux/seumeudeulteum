/* ═══════════════════════════════════════
   스며들틈 — 관리자 도구 v3 (Supabase 클라우드 + 스토리지)
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
  data: { candidates: [], matches: [], rejections: [], applications: [] },

  async init() {
    const [c, m, r, a] = await Promise.all([
      sb.from('candidates').select('*').order('id', { ascending: false }),
      sb.from('matches').select('*').order('id', { ascending: false }),
      sb.from('rejections').select('*').order('id', { ascending: false }),
      sb.from('applications').select('*').order('id', { ascending: false })
    ]);
    if (c.error || m.error) throw (c.error || m.error);
    this.data.candidates = c.data || [];
    this.data.matches = m.data || [];
    // 아래 두 테이블은 업그레이드 SQL을 아직 안 돌렸을 수 있으므로, 없으면 빈 목록으로 진행
    if (r.error) { console.warn('[DB] rejections 테이블 없음 — upgrade_v4.sql을 실행해 주세요', r.error); this.data.rejections = []; }
    else this.data.rejections = r.data || [];
    if (a.error) { console.warn('[DB] applications 테이블 없음 — upgrade_v5.sql을 실행해 주세요', a.error); this.data.applications = []; }
    else this.data.applications = a.data || [];
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
  regMode: 'paste',
  editingId: null,
  formPhotos: [],
  matchFilter: 'all',
  appFilter: 'pending',
  appDetailId: null,
  detailId: null,
  matchDetailId: null,
  pick: { m: null, f: null },
  excelRows: null
};

// ═══════════════════════════════════════
//  파생 정보
// ═══════════════════════════════════════
const STATUS_LABEL = { candidate: '대기중', exchanging: '사진교환', some: '썸', success: '성사', ended: '종료', archived: '보류' };

function activeMatchOf(cid) {
  return DB.data.matches.find(m => (m.male_id === cid || m.female_id === cid) && m.status !== 'ended');
}
function candStatus(c) {
  const m = activeMatchOf(c.id);
  if (m) return m.status;
  return c.archived ? 'archived' : 'candidate';
}
function candName(id) {
  const c = DB.data.candidates.find(x => x.id === id);
  return c ? c.name : '(삭제됨)';
}
function candOf(id) { return DB.data.candidates.find(x => x.id === id); }

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
function storagePathsOf(photos) {
  return (photos || []).map(p => {
    const m = String(p).match(/\/storage\/v1\/object\/public\/photos\/(.+)$/);
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
    if (S.statusFilter === 'candidate' && candStatus(c) !== 'candidate') return false;
    if (S.statusFilter === 'matched' && !activeMatchOf(c.id)) return false;
    if (q) {
      const hay = [c.name, c.job, c.region, c.description, c.personality, c.hobbies, c.mbti, c.education, c.religion, c.admin_memo].join(' ').toLowerCase();
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
    return b.id - a.id;
  });
  return list;
}

function emptyHtml(text, sub) {
  return `<div class="empty">
    <svg width="64" height="64" viewBox="0 0 64 64"><path d="M32 6C48 6 58 18 58 34C58 50 46 58 32 58C18 58 6 50 6 34C6 18 16 6 32 6Z" fill="#E8F0CB"/><circle cx="24" cy="30" r="3" fill="#415111"/><circle cx="40" cy="30" r="3" fill="#415111"/><path d="M26 42Q32 38 38 42" stroke="#415111" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>
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
  if (S.listMode === 'album') {
    box.innerHTML = `<div class="album-grid">` + list.map(c => {
      const st = candStatus(c);
      const photo = c.photos && c.photos[0];
      return `<div class="a-card ${pinned.includes(c.id) ? 'pinned' : ''}" data-id="${c.id}">
        <div class="a-photo ${c.gender === 'm' ? 'male' : ''}">
          ${photo ? `<img src="${photo}" alt="">` : `<i class="ti ti-${c.gender === 'm' ? 'leaf' : 'flower'}"></i>`}
          <span class="badge ${st}">${STATUS_LABEL[st]}</span>
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
      return `<div class="c-card ${pinned.includes(c.id) ? 'pinned' : ''}" data-id="${c.id}">
        <div class="c-row">
          ${avatarHtml(c, 'c-avatar')}
          <div class="c-info">
            <div class="c-name">${escHtml(c.name)} ${pinned.includes(c.id) ? '<i class="ti ti-star-filled pin-star"></i>' : ''} <span class="c-meta">${escHtml(metaLine(c))}</span></div>
            <div class="c-sub">${escHtml(subLine(c))}</div>
          </div>
          <span class="badge ${st}">${STATUS_LABEL[st]}</span>
        </div>
      </div>`;
    }).join('');
  }
  box.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => openDetail(parseInt(el.dataset.id, 10)));
  });
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
    t.gender !== c.gender && !t.archived && !activeMatchOf(t.id) && !rejectionsBetween(c.id, t.id).length);
  const scored = targets.map(t => Object.assign({ t }, matchScore(c, t)))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (!scored.length) return '';
  return `<div class="d-section-title"><i class="ti ti-sparkles"></i> 추천 상대</div>` + scored.map(x => `
    <div class="reco-item" data-rid="${x.t.id}">
      ${avatarHtml(x.t, 'c-avatar')}
      <div style="min-width:0;flex:1">
        <div style="font-size:14px;font-weight:700">${escHtml(x.t.name)} <span class="c-meta">${escHtml(metaLine(x.t))}</span></div>
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

  openForMatch(m, memoNow) {
    this.mode = 'match';
    this.matchId = m.id;
    this.memo = memoNow || '';
    this.left = candOf(m.male_id);
    this.right = candOf(m.female_id);
    this.after = () => { openMatchDetail(m.id); renderAll(); };
    this._open('매칭 종료', true);
  },

  openForCandidate(c) {
    this.mode = 'direct';
    this.matchId = null;
    this.memo = '';
    this.left = c;
    this.right = null;
    this.after = () => { openDetail(c.id); renderCandidates(); };
    this._open('거절 기록 추가', false);
  },

  _open(title, isMatch) {
    this.who = null;
    this.stage = 'profile';
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
    const list = DB.data.candidates.filter(c => c.gender !== this.left.gender);
    if (!list.length) {
      box.innerHTML = `<div style="padding:16px;text-align:center;font-size:12px;color:var(--gray-mid)">상대로 고를 후보가 없어요</div>`;
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

function openDetail(id) {
  const c = candOf(id);
  if (!c) return;
  S.detailId = id;
  const st = candStatus(c);
  const pinnedNow = Pin.has(id);
  const photos = c.photos || [];
  const ideal = c.ideal || {};
  const hobbies = (c.hobbies || '').split(/[,、·\/]/).map(s => s.trim()).filter(Boolean);
  const activeM = activeMatchOf(id);

  $('detailBody').innerHTML = `
    ${photos.length
      ? Gal.html(photos)
      : `<div class="d-nophoto"><i class="ti ti-${c.gender === 'm' ? 'leaf' : 'flower'}"></i>등록된 사진이 없어요</div>`}
    <div class="d-head">
      <span class="d-name">${escHtml(c.name)}</span>
      <span class="badge ${st}">${STATUS_LABEL[st]}</span>
      <button class="icon-btn" id="dPinBtn" style="margin-left:auto;background:var(--gray-bg);color:${pinnedNow ? '#E9B949' : 'var(--gray-mid)'}"><i class="ti ti-star${pinnedNow ? '-filled' : ''}"></i></button>
    </div>
    <div class="d-headline">${escHtml([c.birth_year ? c.birth_year + '년생' : '', c.height ? c.height + 'cm' : '', c.body_type, c.region].filter(Boolean).join(' · '))}</div>

    <div class="d-actions">
      <button class="d-act" id="dCopyBtn"><i class="ti ti-copy"></i>정보 복사</button>
      <button class="d-act" id="dPhotoBtn"><i class="ti ti-photo-down"></i>사진 저장</button>
      <button class="d-act accent" id="dEditBtn"><i class="ti ti-edit"></i>수정</button>
      <button class="d-act" id="dDelBtn" style="color:#A32D2D"><i class="ti ti-trash"></i>삭제</button>
    </div>

    <table class="info-table">
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

    ${renderCandHistory(id)}
    ${renderRejectionSection(id)}
    <div style="height:14px"></div>

    <div class="d-section-title"><i class="ti ti-notes"></i> 관리자 메모</div>
    <textarea id="dAdminMemo" class="admin-memo-input" placeholder="예: 5월에 ○○님과 소개 → 애프터 없이 종료. 지인 소개로 등록됨.">${escHtml(c.admin_memo || '')}</textarea>
    <button class="btn soft" id="dMemoSaveBtn" style="margin-top:8px"><i class="ti ti-check"></i> 메모 저장</button>
    <div style="height:14px"></div>

    ${renderRecoSection(c)}
    <div style="height:6px"></div>

    ${activeM
      ? `<button class="btn soft" id="dGoMatchBtn"><i class="ti ti-heart"></i> 진행 중인 매칭 보기 (${escHtml(candName(activeM.male_id))} ♥ ${escHtml(candName(activeM.female_id))})</button>`
      : `<button class="btn primary" id="dMatchBtn"><i class="ti ti-heart-plus"></i> 매칭 맺어주기</button>`}
    <div style="height:8px"></div>
    <button class="btn ghost" id="dArchiveBtn">${c.archived ? '보류 해제하기' : '보류 처리하기'}</button>
  `;

  Gal.mount(photos);
  $('dPinBtn').onclick = () => { Pin.toggle(id); openDetail(id); renderCandidates(); };
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
    openDetail(id);
    renderCandidates();
  };
  const goM = $('dGoMatchBtn'), newM = $('dMatchBtn');
  if (goM) goM.onclick = () => { closeModal('detailModal'); openMatchDetail(activeM.id); };
  if (newM) newM.onclick = () => { closeModal('detailModal'); openCreateMatch(c); };

  // 관리자 메모 저장
  $('dMemoSaveBtn').onclick = async () => {
    const r = await DB.updateCandidate(id, { admin_memo: $('dAdminMemo').value.trim() });
    if (r) toast('관리자 메모가 저장되었어요');
  };
  // 매칭 기록 → 해당 매칭 상세로
  $('detailBody').querySelectorAll('.cand-hist').forEach(el => {
    el.addEventListener('click', () => { closeModal('detailModal'); openMatchDetail(parseInt(el.dataset.hmid, 10)); });
  });
  // 거절 기록: 카드 클릭 → 상대 프로필 / × → 기록 삭제 / 추가 버튼
  $('dRejAddBtn').onclick = () => { closeModal('detailModal'); Rej.openForCandidate(c); };
  $('detailBody').querySelectorAll('.rej-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.rej-del')) return;
      openDetail(parseInt(el.dataset.rother, 10));
    });
  });
  $('detailBody').querySelectorAll('.rej-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('이 거절 기록을 삭제할까요?')) return;
      if (!(await DB.deleteRejection(parseInt(btn.dataset.rdel, 10)))) return;
      openDetail(id);
      toast('기록이 삭제되었어요');
    });
  });
  // 추천 상대: 카드 클릭 → 그 사람 상세 / 하트 → 바로 매칭 맺기
  $('detailBody').querySelectorAll('.reco-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.reco-link')) return;
      openDetail(parseInt(el.dataset.rid, 10));
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
  L.push('[스며들틈 프로필]');
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
    a.download = `스며들틈_${c.name}_${i + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
  toast(`사진 ${photos.length}장이 저장되었어요`);
}

// ═══════════════════════════════════════
//  등록 / 수정 폼
// ═══════════════════════════════════════
const FORM_IDS = ['fName','fBirth','fHeight','fBody','fRegion','fJob','fWork','fEdu','fReligion','fMbti','fDrink','fSmoke','fCar','fHobby','fPersonality','fDesc','iAge','iHeight','iRegion','iPriority','iJobsPref','iJobsAvoid','iNote'];
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

function compressImageBlob(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          const r = Math.min(MAX / w, MAX / h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cv.toBlob(b => resolve(b), 'image/jpeg', 0.82);
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
const XL_HEADERS = ['이름','성별(남/여)','출생연도','키','체형','거주지','직업','근무형태','학력','종교','MBTI','음주','흡연','자차','취미','성격','특징','이상형나이','이상형키','이상형지역','중요순위','선호직업','기피직업','이상형기타'];

function downloadTemplate() {
  const example = ['봄이','여','1997','160','마른체형','대구 북구','간호사','평일 9to6 고정','전문대졸','기독교','ISFP','월 1-2회','비흡연','없음 (면허 있음)','러닝, 필라테스, 독서','낯가리지만 친해지면 엉뚱함','','연하2~연상4 (연상선호)','175cm 이상','대구, 경북','성격 > 직업안정성 > 경제력','소방관, 전문직, 공무원','간호사, 자영업, 프리랜서','다정다감하고 자상한 사람'];
  const csv = '﻿' + XL_HEADERS.join(',') + '\n' + example.map(v => `"${v}"`).join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '스며들틈_등록양식.csv';
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
          body_type: get(row, '체형'), region: get(row, '거주지'),
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
          ${skipped.length ? `<span style="font-size:12px;color:var(--peach-mid)">이름/성별 누락 ${skipped.length}행 제외</span>` : ''}
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
      ${m.memo ? `<div class="m-memo-preview"><i class="ti ti-note" style="font-size:12px"></i> ${escHtml(m.memo)}</div>` : ''}
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

function openMatchDetail(id) {
  const m = DB.data.matches.find(x => x.id === id);
  if (!m) return;
  S.matchDetailId = id;
  const mc = candOf(m.male_id), fc = candOf(m.female_id);
  const steps = ['exchanging', 'some', 'success', 'ended'];
  $('matchBody').innerHTML = `
    <div class="m-pair" style="margin-bottom:4px">
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
    <div style="height:8px"></div>
    <div class="btn-row">
      ${mc ? `<button class="btn ghost" id="matchViewM">남자 프로필</button>` : ''}
      ${fc ? `<button class="btn ghost" id="matchViewF">여자 프로필</button>` : ''}
    </div>
    <div style="height:8px"></div>
    <button class="btn danger-soft" id="matchDelBtn"><i class="ti ti-trash"></i> 매칭 삭제</button>
  `;
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
      openMatchDetail(id);
      renderAll();
      if (st === 'success') toast('축하해요, 성사되었어요!');
    });
  });
  $('matchMemoSaveBtn').onclick = async () => {
    const memoNow = $('matchMemoInput').value.trim();
    const hist = [...(m.history || [])];
    if (memoNow && memoNow !== (m.memo || '')) hist.push({ t: 'memo', text: memoNow, at: nowStr() });
    if (!(await DB.updateMatch(id, { memo: memoNow, history: hist }))) return;
    openMatchDetail(id);
    renderMatches();
    toast('메모가 저장되었어요');
  };
  const vm = $('matchViewM'), vf = $('matchViewF');
  if (vm) vm.onclick = () => { closeModal('matchModal'); openDetail(m.male_id); };
  if (vf) vf.onclick = () => { closeModal('matchModal'); openDetail(m.female_id); };
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
  renderPickLists();
  openModal('createMatchModal');
}

function renderPickLists() {
  const render = (gender, boxId) => {
    const box = $(boxId);
    const list = DB.data.candidates.filter(c => c.gender === gender && !c.archived);
    if (!list.length) {
      box.innerHTML = `<div style="padding:16px;text-align:center;font-size:12px;color:var(--gray-mid)">등록된 ${gender === 'm' ? '남자' : '여자'} 후보가 없어요</div>`;
      return;
    }
    const otherPick = S.pick[gender === 'm' ? 'f' : 'm'];
    box.innerHTML = list.map(c => {
      const busy = activeMatchOf(c.id);
      const sel = S.pick[gender] === c.id;
      // 반대편에서 고른 사람과 거절 이력이 있으면 표시
      const rej = otherPick ? rejectionsBetween(c.id, otherPick).length : 0;
      return `<div class="pick-item ${sel ? 'sel' : ''} ${gender === 'f' ? 'f-side' : ''}" data-pid="${c.id}">
        ${escHtml(c.name)}${busy ? ' <i class="ti ti-heart" style="font-size:11px;color:var(--orange)"></i>' : ''}${rej ? '<span class="rej-tag">거절 이력</span>' : ''}
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
      ${a.phone ? `<div class="app-sub">${escHtml(a.phone)}</div>` : ''}
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

// 신청서 → 후보 등록
async function approveApplication(a) {
  if (a.status !== 'pending') return;
  const dupe = DB.data.candidates.find(c => c.name === a.name && c.gender === a.gender && (a.phone ? c.phone === a.phone : true));
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
    phone: a.phone || '', source: 'apply',
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
  a.download = `스며들틈_백업_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
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
  window.scrollTo(0, 0);
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function renderAll() {
  renderStats();
  renderCandidates();
  renderMatches();
  renderApplications();
  renderAppBadge();
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
  $('viewToggle').innerHTML = `<i class="ti ti-${S.listMode === 'list' ? 'layout-grid' : 'list'}"></i>`;

  // 등록
  document.querySelectorAll('#regTabs .seg-tab').forEach(btn => {
    btn.addEventListener('click', () => setRegMode(btn.dataset.mode));
  });
  $('parseBtn').addEventListener('click', runParse);
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

  // 거절 기록 모달
  document.querySelectorAll('#rejStage .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      Rej.stage = chip.dataset.st;
      document.querySelectorAll('#rejStage .chip').forEach(c => c.classList.toggle('active', c === chip));
    });
  });
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
    bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); });
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
      if (opens.length) opens[opens.length - 1].classList.remove('open');
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
        bg.classList.remove('open');
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