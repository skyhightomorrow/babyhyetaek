#!/usr/bin/env node
/**
 * 지자체 임신·출산·영유아·아동 복지서비스 수집
 * 목록(LcgvWelfarelist, lifeArray 001/002/007) → 상세(LcgvWelfaredetailed) → data/benefits.json
 *
 * 사용법:
 *   DATA_GO_KR_KEY=... node scripts/fetch-benefits.js            # 전체
 *   DATA_GO_KR_KEY=... node scripts/fetch-benefits.js --limit 30 # 상세 30건만 (검증용)
 *
 * 한도: 일 1,000건 — 상세 전량(~1,700)은 전용 키 발급 후 or 2일 분할.
 * 진행 상태는 data/detail-cache.json에 캐시되어 재실행 시 이어받음.
 *
 *   DATA_GO_KR_KEY=... node scripts/fetch-benefits.js --incremental --limit 400   # 일일 봇(daily.yml)용
 *
 * --incremental (2026-09-13): GitHub Actions에는 detail-cache.json이 없다(gitignore). 그대로 돌리면
 *   상세 1,500건을 전부 다시 요청해 일 한도를 넘고, 못 받은 항목이 detail:null로 저장돼 지역 데이터가 비어 버린다.
 *   그래서 커밋된 benefits.json의 상세를 출발점으로 삼아 **새 항목·수정일(lastMod)이 바뀐 항목만** 다시 받는다.
 *   요청이 실패한 항목은 기존 상세를 유지하고, 목록·상세 건수가 급감하면 저장하지 않는다(API 장애를 삭제로 오인 방지).
 */
const fs = require('fs');
const path = require('path');

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) { console.error('DATA_GO_KR_KEY 필요'); process.exit(1); }

const BASE = 'http://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations';
const LIFE = [
  { code: '007', name: '임신·출산' },
  { code: '001', name: '영유아' },
  { code: '002', name: '아동' },
];
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'detail-cache.json');
const OUT_FILE = path.join(DATA_DIR, 'benefits.json');
const INCREMENTAL = process.argv.includes('--incremental');
// 날짜는 KST — Actions 러너는 UTC라 06:30 KST 실행 시 UTC 날짜가 전날이다
const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const argLimit = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 아주 단순한 XML 파서 (이 API 응답 전용: 중첩 리스트는 servList/기타 반복 태그 단위로 자름)
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : null;
}
function tags(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      if (res.ok && text.includes('<resultCode>0</resultCode>')) return text;
      // 한도 초과 등 에러 코드면 그대로 throw
      const code = (text.match(/<resultCode>(\d+)<\/resultCode>/) || [])[1];
      if (code && code !== '0') throw new Error(`API resultCode=${code}`);
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function fetchList() {
  const byId = new Map();
  for (const life of LIFE) {
    let page = 1;
    let total = Infinity;
    let got = 0;
    while (got < total) {
      const url = `${BASE}/LcgvWelfarelist?serviceKey=${KEY}&pageNo=${page}&numOfRows=100&lifeArray=${life.code}`;
      const xml = await get(url);
      total = parseInt(tag(xml, 'totalCount'), 10);
      const items = tags(xml, 'servList');
      for (const it of items) {
        const id = tag(it, 'servId');
        if (!id) continue;
        const prev = byId.get(id);
        const lifeCodes = prev ? prev.lifeCodes : [];
        if (!lifeCodes.includes(life.code)) lifeCodes.push(life.code);
        byId.set(id, {
          servId: id,
          servNm: tag(it, 'servNm'),
          ctpv: tag(it, 'ctpvNm'),
          sgg: tag(it, 'sggNm'),
          dgst: tag(it, 'servDgst'),
          cyc: tag(it, 'sprtCycNm'),
          pvsn: tag(it, 'srvPvsnNm'),
          aply: tag(it, 'aplyMtdNm'),
          link: tag(it, 'servDtlLink'),
          inqNum: parseInt(tag(it, 'inqNum') || '0', 10),
          lastMod: tag(it, 'lastModYmd'),
          lifeCodes,
        });
      }
      got += items.length;
      if (items.length === 0) break;
      page++;
      await sleep(250);
    }
    console.log(`[목록] ${life.name}(${life.code}): total=${total}`);
  }
  return [...byId.values()];
}

async function fetchDetail(servId) {
  const xml = await get(`${BASE}/LcgvWelfaredetailed?serviceKey=${KEY}&servId=${servId}`);
  return {
    target: tag(xml, 'sprtTrgtCn'),
    crit: tag(xml, 'slctCritCn'),
    benefit: tag(xml, 'alwServCn'),
    how: tag(xml, 'aplyMtdCn'),
    since: tag(xml, 'enfcBgngYmd'),
    laws: tags(xml, 'baslawList').map((b) => tag(b, 'wlfareInfoReldNm')).filter(Boolean),
    contacts: [...new Set(tags(xml, 'inqplCtadrList').map((c) => `${tag(c, 'wlfareInfoReldNm')} ${tag(c, 'wlfareInfoReldCn')}`))],
    lastMod: tag(xml, 'lastModYmd'),
  };
}

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const list = await fetchList();
  console.log(`[목록] 중복 제거 후 ${list.length}건`);
  fs.writeFileSync(path.join(DATA_DIR, 'list.json'), JSON.stringify(list, null, 1));

  const prev = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : null;
  if (INCREMENTAL && prev && list.length < prev.count * 0.7) {
    console.error(`[중단] 목록이 ${prev.count}건 → ${list.length}건으로 30% 넘게 줄었습니다. API 장애로 보고 benefits.json을 건드리지 않습니다.`);
    process.exit(1);
  }

  let cache, queue;
  if (INCREMENTAL) {
    cache = {};
    for (const it of (prev && prev.items) || []) if (it.detail) cache[it.servId] = it.detail;
    const changed = (s) => !cache[s.servId] || (s.lastMod && cache[s.servId].lastMod !== s.lastMod);
    // 새 항목 먼저, 그다음 수정된 항목을 조회수 순으로 — 한도에 걸려도 빈 상세부터 채운다
    queue = list.filter(changed).sort((a, b) => (cache[a.servId] ? 1 : 0) - (cache[b.servId] ? 1 : 0) || b.inqNum - a.inqNum);
    console.log(`[상세·증분] 기존 상세 ${Object.keys(cache).length}건, 새로·다시 받을 ${queue.length}건, 이번 실행 한도 ${argLimit}`);
  } else {
    cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
    // 조회수 높은 것부터 (인기 서비스 우선 — 한도 걸려도 핵심부터 확보)
    queue = list.filter((s) => !cache[s.servId]).sort((a, b) => b.inqNum - a.inqNum);
    console.log(`[상세] 캐시 ${Object.keys(cache).length}건, 남은 ${queue.length}건, 이번 실행 한도 ${argLimit}`);
  }

  let done = 0;
  for (const s of queue) {
    if (done >= argLimit) break;
    try {
      cache[s.servId] = await fetchDetail(s.servId);
      done++;
      if (done % 25 === 0) {
        if (!INCREMENTAL) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
        console.log(`  ...${done}건 (${s.ctpv} ${s.sgg || ''} ${s.servNm})`);
      }
      await sleep(300);
    } catch (e) {
      console.error(`  상세 실패 ${s.servId} ${s.servNm}: ${e.message}`);
      if (/resultCode=22|LIMITED/i.test(e.message)) break; // 일 한도 도달
    }
  }
  if (!INCREMENTAL) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

  const merged = list.map((s) => ({ ...s, detail: cache[s.servId] || null }));
  const detailCount = merged.filter((s) => s.detail).length;
  if (INCREMENTAL && prev && detailCount < prev.detailCount * 0.9) {
    console.error(`[중단] 상세가 ${prev.detailCount}건 → ${detailCount}건으로 줄었습니다. 저장하지 않습니다.`);
    process.exit(1);
  }
  // 원자적 쓰기 — 타임아웃(SIGTERM)이 쓰기 도중에 떨어져도 반쪽 JSON이 남지 않게
  const tmp = OUT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({
    fetchedAt: todayKST(),
    count: merged.length,
    detailCount,
    items: merged,
  }, null, 1));
  fs.renameSync(tmp, OUT_FILE);
  console.log(`[완료] 목록 ${merged.length}건 / 상세 ${detailCount}건(이번에 받은 ${done}건) → data/benefits.json`);
})();
