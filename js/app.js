/* ============================================================================
 * app.js  —  화면 연결(글루)
 * ----------------------------------------------------------------------------
 * 흐름:  🎙️녹음 → ⏹️정지 → (자동) 변환 → 정리 → 결과 표시 → (자동) 저장·전송
 *   - 사용자가 "저장"을 따로 누르지 않아도 끝나면 알아서 기록+우편함 전송.
 *   - 전사 원문을 고치면 정리에 바로 반영(저장본도 갱신).
 * ==========================================================================*/
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var btnRecord = $('btnRecord');
  var statusText = $('statusText');
  var statusDot = $('statusDot');
  var levelBar = $('levelBar');
  var banner = $('banner');
  var processing = $('processing');
  var processingText = $('processingText');
  var resultWrap = $('resultWrap');
  var resultArea = $('resultArea');
  var transcriptBox = $('transcript');
  var btnWord = $('btnWord');
  var btnPpt = $('btnPpt');
  var btnSendPc = $('btnSendPc');
  var btnDelete = $('btnDelete');
  var exportMsg = $('exportMsg');
  var historyList = $('historyList');
  var historyCount = $('historyCount');
  var modal = $('modal');
  var modalTitle = $('modalTitle');
  var modalBody = $('modalBody');
  var modalClose = $('modalClose');
  var modalWord = $('modalWord');
  var modalPpt = $('modalPpt');
  var modalDelete = $('modalDelete');

  var isRecording = false;
  var currentId = null;     // 지금 화면에 열려있는(방금 저장한) 메모 id
  var editTimer = null;

  /* --- 지원 여부 --- */
  if (!RecordingModule.isSupported()) {
    banner.style.display = 'block';
    banner.innerHTML = '⚠️ 이 브라우저는 녹음을 지원하지 않습니다. ' +
      '갤럭시/안드로이드의 <b>Chrome</b>에서 열어 주세요.';
    btnRecord.disabled = true;
    btnRecord.classList.add('disabled');
  }

  /* --- 녹음 모듈 --- */
  var recorder = new RecordingModule({
    onStatus: function (state) {
      if (state === 'recording') setStatus('녹음 중… 끝나면 정지를 누르세요', 'rec');
      else if (state === 'stopped') setStatus('녹음 완료', 'idle');
      else if (state === 'error') setStatus('오류', 'err');
    },
    onLevel: function (level) { levelBar.style.width = Math.round(level * 100) + '%'; },
    onError: function (msg) { showBanner('⚠️ ' + msg); },
    onAudio: function (blob) { processAudio(blob); }
  });

  /* --- 녹음 버튼 토글 --- */
  btnRecord.addEventListener('click', function () {
    if (btnRecord.disabled) return;
    if (!isRecording) {
      hideBanner();
      recorder.start();
      isRecording = true;
      btnRecord.textContent = '⏹️  녹음 정지';
      btnRecord.classList.add('recording');
    } else {
      recorder.stop();
      isRecording = false;
      btnRecord.textContent = '🎙️  녹음 시작';
      btnRecord.classList.remove('recording');
    }
  });

  /* --- 녹음 정지 후: 변환 → 정리 → 저장 (자동) --- */
  function processAudio(blob) {
    showProcessing('🖊️ 변환 준비 중…');
    btnRecord.disabled = true;

    TranscriberModule.transcribe(blob, function (p) {
      if (p.phase === 'lib') setProcessing('🖊️ 변환 기능 불러오는 중…');
      else if (p.phase === 'model') setProcessing('🖊️ 변환 모델 준비 중…' + (p.device === 'wasm' ? ' (CPU 모드)' : ''));
      else if (p.phase === 'download') setProcessing('⬇️ 처음 준비 중… ' + p.pct + '% (다음부터는 빨라져요)');
      else if (p.phase === 'decode') setProcessing('🖊️ 소리를 글자로 바꾸는 중…');
      else if (p.phase === 'transcribe') setProcessing('🖊️ 글자로 옮기는 중…');
    }).then(function (text) {
      btnRecord.disabled = false;
      hideProcessing();
      if (!text) {
        showBanner('소리가 잘 들리지 않았어요. 다시 한 번 녹음해 주세요.');
        setStatus('대기 중', 'idle');
        return;
      }
      transcriptBox.value = text;
      autoGrow(transcriptBox);
      analyzeAndShow();
      autoSave();                    // 끝나면 자동 저장 + 우편함 전송
      setStatus('정리 완료', 'idle');
    }).catch(function (e) {
      console.warn(e);
      btnRecord.disabled = false;
      hideProcessing();
      showBanner('⚠️ 변환에 실패했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요. (' + (e && e.message ? e.message : '오류') + ')');
      setStatus('오류', 'err');
    });
  }

  /* --- 현재 전사로 정리해서 결과 화면 표시 --- */
  function currentData() {
    var text = transcriptBox.value.trim();
    if (!text) return null;
    var r = AnalysisModule.analyze(text);
    return { transcript: text, summary: r.summary, todos: r.todos, decisions: r.decisions, keywords: r.keywords };
  }

  function analyzeAndShow() {
    var text = transcriptBox.value.trim();
    resultWrap.style.display = 'block';
    if (!text) { resultArea.innerHTML = '<p class="empty">내용이 없습니다.</p>'; return; }
    renderResult(AnalysisModule.analyze(text));
  }

  function renderResult(r) {
    var html = '';
    html += section('📌 핵심 요약', r.summary, '핵심으로 볼 만한 문장을 찾지 못했습니다.');
    html += section('✅ 할 일', r.todos, '할 일로 보이는 내용이 없습니다.');
    html += section('📖 결정사항', r.decisions, '결정/합의로 보이는 내용이 없습니다.');
    if (r.keywords && r.keywords.length) {
      html += '<div class="card"><h3>🔑 자주 나온 단어</h3><div class="chips">';
      r.keywords.forEach(function (k) { html += '<span class="chip">' + esc(k.word) + ' <b>' + k.count + '</b></span>'; });
      html += '</div></div>';
    }
    resultArea.innerHTML = html;
  }

  function section(title, items, emptyMsg) {
    var h = '<div class="card"><h3>' + title + '</h3>';
    if (items && items.length) { h += '<ul>'; items.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; }); h += '</ul>'; }
    else h += '<p class="empty">' + emptyMsg + '</p>';
    return h + '</div>';
  }

  /* --- 자동 저장(폰 기록만). PC 전송은 교수님이 버튼으로 고른 것만 --- */
  function autoSave() {
    var data = currentData();
    if (!data) return;
    var entry = HistoryModule.save(data);   // sent: null (미전송)
    if (!entry) { setExportMsg('⚠️ 저장 공간을 쓸 수 없어 기록하지 못했습니다.', 'err'); return; }
    currentId = entry.id;
    setExportMsg('폰에 저장됨. PC로 보내려면 아래 "🖥️ PC로 보내기"를 누르세요.', 'ok');
    updateSendBtn();
    renderHistory();
  }

  /* --- PC(사무소 우편함)로 보내기: 버튼으로만 실행 --- */
  function sendToPc(id, onDone) {
    var entry = HistoryModule.get(id);
    if (!entry) { onDone && onDone(); return; }
    if (entry.sent === true) { setExportMsg('이미 PC로 보낸 메모입니다.', 'ok'); onDone && onDone(); return; }
    if (!window.OfficeBridge) { setExportMsg('전송 기능을 쓸 수 없습니다.', 'err'); onDone && onDone(); return; }
    setExportMsg('🖥️ PC로 보내는 중…', 'work');
    OfficeBridge.push(entry, function (status, msg) {
      if (status === 'sent') setExportMsg('🖥️ PC로 보냈습니다. (몇 분 내 PC에 저장돼요)', 'ok');
      else setExportMsg('전송 실패 · ' + msg + ' — 목록에서 [재시도]로 다시 보낼 수 있어요.', 'err');
      updateSendBtn();
      renderHistory();
      onDone && onDone();
    });
  }

  // 결과 화면의 PC 버튼 상태 갱신
  function updateSendBtn() {
    if (!btnSendPc) return;
    var e = currentId ? HistoryModule.get(currentId) : null;
    if (e && e.sent === true) {
      btnSendPc.textContent = '✅ PC로 보냄';
      btnSendPc.disabled = true; btnSendPc.classList.add('done');
    } else {
      btnSendPc.textContent = '🖥️ 이 메모 PC로 보내기';
      btnSendPc.disabled = false; btnSendPc.classList.remove('done');
    }
  }
  btnSendPc.addEventListener('click', function () {
    if (!currentId) { setExportMsg('먼저 녹음해 주세요.', 'err'); return; }
    sendToPc(currentId);
  });

  /* --- 전사 원문을 고치면 정리·저장본도 갱신(전송은 다시 안 함) --- */
  transcriptBox.addEventListener('input', function () {
    autoGrow(this);
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(function () {
      var text = transcriptBox.value.trim();
      if (!text) return;
      renderResult(AnalysisModule.analyze(text));
      if (currentId) {
        HistoryModule.update(currentId, currentData());
        renderHistory();
        setExportMsg('고친 내용으로 갱신했습니다.', 'ok');
      }
    }, 800);
  });

  /* --- 내보내기 --- */
  function runExport(fnName, label) {
    var data = currentData();
    if (!data) { setExportMsg('먼저 녹음하세요. 저장할 내용이 없습니다.', 'err'); return; }
    setExportMsg(label + ' 파일을 만드는 중…', 'work');
    ExportModule[fnName](data).then(function () {
      setExportMsg('✅ ' + label + ' 파일이 저장되었습니다. (폰의 "다운로드" 폴더에서 확인)', 'ok');
    }).catch(function (e) {
      var m = (e && e.message) || '';
      if (/불러오지 못|로드 실패/.test(m)) setExportMsg('⚠️ ' + label + ' 기능 파일을 인터넷에서 못 받았습니다. 연결 후 다시 눌러 주세요.', 'err');
      else setExportMsg('⚠️ ' + label + ' 저장 실패: ' + m, 'err');
    });
  }
  btnWord.addEventListener('click', function () { runExport('saveDocx', 'Word'); });
  btnPpt.addEventListener('click', function () { runExport('savePptx', 'PPT'); });

  /* --- 이 메모 삭제(방금 저장한 것 취소) --- */
  btnDelete.addEventListener('click', function () {
    if (currentId) HistoryModule.remove(currentId);
    currentId = null;
    updateSendBtn();
    transcriptBox.value = '';
    resultArea.innerHTML = '';
    resultWrap.style.display = 'none';
    setExportMsg('', '');
    renderHistory();
    setStatus('대기 중', 'idle');
  });

  /* --- 지난 메모 목록 --- */
  function renderHistory() {
    var list = HistoryModule.list();
    historyCount.textContent = list.length ? '(' + list.length + '건)' : '';
    if (!list.length) {
      historyList.innerHTML = '<p class="empty" style="color:#6b7280;font-size:14px;">녹음한 메모가 여기에 쌓입니다.</p>';
      return;
    }
    historyList.innerHTML = list.map(function (e) {
      var action;
      if (e.sent === true) action = '<span class="sent ok">전송됨 ✓</span>';
      else if (e.sent === false) action = '<button class="hsend retry" data-send="' + e.id + '">재시도</button>';
      else action = '<button class="hsend" data-send="' + e.id + '">🖥️ PC로</button>';
      return '<div class="histitem" data-id="' + e.id + '">' +
        '<span class="htitle">' + esc(e.title) + '</span>' +
        '<span class="hmeta">' + action + '<span class="hdate">' + e.date + '</span></span></div>';
    }).join('');
    // 항목 클릭 → 상세 / [PC로] 버튼 → 전송(상세 안 열리게 stopPropagation)
    Array.prototype.forEach.call(historyList.querySelectorAll('.histitem'), function (el) {
      el.addEventListener('click', function (ev) {
        var sendId = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-send');
        if (sendId) { ev.stopPropagation(); sendToPc(sendId); return; }
        openMemo(el.getAttribute('data-id'));
      });
    });
  }

  var modalData = null, modalId = null;
  function openMemo(id) {
    var e = HistoryModule.get(id);
    if (!e) return;
    modalData = e.data; modalId = e.id;
    modalTitle.textContent = e.date + ' ' + e.time;
    var sec = function (title, arr) {
      var h = '<div class="card"><h3>' + title + '</h3>';
      if (arr && arr.length) { h += '<ul>'; arr.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; }); h += '</ul>'; }
      else h += '<p class="empty">(없음)</p>';
      return h + '</div>';
    };
    var html = sec('📌 핵심 요약', e.data.summary) + sec('✅ 할 일', e.data.todos) + sec('📖 결정사항', e.data.decisions);
    html += '<div class="card"><h3>📝 전사 원문</h3><p style="white-space:pre-wrap;font-size:15px">' + esc(e.data.transcript || '(없음)') + '</p></div>';
    modalBody.innerHTML = html;
    modal.style.display = 'flex';
  }
  function closeModal() { modal.style.display = 'none'; modalData = null; modalId = null; }
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });
  modalWord.addEventListener('click', function () { exportFrom(modalData, 'saveDocx', 'Word'); });
  modalPpt.addEventListener('click', function () { exportFrom(modalData, 'savePptx', 'PPT'); });
  modalDelete.addEventListener('click', function () {
    if (!modalId) return;
    HistoryModule.remove(modalId);
    if (modalId === currentId) { currentId = null; resultWrap.style.display = 'none'; }
    closeModal(); renderHistory();
  });
  function exportFrom(data, fnName, label) {
    if (!data) return;
    ExportModule[fnName](data).catch(function (e) { console.warn(e); });
  }

  /* --- 화면 유틸 --- */
  function setStatus(text, kind) { statusText.textContent = text; statusDot.className = 'dot ' + (kind || 'idle'); }
  function setExportMsg(msg, kind) { exportMsg.textContent = msg || ''; exportMsg.className = 'exportmsg ' + (kind || ''); }
  function showProcessing(t) { processing.style.display = 'flex'; processingText.textContent = t; }
  function setProcessing(t) { processingText.textContent = t; }
  function hideProcessing() { processing.style.display = 'none'; }
  function showBanner(msg) { banner.style.display = 'block'; banner.innerHTML = msg; }
  function hideBanner() { if (RecordingModule.isSupported()) banner.style.display = 'none'; }
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 300) + 'px'; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  setStatus('대기 중', 'idle');
  renderHistory();

  // 밀렸던 우편함 전송 재시도
  if (window.OfficeBridge && OfficeBridge.pendingCount() > 0) {
    OfficeBridge.flush(function (sent, remaining) {
      if (sent > 0) { renderHistory(); setExportMsg('밀렸던 메모 ' + sent + '건을 사무소로 보냈습니다.', 'ok'); }
    });
  }
})();
