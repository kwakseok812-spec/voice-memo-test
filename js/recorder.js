/* ============================================================================
 * recorder.js  —  녹음/음성인식 모듈 (RecordingModule)
 * ----------------------------------------------------------------------------
 * [통합 대비 설계]
 *  - 이 파일은 "말소리를 글자로 바꾸는 일"만 담당하는 독립 모듈입니다.
 *  - 바깥(앱)은 아래 5개 콜백만 알면 됩니다:
 *      onStatus(state)   : 'idle' | 'listening' | 'stopped' | 'error'
 *      onInterim(text)   : 아직 확정되지 않은(말하는 중) 글자
 *      onFinal(text)     : 확정된 문장 조각 (누적됨)
 *      onError(msg)      : 사람이 읽을 오류 메시지(한국어)
 *      onLevel(0~1)      : 마이크 입력 세기(막대 표시용, 선택)
 *  - 나중에 통합 메신저 앱에서는 이 파일만 통째로 교체하면 됩니다.
 *    예) Web Speech API → (녹음 파일 업로드 + 서버 STT) 로 바꿔도
 *        바깥 코드는 그대로 동작합니다. 인터페이스(start/stop/콜백)가 같기 때문.
 *
 * [현재 구현 방식]  완전 클라이언트 / 무료 / 무설치
 *  - 브라우저 내장 Web Speech API(SpeechRecognition) 사용.
 *  - 갤럭시(안드로이드) Chrome에서 한국어(ko-KR) 실시간 전사 지원.
 *  - 인터넷 연결 필요(구글 음성엔진 경유). API 키·서버·비용 없음.
 *  - 마이크 세기 막대는 별도로 Web Audio API(getUserMedia)로 표시.
 * ==========================================================================*/

(function (global) {
  'use strict';

  // 브라우저마다 이름이 다름(webkit 접두어)
  const SpeechRecognition =
    global.SpeechRecognition || global.webkitSpeechRecognition || null;

  function RecordingModule(options) {
    options = options || {};
    this.lang = options.lang || 'ko-KR';

    // 콜백 (없으면 빈 함수)
    const noop = function () {};
    this.onStatus = options.onStatus || noop;
    this.onInterim = options.onInterim || noop;
    this.onFinal = options.onFinal || noop;
    this.onError = options.onError || noop;
    this.onLevel = options.onLevel || noop;

    // 내부 상태
    this._recognition = null;
    this._active = false;        // 사용자가 "녹음 중"으로 의도한 상태
    this._finalText = '';        // 지금까지 확정된 전체 전사
    this._audioCtx = null;
    this._micStream = null;
    this._levelRAF = null;
  }

  /** 이 브라우저에서 음성인식이 가능한가? */
  RecordingModule.isSupported = function () {
    return !!(global.SpeechRecognition || global.webkitSpeechRecognition);
  };

  /** 지금까지 확정된 전사 전체를 반환 */
  RecordingModule.prototype.getTranscript = function () {
    return this._finalText.trim();
  };

  /** 전사 내용 초기화(새 녹음 시작 전) */
  RecordingModule.prototype.reset = function () {
    this._finalText = '';
  };

  /** 녹음 시작 */
  RecordingModule.prototype.start = function () {
    const self = this;

    if (!SpeechRecognition) {
      this.onError(
        '이 브라우저는 음성 인식을 지원하지 않습니다. ' +
        '갤럭시/안드로이드의 Chrome 또는 PC의 Chrome에서 열어 주세요. ' +
        '(아이폰 Safari는 지원되지 않습니다.)'
      );
      this.onStatus('error');
      return;
    }

    // 이미 켜져 있으면 중복 실행 방지
    if (this._active) return;

    this._active = true;
    this._finalText = '';

    // 마이크 세기 막대(선택 기능) — 실패해도 전사에는 영향 없음
    this._startLevelMeter();

    this._createRecognition();
    try {
      this._recognition.start();
    } catch (e) {
      // 안드로이드에서 연속 start 시 예외가 나는 경우가 있어 방어
      console.warn('recognition.start error:', e);
    }
    this.onStatus('listening');
  };

  /** 녹음 정지 */
  RecordingModule.prototype.stop = function () {
    this._active = false;
    if (this._recognition) {
      try { this._recognition.stop(); } catch (e) {}
    }
    this._stopLevelMeter();
    this.onStatus('stopped');
  };

  /* ------------------------- 내부 구현 ------------------------- */

  RecordingModule.prototype._createRecognition = function () {
    const self = this;
    const rec = new SpeechRecognition();
    rec.lang = this.lang;
    rec.continuous = true;      // 길게 말해도 계속 인식(PC)
    rec.interimResults = true;  // 말하는 중간 결과도 보여줌

    rec.onresult = function (event) {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const chunk = result[0].transcript;
        if (result.isFinal) {
          // 문장 끝에 공백을 넣어 이어 붙임
          self._finalText += chunk.trim() + ' ';
          self.onFinal(self._finalText.trim());
        } else {
          interim += chunk;
        }
      }
      if (interim) self.onInterim(interim);
    };

    rec.onerror = function (event) {
      const map = {
        'no-speech': '소리가 감지되지 않았습니다. 조금 더 크게 말씀해 주세요.',
        'audio-capture':
          '마이크를 찾을 수 없습니다. 기기에 마이크가 연결되어 있는지 확인해 주세요.',
        'not-allowed':
          '마이크 사용이 차단되었습니다. 브라우저 주소창의 자물쇠(또는 권한) 설정에서 마이크를 "허용"으로 바꿔 주세요.',
        'network': '네트워크 오류입니다. 인터넷 연결을 확인해 주세요.',
        'aborted': '' // 정상 정지 과정에서 나므로 무시
      };
      const msg = map[event.error];
      if (msg) {
        self.onError(msg);
        self.onStatus('error');
      }
      // no-speech/aborted 등은 onend에서 자동 재시작으로 이어짐
    };

    // 안드로이드 Chrome은 잠깐 멈춰도 onend가 자주 발생함.
    // 사용자가 아직 "녹음 중"이면 자동으로 다시 켜서 끊김을 막는다(긴 녹음 대응).
    rec.onend = function () {
      if (self._active) {
        try {
          self._recognition.start();
        } catch (e) {
          // 너무 빠른 재시작 시 예외 → 잠깐 뒤 재시도
          setTimeout(function () {
            if (self._active) {
              try { self._recognition.start(); } catch (e2) {}
            }
          }, 300);
        }
      }
    };

    this._recognition = rec;
  };

  /* --- 마이크 입력 세기 막대(시각 피드백용). 실패해도 무시 --- */
  RecordingModule.prototype._startLevelMeter = function () {
    const self = this;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        self._micStream = stream;
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        self._audioCtx = new AC();
        const source = self._audioCtx.createMediaStreamSource(stream);
        const analyser = self._audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        function tick() {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const level = Math.min(1, Math.sqrt(sum / data.length) * 3);
          self.onLevel(level);
          self._levelRAF = requestAnimationFrame(tick);
        }
        tick();
      })
      .catch(function () {
        // 세기 막대만 실패한 것 — 전사는 별개로 진행
      });
  };

  RecordingModule.prototype._stopLevelMeter = function () {
    if (this._levelRAF) cancelAnimationFrame(this._levelRAF);
    this._levelRAF = null;
    this.onLevel(0);
    if (this._micStream) {
      this._micStream.getTracks().forEach(function (t) { t.stop(); });
      this._micStream = null;
    }
    if (this._audioCtx) {
      try { this._audioCtx.close(); } catch (e) {}
      this._audioCtx = null;
    }
  };

  global.RecordingModule = RecordingModule;
})(window);
