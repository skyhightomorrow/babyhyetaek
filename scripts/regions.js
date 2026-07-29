/**
 * 2026-07-01 행정구역 개편 정규화 (공용 모듈)
 *
 * 「전남광주통합특별시 설치를 위한 특별법」(공포 2026-06-02·시행 2026-07-01)로 광주광역시+전라남도가 통합됐고,
 * 인천은 동구→제물포구, 서구→서해구 분리·검단구 신설.
 * 공공데이터포털은 아직 옛 이름을 섞어 주므로 빌드 시점에 현행 명칭으로 통일한다.
 * 옛 URL은 public/_redirects에서 301로 넘긴다(LEGACY_SLUGS).
 *
 * ⚠️ build-local.js(홈 위저드용 DB)와 build-pages.js(/r/ 지역 페이지)가 같은 맵을 써야
 *    홈 선택지와 지역 페이지의 지역명이 어긋나지 않는다.
 */
const SIDO_RENAME = { 전라남도: '전남광주통합특별시', 광주광역시: '전남광주통합특별시' };
const SGG_RENAME = { '인천광역시|동구': '제물포구', '인천광역시|서구': '서해구' };

function normRegion(sido, sgg) {
  const s2 = SIDO_RENAME[sido] || sido;
  const g2 = SGG_RENAME[`${sido}|${sgg}`] || sgg;
  return { sido: s2, sgg: g2, renamed: s2 !== sido || g2 !== sgg };
}

// 현행 (시도, 시군구) → 개편 전 이름 목록. 301 대상 URL을 만들 때 쓴다.
// 입력 데이터가 이미 정규화돼 있어도 리디렉션이 사라지지 않도록 런타임 감지가 아닌 정적 맵으로 둔다.
const GWANGJU_GU = new Set(['동구', '서구', '남구', '북구', '광산구']);

function legacyNames(sido, sgg) {
  const out = [];
  if (sido === '전남광주통합특별시') {
    // 옛 광주 자치구 5곳만 광주광역시- 슬러그를 갖고 있었고, 나머지는 전라남도- 슬러그였다.
    if (GWANGJU_GU.has(sgg)) out.push(['광주광역시', sgg]);
    else out.push(['전라남도', sgg]);
  }
  if (sido === '인천광역시' && sgg === '제물포구') out.push(['인천광역시', '동구']);
  if (sido === '인천광역시' && sgg === '서해구') out.push(['인천광역시', '서구']);
  return out;
}

module.exports = { SIDO_RENAME, SGG_RENAME, normRegion, legacyNames };
