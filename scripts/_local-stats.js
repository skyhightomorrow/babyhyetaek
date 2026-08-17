/**
 * /r/ 지역 페이지용 집계·해석 모듈 (2026-08-17 신설)
 *
 * 왜 만들었나 — 2026-08-17 판정에서 F 가이드 15편 증량(본문 748→1,676자)이 14일간 노출 0으로 무효였다.
 * 같은 날 D는 같은 성격의 "기존 페이지 보강"으로 성공했는데, 차이는 분량이 아니라
 *   "보유 데이터를 집계·해석해서 넣었는가"였다(seo-audit.md 2026-08-17 섹션).
 * 그래서 이 모듈은 benefits.json이 이미 갖고 있으면서 페이지에 한 번도 렌더링되지 않던 필드
 *   (소득기준 crit · 지급수단 pvsn · 주기 cyc · 신청방식 aply · 담당부서 contacts · 신청처 how)를
 *   표와 집계 문장으로 바꾸는 일만 한다. 새 데이터를 가져오지 않는다.
 *
 * ⚠️ 집계 문장으로 쓸 수 있는 축과 없는 축을 2026-08-17에 전수 측정해서 갈랐다:
 *   ✅ 지역화폐 비율(지역 간 0~56%) · 온라인신청 비율(0~80%) · 주기(1회성 346 : 월 277) → 편차가 커서 페이지마다 문장이 달라진다
 *   🔴 소득기준 비율은 지역 간 75~100%로 편차가 거의 없다 → 집계 문장으로 쓰면 213페이지에 같은 문장이 깔려
 *      C `/o/`(데이터를 페이지로 쪼개 나열 → 구글 색인 0) 실패를 재현한다. **표 컬럼으로만 쓰고 문장으로 만들지 말 것.**
 */

// ── 금액 파싱 ───────────────────────────────────────────────────────────────
// 원문(detail.benefit)이 자유 서술이라 완전 파싱은 불가능하다. 2026-08-17 실측:
//   일반 출산지원금 계열 125건 중 '첫째' 금액이 잡히는 것은 43건(34%).
//   눈으로 12건 검수했을 때 잡힌 것은 전부 정확했다(오탐 0) — 그래서 "잡힌 것만 쓴다".
// D 면허반납이 15곳으로 성공했으므로 43곳은 분포 문장의 모수로 충분하다.
// ⚠️ 커버리지를 올리려고 정규식을 느슨하게 만들지 말 것. 오탐이 하나 생기면 그 지역 페이지가 거짓말을 한다.

// 「장애인가정/차상위」처럼 대상이 한정된 사업은 그 지역의 일반 출산지원금이 아니므로 분포에서 뺀다.
const NARROW = /장애인|차상위|저소득|기초생활|한부모|다문화|미혼모|난임/;
const CASH_NM = /출산지원금|출산장려금|출생축하|출산축하|출생장려|양육지원금/;

function toWon(numStr, unit) {
  const n = parseFloat(String(numStr).replace(/,/g, ''));
  if (!isFinite(n)) return null;
  if (unit === '천원') return n * 1000;
  if (unit === '만원') return n * 10000;
  return null;
}

function clean(t) {
  return String(t == null ? '' : t).replace(/&#13;|&#10;/g, ' ').replace(/\s+/g, ' ');
}

/** 첫째 아이 기준 금액. 못 잡으면 null(=페이지에 금액을 쓰지 않는다). */
function firstChildAmount(benefitText) {
  const s = clean(benefitText);
  if (!s) return null;
  const m = s.match(/첫째\s*(?:아이|아|자녀)?\s*[:：\-–]?\s*(?:일시금\s*)?([0-9][0-9,.]*)\s*(만원|천원)/);
  if (!m) return null;
  const won = toWon(m[1], m[2]);
  // 상식 범위 밖은 파싱 오류로 보고 버린다(예: 조례 조문 번호를 금액으로 잘못 읽는 경우)
  if (won == null || won < 10000 || won > 30000000) return null;
  return won;
}

/** 그 지역의 대표 출산지원금 1건(첫째 금액이 잡히는 것 중 최대). 없으면 null. */
function pickHeadline(list) {
  let best = null;
  for (const b of list) {
    if (!b.nm || NARROW.test(b.nm) || !CASH_NM.test(b.nm)) continue;
    const won = firstChildAmount(b.amt);
    if (won == null) continue;
    if (!best || won > best.won) best = { won, nm: b.nm };
  }
  return best;
}

// ── 범주형 집계 ─────────────────────────────────────────────────────────────
const isLocalCurrency = (b) => b.pvsn === '지역화폐';
const isCash = (b) => b.pvsn === '현금지급';
const isOnline = (b) => /인터넷|모바일/.test(b.aply || '');
const isOnce = (b) => b.cyc === '1회성';

/**
 * @param list  그 지역에서 받을 수 있는 전체(시군구 자체 + 시도 광역 공통)
 * @param own   시군구가 직접 운영하는 것만
 *
 * ⚠️ own과 n을 반드시 구분해야 한다. 2026-08-17 최초 구현에서 이걸 합쳐 놨다가
 *    "안양시가 운영하는 지원사업 19개"라는 거짓 문장이 나왔다(실제 안양시 자체는 5개, 나머지 14개는 경기도 광역사업).
 *    D 순천시가 데이터 없이 "운영합니다"라고 단정했던 것과 같은 유형의 오류다.
 *    → "OO가 운영하는"에는 own을, "OO에서 받을 수 있는"에는 n을 쓴다.
 */
function summarize(list, own) {
  const cnt = (f) => list.filter(f).length;
  return {
    n: list.length,
    own: own.length,
    cash: cnt(isCash),
    localCurrency: cnt(isLocalCurrency),
    online: cnt(isOnline),
    once: cnt(isOnce),
    monthly: cnt((b) => b.cyc === '월'),
    // 대표 금액은 그 지역 고유 제도여야 의미가 있으므로 자체 사업에서만 찾는다.
    // (광역 사업을 잡으면 같은 시도 시군구가 전부 같은 금액이 돼 페이지가 서로 구분되지 않는다.)
    headline: pickHeadline(own),
  };
}

/**
 * 전국·시도 집계를 미리 계산해 둔다(페이지마다 다시 돌지 않도록).
 * regions: { [sido]: { [sgg]: list } } — build-pages가 이미 정규화·병합한 형태를 그대로 받는다.
 */
function buildIndex(regions, isRealSgg) {
  const perRegion = {}; // "시도|시군구" → summary
  const bySido = {};    // 시도 → [{sgg, summary}]
  for (const [sido, bucket] of Object.entries(regions)) {
    const common = bucket['(광역 공통)'] || [];
    for (const [sgg, list] of Object.entries(bucket)) {
      if (!isRealSgg(sgg)) continue;
      const merged = [...list, ...common].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
      const s = summarize(merged, list);
      perRegion[`${sido}|${sgg}`] = s;
      (bySido[sido] = bySido[sido] || []).push({ sgg, summary: s });
    }
  }

  // 전국 금액 분포 — 첫째 금액이 잡힌 지역만 (2026-08-17 기준 43곳 안팎)
  const amounts = Object.entries(perRegion)
    .filter(([, s]) => s.headline)
    .map(([k, s]) => ({ key: k, won: s.headline.won }))
    .sort((a, b) => b.won - a.won);

  return { perRegion, bySido, amounts };
}

// ── 한글 조사 ───────────────────────────────────────────────────────────────
// 지역명을 문장에 넣을 때 조사를 하드코딩하면 '군' 단위에서 전부 깨진다("청송군가"·"청송군는").
// D myhyetaek이 2026-08-13에 같은 버그("횡성군는"·"횡성군가")를 고쳤고, F도 같은 실수를 반복해서 옮겨 왔다.
// 받침 판정: (코드 - 0xAC00) % 28 !== 0 이면 받침 있음.
function hasJong(word) {
  const s = String(word || '').trim();
  if (!s) return false;
  const c = s.charCodeAt(s.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false; // 한글 음절이 아니면(숫자·영문) 받침 없음으로 본다
  return (c - 0xac00) % 28 !== 0;
}
const eun = (w) => `${w}${hasJong(w) ? '은' : '는'}`;
const i_ga = (w) => `${w}${hasJong(w) ? '이' : '가'}`;
const eul = (w) => `${w}${hasJong(w) ? '을' : '를'}`;

// ── 문장 생성 ───────────────────────────────────────────────────────────────
const man = (won) => Math.round(won / 10000).toLocaleString('ko-KR') + '만원';
const pct = (x, n) => (n ? Math.round((x / n) * 100) : 0);

/**
 * 전국 분포 대비 이 지역의 위치. D 면허반납의 "전국 15곳 중 20만원에 8곳 집중" 문장과 같은 구조.
 * 금액이 안 잡힌 지역에는 아무 문장도 만들지 않는다(정직한 부재 — D 순천시 사례).
 */
function nationalPosition(key, index) {
  const s = index.perRegion[key];
  if (!s || !s.headline) return null;
  const all = index.amounts;
  if (all.length < 10) return null; // 모수가 너무 적으면 분포 문장 자체를 만들지 않는다
  const rank = all.findIndex((a) => a.key === key) + 1;
  const max = all[0].won;
  const min = all[all.length - 1].won;
  const mid = all[Math.floor(all.length / 2)].won;
  const higher = all.filter((a) => a.won > s.headline.won).length;
  return {
    rank, total: all.length, max, min, mid,
    higher,
    aboveMid: s.headline.won >= mid,
    won: s.headline.won,
  };
}

/**
 * 같은 시도 안에서의 위치 — 금액이 없어도 만들 수 있어 커버리지가 넓다(214곳 전부).
 * ⚠️ 반드시 **자체 사업 수(own)** 로 비교한다. 광역 공통은 그 시도의 모든 시군구에 똑같이 더해지므로
 *    합계로 비교하면 순위는 같아도 평균이 부풀려지고, 무엇보다 "그 지자체가 얼마나 하는가"를 못 나타낸다.
 */
function sidoPosition(sido, sgg, index) {
  const arr = index.bySido[sido];
  if (!arr || arr.length < 3) return null;
  const sorted = arr.slice().sort((a, b) => b.summary.own - a.summary.own);
  const rank = sorted.findIndex((x) => x.sgg === sgg) + 1;
  if (!rank) return null;
  const avg = arr.reduce((a, x) => a + x.summary.own, 0) / arr.length;
  return { rank, total: arr.length, own: sorted[rank - 1].summary.own, avg: Math.round(avg * 10) / 10 };
}

module.exports = {
  firstChildAmount, pickHeadline, summarize, buildIndex,
  hasJong, eun, i_ga, eul,
  nationalPosition, sidoPosition, man, pct,
  isLocalCurrency, isCash, isOnline, isOnce, NARROW, CASH_NM,
};
