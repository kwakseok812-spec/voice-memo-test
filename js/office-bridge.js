/* ============================================================================
 * office-bridge.js  —  사무소 우편함 전송 모듈 (OfficeBridge)
 * ----------------------------------------------------------------------------
 * [역할]
 *  - 완료된 메모(MD)를 Supabase '우편함' 테이블에 넣는다(INSERT).
 *  - 그 뒤 이 PC의 도우미가 우편함을 확인해 .md 파일로 저장한다(앱과 무관).
 *  - 여기 들어가는 키는 **공개(anon/publishable) 키뿐**이다.
 *    이 키는 새어도 남의 글을 못 읽는다(RLS: anon 은 INSERT만 가능).
 *    ⛔ service_role(비밀) 키는 절대 앱/저장소에 넣지 않는다. PC 도우미 로컬에만.
 *
 * [실패 대비]  오프라인 등으로 전송 실패 시 조용히 끝내지 않는다.
 *  - 로컬 '아웃박스' 큐에 쌓아두고, 앱이 다시 열리거나 온라인이 되면 재시도한다.
 *  - 상태(sent/pending)는 HistoryModule 기록과 화면에 표시된다.
 * ==========================================================================*/

(function (global) {
  'use strict';

  // 공개 값 — 저장소(public repo)에 들어가도 안전한 것만.
  const CONFIG = {
    url: 'https://nasizwclypmaojvwfxnn.supabase.co',
    // publishable(공개) 키. anon INSERT 전용 정책이 걸려 있어 노출돼도 안전.
    key: 'sb_publishable_H92J8-9eQB-bE4DQEUnHvw_jku33h7S',
    table: 'voice_memos'
  };

  const OUTBOX = 'voice_memo_outbox_v1';

  function _readOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); }
    catch (e) { return []; }
  }
  function _writeOutbox(arr) {
    try { localStorage.setItem(OUTBOX, JSON.stringify(arr)); return true; }
    catch (e) { return false; }
  }

  // 실제 전송(INSERT). 성공 시 resolve, 실패 시 reject.
  function _post(entry) {
    const body = {
      title: entry.title || '',
      content_md: entry.markdown || '',
      transcript: (entry.data && entry.data.transcript) || '',
      meta: { app: 'voice-memo-test', local_id: entry.id, saved_at: entry.date + ' ' + entry.time }
    };
    return fetch(CONFIG.url + '/rest/v1/' + CONFIG.table, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.key,
        'Authorization': 'Bearer ' + CONFIG.key,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'   // 되돌려받지 않음 → SELECT 권한 불필요
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return true;
    });
  }

  /**
   * 메모 하나를 사무소로 보낸다.
   * @param entry  HistoryModule 이 저장한 entry
   * @param onStatus  function('sent'|'pending', message)
   */
  function push(entry, onStatus) {
    onStatus = onStatus || function () {};
    _post(entry)
      .then(function () {
        if (global.HistoryModule) global.HistoryModule.markSent(entry.id, true);
        onStatus('sent', '사무소로 전송됨');
      })
      .catch(function (e) {
        // 실패 → 아웃박스에 저장하고 나중에 재시도
        const box = _readOutbox();
        if (!box.some(function (x) { return x.id === entry.id; })) {
          box.push({ id: entry.id, title: entry.title, markdown: entry.markdown,
                     date: entry.date, time: entry.time, data: { transcript: (entry.data||{}).transcript || '' } });
          _writeOutbox(box);
        }
        if (global.HistoryModule) global.HistoryModule.markSent(entry.id, false);
        onStatus('pending', '전송 대기(오프라인일 수 있음) · 나중에 자동 재시도');
      });
  }

  /** 아웃박스에 밀린 것들을 재시도. onProgress(sentCount, remaining) */
  function flush(onProgress) {
    onProgress = onProgress || function () {};
    let box = _readOutbox();
    if (!box.length) { onProgress(0, 0); return; }

    let sent = 0;
    // 순차 처리(간단·안전)
    function next(i) {
      if (i >= box.length) {
        // 성공한 것 제거
        const remain = _readOutbox().filter(function (x) { return !x.__done; });
        _writeOutbox(remain);
        onProgress(sent, remain.length);
        return;
      }
      _post(box[i])
        .then(function () {
          box[i].__done = true; sent++;
          if (global.HistoryModule) global.HistoryModule.markSent(box[i].id, true);
        })
        .catch(function () { /* 남겨두고 다음 기회에 */ })
        .then(function () { next(i + 1); });
    }
    next(0);
  }

  function pendingCount() { return _readOutbox().length; }

  global.OfficeBridge = { push: push, flush: flush, pendingCount: pendingCount, CONFIG: CONFIG };

  // 온라인이 되면 자동으로 밀린 것 재시도
  global.addEventListener('online', function () { flush(); });
})(window);
