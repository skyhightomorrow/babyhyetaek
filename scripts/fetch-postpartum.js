#!/usr/bin/env node
/**
 * 전국 산후조리원 수집 → data/postpartum.json (2026-09-13 신설)
 *
 * 출처: 공공데이터포털 「전국산후조리원표준데이터」(data.go.kr/data/15114131, 이용허락범위 제한 없음).
 *       실제 파일은 행정안전부 지방행정인허가(localdata) 「건강_산후조리업」 전국 파일로 제공된다.
 *       → https://file.localdata.go.kr/file/postpartum_care/info 의 「전국 파일 다운로드」 버튼과 같은 URL.
 *       로그인·API 키가 필요 없다(2026-09-13 실측: CSV 329KB · 1,022행 · 영업/정상 479곳).
 *
 * 왜 지역 페이지에 넣나: 복지로 지원사업 표는 "얼마 받나"에만 답하고 "어디로 가나"에는 답이 없다.
 *   산후조리비 지원 사업을 보고 들어온 사람이 바로 다음에 찾는 게 우리 동네 조리원 목록이다.
 *
 * ⚠️ 좌표는 공공데이터 원본(EPSG:5174 Bessel 중부원점 TM)을 proj4로 WGS84 변환한 것만 쓴다.
 *    카카오 지오코딩·로컬 API 결과는 약관상 저장이 안 되므로 절대 섞지 않는다. 좌표가 없으면 주소만 둔다(핀 없음).
 *
 * 사용:
 *   node scripts/fetch-postpartum.js                 # 다운로드 → 변환 → data/postpartum.json
 *   node scripts/fetch-postpartum.js --file 건강_산후조리업.csv   # 사람이 받은 파일로 (사이트가 막혔을 때)
 */
const fs = require('fs');
const path = require('path');
const proj4 = require('proj4');
const { SIDO_RENAME, normRegion } = require('./regions');

const OUT = path.join(__dirname, '..', 'data', 'postpartum.json');
const PAGE = 'https://file.localdata.go.kr/file/postpartum_care/info';
const URL = 'https://file.localdata.go.kr/file/download/postpartum_care/info';
// 브라우저가 아닌 요청(UA·Accept-Language 없음)은 403으로 막힌다(2026-09-13 실측) — 브라우저와 같은 헤더를 보낸다.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  Accept: 'text/csv,text/html,*/*;q=0.8',
  Referer: PAGE,
};

// 원본 좌표계: 「보정계수 안들어간 Bessel 중부원점TM(EPSG:5174)」 — 파일 안내문 그대로.
// towgs84 7변수는 국토지리정보원 고시값. 이게 빠지면 전국이 수백 m씩 한쪽으로 밀린다.
proj4.defs('EPSG:5174', '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43');
const toWgs = proj4('EPSG:5174', 'WGS84');

// 한국 영역(독도·마라도 포함). 이 밖으로 떨어지면 원본 좌표 오류로 보고 핀을 버린다.
const BBOX = { latMin: 33.0, latMax: 38.7, lngMin: 124.5, lngMax: 132.0 };

// 최소 정상치 — 실측 영업/정상 479곳. 소스가 반쪽 응답을 줘도 기존 파일을 덮지 않도록 한다.
// (복지로에서 시도가 통째로 빠진 2026-08-01 사고와 같은 유형을 막는 장치 — build-local.js 주석 참고)
const MIN_OPERATING = 300;
const MAX_DROP = 0.3; // 직전 파일 대비 30% 넘게 줄면 결손으로 본다

const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argFile = (() => { const i = process.argv.indexOf('--file'); return i > -1 ? process.argv[i + 1] : null; })();

async function download() {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      // 사이트 버튼이 다운로드 전에 부르는 횟수 검증 — 과다 호출(429)이면 여기서 멈춘다
      const v = await fetch('https://file.localdata.go.kr/file/validate/download-count', { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (v.status === 429) throw new Error('다운로드 횟수 제한(429) — 잠시 후 재시도');
      const res = await fetch(URL, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/csv/i.test(type)) throw new Error(`HTTP ${res.status} ${type}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

// 인코딩: 응답 헤더는 UTF-8이라고 하지만 실제 본문은 CP949(EUC-KR)다(2026-09-13 실측).
// UTF-8로 먼저 읽어 보고 깨짐 문자(U+FFFD)가 있으면 EUC-KR로 다시 읽는다 — 어느 날 진짜 UTF-8로 바뀌어도 안 깨진다.
function decode(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  if (!u.includes('�')) return u.replace(/^﻿/, '');
  return new TextDecoder('euc-kr').decode(buf);
}

// 따옴표 안 쉼표가 있는 주소("…로 174, 창경빌딩 2,3,4층")가 있어 단순 split 불가
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// 전화번호 원본은 하이픈이 없다(027383335). 지역번호 규칙대로 끊어 보여준다.
function fmtTel(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d || /^0+$/.test(d)) return null;
  if (/^1\d{7}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;          // 1588-xxxx
  if (/^02\d{7,8}$/.test(d)) return `02-${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
  if (/^0\d{2}\d{7,8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
  return null; // 자릿수가 안 맞으면 버튼을 만들지 않는다(잘못 걸리는 전화가 더 나쁘다)
}

// ── 지역 정규화 ──
// 원본 주소는 이미 개편명(전남광주통합특별시·서해구·검단구·화성시 동탄구)으로 들어온다(2026-09-13 실측).
// 그래도 옛 이름이 섞인 행이 오면 regions.js 규칙으로 현행명에 맞춘다.
const OLD_SIDO = { 강원도: '강원특별자치도', 전라북도: '전북특별자치도', 제주도: '제주특별자치도' };
// 인천 중구·서구는 한 구가 둘로 갈렸다 — 옛 주소만으로는 동(洞) 이름으로만 가를 수 있다.
const YEONGJONG_DONG = /(영종|운서|운남|운북|중산|을왕|남북|덕교|무의|용유)동/;
const GEOMDAN_DONG = /(검단|마전|당하|원당|불로|대곡|오류|왕길|금곡)동/;

function regionFromAddr(addr) {
  const t = String(addr || '').trim().split(/\s+/);
  if (t.length < 2) return null;
  let sido = OLD_SIDO[t[0]] || SIDO_RENAME[t[0]] || t[0];
  if (!/(특별시|광역시|특별자치시|특별자치도|통합특별시|도)$/.test(sido)) return null;
  // 세종은 시군구가 없다 — 사이트 전체가 세종 자체를 지역 단위로 쓴다(build-local.js와 같은 규칙)
  if (sido === '세종특별자치시') return { sido, sgg: '세종특별자치시' };
  let sgg = t[1];
  if (!/[시군구]$/.test(sgg)) return null; // 「서울특별시 남부순환로 …」처럼 구가 빠진 주소
  if (sido === '인천광역시' && sgg === '중구') sgg = YEONGJONG_DONG.test(addr) ? '영종구' : '제물포구';
  if (sido === '인천광역시' && sgg === '서구' && GEOMDAN_DONG.test(addr)) sgg = '검단구';
  // 사이트의 지역 단위는 시(市)다 — 「수원시 영통구」·「화성시 동탄구」의 일반구는 시로 접는다
  if (/시$/.test(sgg)) return { sido, sgg };
  const n = normRegion(t[0] in SIDO_RENAME ? t[0] : sido, sgg);
  return { sido: SIDO_RENAME[n.sido] || n.sido, sgg: n.sgg };
}

(async () => {
  const buf = argFile ? fs.readFileSync(argFile) : await download();
  const rows = parseCsv(decode(buf));
  const H = rows[0].map((h) => h.trim());
  const col = (name) => {
    const i = H.indexOf(name);
    if (i < 0) throw new Error(`컬럼 없음: ${name} — 원본 서식이 바뀌었을 수 있음 (헤더: ${H.join(',')})`);
    return i;
  };
  const C = {
    org: col('개방자치단체코드'), id: col('관리번호'), status: col('영업상태명'), nm: col('사업장명'),
    road: col('도로명주소'), jibun: col('지번주소'), tel: col('전화번호'),
    x: col('좌표정보(X)'), y: col('좌표정보(Y)'), cap: col('임산부정원수'), upd: col('데이터갱신시점'),
  };
  const data = rows.slice(1).filter((r) => r.length === H.length);
  const broken = rows.length - 1 - data.length;

  // 영업상태명: 영업/정상 · 휴업 · 폐업 · 취소/말소/만료/정지/중지 · 제외/삭제/전출 — 지금 문 연 곳만 쓴다
  const operating = data.filter((r) => r[C.status].trim() === '영업/정상');

  // 주소에서 지역이 안 잡히는 행은 같은 개방자치단체코드의 다른 행이 가장 많이 가진 지역으로 채운다
  const orgVotes = {};
  for (const r of data) {
    const g = regionFromAddr(r[C.road]) || regionFromAddr(r[C.jibun]);
    if (!g) continue;
    const k = `${g.sido}|${g.sgg}`;
    const v = (orgVotes[r[C.org]] = orgVotes[r[C.org]] || {});
    v[k] = (v[k] || 0) + 1;
  }
  const byOrg = (code) => {
    const v = orgVotes[code];
    if (!v) return null;
    const [k] = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
    const [sido, sgg] = k.split('|');
    return { sido, sgg };
  };

  let noRegion = 0, outOfBox = 0;
  const items = [];
  for (const r of operating) {
    const addr = (r[C.road] || r[C.jibun]).replace(/\s+/g, ' ').trim();
    const g = regionFromAddr(r[C.road]) || regionFromAddr(r[C.jibun]) || byOrg(r[C.org]);
    if (!g) { noRegion++; continue; }
    const x = parseFloat(r[C.x]), y = parseFloat(r[C.y]);
    let lat = null, lng = null;
    if (isFinite(x) && isFinite(y) && x > 0 && y > 0) {
      const [lo, la] = toWgs.forward([x, y]);
      if (la >= BBOX.latMin && la <= BBOX.latMax && lo >= BBOX.lngMin && lo <= BBOX.lngMax) {
        lat = Math.round(la * 1e6) / 1e6;
        lng = Math.round(lo * 1e6) / 1e6;
      } else outOfBox++;
    }
    const cap = parseInt(r[C.cap], 10);
    items.push({
      id: r[C.id], nm: r[C.nm].trim(), sido: g.sido, sgg: g.sgg, addr,
      tel: fmtTel(r[C.tel]), cap: isFinite(cap) && cap > 0 ? cap : null, lat, lng,
    });
  }
  items.sort((a, b) => a.sido.localeCompare(b.sido) || a.sgg.localeCompare(b.sgg) || a.nm.localeCompare(b.nm));

  // ── 좌표 검증: 같은 시군구 중앙값에서 25km 넘게 떨어진 핀 = 주소와 좌표가 어긋난 의심 행 ──
  const km = (a, b) => {
    const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const med = (arr) => { const s = arr.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const groups = {};
  for (const it of items) if (it.lat != null) (groups[`${it.sido}|${it.sgg}`] = groups[`${it.sido}|${it.sgg}`] || []).push(it);
  const outliers = [];
  for (const list of Object.values(groups)) {
    if (list.length < 3) continue; // 1~2곳이면 중앙값이 의미 없다
    const c = { lat: med(list.map((i) => i.lat)), lng: med(list.map((i) => i.lng)) };
    for (const it of list) { const d = km(c, it); if (d > 25) outliers.push({ nm: it.nm, region: `${it.sido} ${it.sgg}`, km: Math.round(d) }); }
  }

  const withCoords = items.filter((i) => i.lat != null).length;
  const sourceUpdatedAt = data.map((r) => r[C.upd].slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() || null;

  // ── 결손 가드: 비정상 응답이면 기존 파일을 덮지 않고 실패로 끝낸다 ──
  let prevCount = 0;
  try { prevCount = JSON.parse(fs.readFileSync(OUT, 'utf8')).items.length; } catch { /* 첫 수집 */ }
  if (items.length < MIN_OPERATING || (prevCount && items.length < prevCount * (1 - MAX_DROP))) {
    console.error(`🔴 [fetch-postpartum] 결과 ${items.length}곳(직전 ${prevCount}곳) — 결손 의심, data/postpartum.json 유지`);
    process.exit(1);
  }

  // 내용이 그대로면 쓰지 않는다 — daily.yml이 매일 돌 때 fetchedAt만 바뀐 파일이 매일 커밋되는 것을 막는다
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (prev.sourceUpdatedAt === sourceUpdatedAt && JSON.stringify(prev.items) === JSON.stringify(items)) {
      console.log(`[fetch-postpartum] 변경 없음(원본 기준일 ${sourceUpdatedAt}, ${items.length}곳) — data/postpartum.json 유지`);
      return;
    }
  } catch { /* 첫 수집 */ }

  const out = {
    fetchedAt: todayKST(),
    sourceUpdatedAt,
    source: '공공데이터포털 전국산후조리원표준데이터(지방행정인허가 건강_산후조리업)',
    counts: { raw: data.length, operating: operating.length, kept: items.length, withCoords },
    items,
  };
  // 원자적 쓰기 — 중간에 죽어도 반쯤 쓰인 JSON이 남지 않게 임시 파일에 쓴 뒤 rename
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, OUT);

  const sggWith = Object.keys(groups).length;
  console.log(`[fetch-postpartum] 원본 ${data.length}행(깨진 행 ${broken}) · 영업/정상 ${operating.length} · 저장 ${items.length}(지역 미상 제외 ${noRegion}) · 좌표 ${withCoords}(영역 밖 ${outOfBox}) · 시군구 ${sggWith}곳 → data/postpartum.json (${(JSON.stringify(out).length / 1024).toFixed(0)}KB)`);
  console.log(`[fetch-postpartum] 원본 기준일 ${sourceUpdatedAt} · 시군구 중앙값 25km 초과 의심 ${outliers.length}건${outliers.length ? ': ' + outliers.map((o) => `${o.nm}(${o.region} ${o.km}km)`).join(', ') : ''}`);
})().catch((e) => {
  console.error(`🔴 [fetch-postpartum] 실패 — data/postpartum.json 유지: ${e.message}`);
  process.exit(1);
});
