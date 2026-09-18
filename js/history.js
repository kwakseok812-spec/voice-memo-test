/* ============================================================================
 * history.js  —  메모 기록 모듈 (HistoryModule)
 * ----------------------------------------------------------------------------
 * [역할]
 *  - 완료된 메모를 브라우저 localStorage에 저장하고 다시 열어보게 한다.
 *  - 전송(공유) 실패에 대비한 "안전망 겸 기록". 기기 안에만 저장된다.
 *  - 한 건(entry) 구조:
 *      { id, date(YYYY-MM-DD), time, title, data, markdown }
 *      data = { transcript, summary[], todos[], decisions[], keywords[] }
 *
 * [통합 대비]
 *  - localStorage는 이 앱(도메인) 안에서만 유효. 통합 앱으로 옮기면
 *    저장소만 교체(예: 통합 앱 DB)하면 되고 인터페이스는 그대로 쓸 수 있게
 *    save/list/get/remove 로 감싸 두었다.
 *  - ⛳ [사무소 자동전송 다리 — 아직 만들지 않음 / 교수님 답 대기]
 *    나중에 "완료된 MD를 사무소(클로드)로 자동 전송"하는 기능을 붙일 때는
 *    save() 안의 표시된 지점(sendToOfficeHook)에 호출 한 줄만 끼우면 된다.
 * ==========================================================================*/

(function (global) {
  'use strict';

  const KEY = 'voice_memo_history_v1';

  function _read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }   // 시크릿모드·차단 등 → 빈 목록으로 안전 처리
  }
  function _write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }  // 용량초과·차단 시 false (조용히 실패 금지: 호출부가 안내)
  }

  function _now() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
      time: p(d.getHours()) + ':' + p(d.getMinutes())
    };
  }

  // 제목 자동 생성: 요약 첫 문장 → 없으면 전사 앞부분
  function _makeTitle(data) {
    let base = (data.summary && data.summary[0]) ||
               (data.transcript || '').trim() || '제목 없음';
    base = base.replace(/\s+/g, ' ').trim();
    return base.length > 22 ? base.slice(0, 22) + '…' : base;
  }

  /** 저장. 성공 시 저장된 entry, 저장소 불가 시 null 반환 */
  function save(data) {
    const t = _now();
    const entry = {
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      date: t.date,
      time: t.time,
      title: _makeTitle(data),
      data: data,
      sent: null,   // null=아직 시도전, true=전송됨, false=미전송(재시도 대기)
      markdown: (global.ExportModule && global.ExportModule.buildMarkdown)
        ? global.ExportModule.buildMarkdown(data) : ''
    };
    const list = _read();
    list.unshift(entry);                 // 최신이 위로
    if (list.length > 200) list.length = 200;
    const ok = _write(list);
    if (!ok) return null;

    /* ⛳ sendToOfficeHook — 사무소 우편함 자동전송 지점 (교수님 승인 완료로 가동).
     *   실제 전송은 app.js 가 save() 반환 직후 OfficeBridge.push(entry) 로 호출한다.
     *   (전송을 여기서 직접 부르지 않는 이유: 저장은 동기, 전송은 비동기라
     *    화면 갱신·상태표시를 app.js 에서 함께 처리하기 위함.) */

    return entry;
  }

  /** 전송 상태 갱신 (OfficeBridge 가 호출) */
  function markSent(id, sent) {
    const list = _read();
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) { list[i].sent = !!sent; changed = true; break; }
    }
    if (changed) _write(list);
    return changed;
  }

  function list() { return _read(); }
  function get(id) {
    return _read().filter(function (e) { return e.id === id; })[0] || null;
  }
  function remove(id) {
    const next = _read().filter(function (e) { return e.id !== id; });
    return _write(next);
  }
  function clearAll() { return _write([]); }

  global.HistoryModule = {
    save: save, list: list, get: get, remove: remove, clearAll: clearAll,
    markSent: markSent
  };
})(window);
