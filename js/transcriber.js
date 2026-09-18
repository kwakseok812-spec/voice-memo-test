/* ============================================================================
 * transcriber.js  —  음성→글자 변환 모듈 (TranscriberModule)
 * ----------------------------------------------------------------------------
 * [방식]  transformers.js 의 Whisper 모델을 "브라우저 안에서" 실행한다.
 *   - 서버·API 키·비용 0 (완전 무료). 모델은 처음 한 번만 내려받아 캐시된다.
 *   - WebGPU 가 있으면 GPU로 빠르게, 없으면 WASM(CPU)으로 동작.
 *   - 한국어 품질을 위해 whisper-base 사용(tiny 는 빠르지만 한국어가 약함).
 *
 * [바깥 인터페이스]
 *   transcribe(blob, onProgress) -> Promise<string(한국어 텍스트)>
 *     onProgress({phase, pct, device}) 로 진행상황 알림:
 *       phase: 'lib'|'model'|'download'|'decode'|'transcribe'
 *
 * [통합 대비]  변환 엔진을 서버 STT로 바꾸려면 이 파일의 transcribe() 내부만
 *   교체하면 된다(입력 blob → 출력 텍스트 계약은 동일).
 * ==========================================================================*/

(function (global) {
  'use strict';

  // 느리면 'Xenova/whisper-tiny' 로 바꾸면 빨라진다(대신 한국어 정확도↓).
  var MODEL = 'Xenova/whisper-base';
  var TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0';

  var _tf = null, _asr = null, _loading = null;

  function _ensure(onProgress) {
    if (_asr) return Promise.resolve(_asr);
    if (_loading) return _loading;
    _loading = (async function () {
      onProgress && onProgress({ phase: 'lib' });
      _tf = await import(TF_URL);
      var device = ('gpu' in navigator) ? 'webgpu' : 'wasm';
      onProgress && onProgress({ phase: 'model', device: device });
      _asr = await _tf.pipeline('automatic-speech-recognition', MODEL, {
        device: device,
        progress_callback: function (x) {
          if (x && x.status === 'progress' && /\.onnx/.test(x.file || '')) {
            onProgress && onProgress({ phase: 'download', pct: Math.round(x.progress || 0), file: x.file });
          }
        }
      });
      // 워밍업: WebGPU는 파이프라인 생성 직후 "첫 추론"이 빈 결과를 내는 경우가 있어,
      // 무음 1초를 한 번 돌려 셰이더를 미리 컴파일해 둔다(첫 실제 변환이 정상 나오게).
      try {
        onProgress && onProgress({ phase: 'model', device: device });
        await _asr(new Float32Array(16000), { language: 'korean', task: 'transcribe' });
      } catch (e) { /* 워밍업 실패는 무시 */ }
      return _asr;
    })();
    return _loading;
  }

  // 녹음 Blob → 16kHz 모노 Float32 (Whisper 입력 형식)
  async function _decodeTo16kMono(blob) {
    var AC = global.AudioContext || global.webkitAudioContext;
    var buf = await blob.arrayBuffer();
    var ac = new AC();
    var decoded;
    try {
      decoded = await ac.decodeAudioData(buf);
    } finally {
      try { ac.close(); } catch (e) {}
    }
    var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    var frames = Math.max(1, Math.ceil(decoded.duration * 16000));
    var off = new OAC(1, frames, 16000);           // 1채널(모노)+16k → 다운믹스+리샘플 동시
    var src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start(0);
    var rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  async function transcribe(blob, onProgress) {
    var asr = await _ensure(onProgress);
    onProgress && onProgress({ phase: 'decode' });
    var audio = await _decodeTo16kMono(blob);
    onProgress && onProgress({ phase: 'transcribe' });
    var out = await asr(audio, {
      language: 'korean',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5
    });
    return ((out && out.text) || '').trim();
  }

  // 앱이 시작될 때 미리 모델을 데워두고 싶을 때(선택). 실패해도 무시.
  function warmup(onProgress) { return _ensure(onProgress).catch(function () {}); }

  global.TranscriberModule = { transcribe: transcribe, warmup: warmup, MODEL: MODEL };
})(window);
