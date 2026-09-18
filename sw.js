/* ============================================================================
 * sw.js  —  서비스 워커 (PWA "홈 화면에 설치" 요건 충족용)
 * ----------------------------------------------------------------------------
 * - 목적: 안드로이드 Chrome이 "앱 설치/홈 화면에 추가"를 띄우게 하는 최소 요건.
 * - 핵심 정적 파일을 캐시해 두 번째 접속부터 빠르게 뜨게 한다.
 * - ⚠️ 음성 인식(Web Speech API)은 구글 서버를 경유하므로 "온라인"이 필요하다.
 *      → 화면(HTML/JS/CSS)은 오프라인에서도 열리지만, 실제 녹음·전사는
 *        인터넷이 연결돼 있어야 동작한다. (완전 오프라인 STT는 지원 안 함)
 * ==========================================================================*/

const CACHE = 'voice-memo-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/recorder.js',
  './js/analyzer.js',
  './js/app.js',
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

// 요청 처리: 캐시 우선, 없으면 네트워크 (네트워크 결과는 캐시에 갱신)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;   // POST 등은 그대로 통과
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          // 성공한 동일 출처 응답만 캐시에 저장
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);   // 오프라인이면 캐시로 대체
      return cached || fetchPromise;
    })
  );
});
