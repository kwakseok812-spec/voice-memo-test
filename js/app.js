/* ============================================================================
 * app.js  —  화면 연결(글루) 코드
 * ----------------------------------------------------------------------------
 * 역할:  녹음 모듈(recorder.js)과 분석 모듈(analyzer.js)을 화면에 이어 붙임.
 *        이 파일에는 "업무 논리"가 없고, 버튼 클릭 → 모듈 호출 → 결과 표시만 함.
 *        (통합 시 이 부분만 새 앱 화면에 맞춰 다시 쓰면 됨)
 * ==========================================================================*/

(function () {
  'use strict';

  // --- 화면 요소 ---
  const $ = function (id) { return document.getElementById(id); };
  const btnRecord = $('btnRecord');
  const btnDemo = $('btnDemo');
  const btnAnalyze = $('btnAnalyze');
  const btnCopy = $('btnCopy');
  const btnReset = $('btnReset');
  const statusText = $('statusText');
  const statusDot = $('statusDot');
  const levelBar = $('levelBar');
  const transcriptBox = $('transcript');
  const interimBox = $('interim');
  const resultArea = $('resultArea');
  const banner = $('banner');

  let isRecording = false;

  /* --- 지원 여부 안내 배너 --- */
  if (!RecordingModule.isSupported()) {
    banner.style.display = 'block';
    banner.innerHTML =
      '⚠️ 이 브라우저는 음성 인식을 지원하지 않습니다.<br>' +
      '갤럭시/안드로이드의 <b>Chrome</b> 또는 PC의 <b>Chrome</b>에서 열어 주세요. ' +
      '(아이폰 Safari 미지원)<br>' +
      '지금은 아래 <b>“예시로 정리해 보기”</b> 버튼으로 정리 기능만 확인할 수 있습니다.';
    btnRecord.disabled = true;
    btnRecord.classList.add('disabled');
  }

  /* --- 녹음 모듈 준비 --- */
  const recorder = new RecordingModule({
    lang: 'ko-KR',
    onStatus: function (state) {
      if (state === 'listening') {
        setStatus('녹음 중… 말씀하세요', 'rec');
      } else if (state === 'stopped') {
        setStatus('정지됨', 'idle');
      } else if (state === 'error') {
        setStatus('오류', 'err');
      }
    },
    onInterim: function (text) {
      interimBox.textContent = text;
    },
    onFinal: function (text) {
      transcriptBox.value = text;
      interimBox.textContent = '';
      autoGrow(transcriptBox);
    },
    onError: function (msg) {
      showBanner('⚠️ ' + msg);
    },
    onLevel: function (level) {
      levelBar.style.width = Math.round(level * 100) + '%';
    }
  });

  /* --- 버튼: 녹음 시작/정지 --- */
  btnRecord.addEventListener('click', function () {
    if (btnRecord.disabled) return;
    if (!isRecording) {
      hideBanner();
      transcriptBox.value = '';
      interimBox.textContent = '';
      resultArea.innerHTML = '';
      recorder.reset();
      recorder.start();
      isRecording = true;
      btnRecord.textContent = '⏹️  녹음 정지';
      btnRecord.classList.add('recording');
    } else {
      recorder.stop();
      isRecording = false;
      btnRecord.textContent = '🎙️  녹음 시작';
      btnRecord.classList.remove('recording');
      // 정지하면 자동으로 정리 실행
      setTimeout(runAnalysis, 200);
    }
  });

  /* --- 버튼: 예시로 정리해 보기(마이크 없이 파이프라인 확인) --- */
  const SAMPLE_TEXT =
    '오늘 학과 회의 내용을 정리하겠습니다. ' +
    '다음 주 화요일까지 신입생 오리엔테이션 자료를 작성해야 합니다. ' +
    '장소는 5호관 대강당으로 정했습니다. ' +
    '홍보 포스터는 김 선생님이 만들기로 했습니다. ' +
    '예산은 학과 운영비에서 삼십만원을 쓰기로 결정했습니다. ' +
    '그리고 참석 학생 명단은 제가 내일까지 정리해서 공유하겠습니다. ' +
    '외부 강사 섭외는 다음 회의에서 다시 논의하기로 했습니다. ' +
    '행사 안내 문자는 행사 이틀 전에 발송하기로 합의했습니다.';

  btnDemo.addEventListener('click', function () {
    hideBanner();
    transcriptBox.value = SAMPLE_TEXT;
    autoGrow(transcriptBox);
    setStatus('예시 문장 입력됨', 'idle');
    runAnalysis();
  });

  /* --- 버튼: (직접 편집 후) 다시 정리 --- */
  btnAnalyze.addEventListener('click', runAnalysis);

  /* --- 버튼: 결과 복사 --- */
  btnCopy.addEventListener('click', function () {
    const text = buildPlainReport();
    if (!text) { showBanner('복사할 정리 결과가 없습니다.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashButton(btnCopy, '복사됨 ✓');
      }, function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  });

  /* --- 버튼: 전체 지우기 --- */
  btnReset.addEventListener('click', function () {
    if (isRecording) { recorder.stop(); isRecording = false;
      btnRecord.textContent = '🎙️  녹음 시작'; btnRecord.classList.remove('recording'); }
    transcriptBox.value = '';
    interimBox.textContent = '';
    resultArea.innerHTML = '';
    recorder.reset();
    setStatus('대기 중', 'idle');
    hideBanner();
  });

  /* ------------------------- 화면 처리 함수들 ------------------------- */

  function runAnalysis() {
    const text = transcriptBox.value.trim();
    if (!text) {
      resultArea.innerHTML =
        '<p class="empty">먼저 녹음하거나 예시 버튼을 눌러 주세요.</p>';
      return;
    }
    const r = AnalysisModule.analyze(text);
    renderResult(r);
  }

  function renderResult(r) {
    let html = '';

    html += section('📌 핵심 요약', r.summary,
      '핵심으로 볼 만한 문장을 찾지 못했습니다.');
    html += section('✅ 할 일', r.todos,
      '할 일로 보이는 내용이 없습니다.');
    html += section('📖 결정사항', r.decisions,
      '결정/합의로 보이는 내용이 없습니다.');

    // 키워드
    if (r.keywords && r.keywords.length) {
      html += '<div class="card"><h3>🔑 자주 나온 단어</h3><div class="chips">';
      r.keywords.forEach(function (k) {
        html += '<span class="chip">' + esc(k.word) +
          ' <b>' + k.count + '</b></span>';
      });
      html += '</div></div>';
    }

    resultArea.innerHTML = html;
  }

  function section(title, items, emptyMsg) {
    let h = '<div class="card"><h3>' + title + '</h3>';
    if (items && items.length) {
      h += '<ul>';
      items.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
      h += '</ul>';
    } else {
      h += '<p class="empty">' + emptyMsg + '</p>';
    }
    h += '</div>';
    return h;
  }

  function buildPlainReport() {
    const text = transcriptBox.value.trim();
    if (!text) return '';
    const r = AnalysisModule.analyze(text);
    let out = '[핵심 요약]\n';
    out += (r.summary.length ? r.summary.map(function (s){return '- '+s;}).join('\n') : '- (없음)');
    out += '\n\n[할 일]\n';
    out += (r.todos.length ? r.todos.map(function (s){return '- '+s;}).join('\n') : '- (없음)');
    out += '\n\n[결정사항]\n';
    out += (r.decisions.length ? r.decisions.map(function (s){return '- '+s;}).join('\n') : '- (없음)');
    out += '\n\n[원문 전사]\n' + text;
    return out;
  }

  function setStatus(text, kind) {
    statusText.textContent = text;
    statusDot.className = 'dot ' + (kind || 'idle');
  }

  function showBanner(msg) { banner.style.display = 'block'; banner.innerHTML = msg; }
  function hideBanner() {
    if (RecordingModule.isSupported()) banner.style.display = 'none';
  }

  function flashButton(btn, label) {
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(function () { btn.textContent = old; }, 1200);
  }

  function fallbackCopy(text) {
    transcriptBox.focus();
    const tmp = document.createElement('textarea');
    tmp.value = text;
    document.body.appendChild(tmp);
    tmp.select();
    try { document.execCommand('copy'); flashButton(btnCopy, '복사됨 ✓'); }
    catch (e) { showBanner('복사에 실패했습니다. 화면에서 직접 선택해 복사해 주세요.'); }
    document.body.removeChild(tmp);
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 300) + 'px';
  }
  transcriptBox.addEventListener('input', function () { autoGrow(this); });

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  setStatus('대기 중', 'idle');

  /* ======================================================================
   * 저장 · 내보내기 · 지난 메모(기록)   — app.js 안의 화면 연결부
   * ==================================================================== */
  const btnSave = $('btnSave');
  const btnWord = $('btnWord');
  const btnPpt = $('btnPpt');
  const btnMd = $('btnMd');
  const exportMsg = $('exportMsg');
  const historyList = $('historyList');
  const historyCount = $('historyCount');
  const modal = $('modal');
  const modalTitle = $('modalTitle');
  const modalBody = $('modalBody');
  const modalClose = $('modalClose');
  const modalWord = $('modalWord');
  const modalPpt = $('modalPpt');
  const modalDelete = $('modalDelete');

  let modalData = null;   // 현재 모달에 열린 메모의 data
  let modalId = null;

  // 현재 화면의 정리 데이터 (전사원문 + 분석결과) 만들기
  function currentData() {
    const text = transcriptBox.value.trim();
    if (!text) return null;
    const r = AnalysisModule.analyze(text);
    return {
      transcript: text,
      summary: r.summary, todos: r.todos,
      decisions: r.decisions, keywords: r.keywords
    };
  }

  function setExportMsg(msg, kind) {
    exportMsg.textContent = msg || '';
    exportMsg.className = 'exportmsg ' + (kind || '');
  }

  // 내보내기 공통 실행기: 로딩표시 → 결과/오류 안내(조용히 실패 금지)
  function runExport(fnName, label, data) {
    if (!data) { setExportMsg('먼저 녹음하거나 예시로 정리해 주세요.', 'err'); return; }
    setExportMsg(label + ' 파일을 만드는 중입니다…', 'work');
    ExportModule[fnName](data)
      .then(function (result) {
        if (result === 'shared') setExportMsg(label + ' 파일을 공유했습니다.', 'ok');
        else if (result === 'aborted') setExportMsg('공유를 취소했습니다.', '');
        else setExportMsg(label + ' 파일을 저장(다운로드)했습니다.', 'ok');
      })
      .catch(function (e) {
        console.warn(e);
        const m = (e && e.message) || '';
        if (/불러오지 못|로드 실패/.test(m)) {
          setExportMsg('⚠️ ' + label + ' 기능에 필요한 파일을 인터넷에서 못 받았습니다. ' +
            '인터넷 연결을 확인한 뒤 다시 눌러 주세요.', 'err');
        } else {
          setExportMsg('⚠️ ' + label + ' 저장에 실패했습니다: ' + m, 'err');
        }
      });
  }

  btnWord.addEventListener('click', function () { runExport('saveDocx', 'Word', currentData()); });
  btnPpt.addEventListener('click', function () { runExport('savePptx', 'PPT', currentData()); });
  btnMd.addEventListener('click', function () { runExport('saveMarkdown', '기록(MD)', currentData()); });

  // 이 메모 저장(기록) — localStorage
  btnSave.addEventListener('click', function () {
    const data = currentData();
    if (!data) { setExportMsg('저장할 내용이 없습니다. 먼저 정리해 주세요.', 'err'); return; }
    const entry = HistoryModule.save(data);
    if (!entry) {
      setExportMsg('⚠️ 저장 공간을 쓸 수 없어 기록하지 못했습니다(브라우저 설정 확인).', 'err');
      return;
    }
    setExportMsg('저장했습니다 · 사무소로 보내는 중…', 'work');
    renderHistory();
    // 사무소 우편함으로 전송(비동기). 성공/대기 상태를 화면에 반영.
    if (window.OfficeBridge) {
      OfficeBridge.push(entry, function (status, msg) {
        setExportMsg('저장 완료 · ' + msg, status === 'sent' ? 'ok' : 'work');
        renderHistory();
      });
    } else {
      setExportMsg('저장했습니다 · ' + entry.date + ' ' + entry.time, 'ok');
    }
  });

  // 지난 메모 목록 그리기
  function renderHistory() {
    const list = HistoryModule.list();
    historyCount.textContent = list.length ? '(' + list.length + '건)' : '';
    if (!list.length) {
      historyList.innerHTML =
        '<p class="empty" style="color:#6b7280;font-size:14px;">저장한 메모가 여기에 쌓입니다.</p>';
      return;
    }
    historyList.innerHTML = list.map(function (e) {
      var badge = e.sent === true
        ? '<span class="sent ok">전송됨</span>'
        : (e.sent === false ? '<span class="sent wait">미전송</span>' : '');
      return '<div class="histitem" data-id="' + e.id + '">' +
        '<span class="htitle">' + esc(e.title) + '</span>' +
        '<span class="hmeta">' + badge + '<span class="hdate">' + e.date + ' ' + e.time + '</span></span></div>';
    }).join('');
    Array.prototype.forEach.call(historyList.querySelectorAll('.histitem'), function (el) {
      el.addEventListener('click', function () { openMemo(el.getAttribute('data-id')); });
    });
  }

  // 메모 상세 모달 열기
  function openMemo(id) {
    const e = HistoryModule.get(id);
    if (!e) return;
    modalData = e.data; modalId = e.id;
    modalTitle.textContent = e.date + ' ' + e.time;
    const sec = function (title, arr) {
      let h = '<div class="card"><h3>' + title + '</h3>';
      if (arr && arr.length) { h += '<ul>'; arr.forEach(function (s){ h += '<li>'+esc(s)+'</li>'; }); h += '</ul>'; }
      else h += '<p class="empty">(없음)</p>';
      return h + '</div>';
    };
    let html = sec('📌 핵심 요약', e.data.summary);
    html += sec('✅ 할 일', e.data.todos);
    html += sec('📖 결정사항', e.data.decisions);
    html += '<div class="card"><h3>📝 전사 원문</h3><p style="white-space:pre-wrap;font-size:15px">' +
      esc(e.data.transcript || '(없음)') + '</p></div>';
    modalBody.innerHTML = html;
    modal.style.display = 'flex';
  }
  function closeModal() { modal.style.display = 'none'; modalData = null; modalId = null; }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });
  modalWord.addEventListener('click', function () { runExport('saveDocx', 'Word', modalData); });
  modalPpt.addEventListener('click', function () { runExport('savePptx', 'PPT', modalData); });
  modalDelete.addEventListener('click', function () {
    if (!modalId) return;
    HistoryModule.remove(modalId);
    closeModal();
    renderHistory();
    setExportMsg('메모를 삭제했습니다.', '');
  });

  renderHistory();  // 시작 시 목록 표시

  // 시작 시, 지난번에 전송 못 한 메모가 있으면 조용히 재시도
  if (window.OfficeBridge && OfficeBridge.pendingCount() > 0) {
    OfficeBridge.flush(function (sent, remaining) {
      if (sent > 0) { renderHistory();
        setExportMsg('밀렸던 메모 ' + sent + '건을 사무소로 보냈습니다.' +
          (remaining ? ' (' + remaining + '건 아직 대기)' : ''), 'ok'); }
    });
  }
})();
