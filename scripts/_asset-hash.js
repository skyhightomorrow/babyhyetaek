// 로컬 JS/CSS 캐시 무효화용 콘텐츠 해시 (2026-09-13 신설)
//
// 왜 필요한가: Cloudflare Pages는 JS/CSS에 `Cache-Control: public, max-age=14400`(4시간)을 붙인다.
//   손으로 박은 ?v=20260817 은 파일이 바뀌어도 아무도 안 올리면 그대로라, 재방문자는 최대 4시간 동안
//   낡은 local-benefits.js(09-07 재생성분)나 region.css를 받는다. HTML은 새것인데 데이터·스타일이 옛것인 조합이 생긴다.
// → 파일 내용의 md5 앞 10자를 ?v= 로 붙인다. 내용이 같으면 URL도 같아 캐시가 유지되고, 바뀌면 즉시 새 URL이 된다.
//   날짜가 아니라 내용 기준이라 daily.yml이 매일 돌아도 바뀐 파일만 URL이 달라진다(lastmod 판정도 흔들리지 않는다).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUB = path.join(__dirname, '..', 'public');

/** '/assets/region.css' → 'abcdef0123' (파일이 없으면 null) */
function hashOf(webPath) {
  try {
    const buf = fs.readFileSync(path.join(PUB, webPath.replace(/^\//, '')));
    return crypto.createHash('md5').update(buf).digest('hex').slice(0, 10);
  } catch {
    return null;
  }
}

/** '/assets/region.css' → '/assets/region.css?v=abcdef0123' — 빌더가 <link>/<script>를 찍을 때 쓴다 */
function assetUrl(webPath) {
  const h = hashOf(webPath);
  return h ? `${webPath}?v=${h}` : webPath;
}

module.exports = { hashOf, assetUrl, PUB };
