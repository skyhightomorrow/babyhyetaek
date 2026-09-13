/* 베이비혜택 — /r/ 허브 검색 (2026-09-13)
 * 지역명(시도·시군구)으로 칩을 거르고, 지원사업 이름으로도 찾아 그 사업이 있는 지역 페이지로 보낸다.
 * 데이터: /assets/benefit-index.js (build-pages.js가 만드는 이름·지역만 담은 가벼운 색인).
 *   홈 위저드용 local-benefits.js(1.2MB)를 허브에서 통째로 받게 하지 않으려고 따로 뽑았다.
 * 검색 키(data-key·data-q)는 빌드가 「시도+약칭+시군구」를 정규화해 박아 둔다 — 「인천 검단」·「경기 수원」도 맞는다.
 * ?q= 는 URL에 동기화(replaceState) — 지역 페이지의 검색창이 /r/?q=… 로 보내고, 검색 결과를 공유할 수 있다.
 */
(function () {
  'use strict';
  var input = document.getElementById('rSearch');
  var out = document.getElementById('rResults');
  if (!input || !out) return;

  var IDX = window.BENEFIT_INDEX || { regions: [], items: [] };
  var cards = [].slice.call(document.querySelectorAll('[data-key]'));
  var MAX = 30;

  // 검색 정규화: 소문자 + 공백 제거 (빌드 쪽 nk()와 같은 규칙이어야 한다)
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var itemKeys = IDX.items.map(function (it) { return norm(it[0]); });

  var gaTimer = null;
  var lastSent = '';
  function sendGa(raw) {
    clearTimeout(gaTimer);
    if (!raw) return;
    // 한 글자씩 칠 때마다 이벤트가 나가지 않도록 입력이 1.5초 멈췄을 때만 보낸다
    gaTimer = setTimeout(function () {
      if (raw === lastSent) return;
      lastSent = raw;
      try { if (typeof window.gtag === 'function') window.gtag('event', 'search', { search_term: raw }); } catch (e) { /* 무시 */ }
    }, 1500);
  }

  function syncUrl(raw) {
    try {
      var u = new URL(window.location.href);
      if (raw) u.searchParams.set('q', raw); else u.searchParams.delete('q');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* 구형 브라우저 — URL 동기화만 포기 */ }
  }

  function run() {
    var raw = input.value.trim();
    var q = norm(raw);
    syncUrl(raw);
    sendGa(raw);

    // ① 지역 칩 거르기 — 시도 이름이 맞으면 그 시도 칩 전부, 아니면 맞는 칩만
    var shown = 0;
    cards.forEach(function (card) {
      var sidoHit = q && card.getAttribute('data-key').indexOf(q) > -1;
      var any = false;
      [].forEach.call(card.querySelectorAll('a[data-q]'), function (a) {
        var hit = !q || sidoHit || a.getAttribute('data-q').indexOf(q) > -1;
        a.hidden = !hit;
        if (hit) any = true;
      });
      card.hidden = !any;
      if (any) shown++;
    });

    // ② 지원사업 이름 검색 — 두 글자 이상부터(한 글자는 거의 모든 사업이 걸린다)
    if (q.length < 2) { out.innerHTML = q && !shown ? '<p class="sub">맞는 지역이 없어요.</p>' : ''; return; }
    var hits = [];
    var total = 0;
    for (var i = 0; i < itemKeys.length; i++) {
      if (itemKeys[i].indexOf(q) === -1) continue;
      total++;
      if (hits.length < MAX) hits.push(IDX.items[i]);
    }
    var html = '';
    if (total) {
      html += '<div class="card"><h2 class="secTitle">「' + esc(raw) + '」 지원사업 <span class="rCount">' + total + '건</span></h2><div class="locList">';
      hits.forEach(function (it) {
        var r = IDX.regions[it[1]];
        // 광역 공통·교육청 사업(r[2]가 빈 값)은 시군구 페이지가 따로 없으므로 그 시도 목록으로 스크롤한다
        var href = r[2] ? '/r/' + encodeURIComponent(r[2]) : '#sido-' + encodeURIComponent(r[0]);
        html += '<a class="locItem rHit" href="' + href + '"><span class="locNm">' + esc(it[0]) + '</span><span class="locMeta">' + esc(r[0]) + ' · ' + esc(r[1]) + '</span></a>';
      });
      html += '</div>' + (total > MAX ? '<p class="sub" style="margin:10px 0 0">검색어를 더 구체적으로 입력하면 나머지 ' + (total - MAX) + '건도 찾을 수 있어요.</p>' : '') + '</div>';
    } else if (!shown) {
      // 첫만남이용권·부모급여·아동수당 같은 국가 수당은 지자체 색인에 없다(전국 공통이라 복지로 지자체 API가 주지 않음).
      // 그런 검색이 빈손으로 끝나지 않게 가이드로 보낸다.
      html = '<p class="sub">「' + esc(raw) + '」에 맞는 지역·지자체 지원사업이 없어요. 시군구 이름(예: 수원시)이나 사업 이름(예: 출산지원금)으로 찾아보세요.<br>' +
        '첫만남이용권·부모급여·아동수당 같은 <b>국가 지원금</b>은 <a href="/guide/">육아 지원금 가이드</a>에 정리돼 있어요.</p>';
    }
    out.innerHTML = html;
  }

  var q0 = '';
  try { q0 = new URL(window.location.href).searchParams.get('q') || ''; } catch (e) { q0 = ''; }
  if (q0) input.value = q0;
  input.addEventListener('input', run);
  if (input.form) input.form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
  if (q0) run();
})();
