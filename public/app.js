/* 베이비혜택 — 진단 위저드 + 타임라인 엔진 (클라이언트사이드, 무저장) */
'use strict';
const WON = (man) => man * 10000;
const won = (n) => n.toLocaleString('ko-KR') + '원';
const man = (n) => Math.round(n / 10000).toLocaleString('ko-KR') + '만원';

/* ── 2026 국가 수당 (national.js 미러 — 검증 2026-07-15) ── */
const N = {
  firstMeet: { first: WON(200), later: WON(300) },
  pregVoucher: { single: WON(100), multi: WON(140) },
  parentPay: { age0: WON(100), age1: WON(50) },
  childPay: { amt: WON(10), untilMonths: 108, nonMetro: WON(2) },
  leave: [
    { fromM: 1, toM: 3, rate: 1.0, cap: WON(250) },
    { fromM: 4, toM: 6, rate: 1.0, cap: WON(200) },
    { fromM: 7, toM: 12, rate: 0.8, cap: WON(160) },
  ],
};

/* ── 엔진: 입력 → {total, oneTime[], phases[], leaveTotal} ── */
function calcLeave(wage) {
  if (!wage || wage <= 0) return { total: 0, rows: [] };
  let total = 0;
  const rows = N.leave.map((b) => {
    const months = b.toM - b.fromM + 1;
    const perMonth = Math.min(Math.round(wage * b.rate), b.cap);
    total += perMonth * months;
    return { label: `${b.fromM}~${b.toM}개월`, perMonth, months, rate: b.rate, capped: wage * b.rate > b.cap };
  });
  return { total, rows };
}

function buildPlan(input) {
  const { order, multi, useLeave, wage } = input; // order: 1=첫째, 2=둘째+
  const oneTime = [];
  oneTime.push({
    label: '첫만남이용권',
    amount: order >= 2 ? N.firstMeet.later : N.firstMeet.first,
    when: '출생 직후',
    note: order >= 2 ? '둘째 이상' : '첫째',
  });
  oneTime.push({
    label: '임신·출산 진료비 바우처',
    amount: multi ? N.pregVoucher.multi : N.pregVoucher.single,
    when: '임신 확인 후',
    note: (multi ? '다태아' : '단태아') + ' · 국민행복카드',
  });

  // 월별 단계
  const phases = [
    { key: '0', label: '0세 (0~11개월)', months: 12, items: [
      { label: '부모급여', m: N.parentPay.age0 }, { label: '아동수당', m: N.childPay.amt } ] },
    { key: '1', label: '1세 (12~23개월)', months: 12, items: [
      { label: '부모급여', m: N.parentPay.age1 }, { label: '아동수당', m: N.childPay.amt } ] },
    { key: '2', label: '2~8세 (24~107개월)', months: 84, items: [
      { label: '아동수당', m: N.childPay.amt } ] },
  ];
  phases.forEach((p) => {
    p.perMonth = p.items.reduce((a, it) => a + it.m, 0);
    p.subtotal = p.perMonth * p.months;
  });

  const leave = useLeave ? calcLeave(wage) : { total: 0, rows: [] };

  const nationalTotal = oneTime.reduce((a, x) => a + x.amount, 0) + phases.reduce((a, p) => a + p.subtotal, 0);
  return { oneTime, phases, leave, nationalTotal, grandTotal: nationalTotal + leave.total };
}

/* ── 지자체 조회 ── */
function localFor(sido, sgg) {
  const db = window.LOCAL_BENEFITS;
  if (!db || !db.sido[sido]) return { list: [], meta: db };
  const bucket = db.sido[sido];
  const common = bucket['(광역 공통)'] || [];
  const local = bucket[sgg] || [];
  // 시군구 지원금 + 광역 공통, 조회수순
  const list = [...local, ...common].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
  return { list, meta: db };
}

/* ── 상태 + 렌더 ── */
const S = { step: 0, sido: '', sgg: '', order: 1, multi: false, useLeave: false, wage: 0 };
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function sidoList() { return Object.keys(window.LOCAL_BENEFITS ? window.LOCAL_BENEFITS.sido : {}).sort(); }
function sggList(sido) {
  const b = window.LOCAL_BENEFITS && window.LOCAL_BENEFITS.sido[sido];
  if (!b) return [];
  return Object.keys(b).filter((k) => k !== '(광역 공통)').sort();
}

function render() {
  const root = $('#app');
  root.innerHTML = '';
  if (S.step < 4) root.appendChild(renderWizard());
  else root.appendChild(renderResult());
  // 예시 섹션은 홈(위저드)에서만 노출
  const ex = $('#examples');
  if (ex) ex.style.display = S.step < 4 ? 'block' : 'none';
}

// 최신 데이터 날짜 배지
function setFreshPill() {
  const pill = document.getElementById('freshPill');
  const db = window.LOCAL_BENEFITS;
  if (pill && db && db.builtAt) {
    const d = db.builtAt.replace(/-/g, '.');
    pill.textContent = `🍼 ${d} 기준 · 최신 데이터`;
  }
}

// 홈 하단 예시 — 적게 받을 때 / 많이 받을 때 (분별력)
function exComps(input) {
  const p = buildPlan(input);
  const sb = (label) => p.phases.reduce((a, ph) => a + ph.items.filter((it) => it.label === label).reduce((s, it) => s + it.m * ph.months, 0), 0);
  const arr = [
    ['첫만남이용권', p.oneTime[0].amount],
    ['임신·출산 바우처', p.oneTime[1].amount],
    ['부모급여', sb('부모급여')],
    ['아동수당', sb('아동수당')],
  ];
  if (input.useLeave) arr.push(['육아휴직급여', p.leave.total]);
  return { total: p.grandTotal, arr };
}
function bdRows(c) {
  return c.arr.map(([k, v]) => `<div class="r"><span>${k}</span><b>${man(v)}</b></div>`).join('');
}
function renderExamples() {
  const box = $('#examples');
  if (!box) return;
  const low = exComps({ order: 1, multi: false, useLeave: false });
  const high = exComps({ order: 2, multi: true, useLeave: true, wage: 3500000 });
  box.innerHTML = `<div class="exWrap">
    <div class="exTitle">💡 이만큼 차이 나요</div>
    <div class="exSub">같은 국가 수당이라도 조건에 따라 총액이 크게 달라져요. 여기에 우리 동네 지원금이 더 붙어요.</div>
    <div class="exScenario low">
      <span class="stag">적게 받을 때</span>
      <div class="cond">첫째 · 단태아 · 육아휴직 미사용</div>
      <div class="big">약 ${man(low.total)}</div>
      <div class="exBd">${bdRows(low)}</div>
    </div>
    <div class="exScenario high">
      <span class="stag">많이 받을 때</span>
      <div class="cond">둘째 이상 · 다태아 · 육아휴직 사용(월 통상임금 350만원 가정)</div>
      <div class="big">약 ${man(high.total)}</div>
      <div class="exBd">${bdRows(high)}</div>
    </div>
    <div class="exRegionNote">🏙️ 여기에 <b>우리 동네 지자체 지원금</b>이 더해져요. 첫째부터 수십만~수백만원, 셋째 이상은 1,000만원이 넘는 곳도 있어요. 비수도권은 아동수당도 매월 2만원 더 나와요. 위에서 지역을 선택하면 실제 지원금을 확인할 수 있어요.</div>
  </div>`;
}

function stepDots(active) {
  const wrap = el('div', 'dots');
  for (let i = 0; i < 4; i++) wrap.appendChild(el('span', 'dot' + (i <= active ? ' on' : '')));
  return wrap;
}

function renderWizard() {
  const card = el('div', 'card wizard');
  card.appendChild(stepDots(S.step));

  if (S.step === 0) {
    card.appendChild(el('h2', 'q', '어느 지역에 사세요?'));
    card.appendChild(el('p', 'qsub', '지역과 몇째 아이인지만 고르면 돼요. 이름·연락처·로그인은 필요 없어요.'));
    const sidoSel = el('select', 'sel');
    sidoSel.appendChild(el('option', '', '<option value="">시 / 도 선택</option>'.replace(/^<option[^>]*>|<\/option>$/g, '') && ''));
    sidoSel.innerHTML = '<option value="">시 / 도 선택</option>' + sidoList().map((s) => `<option ${s === S.sido ? 'selected' : ''}>${s}</option>`).join('');
    const sggSel = el('select', 'sel');
    const fillSgg = () => {
      sggSel.innerHTML = '<option value="">시 / 군 / 구 선택</option>' + sggList(S.sido).map((s) => `<option ${s === S.sgg ? 'selected' : ''}>${s}</option>`).join('');
      sggSel.disabled = !S.sido;
    };
    fillSgg();
    sidoSel.onchange = () => { S.sido = sidoSel.value; S.sgg = ''; fillSgg(); syncNext(); };
    sggSel.onchange = () => { S.sgg = sggSel.value; syncNext(); };
    card.appendChild(sidoSel);
    card.appendChild(sggSel);
  }

  if (S.step === 1) {
    card.appendChild(el('h2', 'q', '몇째 아이인가요?'));
    card.appendChild(el('p', 'qsub', '출생 순위는 부모 기준 통산이에요. 첫만남이용권 금액이 달라져요.'));
    const opts = [ { v: 1, t: '첫째' }, { v: 2, t: '둘째 이상' } ];
    const g = el('div', 'choices');
    opts.forEach((o) => {
      const b = el('button', 'choice' + (S.order === o.v ? ' on' : ''), o.t);
      b.onclick = () => { S.order = o.v; render(); };
      g.appendChild(b);
    });
    card.appendChild(g);
  }

  if (S.step === 2) {
    card.appendChild(el('h2', 'q', '태아가 몇 명인가요?'));
    card.appendChild(el('p', 'qsub', '다태아는 임신·출산 진료비 바우처가 더 많아요.'));
    const opts = [ { v: false, t: '한 명 (단태아)' }, { v: true, t: '쌍둥이 이상 (다태아)' } ];
    const g = el('div', 'choices');
    opts.forEach((o) => {
      const b = el('button', 'choice' + (S.multi === o.v ? ' on' : ''), o.t);
      b.onclick = () => { S.multi = o.v; render(); };
      g.appendChild(b);
    });
    card.appendChild(g);
  }

  if (S.step === 3) {
    card.appendChild(el('h2', 'q', '육아휴직을 쓸 예정인가요?'));
    card.appendChild(el('p', 'qsub', '고용보험에 가입한 근로자라면 육아휴직급여를 받을 수 있어요. (선택)'));
    const g = el('div', 'choices');
    const noBtn = el('button', 'choice' + (!S.useLeave ? ' on' : ''), '아니요 / 잘 모르겠어요');
    noBtn.onclick = () => { S.useLeave = false; render(); };
    const yesBtn = el('button', 'choice' + (S.useLeave ? ' on' : ''), '네, 쓸 거예요');
    yesBtn.onclick = () => { S.useLeave = true; render(); };
    g.appendChild(noBtn); g.appendChild(yesBtn);
    card.appendChild(g);
    if (S.useLeave) {
      if (!S.wage) S.wage = 2500000;
      const wrap = el('div', 'wageWrap');
      wrap.appendChild(el('label', 'wageLbl', '휴직 전 월 통상임금 (세전, 대략)'));
      const valEl = el('div', 'wageVal', man(S.wage));
      const sl = document.createElement('input');
      sl.type = 'range'; sl.className = 'wageSlider';
      sl.min = '1000000'; sl.max = '7000000'; sl.step = '100000'; sl.value = String(S.wage);
      sl.oninput = () => { S.wage = parseInt(sl.value, 10); valEl.textContent = man(S.wage); };
      wrap.appendChild(valEl);
      wrap.appendChild(sl);
      const rng = el('div', 'wageRange'); rng.innerHTML = '<span>100만원</span><span>700만원 이상</span>';
      wrap.appendChild(rng);
      card.appendChild(wrap);
    }
  }

  // 네비게이션
  const nav = el('div', 'nav');
  if (S.step > 0) { const b = el('button', 'btn ghost', '이전'); b.onclick = () => { S.step--; render(); }; nav.appendChild(b); }
  const next = el('button', 'btn primary', S.step === 3 ? '내 혜택 보기' : '다음');
  next.id = 'nextBtn';
  next.onclick = () => { S.step++; render(); window.scrollTo(0, 0); };
  nav.appendChild(next);
  card.appendChild(nav);

  setTimeout(syncNext, 0);
  return card;
}

function syncNext() {
  const b = document.getElementById('nextBtn');
  if (!b) return;
  if (S.step === 0) b.disabled = !(S.sido && S.sgg);
  else b.disabled = false;
}

function renderResult() {
  const plan = buildPlan(S);
  const { list, meta } = localFor(S.sido, S.sgg);
  const wrap = el('div', 'result');

  // 헤드라인
  const hero = el('div', 'card heroCard');
  hero.appendChild(el('div', 'freshBadge', `2026년 기준 · 지자체 데이터 ${meta ? meta.builtAt : ''} 갱신`));
  hero.appendChild(el('p', 'heroLbl', `${S.sido} ${S.sgg} · ${S.order >= 2 ? '둘째 이상' : '첫째'}${S.multi ? ' · 다태아' : ''} 기준`));
  hero.appendChild(el('div', 'heroNum', man(plan.grandTotal)));
  hero.appendChild(el('p', 'heroCap', `아이 태어나서 8세까지 받는 <b>국가 지원금 합계</b>${S.useLeave ? ' (육아휴직급여 포함)' : ''}<br>여기에 <b>${S.sido} ${S.sgg}</b>가 주는 아래 지원금이 <b>추가</b>돼요.`));
  wrap.appendChild(hero);

  // 구성 항목 breakdown (혜택별 합계 + 발행된 가이드로 링크)
  const guideHref = (slug) => ((window.PUBLISHED_GUIDES || []).includes(slug) ? `/guide/${slug}.html` : null);
  const sumBenefit = (label) => plan.phases.reduce((a, p) => a + p.items.filter((it) => it.label === label).reduce((s, it) => s + it.m * p.months, 0), 0);
  const comps = [
    { nm: '첫만남이용권', when: '출생 직후 · 1회', where: '주민센터·복지로·정부24 (출생신고 때)', amt: plan.oneTime[0].amount, slug: 'cheotmannam-voucher' },
    { nm: '임신·출산 진료비 바우처', when: '임신 확인 후 ~ 출생 후 24개월', where: '국민행복카드 (카드사·복지로)', amt: plan.oneTime[1].amount, slug: 'imsin-chulsan-voucher' },
    { nm: '부모급여', when: '출생 ~ 생후 24개월 · 매월 25일', where: '주민센터·복지로', amt: sumBenefit('부모급여'), slug: 'bumo-geumyeo-guide' },
    { nm: '아동수당', when: '출생 ~ 만 8세 전 · 매월 25일', where: '주민센터·복지로', amt: sumBenefit('아동수당'), slug: 'adong-sudang-2026' },
  ];
  if (S.useLeave && plan.leave.total > 0) comps.push({ nm: '육아휴직급여', when: '휴직한 달부터 · 최대 12개월', where: '고용24 (회사에 육아휴직 신청 후)', amt: plan.leave.total, slug: 'yuga-hyujik-geumyeo-2026' });

  const bd = el('div', 'card');
  bd.appendChild(el('span', 'secBadge nat', '국가지원금 · 전국 공통'));
  bd.appendChild(el('h3', 'secTitle', '이 금액은 이렇게 구성돼요'));
  const bdList = el('div', 'bdList');
  comps.forEach((c) => {
    const href = guideHref(c.slug);
    const nm = href ? `<a href="${href}">${c.nm}</a>` : c.nm;
    const row = el('div', 'bdRow');
    row.innerHTML = `<div class="bdL"><div class="bdNm">${nm}</div><div class="bdWhen">🗓 ${c.when}</div><div class="bdWhere">📍 ${c.where}</div></div><div class="bdAmt">${man(c.amt)}</div>`;
    bdList.appendChild(row);
  });
  bd.appendChild(bdList);
  const bdTotal = el('div', 'bdTotal');
  bdTotal.innerHTML = `<span class="k">국가 지원금 합계${S.useLeave ? ' (육아휴직 포함)' : ''}</span><span class="v">${man(plan.grandTotal)}</span>`;
  bd.appendChild(bdTotal);
  const metro = ['서울특별시', '경기도', '인천광역시'].includes(S.sido);
  let src = '부모급여는 가정양육 현금 기준(어린이집 이용 시 보육료 바우처로 차감). 아동수당은 2026년 9세 미만까지 지급(2030년 13세까지 단계 확대)이라 실제로는 더 오래 받을 수 있어요.';
  if (!metro) src += ` ${S.sido}는 비수도권이라, 인구감소지역이면 아동수당이 매월 2만원 더 나올 수 있어요(위 합계엔 미포함).`;
  bd.appendChild(el('p', 'srcNote', src));
  wrap.appendChild(bd);

  // 지자체 지원금
  const loc = el('div', 'card');
  loc.appendChild(el('span', 'secBadge local', '지역지원금 · 우리 동네'));
  loc.appendChild(el('h3', 'secTitle', `🏙️ ${S.sido} ${S.sgg}가 주는 추가 지원금`));
  if (list.length === 0) {
    loc.appendChild(el('p', 'qsub', '이 지역의 공공데이터 상세가 아직 확인되지 않았어요. 곧 보강됩니다.'));
  } else {
    loc.appendChild(el('p', 'qsub', `${list.length}개 지원금 (조회 많은 순) · 출처: 한국사회보장정보원 공공데이터`));
    const ul = el('div', 'locList');
    list.slice(0, 12).forEach((b) => {
      const item = el('div', 'locItem');
      const modTxt = b.mod ? `갱신 ${b.mod.slice(0, 4)}.${b.mod.slice(4, 6)}` : '';
      item.innerHTML =
        `<div class="locNm">${b.nm}</div>` +
        (b.amt ? `<div class="locAmt">${b.amt}</div>` : (b.dgst ? `<div class="locDgst">${b.dgst}</div>` : '')) +
        `<div class="locMeta">${b.law ? `📜 ${b.law}` : ''} ${modTxt ? `· ${modTxt}` : ''} ${b.link ? `· <a href="${b.link}" target="_blank" rel="noopener">복지로 상세 →</a>` : ''}</div>`;
      ul.appendChild(item);
    });
    loc.appendChild(ul);
    if (list.length > 12) loc.appendChild(el('p', 'moreNote', `외 ${list.length - 12}개 더 · 전체 보기는 준비 중`));
  }
  wrap.appendChild(loc);

  // 다시
  const again = el('button', 'btn ghost wide', '조건 바꿔서 다시 계산');
  again.onclick = () => { S.step = 0; render(); window.scrollTo(0, 0); };
  wrap.appendChild(again);

  wrap.appendChild(el('p', 'disclaimer', '※ 참고용 추정치입니다. 실제 수급 여부·금액은 소득/재산 기준, 거주 요건, 신청 시기에 따라 달라질 수 있어요. 지자체 지원금은 조례 개정으로 변경될 수 있으니 복지로·주민센터에서 최종 확인하세요. 회원가입·개인정보 저장은 하지 않습니다.'));
  return wrap;
}

document.addEventListener('DOMContentLoaded', () => { setFreshPill(); renderExamples(); render(); });
