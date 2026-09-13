#!/usr/bin/env node
/**
 * 빌드 마지막 단계 — public/ 의 모든 HTML에서 로컬 JS/CSS 참조의 ?v= 를 파일 내용 해시로 다시 찍는다 (2026-09-13 신설)
 *
 * 왜: Cloudflare Pages가 JS/CSS에 max-age=14400(4시간)을 붙이는데, 홈이 ?v=20260817 을 손으로 박아 두어
 *     09-07에 재생성된 local-benefits.js가 재방문자에게 최대 4시간 동안 옛 버전으로 나갔다. (자세한 배경은 _asset-hash.js)
 * 빌더(build-pages·build-guides)는 이미 해시가 붙은 URL을 찍는다. 이 스크립트는
 *   ① 손으로 쓴 public/index.html 과 ② 빌더가 모르는 새 참조를 놓치지 않기 위한 최종 안전망이다. 몇 번 돌려도 결과가 같다(멱등).
 *
 * ⚠️ 반드시 모든 JS/CSS 생성이 끝난 뒤(build-guides가 published-guides.js를 쓴 뒤) 실행할 것 — 그 전에 찍으면 해시가 한 박자 늦는다.
 * 사용: node scripts/stamp-assets.js
 */
const fs = require('fs');
const path = require('path');
const { hashOf, PUB } = require('./_asset-hash');
const lastmod = require('./lastmod');

const ORIGIN = process.env.SITE_ORIGIN || 'https://babyhyetaek.com';
// 루트 상대경로 로컬 JS/CSS만 대상 — 외부(gtag·카카오 SDK)와 이미지·아이콘은 건드리지 않는다
const REF = /((?:src|href)=")(\/[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const missing = new Set();
const changed = [];
for (const file of walk(PUB)) {
  const src = fs.readFileSync(file, 'utf8');
  const next = src.replace(REF, (m, pre, url, post) => {
    const h = hashOf(url);
    if (!h) { missing.add(url); return m; }
    return `${pre}${url}?v=${h}${post}`;
  });
  if (next !== src) {
    fs.writeFileSync(file, next);
    changed.push(path.relative(PUB, file).replace(/\\/g, '/'));
  }
}

// 홈은 build-pages가 sitemap lastmod를 먼저 찍고 난 뒤에 여기서 바뀐다 → 홈 행만 다시 판정해 날짜를 맞춘다.
// (안 하면 다음 빌드에서야 해시 차이를 발견해 lastmod가 하루 늦게 올라간다)
const smPath = path.join(PUB, 'sitemap.xml');
if (changed.includes('index.html') && fs.existsSync(smPath)) {
  const rows = lastmod.parse(smPath);
  const home = `${ORIGIN}/`;
  const [stamped] = lastmod.stamp([{ url: home, file: path.join(PUB, 'index.html') }]);
  const i = rows.findIndex((r) => r.url === home);
  if (i > -1) { rows[i] = stamped; fs.writeFileSync(smPath, lastmod.xml(rows)); }
}

const others = changed.filter((f) => f !== 'index.html');
if (others.length)
  console.warn(`[stamp-assets] ⚠️ 빌더가 해시 없이 찍은 참조가 있어 고쳤습니다(${others.length}개 — 빌더에서 assetUrl()을 쓰도록 수정 권장): ${others.slice(0, 5).join(', ')}`);
if (missing.size) console.warn(`[stamp-assets] ⚠️ 참조는 있는데 파일이 없음: ${[...missing].join(', ')}`);
console.log(`[stamp-assets] ?v= 콘텐츠 해시 갱신 — 변경 ${changed.length}개 파일${changed.length ? ` (${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ' …' : ''})` : ''}`);
