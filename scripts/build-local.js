#!/usr/bin/env node
/**
 * data/benefits.json → public/local-benefits.js
 * 시도>시군구 트리로 그룹핑, 육아/출산 관련 서비스만, 금액문구 정제.
 * 상세 미확보(detail=null)도 목록 필드로 노출(제목·요약·링크는 있음).
 */
const fs = require('fs');
const path = require('path');
const { normRegion, isCommonKey, PENDING_SGG } = require('./regions');

const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'benefits.json'), 'utf8'));

// 육아·출산과 무관한 노이즈 제외(장애인·저소득 일반·노인 등 성인 대상이 섞여 옴)
// 2026-09-07: 「아이」 누락으로 14건이 통째로 빠져 있었다(「아픈아이 병원동행」·「아이맘 교통비」 등).
// 광주 광산구는 자체 사업이 그 1건뿐이라 지역 페이지 자체가 안 만들어지고 있었다.
// 전수 확인 결과 편입 14건 모두 육아 관련이고 오탐은 0건이었다.
const INCLUDE = /출산|출생|산후|산모|임신|임산부|난임|육아|양육|보육|어린이집|유아|아동|영유아|기저귀|분유|첫만남|다자녀|입학|돌봄|모유|태아|아이/;
const EXCLUDE = /노인|어르신|경로|장애인\s*활동|중증장애|한부모.*자립정착|성인|청년\s*월세|어업|농업인?\s*수당|귀농/;

function cleanAmt(s) {
  if (!s) return null;
  return s
    .replace(/&#13;|&#10;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

const bySido = {};
let kept = 0;
for (const s of src.items) {
  if (!INCLUDE.test(s.servNm)) continue;
  if (EXCLUDE.test(s.servNm)) continue;
  const rawSido = s.ctpv || '기타';
  // 세종은 시군구가 없어 서비스 sgg가 비어있음 → 세종 자체를 지역 단위로
  const rawSgg = s.sgg || (s.ctpv === '세종특별자치시' ? '세종특별자치시' : '(광역 공통)');
  // 2026-07-01 개편명으로 통일 — 홈 위저드 선택지와 /r/ 지역 페이지의 지역명이 어긋나지 않게 한다
  const { sido, sgg } = normRegion(rawSido, rawSgg);
  bySido[sido] = bySido[sido] || {};
  bySido[sido][sgg] = bySido[sido][sgg] || [];
  bySido[sido][sgg].push({
    id: s.servId,
    nm: s.servNm,
    dgst: cleanAmt(s.dgst),
    amt: s.detail ? cleanAmt(s.detail.benefit) : null,
    how: s.detail ? cleanAmt(s.detail.how) : null,
    law: s.detail && s.detail.laws && s.detail.laws[0] ? s.detail.laws[0] : null,
    since: s.detail ? s.detail.since : null,
    mod: s.lastMod || (s.detail && s.detail.lastMod) || null,
    link: s.link,
    hot: s.inqNum || 0,
    // 2026-08-17 추가 — 아래 4개는 원본이 100% 갖고 있는데도 여태 페이지에 한 번도 안 나갔다.
    // /r/ 조건 표와 집계 문장의 재료다(scripts/_local-stats.js).
    pvsn: s.pvsn || null,          // 지급수단: 현금지급 / 지역화폐 / 현물지급 / 바우처 …
    cyc: s.cyc || null,            // 주기: 1회성 / 월 / 년 …
    aply: s.aply || null,          // 신청방식: 방문 / 인터넷 …
    crit: s.detail ? cleanAmt(s.detail.crit) : null,   // 소득기준 (표 컬럼 전용 — 집계 문장 금지, 지역 간 편차 없음)
    target: s.detail ? cleanAmt(s.detail.target) : null,
    tel: s.detail && s.detail.contacts && s.detail.contacts[0] ? cleanAmt(s.detail.contacts[0]) : null,
  });
  kept++;
}

// ── 수동 큐레이션 병합 (2026-09-07) ──
// 복지로에 아예 등재되지 않은 시군구 자체 출산지원금을 손으로 채운다.
// 🔴 목포시가 계기다 — 첫째 150만원~다섯째 550만원을 실제로 주는데 복지로에는 시 자체 사업이 2건뿐이라
//    페이지 금액이 0원이었고, 네이버 「목포 출산지원금」이 노출 100건에 CTR 1.0%로 최하위였다.
//    즉 순위 문제가 아니라 **찾는 숫자가 페이지에 없는 것**이 원인이었다.
const MANUAL_FILE = path.join(__dirname, '..', 'data', 'local-manual.json');
let manualCount = 0;
if (fs.existsSync(MANUAL_FILE)) {
  const manual = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8'));
  for (const it of manual.items || []) {
    const [rawSido, rawSgg] = String(it.region || '').split('|');
    if (!rawSido || !rawSgg) { console.warn(`[build-local] ⚠️ 수동 항목 region이 「시도|시군구」 형식이 아님: ${it.id}`); continue; }
    const { sido, sgg } = normRegion(rawSido, rawSgg);
    const bucket = (bySido[sido] = bySido[sido] || {});
    const arr = (bucket[sgg] = bucket[sgg] || []);
    if (arr.some((x) => x.id === it.id)) continue;
    // 복지로에 같은 사업이 뒤늦게 등재되면 표에 두 번 나온다. 이름이 겹치면 사람이 확인하도록 경고만 낸다.
    const dup = arr.find((x) => x.nm && it.nm && (x.nm.includes(it.nm) || it.nm.includes(x.nm)));
    if (dup) console.warn(`[build-local] ⚠️ 수동 항목과 이름이 겹치는 공시 사업 발견 — 중복 확인 필요: ${sido} ${sgg} 「${it.nm}」 vs 「${dup.nm}」`);
    const { region, source, asOf, ...rest } = it;
    // 정렬용 조회수는 그 지역 최댓값 +1 — 자체 대표 사업이라 표 맨 위에 와야 한다(임의의 큰 수를 넣지 않는다).
    const maxHot = arr.reduce((a, x) => Math.max(a, x.hot || 0), 0);
    arr.push({ ...rest, hot: rest.hot != null ? rest.hot : maxHot + 1, mod: (asOf || '').replace(/-/g, ''), manual: true, src: source || null });
    manualCount++;
  }
  if (manualCount) console.log(`[build-local] 수동 큐레이션 ${manualCount}건 병합 (복지로 미등재분)`);
}

// ── 전남광주통합특별시 광역 사업 권역 분리 (2026-09-07) ──
// 2026-07-01 통합으로 옛 광주광역시와 옛 전라남도의 광역 사업이 「(광역 공통)」 한 풀에 섞였다.
// 그대로 두면 광주 조례 사업이 전남 22개 시군 페이지에, 전남 조례 사업이 광주 5개 구 페이지에 실린다
// (실제로 09-07까지 「여수시 출생기본수당」이 전남 22곳 전부에 남의 동네 사업으로 표시되고 있었다).
// 근거 조례와 담당부서 지역번호로 갈라 각 권역에만 붙이고, 판별 불가면 양쪽 모두 유지한다(기존 동작).
// ⚠️ 이 분리는 두 옛 시도가 합쳐진 전남광주에만 해당한다. 다른 시도의 (광역 공통)은 그 시도 전역이 맞다.
const UNIFIED = '전남광주통합특별시';
if (bySido[UNIFIED]) {
  const bucket = bySido[UNIFIED];
  const common = bucket['(광역 공통)'] || [];
  // ⚠️ 두 글자 자치구명(동구·서구·남구·북구)은 사업명에 우연히 섞일 수 있어 귀속 판정에서 뺀다.
  //    그런 사업은 아래 지역번호 규칙으로 걸러진다.
  const owners = Object.keys(bucket)
    .filter((k) => !k.startsWith('(광역 공통') && !/교육청/.test(k) && k.length >= 3)
    .sort((a, b) => b.length - a.length);
  const gj = [];   // 광주 권역 전용
  const jn = [];   // 전남 권역 전용
  const both = []; // 판별 불가 → 양쪽 모두
  let owned = 0;
  for (const it of common) {
    // ① 사업명에 특정 시군이 박힌 광역 사업은 그 시군 것이다 (예: 「여수시 출생기본소득」)
    const owner = owners.find((n) => (it.nm || '').includes(n));
    if (owner) { bucket[owner].push(it); owned++; continue; }
    // ② 담당부서 지역번호 — 062 광주 / 061 전남. 가장 신뢰도 높은 신호다.
    const tel = it.tel || '';
    // ③ 근거 조례·사업개요. tel에는 「전남광주통합특별시」가 들어가므로 조례 판정에 tel을 섞지 않는다.
    const law = `${it.law || ''} ${it.dgst || ''}`;
    if (/062[-\s]/.test(tel)) gj.push(it);
    else if (/061[-\s]/.test(tel)) jn.push(it);
    else if (/광주광역시|광주권역/.test(law)) gj.push(it);
    else if (/전라남도|전남/.test(law)) jn.push(it);
    else both.push(it);
  }
  bucket['(광역 공통)'] = both;
  if (gj.length) bucket['(광역 공통·광주)'] = gj;
  if (jn.length) bucket['(광역 공통·전남)'] = jn;
  console.log(`[build-local] 전남광주 광역 분리 — 광주 ${gj.length} · 전남 ${jn.length} · 양쪽 ${both.length} · 시군 귀속 ${owned}`);
}

// ── 신설 구 빈 버킷 (2026-09-13, regions.js PENDING_SGG) ──
// 검단구는 복지로 자체 사업이 0건이라 키 자체가 없어 홈 위저드에서 고를 수 없었다.
// 빈 배열만 만들어 두면 위저드가 광역 공통 사업 + 국가 수당을 보여주고, build-pages가 안내문을 붙인 페이지를 만든다.
for (const [sido, m] of Object.entries(PENDING_SGG)) {
  if (!bySido[sido]) continue; // 시도가 통째로 빠진 날은 아래 이월 로직에 맡긴다
  for (const sgg of Object.keys(m)) bySido[sido][sgg] = bySido[sido][sgg] || [];
}

// 각 시군구 내 조회수순 정렬
for (const sido of Object.values(bySido))
  for (const arr of Object.values(sido)) arr.sort((a, b) => b.hot - a.hot);

// 소스 결손 방어: 공공데이터포털이 특정 시도를 통째로 안 주는 날이 있다
// (2026-08-01 실측 — 행정구역 개편 이관 중이라 전남·광주 88건이 응답에서 통째로 빠졌고,
//  그대로 빌드가 돌아 /r/ 지역 페이지 22개와 301 리디렉션이 삭제됐다).
// 개별 사업이 끝나 빠지는 건 정상 감소지만 "시도 하나가 통째로 0건"은 소스 장애 신호이므로,
// 그런 시도는 직전 빌드 결과를 그대로 이어받아 페이지가 사라지지 않게 한다.
const outPath = path.join(__dirname, '..', 'public', 'local-benefits.js');
const carried = [];
const staleAsOf = {}; // 이월된 시도 → 그 데이터가 실제로 수집된 날짜(페이지에 이 날짜를 표시한다)
if (fs.existsSync(outPath)) {
  const prevRaw = fs.readFileSync(outPath, 'utf8');
  const prev = JSON.parse(prevRaw.replace(/^window\.LOCAL_BENEFITS\s*=\s*/, '').replace(/;\s*$/, ''));
  for (const [sido, bucket] of Object.entries(prev.sido || {})) {
    if (!bySido[sido] && Object.keys(bucket).length) {
      bySido[sido] = bucket;
      carried.push(sido);
      // 이미 이월된 적 있으면 그때 날짜를 유지한다 — 매일 이월될 때마다 날짜가 따라 밀리면
      // 실제로는 낡은 데이터가 계속 "오늘 갱신"으로 보이게 된다.
      staleAsOf[sido] = (prev.staleAsOf && prev.staleAsOf[sido]) || prev.builtAt;
    }
  }
}

const out = {
  builtAt: src.fetchedAt,
  detailCoverage: `${src.detailCount}/${src.count}`,
  // 이번 수집에서 통째로 누락돼 직전 데이터를 유지한 시도 → 실제 수집일(있으면 소스 점검 필요)
  staleAsOf,
  sido: bySido,
};

const js = 'window.LOCAL_BENEFITS = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(outPath, js);

if (carried.length) {
  console.warn(`[build-local] ⚠️ 소스에서 통째로 누락된 시도 ${carried.length}곳 — 직전 데이터 유지: ${carried.join(', ')}`);
  // 이월은 하루 이틀 장애를 넘기라고 만든 장치인데, F는 지자체 데이터가 수동 갱신이라
  // 아무도 재수집을 돌리지 않으면 낡은 데이터가 무한정 서빙된다.
  // 🔴 실제로 전남광주가 2026-08-01 결손 뒤 55일간 7/14 데이터로 연명했다(09-07 발견).
  //    그래서 이월이 길어지면 경고 수위를 올려 재수집을 강제한다.
  const days = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  for (const sido of carried) {
    const n = staleAsOf[sido] ? days(staleAsOf[sido]) : null;
    if (n != null && n >= 14)
      console.warn(
        `[build-local] 🔴 ${sido} 데이터가 ${n}일째 이월 중입니다(수집일 ${staleAsOf[sido]}). ` +
          `먼저 DATA_GO_KR_KEY=... node scripts/fetch-benefits.js 로 재수집하고, ` +
          `그래도 이 경고가 남으면 소스(복지로)가 그 시도를 아직 안 주는 것이니 API 응답의 ctpvNm 분포를 직접 확인하세요.`
      );
  }
}

const sidoCount = Object.keys(bySido).length;
// 광역 버킷((광역 공통)·권역별)은 시군구가 아니므로 세지 않는다 — 실제 페이지 수와 맞춘다.
const sggCount = Object.values(bySido).reduce((a, s) => a + Object.keys(s).filter((k) => !isCommonKey(k)).length, 0);
console.log(`[build-local] 육아/출산 관련 ${kept}건 · ${sidoCount}개 시도 · ${sggCount}개 시군구 → public/local-benefits.js (${(js.length / 1024).toFixed(0)}KB)`);
