// 페이지 삭제 안전망 — 소스 결손 상태로 빌드가 돌아 라이브 페이지가 사라지는 것을 막는다.
//
// 왜 필요한가 (2026-08-30 전 사이트 점검):
//   빌드가 디렉토리를 rmSync 후 재생성하므로, 데이터가 결손된 채 빌드하면 그만큼 페이지가
//   그대로 없어지고 Actions가 그 삭제를 커밋·배포한다. 에러도 빌드 실패도 없다.
//   F는 2026-08-01에 실제로 당했다 — 공공데이터포털이 행정구역 개편 이관 중 전남·광주 88건을
//   응답에서 통째로 빼먹었고, 자동 커밋(4b17b2d 「가이드 예약발행」)이 /r/ 22개를 삭제했다.
//   build-local.js 의 시도 단위 이월(08-02 도입)이 1차 방어이고, 이건 그게 뚫렸을 때의 2차 방어다.
//   A ijacalc도 같은 유형으로 /bank/ 47개를 세 번 잃었다.
//
// ⚠️ 판정 기준을 「몇 % 감소」로 잡지 말 것 — 실측으로 기각했다:
//   F 실제 사고는 10%, D에서 시도 3곳을 통째로 빼도 7%였다. 20% 임계로는 둘 다 못 잡는다.
//   (A가 20% 가드에 걸린 건 47/97 = 48%로 유난히 컸기 때문이지 임계가 옳아서가 아니다.)
// ✅ 대신 **사라지는 페이지를 직접 센다** — 직전 파일 집합 − 이번 생성 집합 = 곧 404가 될 URL 수.
//   그게 이 조치가 막으려는 손해 그 자체이고, 사이트 규모와 무관하게 같은 의미를 갖는다.
const fs = require("fs");
const path = require("path");

/**
 * @param {string} dir      대상 디렉토리(rmSync 직전에 호출할 것)
 * @param {Iterable<string>} nextSlugs  이번 빌드가 만들 파일명(확장자 제외, 디코드된 상태)
 * @param {{label: string, max: number}} opts
 *   label 보고용 이름 · max 허용 삭제 수(정상 churn보다 넉넉히, 사고 규모보다는 작게)
 */
function guardPages(dir, nextSlugs, { label, max }) {
  const prev = new Set(
    (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .filter((f) => f.endsWith(".html") && f !== "index.html")
      .map((f) => decodeURIComponent(f.replace(/\.html$/, "")))
  );
  if (!prev.size) return; // 첫 빌드
  const next = new Set([...nextSlugs]);
  const vanished = [...prev].filter((s) => !next.has(s));
  if (vanished.length > max) {
    console.error(
      `\n🔴 빌드 중단 — ${label} 페이지 ${vanished.length}개가 사라집니다(허용 ${max}개).\n` +
        `   ${vanished.slice(0, 12).join(", ")}${vanished.length > 12 ? ` … 외 ${vanished.length - 12}개` : ""}\n` +
        `   공공데이터포털 응답 결손일 가능성이 큽니다(public/local-benefits.js 의 시도 목록 확인).\n` +
        `   의도한 감소라면 ${dir} 를 먼저 비우고 다시 빌드하세요.`
    );
    process.exit(1);
  }
  if (vanished.length) console.warn(`⚠️ ${label} 페이지 ${vanished.length}개 사라짐(허용 범위): ${vanished.join(", ")}`);
}

module.exports = { guardPages };
