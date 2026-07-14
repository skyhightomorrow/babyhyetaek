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

const ORIGIN = process.env.SITE_ORIGIN || 'https://babyhyetaek.com';
const YEAR = 2026;
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

// local-benefits.js 로드 (window.LOCAL_BENEFITS = {...};)
const lbRaw = fs.readFileSync(path.join(PUB, 'local-benefits.js'), 'utf8');
const DB = JSON.parse(lbRaw.replace(/^window\.LOCAL_BENEFITS\s*=\s*/, '').replace(/;\s*$/, ''));

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

function localSection(sido, sgg, list) {
  if (!list.length) return '<p class="sub">이 지역의 공공데이터 상세를 준비 중입니다.</p>';
  const items = list.slice(0, 20).map((b) => {
    const mod = b.mod ? `갱신 ${b.mod.slice(0, 4)}.${b.mod.slice(4, 6)}` : '';
    return `<div class="locItem">
      <div class="locNm">${esc(b.nm)}</div>
      ${b.amt ? `<div class="locAmt">${esc(b.amt)}</div>` : (b.dgst ? `<div class="locAmt" style="color:var(--mut)">${esc(b.dgst)}</div>` : '')}
      <div class="locMeta">${b.law ? '📜 ' + esc(b.law) : ''} ${mod ? '· ' + mod : ''} ${b.link ? `· <a href="${esc(b.link)}" target="_blank" rel="noopener">복지로 상세 →</a>` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="locList">${items}</div>` + (list.length > 20 ? `<p class="sub" style="text-align:center;margin-top:12px">외 ${list.length - 20}개 더</p>` : '');
}

function page(sido, sgg, list, nearby) {
  const title = `${sido} ${sgg} 출산지원금·육아 지원금 ${YEAR} — 총 얼마 받나요?`;
  const desc = `${sido} ${sgg}에서 ${YEAR}년 받을 수 있는 출산·육아 지원금 총정리. 국가 수당(부모급여·첫만남이용권·아동수당)에 ${sgg} 지자체 지원금까지 합쳐 8세까지 총액을 계산해 드려요. 최신 공공데이터 기반.`;
  const url = `${ORIGIN}/r/${encodeURIComponent(slug(sido, sgg))}.html`;
  const nearbyLinks = nearby.map((n) => `<a href="/r/${encodeURIComponent(slug(sido, n))}.html">${esc(n)}</a>`).join('');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [{
      '@type': 'Question', name: `${sido} ${sgg}에서 아이를 낳으면 지원금을 얼마나 받나요?`,
      acceptedAnswer: { '@type': 'Answer', text: `국가 수당만 첫째 기준 약 ${man(NAT_HEADLINE)}(8세까지)이며, 여기에 ${sgg}가 조례로 주는 지자체 지원금이 추가됩니다.` },
    }],
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
    <div class="freshBadge">${YEAR}년 기준 · 지자체 데이터 ${esc(DB.builtAt)} 갱신</div>
    <p class="sumCap">${esc(sgg)} · 첫째 아이 기준</p>
    <div class="sumNum">약 ${man(NAT_HEADLINE)}</div>
    <p class="sumCap">아이 태어나서 8세까지 받는 <b>국가 지원금 합계</b><br>여기에 아래 <b>${esc(sgg)} 지자체 지원금</b>이 추가돼요.</p>
    <a class="cta" href="/">내 조건으로 정확히 계산하기 →</a>
  </div>

  <div class="adSlot"><span>광고 영역</span></div>

  <div class="card">
    <h2 class="secTitle">🏙️ ${esc(sgg)}가 주는 지자체 지원금 <span style="color:var(--dim);font-weight:600;font-size:13px">${list.length}개</span></h2>
    <p class="sub" style="margin:0 0 14px">출처: 한국사회보장정보원 공공데이터(복지로) · 조회 많은 순</p>
    ${localSection(sido, sgg, list)}
  </div>

  <div class="card">
    <h2 class="secTitle">🇰🇷 국가 육아 지원금 (${YEAR})</h2>
    ${natTable()}
    <p class="sub" style="margin:14px 0 0;font-size:12px">아동수당은 ${YEAR}년 9세 미만까지(2030년 13세까지 단계적 확대). 부모급여는 가정양육 현금 기준.</p>
  </div>

  ${nearbyLinks ? `<div class="card"><h2 class="secTitle">📍 ${esc(sido)} 다른 지역</h2><div class="nearby">${nearbyLinks}</div></div>` : ''}

  <p class="disclaimer">※ 참고용 정보입니다. 실제 수급 여부·금액은 소득/재산 기준, 거주 요건, 신청 시기, 조례 개정에 따라 달라질 수 있어요. 지자체 지원금은 복지로·주민센터에서 최종 확인하세요. 본 서비스는 정부·지자체 공식 서비스가 아닙니다.</p>
  <footer>baby<b>hyetaek</b>.com · <a href="/">홈</a> · <a href="/about.html">소개</a> · <a href="/privacy.html">개인정보처리방침</a> · <a href="/contact.html">문의</a></footer>
</div>
</body></html>`;
}

// ── 빌드 ──
const outDir = path.join(PUB, 'r');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const urls = [`${ORIGIN}/`];
let count = 0;
for (const [sido, bucket] of Object.entries(DB.sido)) {
  const sggs = Object.keys(bucket).filter((k) => k !== '(광역 공통)' && !/교육청/.test(k) && k.trim().length >= 2);
  const common = bucket['(광역 공통)'] || [];
  for (const sgg of sggs) {
    const list = [...(bucket[sgg] || []), ...common].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
    const nearby = sggs.filter((s) => s !== sgg).slice(0, 12);
    fs.writeFileSync(path.join(outDir, `${slug(sido, sgg)}.html`), page(sido, sgg, list, nearby));
    urls.push(`${ORIGIN}/r/${encodeURIComponent(slug(sido, sgg))}.html`);
    count++;
  }
}

// sitemap
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
fs.writeFileSync(path.join(PUB, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(PUB, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);

console.log(`[build-pages] 지역 페이지 ${count}개 + sitemap(${urls.length} URL) + robots.txt`);
console.log(`[build-pages] 국가수당 헤드라인(첫째): ${man(NAT_HEADLINE)}`);
