#!/usr/bin/env node
/**
 * data/benefits.json → public/local-benefits.js
 * 시도>시군구 트리로 그룹핑, 육아/출산 관련 서비스만, 금액문구 정제.
 * 상세 미확보(detail=null)도 목록 필드로 노출(제목·요약·링크는 있음).
 */
const fs = require('fs');
const path = require('path');
const { normRegion, isCommonKey } = require('./regions');

const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'benefits.json'), 'utf8'));

// 육아·출산과 무관한 노이즈 제외(장애인·저소득 일반·노인 등 성인 대상이 섞여 옴)
const INCLUDE = /출산|출생|산후|산모|임신|임산부|난임|육아|양육|보육|어린이집|유아|아동|영유아|기저귀|분유|첫만남|다자녀|입학|돌봄|모유|태아/;
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

if (carried.length)
  console.warn(`[build-local] ⚠️ 소스에서 통째로 누락된 시도 ${carried.length}곳 — 직전 데이터 유지: ${carried.join(', ')}`);

const sidoCount = Object.keys(bySido).length;
// 광역 버킷((광역 공통)·권역별)은 시군구가 아니므로 세지 않는다 — 실제 페이지 수와 맞춘다.
const sggCount = Object.values(bySido).reduce((a, s) => a + Object.keys(s).filter((k) => !isCommonKey(k)).length, 0);
console.log(`[build-local] 육아/출산 관련 ${kept}건 · ${sidoCount}개 시도 · ${sggCount}개 시군구 → public/local-benefits.js (${(js.length / 1024).toFixed(0)}KB)`);
