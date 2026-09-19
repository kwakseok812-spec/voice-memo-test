/* ============================================================================
 * sw.js  —  서비스 워커 (PWA "홈 화면에 설치" 요건 충족용)
 * ----------------------------------------------------------------------------
 * - 목적: 안드로이드 Chrome이 "앱 설치/홈 화면에 추가"를 띄우게 하는 최소 요건.
 * - 핵심 정적 파일을 캐시해 두 번째 접속부터 빠르게 뜨게 한다.
 * - ⚠️ 음성 인식(Web Speech API)은 구글 서버를 경유하므로 "온라인"이 필요하다.
 *      → 화면(HTML/JS/CSS)은 오프라인에서도 열리지만, 실제 녹음·전사는
 *        인터넷이 연결돼 있어야 동작한다. (완전 오프라인 STT는 지원 안 함)
 * ==========================================================================*/

const CACHE = 'voice-memo-v8';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/recorder.js',
  './js/office-bridge.js',
  './js/history.js',
  './js/app.js',
  './js/install.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 설치: 핵심 파일 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => {})   // 일부 파일 실패해도 설치는 진행
  );
  self.skipWaiting();
});

// 활성화: 옛 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 요청 처리
//  - HTML 문서(페이지 이동)는 "네트워크 우선": 새로 배포하면 바로 최신이 뜬다.
//    (오프라인일 때만 캐시로 대체 → 앱이 안 열리는 일 방지)
//  - 그 밖의 정적 파일(css/js/아이콘)은 "캐시 우선": 빠르고, 뒤에서 갱신.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;   // POST 등은 그대로 통과

  const isDoc = req.mode === 'navigate' ||
    (req.destination === 'document') ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isDoc) {
    // 네트워크 우선
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // 캐시 우선(정적 자산)
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
