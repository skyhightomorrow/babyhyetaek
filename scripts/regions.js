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
  // 인천 중구·동구는 폐지됐다 — 중구 내륙 + 동구 = 제물포구, 중구의 영종도·용유도 = 영종구.
  // 중구 URL 하나를 두 곳으로 나눌 수는 없으므로 인구가 많은 구도심 쪽(제물포구)으로 넘긴다.
  // (2026-09-07 추가 — 소스가 영종구를 주기 시작하면서 중구 페이지가 사라져 라이브 URL이 404가 될 뻔했다.)
  if (sido === '인천광역시' && sgg === '제물포구') out.push(['인천광역시', '동구'], ['인천광역시', '중구']);
  if (sido === '인천광역시' && sgg === '서해구') out.push(['인천광역시', '서구']);
  return out;
}

// ── 광역 공통 버킷 (2026-09-07) ──
// 보통 시도의 광역 사업은 그 시도 전역에 적용되므로 버킷이 하나뿐이다.
// 전남광주만 두 옛 시도(광주광역시+전라남도)가 합쳐져 권역별 버킷이 더 붙는다 — build-local.js 참고.
const UNIFIED_SIDO = '전남광주통합특별시';
const isCommonKey = (k) => k.startsWith('(광역 공통');

/** 그 시군구 페이지에 얹을 광역 사업 목록 (전역 공통 + 해당 권역 전용) */
function commonFor(bucket, sido, sgg) {
  const base = bucket['(광역 공통)'] || [];
  if (sido !== UNIFIED_SIDO) return base;
  const key = GWANGJU_GU.has(sgg) ? '(광역 공통·광주)' : '(광역 공통·전남)';
  return bucket[key] ? [...base, ...bucket[key]] : base;
}

// ── 원천 데이터에 아직 없는 신설 구 (2026-09-13) ──
// 영종구·제물포구·서해구는 복지로가 새 이름으로 사업을 주기 시작해서 페이지가 저절로 생겼다.
// 검단구는 서구에서 갈라졌는데 복지로 검단 사업이 0건이라 페이지도, 홈 위저드 선택지도 없었다
// (검단구 주민은 자기 동네를 고를 수가 없었다).
// → 빈 버킷을 만들어 인천 광역 공통 사업 + 국가 수당만으로 페이지를 세우고, 자체 사업이 아직 없다는 사실을 페이지에 밝힌다.
// ⚠️ 지원사업을 지어 넣지 말 것. 복지로에 검단구 사업이 들어오면 own이 1 이상이 되어 일반 페이지로 저절로 넘어간다.
const PENDING_SGG = {
  인천광역시: {
    검단구: { since: '2026-07-01', from: '서구', sibling: '서해구' },
  },
};

// 시도 약칭 + 표시 순서(행정표준코드 순). 검색에서 「인천 검단」·「경기 수원」처럼 약칭으로 쳐도 맞게 하고,
// 홈 「우리 동네 혜택 찾기」 목록 순서로 쓴다. 여기 없는 시도는 목록 끝에 붙는다.
const SIDO_SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 대전광역시: '대전', 울산광역시: '울산',
  세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남',
  전북특별자치도: '전북', 전남광주통합특별시: '전남광주', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주',
};

/** 신설됐지만 원천 데이터에 자체 사업이 없는 시군구 정보 (없으면 null) */
const pendingInfo = (sido, sgg) => (PENDING_SGG[sido] && PENDING_SGG[sido][sgg]) || null;

module.exports = { SIDO_RENAME, SGG_RENAME, normRegion, legacyNames, GWANGJU_GU, UNIFIED_SIDO, isCommonKey, commonFor, PENDING_SGG, pendingInfo, SIDO_SHORT };
