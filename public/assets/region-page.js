/* 베이비혜택 — 지역 페이지 보조 스크립트 (2026-09-13)
 * ① 산후조리원 「지도로 보기」: 누를 때만 카카오맵 SDK를 불러온다(페이지 첫 로딩·Core Web Vitals에 영향 없게).
 * ② GA4 이벤트: call_click(전화 버튼) · map_click(카카오맵 링크) · map_open(지도 펼침) — 모두 region 파라미터 포함.
 *
 * ⚠️ 마커 좌표는 페이지에 박힌 공공데이터(EPSG:5174→WGS84 변환값)만 쓴다.
 *    카카오 지오코딩·장소검색 API는 결과 저장이 약관상 금지라 호출하지 않는다.
 */
(function () {
  'use strict';
  var KAKAO_KEY = '84f3eca6ecc3c7088fa9875481301709'; // JS 키 — 공개용, 카카오 콘솔에서 도메인(babyhyetaek.com·localhost:8630) 제한
  var SDK = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + KAKAO_KEY + '&autoload=false';

  var body = document.body;
  var region = (body && body.getAttribute('data-region')) || '';

  function ga(name, params) {
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, params);
    } catch (e) { /* 분석 실패가 화면 동작을 막으면 안 된다 */ }
  }

  // ── 클릭 이벤트 위임: 카드가 여러 개라 개별 바인딩 대신 문서 한 곳에서 받는다 ──
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-ga]') : null;
    if (!a) return;
    var kind = a.getAttribute('data-ga');
    if (kind === 'call') ga('call_click', { region: region, target: a.getAttribute('data-target') || '' });
    else if (kind === 'map') ga('map_click', { region: region, target: a.getAttribute('data-target') || '' });
  });

  // ── 지도 ──
  var btn = document.getElementById('ppMapBtn');
  var box = document.getElementById('ppMap');
  var dataEl = document.getElementById('ppData');
  if (!btn || !box || !dataEl) return;

  var points = [];
  try { points = JSON.parse(dataEl.textContent || '[]'); } catch (e) { points = []; }
  if (!points.length) { btn.hidden = true; return; }

  var state = 'idle'; // idle → loading → ready | failed
  var map = null;

  function fail() {
    state = 'failed';
    box.innerHTML = '<p class="ppMapMsg">지도를 불러오지 못했어요. 목록의 「카카오맵에서 보기」 링크를 이용해 주세요.</p>';
    btn.textContent = '지도 닫기';
  }

  function loadSdk(cb) {
    if (window.kakao && window.kakao.maps && window.kakao.maps.load) { window.kakao.maps.load(cb); return; }
    var s = document.createElement('script');
    var done = false;
    // 광고 차단기·도메인 미등록이면 onerror조차 안 오고 멈추는 경우가 있어 시간 제한을 둔다
    var timer = setTimeout(function () { if (!done) { done = true; fail(); } }, 10000);
    s.src = SDK;
    s.async = true;
    s.onload = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!window.kakao || !window.kakao.maps || !window.kakao.maps.load) { fail(); return; }
      try { window.kakao.maps.load(cb); } catch (e) { fail(); }
    };
    s.onerror = function () { if (!done) { done = true; clearTimeout(timer); fail(); } };
    document.head.appendChild(s);
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function draw() {
    try {
      var km = window.kakao.maps;
      box.innerHTML = '';
      map = new km.Map(box, { center: new km.LatLng(points[0].lat, points[0].lng), level: 7 });
      map.addControl(new km.ZoomControl(), km.ControlPosition.RIGHT);
      var bounds = new km.LatLngBounds();
      var info = new km.InfoWindow({ removable: true });
      points.forEach(function (p) {
        var pos = new km.LatLng(p.lat, p.lng);
        var marker = new km.Marker({ map: map, position: pos, title: p.nm });
        bounds.extend(pos);
        km.event.addListener(marker, 'click', function () {
          info.setContent('<div class="ppInfo"><b>' + esc(p.nm) + '</b>' + (p.tel ? '<br>' + esc(p.tel) : '') + '</div>');
          info.open(map, marker);
        });
      });
      // 숨겨져 있던 div에 지도를 만들면 크기를 0으로 잡는다 → 보인 뒤 relayout으로 다시 잰다
      map.relayout();
      if (points.length > 1) map.setBounds(bounds);
      else map.setCenter(bounds.getSouthWest());
      state = 'ready';
    } catch (e) {
      fail();
    }
  }

  btn.addEventListener('click', function () {
    var open = box.hidden;
    box.hidden = !open;
    btn.textContent = open ? '지도 닫기' : '지도로 보기';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    ga('map_open', { region: region, count: points.length });
    if (state === 'idle') {
      state = 'loading';
      box.innerHTML = '<p class="ppMapMsg">지도를 불러오는 중…</p>';
      loadSdk(draw);
    } else if (state === 'ready' && map) {
      map.relayout();
    }
  });
})();
