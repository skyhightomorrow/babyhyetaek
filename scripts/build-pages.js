#!/usr/bin/env node
/**
 * 시군구별 정적 SEO 페이지 생성 → public/r/{시도}-{시군구}.html + sitemap.xml
 * 각 페이지: 그 지역 지자체 지원금 프리렌더 + 국가수당 요약 + 계산기 CTA.
 * "화성시 출산지원금 2026" 롱테일 검색 타겟(현재 블로그 점령).
 *
 * 사용: node scripts/build-pages.js
 * 전제: public/local-benefits.js (build-local.js가 먼저 생성)
 * 선택: data/postpartum.json (fetch-postpartum.js) — 없으면 산후조리원 섹션만 빠지고 빌드는 계속된다.
 */
const fs = require('fs');
const { guardPages } = require('./_page-guard');
const path = require('path');
const { NATIONAL } = require('../lib/national');
const lastmod = require('./lastmod');
// JS/CSS 링크에 콘텐츠 해시를 붙인다 — CF Pages가 JS/CSS를 max-age=14400(4시간) 캐시하므로(_asset-hash.js 참고)
const { assetUrl } = require('./_asset-hash');

const ORIGIN = process.env.SITE_ORIGIN || 'https://babyhyetaek.com';
const YEAR = 2026;
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

// local-benefits.js 로드 (window.LOCAL_BENEFITS = {...};)
const lbRaw = fs.readFileSync(path.join(PUB, 'local-benefits.js'), 'utf8');
const DB = JSON.parse(lbRaw.replace(/^window\.LOCAL_BENEFITS\s*=\s*/, '').replace(/;\s*$/, ''));

// 2026-07-01 행정구역 개편 정규화.
// 「전남광주통합특별시 설치를 위한 특별법」(공포 2026-06-02·시행 2026-07-01)로 광주광역시+전라남도가 통합됐고,
// 인천은 동구→제물포구, 서구→서해구 분리·검단구 신설.
// 공공데이터포털은 아직 옛 이름을 주므로 빌드 시점에 현행 명칭으로 바꿔 페이지를 만든다.
// 옛 URL은 public/_redirects에서 301로 넘긴다.
// (맵 본체는 build-local.js와 공유 — scripts/regions.js)
const { normRegion, legacyNames, isCommonKey, commonFor, PENDING_SGG, pendingInfo, SIDO_SHORT } = require('./regions');
// 조건 표·집계 문장용 (2026-08-17). 지역 페이지가 "나열"에서 "집계·해석"으로 넘어가는 부분.
const ST = require('./_local-stats');

// 시군구 페이지를 만드는 키인지 — 교육청·(광역 공통)은 시군구가 아니라 페이지를 만들지 않는다.
// 집계 모수도 같은 기준이어야 "전국 N곳 중 M위" 문장이 실제 페이지 수와 맞는다.
const isRealSgg = (k) => !isCommonKey(k) && !/교육청/.test(k) && k.trim().length >= 2;

// 전국·시도 집계는 페이지마다 다시 돌면 214번 반복되므로 빌드 시작 때 한 번만 만든다(정규화 직후 대입).
let STATS = { perRegion: {}, bySido: {}, amounts: [] };

const man = (n) => Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (sido, sgg) => `${sido}-${sgg}`.replace(/[()]/g, '').replace(/\s+/g, '');
// 검색 키 정규화 — public/assets/region-search.js 의 norm()과 같은 규칙(소문자·공백 제거)
const nk = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
// <script type="application/json"> 안에 넣을 JSON — 상호에 「</script>」가 섞여도 태그가 닫히지 않게
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

// 신설 구인데 복지로 자체 사업이 아직 0건인 곳(검단구) — 안내문을 붙이고 집계 순위에서 뺀다
const isPendingEmpty = (sido, sgg, bucket) => !!pendingInfo(sido, sgg) && !(bucket[sgg] || []).length;

// ── 산후조리원 (2026-09-13) ──
// data/postpartum.json 이 없거나 깨져도 빌드는 멈추지 않는다 — 섹션만 빠진다(지원금 페이지가 부가 데이터 때문에 사라지면 안 된다).
let PP = null;
try {
  PP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'postpartum.json'), 'utf8'));
  if (!PP || !Array.isArray(PP.items) || !PP.items.length) PP = null;
} catch {
  PP = null;
}
if (!PP) console.warn('[build-pages] ⚠️ data/postpartum.json 없음 — 산후조리원 섹션 없이 빌드 (node scripts/fetch-postpartum.js)');
const ppBy = {};
const ppBySido = {};
if (PP) {
  for (const it of PP.items) {
    (ppBy[`${it.sido}|${it.sgg}`] = ppBy[`${it.sido}|${it.sgg}`] || []).push(it);
    (ppBySido[it.sido] = ppBySido[it.sido] || []).push(it);
  }
}

// ── 연락처 원문에서 전화번호 추출 (2026-09-13) ──
// 원문이 「과천시 가족아동과 02-3677-2259」·「태안군청 … 0416702722」·「기장군 … 051 709 4652」처럼 제각각이다.
// 지역번호를 명시해야 붙여 쓴 번호(0222316375 = 02-2231-6375)가 바르게 갈린다.
// 「032-120」 같은 콜센터 단축번호·「000-0000」 자리표시·지역번호 없는 「940-5736」은 버튼을 만들지 않는다
// (잘못 걸리는 전화 버튼은 없는 것보다 나쁘다). public/app.js 의 phonesIn과 같은 규칙.
const TEL_RE = /(?<!\d)(?:(02|0[3-6][1-5]|01[016-9]|070)[-\s.)]?(\d{3,4})[-\s.]?(\d{4})|(1[5-9]\d{2})-(\d{4}))(?!\d)/g;
function phonesIn(text) {
  const out = [];
  const s = String(text || '');
  let m;
  TEL_RE.lastIndex = 0;
  while ((m = TEL_RE.exec(s))) {
    const num = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[4]}-${m[5]}`;
    if (/-0{3,4}-|-0000$/.test(num)) continue;
    if (!out.includes(num)) out.push(num);
  }
  return out;
}
const telBtn = (num, target) =>
  `<a class="telBtn" href="tel:${num.replace(/-/g, '')}" data-ga="call" data-target="${target}">📞 ${esc(num)}</a>`;

// 국가수당 헤드라인(첫째·단태·육아휴직 제외) = 첫만남200+바우처100+0세1320+1세720+2~8세840
const NAT_HEADLINE =
  NATIONAL.firstMeet.firstChild + NATIONAL.pregnancyVoucher.single +
  (NATIONAL.parentPay.age0 + NATIONAL.childPay.amount) * 12 +
  (NATIONAL.parentPay.age1 + NATIONAL.childPay.amount) * 12 +
  NATIONAL.childPay.amount * (NATIONAL.childPay.untilMonths - 24);

function natTable() {
  return `<table class="natTable">
    <tr><td>첫만남이용권 <span class="muted">출생 1회</span></td><td>${man(NATIONAL.firstMeet.firstChild)}~${man(NATIONAL.firstMeet.laterChild)}</td></tr>
    <tr><td>임신·출산 진료비 바우처 <span class="muted">국민행복카드</span></td><td>${man(NATIONAL.pregnancyVoucher.single)}~${man(NATIONAL.pregnancyVoucher.multi)}</td></tr>
    <tr><td>부모급여 <span class="muted">0세 월100만·1세 월50만</span></td><td>1,800만원</td></tr>
    <tr><td>아동수당 <span class="muted">월10만·9세 미만</span></td><td>1,080만원</td></tr>
    <tr><td>육아휴직급여 <span class="muted">근로자·통상임금 기준</span></td><td>별도</td></tr>
  </table>`;
}

// 소득기준 원문이 "제한없음"류인지 판정. 표에 '소득 무관'으로 줄여 쓰기 위한 것이며,
// ⚠️ 이 비율로 집계 문장을 만들지 말 것 — 지역 간 편차가 75~100%로 거의 없다(2026-08-17 실측).
const NO_INCOME_TEST = /제한\s*없|해당\s*없|무관|기준\s*없|전\s*계층|모든\s*가구/;

function critShort(b) {
  if (!b.crit) return '—';
  const t = String(b.crit).trim();
  if (NO_INCOME_TEST.test(t)) return '소득 무관';
  const m = t.match(/기준\s*중위소득\s*([0-9]+)\s*%/);
  if (m) return `중위소득 ${m[1]}% 이하`;
  return t.length > 22 ? t.slice(0, 22) + '…' : t;
}

// 조건 표 — 2026-08-17 신설. D 면허반납 성공의 1번 요소(금액·지급수단·신청처를 한 표에 모으기)를 옮긴 것.
// 지급수단·주기·소득기준·연락처는 원본에 100% 있으면서 여태 페이지에 안 나가던 필드다.
function localSection(sido, sgg, list) {
  if (!list.length) return '<p class="sub">이 지역의 공공데이터 상세를 준비 중입니다.</p>';
  const rows = list.slice(0, 20).map((b) => {
    const mod = b.mod ? `${b.mod.slice(0, 4)}.${b.mod.slice(4, 6)}` : '';
    const amount = b.amt || b.dgst || '';
    const pay = b.pvsn ? esc(b.pvsn) : '—';
    const cyc = b.cyc ? esc(b.cyc) : '—';
    const how = b.how ? esc(b.how) : (b.aply ? esc(b.aply) : '—');
    const tels = phonesIn(b.tel);
    return `<tr>
      <th scope="row">
        <span class="bNm">${esc(b.nm)}</span>
        ${b.law ? `<span class="bLaw">📜 ${esc(b.law)}</span>` : ''}
        ${mod ? `<span class="bLaw">갱신 ${mod}</span>` : ''}
      </th>
      <td class="bAmt">${amount ? esc(amount) : '<span class="bDim">공고 확인 필요</span>'}</td>
      <td>${pay}<span class="bDim"> · ${cyc}</span></td>
      <td>${esc(critShort(b))}</td>
      <td>${how}${b.tel ? `<span class="bDim">${esc(b.tel)}</span>` : ''}${tels.map((t) => telBtn(t, 'benefit')).join('')}${b.link ? `<a class="bLink" href="${esc(b.link)}" target="_blank" rel="noopener">${b.manual ? '공식 안내 →' : '복지로 →'}</a>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="tblWrap"><table class="bTable">
    <thead><tr><th scope="col">지원사업</th><th scope="col">지원 내용</th><th scope="col">지급수단·주기</th><th scope="col">소득기준</th><th scope="col">신청처</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>` + (list.length > 20 ? `<p class="sub" style="text-align:center;margin-top:12px">외 ${list.length - 20}개 더</p>` : '');
}

// 집계·해석 — 2026-08-17 신설. "데이터를 나열하면 실패(C /o/), 집계·해석하면 성공(H 가이드)"의 적용.
// ⚠️ 근거가 없는 지역에는 문장을 만들지 않는다(정직한 부재 — D 순천시가 데이터 없이 "운영합니다"라고 단정했던 사례).
function analysisSection(sido, sgg, key, STATS) {
  const s = STATS.perRegion[key];
  if (!s || !s.n) return '';
  const out = [];

  const nat = ST.nationalPosition(key, STATS);
  if (nat) {
    const band = nat.aboveMid ? '많은 편' : '적은 편';
    // '만원'은 받침(ㄴ)으로 끝나므로 조사는 항상 '으로'. 숫자에 따라 갈리지 않는다.
    out.push(`<li><b>전국 위치</b> — ${esc(sgg)}의 첫째 아이 출산지원금은 <b>${ST.man(nat.won)}</b>으로,
      금액이 공고로 확인된 전국 ${nat.total}곳 중 <b>${nat.rank}위</b>입니다(${nat.higher}곳이 더 많음).
      전국은 ${ST.man(nat.min)}~${ST.man(nat.max)}으로 <b>${Math.round(nat.max / nat.min)}배</b> 차이가 나며, ${ST.eun(esc(sgg))} 중간값(${ST.man(nat.mid)})보다 ${band}입니다.</li>`);
  }

  const sp = ST.sidoPosition(sido, sgg, STATS);
  if (sp) {
    const cmp = sp.own > sp.avg ? '많습니다' : (sp.own < sp.avg ? '적습니다' : '같습니다');
    const commonN = s.n - s.own;
    out.push(`<li><b>${esc(sido)} 안에서</b> — ${ST.i_ga(esc(sgg))} <b>직접 운영하는</b> 육아·출산 지원사업은 <b>${sp.own}개</b>로
      ${esc(sido)} ${sp.total}곳 중 <b>${sp.rank}위</b>입니다. 시도 평균 ${sp.avg}개보다 ${cmp}.
      ${commonN > 0 ? `여기에 ${ST.i_ga(esc(sido))} 전 지역에 공통으로 주는 ${commonN}개가 더해져 <b>${esc(sgg)}에서 받을 수 있는 사업은 ${s.n}개</b>입니다.` : ''}</li>`);
  }

  // 지급수단 — 지역 간 편차 0~56%로 실제로 갈린다. "현금인 줄 알았는데 지역화폐"가 흔한 실사용 함정이라 먼저 쓴다.
  if (s.localCurrency > 0) {
    out.push(`<li><b>현금이 아닌 지원이 섞여 있습니다</b> — ${s.n}개 중 <b>${s.localCurrency}개(${ST.pct(s.localCurrency, s.n)}%)</b>가
      <b>지역화폐·상품권</b>으로 지급됩니다. 현금 지급은 ${s.cash}개입니다.</li>`);
  } else if (s.cash > 0) {
    out.push(`<li><b>지급수단</b> — ${s.n}개 중 <b>${s.cash}개</b>가 현금으로 지급됩니다(지역화폐 지급 사업 없음).</li>`);
  }

  // 신청방식 — 0~80%로 편차가 크다
  if (s.online === 0) {
    out.push(`<li><b>온라인 신청이 안 됩니다</b> — ${esc(sgg)}의 ${s.n}개 사업은 확인된 범위에서 <b>전부 방문 신청</b>입니다.
      주민등록상 주소지 행정복지센터(주민센터)에서 접수하세요.</li>`);
  } else {
    out.push(`<li><b>온라인 신청</b> — ${s.n}개 중 <b>${s.online}개(${ST.pct(s.online, s.n)}%)</b>가 인터넷·모바일 신청을 받습니다. 나머지는 방문 접수입니다.</li>`);
  }

  // 일시금이냐 매월이냐 — 1회성 346 : 월 277로 전국적으로 갈리는 축
  if (s.once || s.monthly) {
    out.push(`<li><b>한 번에 받나, 나눠 받나</b> — 일시금(1회성) <b>${s.once}개</b> · 매월 지급 <b>${s.monthly}개</b>입니다.
      ${s.monthly > s.once ? '나눠 받는 사업이 더 많아 거주 요건을 계속 유지해야 하는 경우가 많습니다.' : '한 번에 받는 사업이 더 많습니다.'}</li>`);
  }

  if (!out.length) return '';
  return `<div class="card"><h2 class="secTitle">📊 ${esc(sgg)} 지원금, 이렇게 생겼습니다</h2>
    <ul class="insight">${out.join('')}</ul>
    <p class="sub" style="margin:12px 0 0;font-size:12px">복지로 공공데이터에 공고된 내용을 집계한 것입니다. 금액 비교는 <b>첫째 아이 기준</b>이며, 둘째·셋째는 지역마다 가산 폭이 다릅니다.</p>
  </div>`;
}

// ── 우리 동네 산후조리원 섹션 (2026-09-13) ──
// 지원금 표가 "얼마 받나"에 답한다면 이 섹션은 "어디로 가나"에 답한다. 요금은 원본에 없으므로 쓰지 않는다.
function ppCard(c) {
  // 카카오맵 링크 URL 규칙: /link/map/이름,위도,경도 — 이름에 쉼표가 있으면 좌표로 잘못 읽히므로 공백으로 바꾼다
  const href = c.lat != null
    ? `https://map.kakao.com/link/map/${encodeURIComponent(c.nm.replace(/,/g, ' '))},${c.lat},${c.lng}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(c.addr)}`;
  return `<div class="ppItem"><div class="ppNm">${esc(c.nm)}</div><div class="ppAddr">${esc(c.addr)}</div>${
    c.cap ? `<div class="ppMeta">임산부실 정원 ${c.cap}명</div>` : ''
  }<div class="ppBtns">${c.tel ? telBtn(c.tel, 'postpartum') : ''}<a class="mapLink" href="${href}" target="_blank" rel="noopener" data-ga="map" data-target="postpartum">카카오맵에서 보기</a></div></div>`;
}

function postpartumSection(sido, sgg) {
  if (!PP) return '';
  const own = ppBy[`${sido}|${sgg}`] || [];
  const src = `<p class="ppSrc">출처: 공공데이터포털 전국산후조리원표준데이터(지자체 인허가 정보) · 기준일 ${esc(PP.sourceUpdatedAt || PP.fetchedAt)} · 요금 정보는 포함되지 않아요</p>`;
  if (own.length) {
    const pts = own.filter((c) => c.lat != null).map((c) => ({ nm: c.nm, lat: c.lat, lng: c.lng, tel: c.tel }));
    const noPin = own.length - pts.length;
    return `<div class="card" id="postpartum">
    <h2 class="secTitle">🍼 우리 동네 산후조리원 ${own.length}곳</h2>
    <p class="sub" style="margin:0 0 12px">${esc(sgg)}에 영업 중으로 신고된 산후조리원이에요. 예약 전 전화로 운영 여부와 요금을 확인하세요.</p>
    ${pts.length ? `<button type="button" class="ppMapBtn" id="ppMapBtn" aria-expanded="false" aria-controls="ppMap">지도로 보기</button>
    <div id="ppMap" class="ppMap" hidden></div>
    <script type="application/json" id="ppData">${jsonForScript(pts)}</script>${noPin ? `<p class="ppSrc" style="margin-top:8px">※ ${noPin}곳은 원본에 좌표가 없어 지도에 표시되지 않아요(목록에는 있어요).</p>` : ''}` : ''}
    <div class="ppList">${own.map(ppCard).join('')}</div>
    ${src}
  </div>`;
  }
  // 0곳 — 없다고 정직하게 쓰고, 같은 시도에서 조리원이 있는 지역을 「곳 수 + 그 지역 페이지 링크」로만 보여준다.
  // ⚠️ 처음엔 시도 전체 카드를 접어 넣었는데, 0곳 페이지 90개에 같은 긴 목록(경기 156곳, 한 페이지 124KB)이
  //    반복돼 중복 콘텐츠가 됐다(애드센스 저가치 판정 위험). 상세는 조리원이 있는 지역 페이지 한 곳에만 둔다.
  const bySgg = {};
  for (const c of ppBySido[sido] || []) bySgg[c.sgg] = (bySgg[c.sgg] || 0) + 1;
  const others = Object.entries(bySgg).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  return `<div class="card" id="postpartum">
    <h2 class="secTitle">🍼 우리 동네 산후조리원 0곳</h2>
    <p class="sub" style="margin:0">${esc(sgg)}에는 영업 중으로 신고된 산후조리원이 없어요.${others.length ? ` 가까운 ${esc(sido)} 다른 지역을 확인해 보세요.` : ''}</p>
    ${others.length ? `<div class="nearby" style="margin-top:10px">${others.map(([s, n]) => SLUGS.has(slug(sido, s))
      ? `<a href="/r/${encodeURIComponent(slug(sido, s))}#postpartum">${esc(s)} ${n}곳</a>`
      : `<span>${esc(s)} ${n}곳</span>`).join('')}</div>` : ''}
    ${src}
  </div>`;
}

// 다른 지역·지원사업 검색 — /r/?q= 로 보낸다(허브의 region-search.js가 받아 바로 거른다). JS 없이도 동작하는 GET 폼.
const miniSearch = () => `<form class="rSearchBox" action="/r/" method="get" role="search" style="margin:0">
      <label for="rq" class="srOnly">지역·지원사업 검색</label>
      <input id="rq" name="q" type="search" placeholder="다른 지역·지원사업 (예: 첫만남)" autocomplete="off">
      <button type="submit">검색</button>
    </form>`;

// 개편된 지역에는 안내를 붙인다. 지원사업·조례 이름에는 옛 지자체명이 그대로 남아 있어
// (예: '전라남도 출생기본수당 지원 조례') 그대로 두는 것이 정확한데, 설명이 없으면 이용자가 혼동한다.
function mergeNote(sido, sgg) {
  if (sido === '전남광주통합특별시')
    return `<p class="disclaimer">※ 2026년 7월 1일 <b>광주광역시와 전라남도가 전남광주통합특별시로 통합</b>됐습니다(전남광주통합특별시 설치를 위한 특별법). 아래 지원사업 이름에 '전라남도'가 남아 있는 것은 <b>조례의 정식 명칭</b>이기 때문이며, ${esc(sgg)} 주민이 그대로 신청할 수 있습니다.</p>`;
  if (sido === '인천광역시' && (sgg === '제물포구' || sgg === '서해구'))
    return `<p class="disclaimer">※ 2026년 7월 1일 인천 자치구가 개편돼 <b>${sgg === '제물포구' ? '동구가 제물포구로' : '서구가 서해구와 검단구로'}</b> 바뀌었습니다. 지원사업 이름에 옛 구 이름이 남아 있을 수 있습니다.</p>`;
  if (sido === '인천광역시' && sgg === '영종구')
    return `<p class="disclaimer">※ 2026년 7월 1일 인천 자치구가 개편돼 <b>옛 중구의 영종도·용유도 지역이 영종구</b>가 됐습니다. 지원사업 이름에 옛 구 이름(중구)이 남아 있을 수 있습니다.</p>`;
  return '';
}

// 신설 구(검단구) 안내 — 자체 사업이 복지로에 없다는 사실을 페이지 맨 앞에서 밝힌다.
// ⚠️ "검단구도 서해구 사업을 받는다"고 단정하지 않는다 — 분리 후 적용 여부는 확인된 근거가 없다.
function pendingNotice(sido, sgg, info, siblingExists) {
  const [y, m, d] = info.since.split('-').map(Number);
  const sib = siblingExists
    ? `<a href="/r/${encodeURIComponent(slug(sido, info.sibling))}">${esc(info.sibling)}(옛 ${esc(info.from)}) 페이지</a>`
    : `${esc(info.sibling)}(옛 ${esc(info.from)}) 지역 정보`;
  return `<div class="notice">📌 <b>${esc(sgg)}는 ${y}년 ${m}월 ${d}일 인천 ${esc(info.from)}에서 분리돼 새로 생긴 구</b>예요.
    ${esc(sgg)}가 직접 운영하는 지원사업은 아직 복지로 공공데이터에 등록되지 않아, 이 페이지에는 <b>${esc(sido)} 공통 지원사업과 국가 수당만</b> 정리했어요.
    분리 전 ${esc(info.from)} 사업이 궁금하면 ${sib}를 참고하되, ${esc(sgg)} 주민에게 그대로 적용되는지는 ${esc(sgg)}청·주민센터에 확인하세요.</div>`;
}

function page(sido, sgg, list, nearby, own) {
  const key = `${sido}|${sgg}`;
  const pInfo = own.length ? null : pendingInfo(sido, sgg);
  // 집계에서 빠진 지역(신설 구)은 그 페이지 목록으로 직접 요약한다 — 기본값 0으로 두면 "전부 방문 신청" 같은 거짓 문장이 나온다
  const s = STATS.perRegion[key] || ST.summarize(list, own);
  const head = s.headline;

  // ── title·description: 지역 고유 숫자를 앞으로 (2026-08-17) ──
  // 기존에는 "총 얼마 받나요?"라고 묻기만 하고 답이 없었다. D는 description을 금액으로 바꾼 뒤
  // 순위가 그대로여도 CTR이 먼저 움직였다("지급기준" 롱테일에서 네이버 CTR 100%). F는 이미 5.8~10.5위라
  // 순위가 아니라 CTR이 병목이므로 이 변경이 1차 지표다.
  const title = head
    ? `${sgg} 출산지원금 ${YEAR} — 첫째 ${man(head.won)} + 국가 ${man(NAT_HEADLINE)}`
    : pInfo
      ? `${sgg} 출산지원금·육아 지원금 ${YEAR} — ${SIDO_SHORT[sido] || sido} 공통 ${s.n}개 + 국가 ${man(NAT_HEADLINE)}`
      : `${sgg} 출산지원금·육아 지원금 ${YEAR} — 지원사업 ${s.n}개 + 국가 ${man(NAT_HEADLINE)}`;

  const payHint = s.localCurrency > 0
    ? `${s.localCurrency}개는 지역화폐로 지급됩니다.`
    : (s.cash > 0 ? `현금 지급 ${s.cash}개.` : '');
  const applyHint = s.online === 0 ? '신청은 전부 주민센터 방문입니다.' : `${s.online}개는 온라인 신청이 됩니다.`;
  // "받을 수 있는"(=자체+광역 s.n)과 "직접 운영하는"(=s.own)을 섞지 말 것 — 위 summarize 주석 참고.
  const desc = head
    ? `${sido} ${sgg} 첫째 아이 출산지원금 ${man(head.won)}. ${sgg}에서 받을 수 있는 육아·출산 지원사업 ${s.n}개의 금액·지급수단·소득기준·신청처를 한 표에 정리했습니다. ${payHint} ${applyHint} 국가 수당(부모급여·첫만남이용권·아동수당) 8세까지 ${man(NAT_HEADLINE)}과 합산.`
    : pInfo
      ? `${sido} ${sgg}(${YEAR}년 ${info2kr(pInfo.since)} ${pInfo.from}에서 분리 신설)에서 받을 수 있는 ${sido} 공통 육아·출산 지원사업 ${s.n}개와 국가 수당(부모급여·첫만남이용권·아동수당) 8세까지 ${man(NAT_HEADLINE)}을 정리했습니다. ${sgg} 자체 사업은 아직 공공데이터에 없습니다.`
      : `${sido} ${sgg}에서 받을 수 있는 육아·출산 지원사업 ${s.n}개의 금액·지급수단·소득기준·신청처를 한 표에 정리했습니다. ${payHint} ${applyHint} 국가 수당(부모급여·첫만남이용권·아동수당) 8세까지 ${man(NAT_HEADLINE)}과 합산해 확인하세요.`;

  const url = `${ORIGIN}/r/${encodeURIComponent(slug(sido, sgg))}`;
  const nearbyLinks = nearby.map((n) => `<a href="/r/${encodeURIComponent(slug(sido, n))}">${esc(n)}</a>`).join('');

  // ── FAQ 3문항 (2026-08-17) ──
  // D는 FAQ를 "얼마·몇 살·어디에"로 3문항 만들어 스키마 맨 앞에 놓은 뒤 네이버에서 「지급기준」 롱테일 CTR 100%가 나왔다.
  // 답변에 반드시 이 지역 고유 숫자가 들어가야 한다(기존 1문항은 213페이지가 같은 답이었다).
  const faq = [];
  faq.push({
    q: `${sgg}에서 아이를 낳으면 지원금을 얼마나 받나요?`,
    a: head
      ? `${ST.eun(sgg)} 첫째 아이 기준 ${man(head.won)}을 지급합니다(${head.nm}). 여기에 국가 수당이 8세까지 약 ${man(NAT_HEADLINE)} 더해집니다. 둘째·셋째는 가산되는 경우가 많아 공고를 확인하세요.`
      : pInfo
        ? `국가 수당이 첫째 기준 8세까지 약 ${man(NAT_HEADLINE)}이고, ${sido} 공통 지원사업 ${s.n}개를 받을 수 있습니다. ${ST.eun(sgg)} ${pInfo.since.slice(0, 4)}년 신설된 구라 자체 출산지원금은 아직 공공데이터에 등록되지 않았으니 ${sgg}청에 확인하세요.`
        : `국가 수당이 첫째 기준 8세까지 약 ${man(NAT_HEADLINE)}이고, 여기에 ${sgg}에서 받을 수 있는 지원사업 ${s.n}개가 추가됩니다. 금액은 사업마다 달라 아래 표에서 확인하세요.`,
  });
  faq.push({
    q: `${sgg} 출산지원금은 어디에 신청하나요?`,
    a: s.online === 0
      ? `${sgg}에서 받을 수 있는 지원사업 ${s.n}개는 확인된 범위에서 전부 방문 신청입니다. 주민등록상 주소지 행정복지센터(주민센터)에서 접수하며, 사업별 담당부서 연락처는 아래 표에 있습니다.`
      : `${s.n}개 중 ${s.online}개는 인터넷·모바일로 신청할 수 있고 나머지는 주민등록상 주소지 행정복지센터 방문 접수입니다. 사업별 신청처는 아래 표에서 확인하세요.`,
  });
  faq.push({
    q: s.localCurrency > 0 ? `${sgg} 출산지원금은 현금으로 주나요?` : `${sgg} 출산지원금은 한 번에 받나요?`,
    a: s.localCurrency > 0
      ? `전부 현금은 아닙니다. ${sgg}에서 받을 수 있는 ${s.n}개 사업 중 ${s.localCurrency}개(${ST.pct(s.localCurrency, s.n)}%)는 지역화폐·상품권으로 지급되고, 현금 지급은 ${s.cash}개입니다.`
      : `${ST.eun(sgg)} 일시금(1회성) ${s.once}개, 매월 나눠 지급 ${s.monthly}개입니다. 나눠 받는 사업은 지급 기간 동안 ${sgg} 거주 요건을 계속 유지해야 하는 경우가 많습니다.`,
  });

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const localTitle = pInfo
    ? `🏙️ ${esc(sgg)} 주민이 받을 수 있는 ${esc(sido)} 공통 지원금 <span class="cnt">${list.length}개</span>`
    : `🏙️ ${ST.i_ga(esc(sgg))} 주는 지자체 지원금 <span class="cnt">${list.length}개</span>`;

  return `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="stylesheet" href="${assetUrl('/assets/region.css')}">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-6CZCXLHZVB"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-6CZCXLHZVB');</script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head><body data-region="${esc(sido)} ${esc(sgg)}">
<div class="shell">
  <header>
    <div class="logo"><a href="/" style="color:inherit">베이비<b>혜택</b></a></div>
    <div class="crumb"><a href="/">홈</a> › <a href="/r/">지역별</a> › ${esc(sido)} › ${esc(sgg)}</div>
  </header>
  <h1>${esc(sido)} ${esc(sgg)}<br>출산·육아 지원금 (${YEAR})</h1>
  <p class="sub">${esc(sgg)}에 사는 우리 집이 아이 태어나서 8세까지 받는 지원금을 국가 수당 + 지자체 지원금으로 정리했어요.</p>

  ${pInfo ? pendingNotice(sido, sgg, pInfo, SLUGS.has(slug(sido, pInfo.sibling))) : ''}

  <div class="card">
    <div class="freshBadge">${YEAR}년 기준 · 지자체 데이터 ${esc((DB.staleAsOf || {})[sido] || DB.builtAt)} 갱신</div>
    <p class="sumCap">${esc(sgg)} · 첫째 아이 기준</p>
    <div class="sumNum">약 ${man(NAT_HEADLINE)}</div>
    <p class="sumCap">아이 태어나서 8세까지 받는 <b>국가 지원금 합계</b><br>여기에 아래 <b>${esc(sgg)} 지자체 지원금</b>이 추가돼요.</p>
    <a class="cta" href="/">내 조건으로 정확히 계산하기 →</a>
  </div>

  <div class="adSlot"><span>광고 영역</span></div>

  <div class="card">
    <h2 class="secTitle">${localTitle}</h2>
    <p class="sub" style="margin:0 0 14px">출처: 한국사회보장정보원 공공데이터(복지로)${
      // 복지로에 없어 지자체 공식 페이지에서 직접 확인해 넣은 항목이 섞이면 출처를 정확히 병기한다.
      list.some((b) => b.manual)
        ? ` · ${[...new Set(list.filter((b) => b.manual).map((b) => b.src).filter(Boolean))].map(esc).join(' · ')}`
        : ''
    } · 조회 많은 순</p>
    ${localSection(sido, sgg, list)}
  </div>

  ${analysisSection(sido, sgg, key, STATS)}

  ${postpartumSection(sido, sgg)}

  <div class="card">
    <h2 class="secTitle">❓ ${esc(sgg)} 출산지원금 자주 묻는 질문</h2>
    <dl class="faq">${faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join('')}</dl>
  </div>

  <div class="card">
    <h2 class="secTitle">🇰🇷 국가 육아 지원금 (${YEAR})</h2>
    ${natTable()}
    <p class="sub" style="margin:14px 0 0;font-size:12px">아동수당은 ${YEAR}년 9세 미만까지(2030년 13세까지 단계적 확대). 부모급여는 가정양육 현금 기준.</p>
  </div>

  <div class="card">
    ${nearbyLinks ? `<h2 class="secTitle">📍 ${esc(sido)} 다른 지역</h2><div class="nearby" style="margin-bottom:16px">${nearbyLinks}</div>` : ''}
    <h2 class="secTitle">🔎 다른 지역·지원사업 찾기</h2>
    ${miniSearch()}
  </div>

  ${mergeNote(sido, sgg)}
  <p class="disclaimer">※ 참고용 정보입니다. 실제 수급 여부·금액은 소득/재산 기준, 거주 요건, 신청 시기, 조례 개정에 따라 달라질 수 있어요. 지자체 지원금은 복지로·주민센터에서 최종 확인하세요. 본 서비스는 정부·지자체 공식 서비스가 아닙니다.</p>
  <footer>baby<b>hyetaek</b>.com · <a href="/">홈</a> · <a href="/about">소개</a> · <a href="/privacy">개인정보처리방침</a> · <a href="/contact">문의</a></footer>
</div>
<script src="${assetUrl('/assets/region-page.js')}" defer></script>
</body></html>`;
}

// '2026-07-01' → '7월 1일'
function info2kr(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}월 ${d}일`;
}

// ── 빌드 ──
// ── 행정구역 개편 정규화: DB의 시도·시군구 키를 현행 명칭으로 바꾼 뒤 페이지를 만든다 ──
// build-local.js가 이미 정규화하므로 대개 no-op이지만, 옛 이름이 섞인 DB로도 빌드되게 남겨둔다(멱등).
{
  const merged = {};
  for (const [sido, bucket] of Object.entries(DB.sido)) {
    for (const [sgg, list] of Object.entries(bucket)) {
      const n = normRegion(sido, sgg);
      const dst = (merged[n.sido] = merged[n.sido] || {});
      dst[n.sgg] = [...(dst[n.sgg] || []), ...list];
    }
  }
  // 신설 구 빈 버킷 — build-local.js도 만들지만, 옛 local-benefits.js로 빌드돼도 페이지가 빠지지 않게 여기서도 보장한다(멱등)
  for (const [sido, m] of Object.entries(PENDING_SGG)) {
    if (!merged[sido]) continue;
    for (const sgg of Object.keys(m)) merged[sido][sgg] = merged[sido][sgg] || [];
  }
  DB.sido = merged;
}

// 정규화가 끝난 뒤 집계 — 개편 전 이름으로 흩어진 지역이 합쳐진 상태여야 순위·분포가 맞는다.
// 자체 사업 0건인 신설 구는 집계에서 뺀다 — 넣으면 "직접 운영하는 사업 0개로 12곳 중 12위"라는,
// 사실은 데이터 미등록인 것을 지자체가 안 하는 것처럼 보이게 하는 문장이 나온다.
{
  const statsView = {};
  for (const [sido, bucket] of Object.entries(DB.sido)) {
    statsView[sido] = {};
    for (const [sgg, list] of Object.entries(bucket)) if (!isPendingEmpty(sido, sgg, bucket)) statsView[sido][sgg] = list;
  }
  STATS = ST.buildIndex(statsView, isRealSgg);
}
console.log(`[build-pages] 집계 — 지역 ${Object.keys(STATS.perRegion).length}곳 · 첫째 금액 확인 ${STATS.amounts.length}곳`);

// 옛 이름으로 이미 색인된 URL이 있으므로 (구슬러그 → 신슬러그) 쌍을 모아 _redirects를 쓴다.
// ⚠️ 입력이 이미 정규화돼 있어도 리디렉션이 사라지면 안 되므로, "이번 빌드에서 이름이 바뀐 것"이 아니라
//    현행 지역명에 대응하는 개편 전 이름(regions.js의 정적 맵)으로 만든다.
const redirectPairs = [];
for (const [sido, bucket] of Object.entries(DB.sido)) {
  for (const sgg of Object.keys(bucket)) {
    if (!isRealSgg(sgg)) continue;
    for (const [oldSido, oldSgg] of legacyNames(sido, sgg)) {
      redirectPairs.push([slug(oldSido, oldSgg), slug(sido, sgg)]);
    }
  }
}

const outDir = path.join(PUB, 'r');
// 이번 빌드가 만들 슬러그 전체 — 페이지 삭제 가드와 「형제 구 페이지가 실제로 있는가」 판정에 같이 쓴다
const SLUGS = new Set();
for (const [sido, bucket] of Object.entries(DB.sido)) {
  for (const sgg of Object.keys(bucket).filter(isRealSgg)) SLUGS.add(slug(sido, sgg));
}
// 지우기 전에 무엇이 사라질지 본다. 2026-08-01에 이 자리에서 /r/ 22개가 조용히 삭제됐다.
// 정상 churn은 0건(50커밋 실측)이라 허용 5면 충분하다.
guardPages(outDir, SLUGS, { label: '지역', max: 5 });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// urls와 짝을 이루는 실제 파일 경로 — lastmod를 내용 해시로 판정하는 데 쓴다
const urls = [`${ORIGIN}/`];
const files = [path.join(PUB, 'index.html')];
let count = 0;
let ppPages = 0;
const hubIndex = []; // [sido, sggs[]] — 허브 페이지용 (지역 페이지가 홈에서 고아가 되지 않도록)
for (const [sido, bucket] of Object.entries(DB.sido)) {
  const sggs = Object.keys(bucket).filter(isRealSgg);
  for (const sgg of sggs) {
    // 광역 사업은 권역별로 갈라 붙인다 — 전남광주는 옛 광주/전남 사업이 섞여 있다(regions.js).
    const own = bucket[sgg] || [];
    const list = [...own, ...commonFor(bucket, sido, sgg)]
      .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
    const nearby = sggs.filter((s) => s !== sgg).slice(0, 12);
    fs.writeFileSync(path.join(outDir, `${slug(sido, sgg)}.html`), page(sido, sgg, list, nearby, own));
    urls.push(`${ORIGIN}/r/${encodeURIComponent(slug(sido, sgg))}`);
    files.push(path.join(outDir, `${slug(sido, sgg)}.html`));
    count++;
    if ((ppBy[`${sido}|${sgg}`] || []).length) ppPages++;
  }
  if (sggs.length) hubIndex.push([sido, sggs]);
}
if (PP) console.log(`[build-pages] 산후조리원 ${PP.items.length}곳(기준일 ${PP.sourceUpdatedAt}) — 1곳 이상인 지역 페이지 ${ppPages}/${count}`);

// 시도 표시 순서 — 행정표준코드 순(regions.js SIDO_SHORT), 목록에 없는 시도는 끝에
const sidoRank = (s) => { const i = Object.keys(SIDO_SHORT).indexOf(s); return i < 0 ? 99 : i; };
const sidoKey = (sido) => nk(sido + (SIDO_SHORT[sido] || ''));

// ── 허브 검색 색인 (2026-09-13) → public/assets/benefit-index.js ──
// 허브 검색은 사업 "이름"과 "지역"만 있으면 된다. local-benefits.js(1.2MB)를 허브에서 받게 하지 않으려고 따로 뽑는다.
// regions: [시도, 표시명, 슬러그('' = 시군구 페이지 없음)] · items: [사업명, regions 인덱스]
{
  const regions = [];
  const items = [];
  for (const [sido, bucket] of Object.entries(DB.sido).sort((a, b) => sidoRank(a[0]) - sidoRank(b[0]))) {
    for (const [k, list] of Object.entries(bucket)) {
      if (!list.length) continue;
      const label = isRealSgg(k) ? k : k.replace(/^\(광역 공통\)$/, '시도 공통').replace(/^\(광역 공통·(.+)\)$/, '옛 $1 권역 공통');
      const ri = regions.push([sido, label, isRealSgg(k) ? slug(sido, k) : '']) - 1;
      const seen = new Set();
      for (const b of list) {
        if (!b.nm || seen.has(b.nm)) continue;
        seen.add(b.nm);
        items.push([b.nm, ri]);
      }
    }
  }
  const js = 'window.BENEFIT_INDEX=' + JSON.stringify({ regions, items }) + ';\n';
  fs.writeFileSync(path.join(PUB, 'assets', 'benefit-index.js'), js);
  console.log(`[build-pages] 검색 색인 assets/benefit-index.js — 사업 ${items.length}건 · ${(Buffer.byteLength(js) / 1024).toFixed(0)}KB`);
}

// ── 지역 허브 (/r/) ──
// 홈에서 지역 페이지로 가는 정적 링크가 0개라 사이트맵으로만 발견되던 문제를 해소한다.
// 홈 → /r/ → 시군구 페이지 전체로 링크가 흐르게 하는 것이 목적.
{
  const title = `전국 시군구 출산지원금·육아 지원금 ${YEAR} — 우리 동네 찾기`;
  const desc = `전국 ${count}개 시군구의 ${YEAR}년 출산지원금·육아 지원금을 지역별로 정리했습니다. 우리 동네를 골라 국가 수당과 지자체 지원금을 합친 8세까지 총액을 확인하세요.`;
  const url = `${ORIGIN}/r/`;
  const groups = hubIndex.slice().sort((a, b) => b[1].length - a[1].length).map(([sido, sggs]) =>
    `<div class="card" id="sido-${esc(sido)}" data-key="${esc(sidoKey(sido))}"><h2 class="secTitle">${esc(sido)} <span class="cnt">${sggs.length}곳</span></h2>
<div class="nearby">${sggs.map((s) => `<a href="/r/${encodeURIComponent(slug(sido, s))}" data-q="${esc(nk(sido + (SIDO_SHORT[sido] || '') + s))}">${esc(s)}</a>`).join('')}</div></div>`).join('\n');

  const hub = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="stylesheet" href="${assetUrl('/assets/region.css')}">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-6CZCXLHZVB"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-6CZCXLHZVB');</script>
</head><body>
<div class="shell">
  <header>
    <div class="logo"><a href="/" style="color:inherit">베이비<b>혜택</b></a></div>
    <div class="crumb"><a href="/">홈</a> › 지역별</div>
  </header>
  <h1>우리 동네<br>출산·육아 지원금 (${YEAR})</h1>
  <p class="sub">전국 ${count}개 시군구별로 국가 수당과 지자체 지원금을 합친 8세까지 총액을 정리했어요. 사는 지역을 골라보세요.</p>
  <form class="rSearchBox" action="/r/" method="get" role="search">
    <label for="rSearch" class="srOnly">지역·지원사업 검색</label>
    <input id="rSearch" name="q" type="search" placeholder="시군구·지원사업 이름 (예: 검단구, 첫만남)" autocomplete="off">
  </form>
  <div id="rResults" aria-live="polite"></div>
${groups}
  <p class="disclaimer">※ 참고용 정보입니다. 실제 수급 여부·금액은 소득/재산 기준, 거주 요건, 신청 시기, 조례 개정에 따라 달라질 수 있어요. 본 서비스는 정부·지자체 공식 서비스가 아닙니다.</p>
  <footer>baby<b>hyetaek</b>.com · <a href="/">홈</a> · <a href="/guide/">가이드</a> · <a href="/about">소개</a> · <a href="/privacy">개인정보처리방침</a> · <a href="/contact">문의</a></footer>
</div>
<script src="${assetUrl('/assets/benefit-index.js')}"></script>
<script src="${assetUrl('/assets/region-search.js')}"></script>
</body></html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), hub);
  urls.push(url);
  files.push(path.join(outDir, 'index.html'));
  console.log(`[build-pages] 지역 허브 /r/ 생성 — ${hubIndex.length}개 시도 · ${count}개 시군구 링크`);
}

// ── 홈 「우리 동네 혜택 찾기」 (2026-09-13) ──
// 시도 <details> → 시군구 링크. JS 없이 2번 클릭으로 지역 페이지에 닿는다.
// 홈 위저드는 <select>라 크롤러가 지역 페이지로 따라가지 못하므로, 이 목록이 홈→지역 페이지의 정적 링크 경로가 된다.
// index.html은 손으로 쓴 파일이라 마커 사이만 갈아 끼운다. lastmod 판정(아래 sitemap) 전에 해야 홈 날짜가 맞는다.
{
  const idxPath = path.join(PUB, 'index.html');
  const START = '<!-- REGION-FINDER:START -->';
  const END = '<!-- REGION-FINDER:END -->';
  const src = fs.readFileSync(idxPath, 'utf8');
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  if (a < 0 || b < a) {
    console.warn('[build-pages] ⚠️ index.html에 REGION-FINDER 마커가 없어 「우리 동네 혜택 찾기」를 갱신하지 못했습니다');
  } else {
    const blocks = hubIndex.slice().sort((x, y) => sidoRank(x[0]) - sidoRank(y[0])).map(([sido, sggs]) =>
      `    <details class="rfSido"><summary>${esc(sido)}<span>${sggs.length}곳</span></summary><div class="rfList">${
        sggs.slice().sort((p, q) => p.localeCompare(q, 'ko')).map((s) => `<a href="/r/${encodeURIComponent(slug(sido, s))}">${esc(s)}</a>`).join('')
      }</div></details>`).join('\n');
    const html = `${START}
  <section class="regionEntry" id="region-finder">
    <h2>우리 동네 혜택 찾기</h2>
    <p>시·도를 누르고 시·군·구를 고르면 그 지역 지원금과 산후조리원 정보로 바로 가요.</p>
${blocks}
    <a class="rfAll" href="/r/">지역·지원사업 이름으로 검색하기 →</a>
  </section>
  `;
    const next = src.slice(0, a) + html + src.slice(b);
    if (next !== src) fs.writeFileSync(idxPath, next);
  }
}

// sitemap — lastmod는 페이지 내용이 실제로 바뀐 URL만 오늘 날짜로 올라간다(scripts/lastmod.js 주석 참고)
const rows = lastmod.stamp(urls.map((u, i) => ({ url: u, file: files[i] })));
fs.writeFileSync(path.join(PUB, 'sitemap.xml'), lastmod.xml(rows));
fs.writeFileSync(path.join(PUB, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);

// 행정구역 개편으로 URL이 바뀐 지역은 옛 주소를 301로 넘긴다(이미 색인된 링크 보존)
if (redirectPairs.length) {
  const lines = redirectPairs
    .map(([from, to]) => `/r/${encodeURIComponent(from)} /r/${encodeURIComponent(to)} 301`)
    .join('\n');
  fs.writeFileSync(path.join(PUB, '_redirects'), lines + '\n');
  console.log(`[build-pages] _redirects ${redirectPairs.length}건 (행정구역 개편 전 URL → 현행 URL)`);
}

console.log(`[build-pages] 지역 페이지 ${count}개 + sitemap(${urls.length} URL) + robots.txt`);
console.log(`[build-pages] 국가수당 헤드라인(첫째): ${man(NAT_HEADLINE)}`);
