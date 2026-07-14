#!/usr/bin/env node
/**
 * data/benefits.json → public/local-benefits.js
 * 시도>시군구 트리로 그룹핑, 육아/출산 관련 서비스만, 금액문구 정제.
 * 상세 미확보(detail=null)도 목록 필드로 노출(제목·요약·링크는 있음).
 */
const fs = require('fs');
const path = require('path');

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
  const sido = s.ctpv || '기타';
  const sgg = s.sgg || '(광역 공통)';
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
  });
  kept++;
}

// 각 시군구 내 조회수순 정렬
for (const sido of Object.values(bySido))
  for (const arr of Object.values(sido)) arr.sort((a, b) => b.hot - a.hot);

const out = {
  builtAt: src.fetchedAt,
  detailCoverage: `${src.detailCount}/${src.count}`,
  sido: bySido,
};

const js = 'window.LOCAL_BENEFITS = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'public', 'local-benefits.js'), js);

const sidoCount = Object.keys(bySido).length;
const sggCount = Object.values(bySido).reduce((a, s) => a + Object.keys(s).length, 0);
console.log(`[build-local] 육아/출산 관련 ${kept}건 · ${sidoCount}개 시도 · ${sggCount}개 시군구 → public/local-benefits.js (${(js.length / 1024).toFixed(0)}KB)`);
