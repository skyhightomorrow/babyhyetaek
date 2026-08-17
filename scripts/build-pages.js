#!/usr/bin/env node
/**
 * 시군구별 정적 SEO 페이지 생성 → public/r/{시도}-{시군구}.html + sitemap.xml
 * 각 페이지: 그 지역 지자체 지원금 프리렌더 + 국가수당 요약 + 계산기 CTA.
 * "화성시 출산지원금 2026" 롱테일 검색 타겟(현재 블로그 점령).
 *
 * 사용: node scripts/build-pages.js
 * 전제: public/local-benefits.js (build-local.js가 먼저 생성)
 */
const fs = require('fs');
const path = require('path');
const { NATIONAL } = require('../lib/national');
const lastmod = require('./lastmod');

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
const { normRegion, legacyNames } = require('./regions');
// 조건 표·집계 문장용 (2026-08-17). 지역 페이지가 "나열"에서 "집계·해석"으로 넘어가는 부분.
const ST = require('./_local-stats');

// 시군구 페이지를 만드는 키인지 — 교육청·(광역 공통)은 시군구가 아니라 페이지를 만들지 않는다.
// 집계 모수도 같은 기준이어야 "전국 N곳 중 M위" 문장이 실제 페이지 수와 맞는다.
const isRealSgg = (k) => k !== '(광역 공통)' && !/교육청/.test(k) && k.trim().length >= 2;

// 전국·시도 집계는 페이지마다 다시 돌면 214번 반복되므로 빌드 시작 때 한 번만 만든다(정규화 직후 대입).
let STATS = { perRegion: {}, bySido: {}, amounts: [] };

const man = (n) => Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (sido, sgg) => `${sido}-${sgg}`.replace(/[()]/g, '').replace(/\s+/g, '');

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
    return `<tr>
      <th scope="row">
        <span class="bNm">${esc(b.nm)}</span>
        ${b.law ? `<span class="bLaw">📜 ${esc(b.law)}</span>` : ''}
        ${mod ? `<span class="bLaw">갱신 ${mod}</span>` : ''}
      </th>
      <td class="bAmt">${amount ? esc(amount) : '<span class="bDim">공고 확인 필요</span>'}</td>
      <td>${pay}<span class="bDim"> · ${cyc}</span></td>
      <td>${esc(critShort(b))}</td>
      <td>${how}${b.tel ? `<span class="bDim">${esc(b.tel)}</span>` : ''}${b.link ? `<a class="bLink" href="${esc(b.link)}" target="_blank" rel="noopener">복지로 →</a>` : ''}</td>
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

// 개편된 지역에는 안내를 붙인다. 지원사업·조례 이름에는 옛 지자체명이 그대로 남아 있어
// (예: '전라남도 출생기본수당 지원 조례') 그대로 두는 것이 정확한데, 설명이 없으면 이용자가 혼동한다.
function mergeNote(sido, sgg) {
  if (sido === '전남광주통합특별시')
    return `<p class="disclaimer">※ 2026년 7월 1일 <b>광주광역시와 전라남도가 전남광주통합특별시로 통합</b>됐습니다(전남광주통합특별시 설치를 위한 특별법). 아래 지원사업 이름에 '전라남도'가 남아 있는 것은 <b>조례의 정식 명칭</b>이기 때문이며, ${esc(sgg)} 주민이 그대로 신청할 수 있습니다.</p>`;
  if (sido === '인천광역시' && (sgg === '제물포구' || sgg === '서해구'))
    return `<p class="disclaimer">※ 2026년 7월 1일 인천 자치구가 개편돼 <b>${sgg === '제물포구' ? '동구가 제물포구로' : '서구가 서해구와 검단구로'}</b> 바뀌었습니다. 지원사업 이름에 옛 구 이름이 남아 있을 수 있습니다.</p>`;
  return '';
}

function page(sido, sgg, list, nearby) {
  const key = `${sido}|${sgg}`;
  const s = STATS.perRegion[key] || { n: list.length, cash: 0, localCurrency: 0, online: 0, once: 0, monthly: 0, headline: null };
  const head = s.headline;

  // ── title·description: 지역 고유 숫자를 앞으로 (2026-08-17) ──
  // 기존에는 "총 얼마 받나요?"라고 묻기만 하고 답이 없었다. D는 description을 금액으로 바꾼 뒤
  // 순위가 그대로여도 CTR이 먼저 움직였다("지급기준" 롱테일에서 네이버 CTR 100%). F는 이미 5.8~10.5위라
  // 순위가 아니라 CTR이 병목이므로 이 변경이 1차 지표다.
  const title = head
    ? `${sgg} 출산지원금 ${YEAR} — 첫째 ${man(head.won)} + 국가 ${man(NAT_HEADLINE)}`
    : `${sgg} 출산지원금·육아 지원금 ${YEAR} — 지원사업 ${s.n}개 + 국가 ${man(NAT_HEADLINE)}`;

  const payHint = s.localCurrency > 0
    ? `${s.localCurrency}개는 지역화폐로 지급됩니다.`
    : (s.cash > 0 ? `현금 지급 ${s.cash}개.` : '');
  const applyHint = s.online === 0 ? '신청은 전부 주민센터 방문입니다.' : `${s.online}개는 온라인 신청이 됩니다.`;
  // "받을 수 있는"(=자체+광역 s.n)과 "직접 운영하는"(=s.own)을 섞지 말 것 — 위 summarize 주석 참고.
  const desc = head
    ? `${sido} ${sgg} 첫째 아이 출산지원금 ${man(head.won)}. ${sgg}에서 받을 수 있는 육아·출산 지원사업 ${s.n}개의 금액·지급수단·소득기준·신청처를 한 표에 정리했습니다. ${payHint} ${applyHint} 국가 수당(부모급여·첫만남이용권·아동수당) 8세까지 ${man(NAT_HEADLINE)}과 합산.`
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
<link rel="stylesheet" href="/assets/region.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-6CZCXLHZVB"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-6CZCXLHZVB');</script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head><body>
<div class="shell">
  <header>
    <div class="logo"><a href="/" style="color:inherit">베이비<b>혜택</b></a></div>
    <div class="crumb"><a href="/">홈</a> › ${esc(sido)} › ${esc(sgg)}</div>
  </header>
  <h1>${esc(sido)} ${esc(sgg)}<br>출산·육아 지원금 (${YEAR})</h1>
  <p class="sub">${esc(sgg)}에 사는 우리 집이 아이 태어나서 8세까지 받는 지원금을 국가 수당 + 지자체 지원금으로 정리했어요.</p>

  <div class="card">
    <div class="freshBadge">${YEAR}년 기준 · 지자체 데이터 ${esc((DB.staleAsOf || {})[sido] || DB.builtAt)} 갱신</div>
    <p class="sumCap">${esc(sgg)} · 첫째 아이 기준</p>
    <div class="sumNum">약 ${man(NAT_HEADLINE)}</div>
    <p class="sumCap">아이 태어나서 8세까지 받는 <b>국가 지원금 합계</b><br>여기에 아래 <b>${esc(sgg)} 지자체 지원금</b>이 추가돼요.</p>
    <a class="cta" href="/">내 조건으로 정확히 계산하기 →</a>
  </div>

  <div class="adSlot"><span>광고 영역</span></div>

  <div class="card">
    <h2 class="secTitle">🏙️ ${ST.i_ga(esc(sgg))} 주는 지자체 지원금 <span style="color:var(--dim);font-weight:600;font-size:13px">${list.length}개</span></h2>
    <p class="sub" style="margin:0 0 14px">출처: 한국사회보장정보원 공공데이터(복지로) · 조회 많은 순</p>
    ${localSection(sido, sgg, list)}
  </div>

  ${analysisSection(sido, sgg, key, STATS)}

  <div class="card">
    <h2 class="secTitle">❓ ${esc(sgg)} 출산지원금 자주 묻는 질문</h2>
    <dl class="faq">${faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join('')}</dl>
  </div>

  <div class="card">
    <h2 class="secTitle">🇰🇷 국가 육아 지원금 (${YEAR})</h2>
    ${natTable()}
    <p class="sub" style="margin:14px 0 0;font-size:12px">아동수당은 ${YEAR}년 9세 미만까지(2030년 13세까지 단계적 확대). 부모급여는 가정양육 현금 기준.</p>
  </div>

  ${nearbyLinks ? `<div class="card"><h2 class="secTitle">📍 ${esc(sido)} 다른 지역</h2><div class="nearby">${nearbyLinks}</div></div>` : ''}

  ${mergeNote(sido, sgg)}
  <p class="disclaimer">※ 참고용 정보입니다. 실제 수급 여부·금액은 소득/재산 기준, 거주 요건, 신청 시기, 조례 개정에 따라 달라질 수 있어요. 지자체 지원금은 복지로·주민센터에서 최종 확인하세요. 본 서비스는 정부·지자체 공식 서비스가 아닙니다.</p>
  <footer>baby<b>hyetaek</b>.com · <a href="/">홈</a> · <a href="/about">소개</a> · <a href="/privacy">개인정보처리방침</a> · <a href="/contact">문의</a></footer>
</div>
</body></html>`;
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
  DB.sido = merged;
}

// 정규화가 끝난 뒤 집계 — 개편 전 이름으로 흩어진 지역이 합쳐진 상태여야 순위·분포가 맞는다.
STATS = ST.buildIndex(DB.sido, isRealSgg);
console.log(`[build-pages] 집계 — 지역 ${Object.keys(STATS.perRegion).length}곳 · 첫째 금액 확인 ${STATS.amounts.length}곳`);

// 옛 이름으로 이미 색인된 URL이 있으므로 (구슬러그 → 신슬러그) 쌍을 모아 _redirects를 쓴다.
// ⚠️ 입력이 이미 정규화돼 있어도 리디렉션이 사라지면 안 되므로, "이번 빌드에서 이름이 바뀐 것"이 아니라
//    현행 지역명에 대응하는 개편 전 이름(regions.js의 정적 맵)으로 만든다.
const redirectPairs = [];
for (const [sido, bucket] of Object.entries(DB.sido)) {
  for (const sgg of Object.keys(bucket)) {
    if (sgg === '(광역 공통)' || /교육청/.test(sgg) || sgg.trim().length < 2) continue;
    for (const [oldSido, oldSgg] of legacyNames(sido, sgg)) {
      redirectPairs.push([slug(oldSido, oldSgg), slug(sido, sgg)]);
    }
  }
}

const outDir = path.join(PUB, 'r');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// urls와 짝을 이루는 실제 파일 경로 — lastmod를 내용 해시로 판정하는 데 쓴다
const urls = [`${ORIGIN}/`];
const files = [path.join(PUB, 'index.html')];
let count = 0;
const hubIndex = []; // [sido, sggs[]] — 허브 페이지용 (지역 페이지가 홈에서 고아가 되지 않도록)
for (const [sido, bucket] of Object.entries(DB.sido)) {
  const sggs = Object.keys(bucket).filter((k) => k !== '(광역 공통)' && !/교육청/.test(k) && k.trim().length >= 2);
  const common = bucket['(광역 공통)'] || [];
  for (const sgg of sggs) {
    const list = [...(bucket[sgg] || []), ...common].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
    const nearby = sggs.filter((s) => s !== sgg).slice(0, 12);
    fs.writeFileSync(path.join(outDir, `${slug(sido, sgg)}.html`), page(sido, sgg, list, nearby));
    urls.push(`${ORIGIN}/r/${encodeURIComponent(slug(sido, sgg))}`);
    files.push(path.join(outDir, `${slug(sido, sgg)}.html`));
    count++;
  }
  if (sggs.length) hubIndex.push([sido, sggs]);
}

// ── 지역 허브 (/r/) ──
// 홈에서 지역 페이지로 가는 정적 링크가 0개라 사이트맵으로만 발견되던 문제를 해소한다.
// 홈 → /r/ → 시군구 페이지 전체로 링크가 흐르게 하는 것이 목적.
{
  const title = `전국 시군구 출산지원금·육아 지원금 ${YEAR} — 우리 동네 찾기`;
  const desc = `전국 ${count}개 시군구의 ${YEAR}년 출산지원금·육아 지원금을 지역별로 정리했습니다. 우리 동네를 골라 국가 수당과 지자체 지원금을 합친 8세까지 총액을 확인하세요.`;
  const url = `${ORIGIN}/r/`;
  const groups = hubIndex.slice().sort((a, b) => b[1].length - a[1].length).map(([sido, sggs]) =>
    `<div class="card"><h2 class="secTitle">${esc(sido)} <span style="color:var(--dim);font-weight:600;font-size:13px">${sggs.length}곳</span></h2>
<div class="nearby">${sggs.map((s) => `<a href="/r/${encodeURIComponent(slug(sido, s))}">${esc(s)}</a>`).join('')}</div></div>`).join('\n');

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
<link rel="stylesheet" href="/assets/region.css">
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
${groups}
  <p class="disclaimer">※ 참고용 정보입니다. 실제 수급 여부·금액은 소득/재산 기준, 거주 요건, 신청 시기, 조례 개정에 따라 달라질 수 있어요. 본 서비스는 정부·지자체 공식 서비스가 아닙니다.</p>
  <footer>baby<b>hyetaek</b>.com · <a href="/">홈</a> · <a href="/guide/">가이드</a> · <a href="/about">소개</a> · <a href="/privacy">개인정보처리방침</a> · <a href="/contact">문의</a></footer>
</div>
</body></html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), hub);
  urls.push(url);
  files.push(path.join(outDir, 'index.html'));
  console.log(`[build-pages] 지역 허브 /r/ 생성 — ${hubIndex.length}개 시도 · ${count}개 시군구 링크`);
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
