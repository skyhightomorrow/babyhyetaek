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
  childPay: { amt: WON(10), untilMonths: 96 },
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
    { key: '2', label: '2~7세 (24~95개월)', months: 72, items: [
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
    card.appendChild(el('p', 'qsub', '주민등록상 거주지 기준으로 우리 동네 지원금을 찾아드려요.'));
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
      const wrap = el('div', 'wageWrap');
      wrap.appendChild(el('label', 'wageLbl', '휴직 전 월 통상임금 (세전, 대략)'));
      const inp = el('input', 'wageInp'); inp.type = 'text'; inp.inputMode = 'numeric';
      inp.placeholder = '예: 350만원 → 3500000';
      inp.value = S.wage ? S.wage.toLocaleString('ko-KR') : '';
      inp.oninput = () => { S.wage = parseInt(inp.value.replace(/[^0-9]/g, '') || '0', 10); const p = $('#wagePrev'); if (p) p.textContent = S.wage ? man(S.wage) + ' 기준' : ''; };
      wrap.appendChild(inp);
      wrap.appendChild(el('div', 'wagePrev', '')); wrap.lastChild.id = 'wagePrev';
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

  // 광고 슬롯 1 (애드센스 자리)
  wrap.appendChild(adSlot('결과 상단'));

  // 타임라인
  const tl = el('div', 'card');
  tl.appendChild(el('h3', 'secTitle', '📅 월별 현금 타임라인'));
  const list1 = el('div', 'timeline');
  // 출생 시점
  plan.oneTime.forEach((o) => {
    const row = el('div', 'tlRow once');
    row.innerHTML = `<div class="tlWhen">${o.when}</div><div class="tlBody"><div class="tlNm">${o.label} <span class="tlTag">1회</span></div><div class="tlNote">${o.note}</div></div><div class="tlAmt">${man(o.amount)}</div>`;
    list1.appendChild(row);
  });
  plan.phases.forEach((p) => {
    const row = el('div', 'tlRow');
    const items = p.items.map((it) => `${it.label} ${man(it.m)}`).join(' + ');
    row.innerHTML = `<div class="tlWhen">${p.label}</div><div class="tlBody"><div class="tlNm">매월 ${man(p.perMonth)}</div><div class="tlNote">${items} · ${p.months}개월</div></div><div class="tlAmt">${man(p.subtotal)}</div>`;
    list1.appendChild(row);
  });
  if (S.useLeave && plan.leave.total > 0) {
    plan.leave.rows.forEach((r) => {
      const row = el('div', 'tlRow leave');
      row.innerHTML = `<div class="tlWhen">육아휴직 ${r.label}</div><div class="tlBody"><div class="tlNm">매월 ${man(r.perMonth)}</div><div class="tlNote">통상임금 ${r.rate * 100}%${r.capped ? ' · 상한 적용' : ''} · ${r.months}개월</div></div><div class="tlAmt">${man(r.perMonth * r.months)}</div>`;
      list1.appendChild(row);
    });
  }
  tl.appendChild(list1);
  tl.appendChild(el('p', 'srcNote', '국가 수당은 2026년 법정 기준. 부모급여는 가정양육 현금 기준(어린이집 이용 시 보육료 바우처로 차감). 아동수당은 2026년 지급연령 확대가 진행 중이라 실제 수령 기간이 더 길 수 있어요.'));
  wrap.appendChild(tl);

  // 쿠팡 슬롯 (시기별 준비물)
  const coupang = el('div', 'card coupangCard');
  coupang.appendChild(el('h3', 'secTitle', '🍼 이 시기, 뭐부터 준비할까요?'));
  coupang.appendChild(el('p', 'qsub', '출산 준비물 체크리스트 — 곧 큐레이션과 함께 열립니다.'));
  const chips = el('div', 'prepChips');
  ['임신 중 · 산모용품', '출생 직후 · 배냇/기저귀', '3~6개월 · 수유/수면', '6개월~ · 이유식'].forEach((t) => chips.appendChild(el('span', 'prepChip', t)));
  coupang.appendChild(chips);
  coupang.appendChild(el('div', 'slotTag', '쿠팡파트너스 제휴 예정 슬롯'));
  wrap.appendChild(coupang);

  // 지자체 지원금
  const loc = el('div', 'card');
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

  // 보험 CPA 슬롯
  const ins = el('div', 'card insCard');
  ins.appendChild(el('h3', 'secTitle', '🛡️ 출산 전 챙기면 좋은 것'));
  ins.appendChild(el('p', 'qsub', '태아보험은 출산 전(임신 22주 이내)에 가입해야 보장 범위가 넓어요. 여러 상품을 비교해 보세요.'));
  ins.appendChild(el('div', 'slotTag', '태아·어린이보험 비교 제휴 예정 슬롯'));
  wrap.appendChild(ins);

  // 광고 슬롯 2
  wrap.appendChild(adSlot('결과 하단'));

  // 다시
  const again = el('button', 'btn ghost wide', '조건 바꿔서 다시 계산');
  again.onclick = () => { S.step = 0; render(); window.scrollTo(0, 0); };
  wrap.appendChild(again);

  wrap.appendChild(el('p', 'disclaimer', '※ 참고용 추정치입니다. 실제 수급 여부·금액은 소득/재산 기준, 거주 요건, 신청 시기에 따라 달라질 수 있어요. 지자체 지원금은 조례 개정으로 변경될 수 있으니 복지로·주민센터에서 최종 확인하세요. 회원가입·개인정보 저장은 하지 않습니다.'));
  return wrap;
}

function adSlot(where) {
  const d = el('div', 'adSlot');
  d.innerHTML = `<span>광고 영역 (${where})</span>`;
  return d;
}

document.addEventListener('DOMContentLoaded', render);
