#!/usr/bin/env node
/**
 * 가이드 예약발행 — lib/guides.js에서 date <= 오늘(KST 또는 BUILD_DATE)인 글만 생성.
 * public/guide/{slug}.html + public/guide/index.html(허브) 생성, sitemap에 병합.
 * 내부링크는 발행일이 같거나 빠른 글로만(404 방지).
 *
 * 사용: node scripts/build-guides.js   (BUILD_DATE=2026-07-18 로 시뮬레이션 가능)
 */
const fs = require('fs');
const path = require('path');
const GUIDES = require('../lib/guides');

const ORIGIN = process.env.SITE_ORIGIN || 'https://babyhyetaek.com';
const GA = 'G-6CZCXLHZVB';
const today = process.env.BUILD_DATE || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST
const PUB = path.join(__dirname, '..', 'public');
const OUT = path.join(PUB, 'guide');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const published = GUIDES.filter((g) => g.date <= today).sort((a, b) => a.date.localeCompare(b.date));

function head(title, desc, url, extraLd) {
  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="stylesheet" href="/assets/region.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA}');</script>
${extraLd || ''}
<style>.guideBody h2{font-size:18px;margin:24px 0 8px}.guideBody p{margin:0 0 12px;color:#3d4759;font-size:15.5px;line-height:1.75}.guideBody ul{margin:0 0 14px;padding-left:20px;color:#3d4759}.guideBody li{margin-bottom:6px;font-size:15px;line-height:1.7}.guideBody strong{color:#191f2e}.gdate{font-size:12.5px;color:#9aa4b2;margin-bottom:6px}.related{margin-top:8px}.related a{display:block;padding:12px 14px;background:#fafbfc;border:1px solid #eef0f4;border-radius:11px;margin-bottom:8px;color:#191f2e;font-size:14px;font-weight:600}</style>
</head><body><div class="shell">`;
}

const footer = `<footer>baby<b>hyetaek</b>.com · <a href="/">홈</a> · <a href="/guide/">가이드</a> · <a href="/about.html">소개</a> · <a href="/privacy.html">개인정보처리방침</a> · <a href="/contact.html">문의</a></footer></div></body></html>`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const guideUrls = [];
published.forEach((g, i) => {
  const url = `${ORIGIN}/guide/${g.slug}.html`;
  // 관련 글 = 이미 발행된 다른 글 중 최대 3개
  const related = published.filter((x) => x.slug !== g.slug).slice(0, 3);
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.desc, datePublished: g.date, publisher: { '@type': 'Organization', name: '베이비혜택' } })}</script>`;
  const relatedHtml = related.length
    ? `<div class="card"><h2 class="secTitle">함께 보면 좋은 글</h2><div class="related">${related.map((r) => `<a href="/guide/${r.slug}.html">${esc(r.title)}</a>`).join('')}</div></div>`
    : '';
  const html = head(g.title + ' — 베이비혜택', g.desc, url, ld) +
    `<header><div class="logo"><a href="/" style="color:inherit">베이비<b>혜택</b></a></div><div class="crumb"><a href="/">홈</a> › <a href="/guide/">가이드</a></div></header>
<h1>${esc(g.title)}</h1>
<div class="card"><div class="gdate">${g.date} · 베이비혜택</div><div class="guideBody">${g.body}</div>
<p style="margin-top:18px"><a class="cta" href="/">우리 동네 지원금 계산해보기 →</a></p></div>
<div class="adSlot"><span>광고 영역</span></div>
${relatedHtml}
<p class="disclaimer">※ 제도와 금액은 개정될 수 있어요. 신청 전 복지로(bokjiro.go.kr)와 주민센터에서 최신 정보를 확인하세요.</p>` + footer;
  fs.writeFileSync(path.join(OUT, `${g.slug}.html`), html);
  guideUrls.push(url);
});

// 가이드 허브
const hubItems = published.map((g) => `<a href="/guide/${g.slug}.html" class="locItem" style="display:block"><div class="locNm">${esc(g.title)}</div><div class="locMeta">${g.date}</div></a>`).join('');
const hub = head('육아 지원금 가이드 — 베이비혜택', '출산지원금·부모급여·육아휴직급여·지자체 지원금까지, 2026년 육아 지원 제도를 쉽게 정리했어요.', `${ORIGIN}/guide/`) +
  `<header><div class="logo"><a href="/" style="color:inherit">베이비<b>혜택</b></a></div></header>
<h1>육아 지원금 가이드</h1><p class="sub">2026년 출산·육아 지원 제도를 쉽게 정리했어요.</p>
<div class="card"><div class="locList">${hubItems || '<p class="sub">준비 중입니다.</p>'}</div></div>` + footer;
fs.writeFileSync(path.join(OUT, 'index.html'), hub);
guideUrls.push(`${ORIGIN}/guide/`);

// 발행된 가이드 slug 목록 (app.js가 미발행 글 링크 방지에 사용)
fs.writeFileSync(path.join(PUB, 'published-guides.js'), 'window.PUBLISHED_GUIDES=' + JSON.stringify(published.map((g) => g.slug)) + ';\n');

// sitemap 병합 (지역 페이지 sitemap이 이미 있으면 guide URL 추가)
const smPath = path.join(PUB, 'sitemap.xml');
let existing = [];
if (fs.existsSync(smPath)) existing = (fs.readFileSync(smPath, 'utf8').match(/<loc>(.*?)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, ''));
const allUrls = [...new Set([...existing, ...guideUrls])];
fs.writeFileSync(smPath, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allUrls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}\n</urlset>`);

console.log(`[build-guides] 발행 ${published.length}/${GUIDES.length}편 (기준일 ${today}) → public/guide/ · sitemap ${allUrls.length} URL`);
published.forEach((g) => console.log(`  ${g.date} ${g.slug}`));
