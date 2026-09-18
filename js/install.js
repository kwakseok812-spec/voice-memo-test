/* ============================================================================
 * install.js  —  홈 화면 "설치" 안내 모듈 (독립)
 * ----------------------------------------------------------------------------
 * - 크롬이 설치 가능해지면(beforeinstallprompt) 상단에 큰 버튼을 자동으로 띄운다.
 * - 버튼을 누르면 네이티브 설치창을 연다(사용자 제스처 1회 필요 — 완전자동은 불가).
 * - 설치되면(appinstalled) "설치됨"으로 바꾼 뒤 숨긴다.
 * - 이벤트가 안 오는 브라우저(삼성인터넷·iOS·이미 설치됨)에서는
 *   죽은 버튼 대신 "설치 방법 보기" 안내를 보여준다.
 * - 이미 앱 모드(standalone)면 배너를 아예 숨긴다.
 * 기존 기능(녹음·정리·내보내기·우편함)과 완전히 분리되어 서로 영향 없음.
 * ==========================================================================*/

(function () {
  'use strict';

  var bar = document.getElementById('installBar');
  var btn = document.getElementById('installBtn');
  var help = document.getElementById('installHelpLink');
  var helpBox = document.getElementById('installHelp');
  if (!bar || !btn) return;

  var deferredPrompt = null;
  var promptSeen = false;

  // 이미 설치되어 앱(전체화면)으로 열렸는지
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  if (isStandalone()) { bar.style.display = 'none'; return; }

  // 1) 크롬이 "설치 가능" 신호를 보내면 잡아서 버튼을 띄운다
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    promptSeen = true;
    btn.style.display = 'block';
    if (help) help.style.display = 'none';
    if (helpBox) helpBox.style.display = 'none';
    bar.style.display = 'block';
  });

  // 2) 버튼 누르면 네이티브 설치창 열기
  btn.addEventListener('click', function () {
    if (!deferredPrompt) { showHelp(); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      if (choice && choice.outcome === 'accepted') {
        bar.style.display = 'none';
      } else {
        // 취소 → 버튼은 두되 방법 링크도 함께 노출
        if (help) help.style.display = 'inline';
      }
      deferredPrompt = null;
    });
  });

  // 3) 설치 완료되면 알리고 숨김
  window.addEventListener('appinstalled', function () {
    btn.textContent = '✅ 홈 화면에 설치됨';
    btn.disabled = true;
    setTimeout(function () { bar.style.display = 'none'; }, 2500);
  });

  // 4) 폴백: 설치 이벤트가 안 오는 브라우저 안내
  function browserGuide() {
    var ua = navigator.userAgent || '';
    if (/SamsungBrowser/i.test(ua)) {
      return '삼성 인터넷: 아래 <b>≡ 메뉴</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 누르세요.';
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return 'iPhone(사파리): 아래 <b>공유 버튼</b>(□↑) → <b>홈 화면에 추가</b>를 누르세요. ' +
             '(※ 아이폰은 음성 인식은 지원되지 않습니다.)';
    }
    if (/Android/i.test(ua) && /Chrome/i.test(ua)) {
      return '크롬: 오른쪽 위 <b>⋮ 메뉴</b> → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르세요.';
    }
    return '크롬: 오른쪽 위 ⋮ 메뉴 → "앱 설치". · 삼성 인터넷: ≡ 메뉴 → "현재 페이지 추가" → "홈 화면".';
  }
  function showHelp() {
    if (!helpBox) return;
    helpBox.innerHTML = browserGuide();
    helpBox.style.display = 'block';
  }
  if (help) {
    help.addEventListener('click', function (ev) { ev.preventDefault(); showHelp(); });
  }

  // 설치 이벤트가 곧바로 오지 않는 브라우저를 위해, 잠시 뒤에도 신호가 없으면
  // 큰 버튼 대신 "설치 방법 보기" 링크를 보여준다(죽은 버튼 방지).
  setTimeout(function () {
    if (promptSeen || isStandalone()) return;
    btn.style.display = 'none';
    if (help) help.style.display = 'inline';
    bar.style.display = 'block';
  }, 3500);
})();
