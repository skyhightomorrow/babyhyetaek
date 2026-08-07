// URL별 <lastmod> 관리
//
// 왜 필요한가: 구글은 lastmod를 "consistently and verifiably accurate"할 때만 쓴다고 명시한다
// (developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
// 매일 전 URL을 오늘 날짜로 찍으면 신호가 무의미해져 무시당하고, 아예 없으면 판단 근거가 없다.
// → 페이지 HTML이 실제로 바뀐 URL만 날짜를 올린다. 판정 근거는 렌더된 파일의 해시.
//
// 레지스트리: data/lastmod.json  { "<url>": { "hash": "<sha1 앞 16자>", "date": "YYYY-MM-DD" } }
// 반드시 커밋할 것 — 없으면 다음 빌드가 전 URL을 새로 시드한다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REG = path.join(ROOT, 'data', 'lastmod.json');

const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function load() {
  try {
    return JSON.parse(fs.readFileSync(REG, 'utf8'));
  } catch {
    return {};
  }
}

function hashOf(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

// 최초 시드용: 그 파일의 마지막 커밋일. 얕은 클론(CI)이나 git 밖에서는 null.
function gitDate(file) {
  try {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch {
    return null;
  }
}

// 워킹트리에서 HEAD와 달라진 파일 집합(시드 시 "이미 오늘 바뀐 것"을 구분하려고 한 번만 조회)
let dirtySet = null;
function isDirty(file) {
  if (dirtySet === null) {
    dirtySet = new Set();
    try {
      const out = execFileSync('git', ['status', '--porcelain', '-z'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const rec of out.split('\0')) {
        if (rec.length > 3) dirtySet.add(rec.slice(3));
      }
    } catch {
      /* git 밖이면 빈 집합 — 시드는 gitDate 또는 오늘로 떨어진다 */
    }
  }
  return dirtySet.has(path.relative(ROOT, file).replace(/\\/g, '/'));
}

/**
 * entries: [{ url, file }] → [{ url, lastmod }]  (입력 순서 유지)
 * 레지스트리를 갱신하고 저장한다. 같은 빌드에서 여러 번 호출해도 안전(병합).
 */
function stamp(entries) {
  const reg = load();
  const today = todayKST();
  const out = [];

  for (const { url, file } of entries) {
    const h = hashOf(file);
    if (h === null) {
      // 파일을 못 읽으면 기존 값 유지(없으면 오늘) — 날짜를 지어내지 않는다
      out.push({ url, lastmod: (reg[url] && reg[url].date) || today });
      continue;
    }
    const prev = reg[url];
    let date;
    if (!prev) {
      date = isDirty(file) ? today : gitDate(file) || today; // 최초 시드
    } else if (prev.hash !== h) {
      date = today; // 내용이 실제로 바뀐 페이지만 갱신
    } else {
      date = prev.date; // 그대로
    }
    reg[url] = { hash: h, date };
    out.push({ url, lastmod: date });
  }

  fs.mkdirSync(path.dirname(REG), { recursive: true });
  fs.writeFileSync(REG, JSON.stringify(reg) + '\n');
  return out;
}

const xml = (rows) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  rows
    .map((r) => `<url><loc>${r.url}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>`)
    .join('\n') +
  '\n</urlset>';

// 기존 sitemap.xml에서 [{url, lastmod}] 복원 (build-guides가 지역 sitemap에 이어붙일 때 사용)
function parse(smPath) {
  if (!fs.existsSync(smPath)) return [];
  const src = fs.readFileSync(smPath, 'utf8');
  const rows = [];
  const re = /<url>\s*<loc>(.*?)<\/loc>\s*(?:<lastmod>(.*?)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(src))) rows.push({ url: m[1], lastmod: m[2] || null });
  return rows;
}

module.exports = { stamp, xml, parse, todayKST };
