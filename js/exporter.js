/* ============================================================================
 * exporter.js  —  내보내기 모듈 (ExportModule)
 * ----------------------------------------------------------------------------
 * [통합 대비 설계]
 *  - "정리 결과를 파일로 저장/공유하는 일"만 담당하는 독립 모듈.
 *  - 입력 형식(고정):  data = {
 *        transcript: string,               // 원문 전사
 *        summary: string[], todos: string[],
 *        decisions: string[], keywords: {word,count}[]
 *    }
 *  - 공개 함수:  saveMarkdown / saveDocx / savePdf / savePptx  (모두 async)
 *  - 저장 방식:  가능하면 Web Share(폰에서 카톡·메일 등으로 공유),
 *                안 되면 일반 다운로드로 자동 폴백.
 *  - 외부 라이브러리는 CDN에서 필요할 때만 불러오며,
 *    실패 시 한국어로 안내(조용히 실패 금지).
 * ==========================================================================*/

(function (global) {
  'use strict';

  // 라이브러리 CDN (필요할 때만 로드)
  // ※ PDF는 교수님 확정으로 제외 — 보기용은 Word·PPT면 충분(한글폰트 임베드 불필요).
  const LIBS = {
    docx: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',      // window.docx
    pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js' // window.PptxGenJS
  };

  const _loaded = {};
  function loadScript(url) {
    if (_loaded[url]) return _loaded[url];
    _loaded[url] = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () {
        _loaded[url] = null; // 다음에 재시도 가능
        reject(new Error('스크립트 로드 실패: ' + url));
      };
      document.head.appendChild(s);
    });
    return _loaded[url];
  }

  /* --- 공통 유틸 --- */
  function today() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function filename(ext) { return 'voice-memo-' + today() + '.' + ext; }

  function isEmpty(data) {
    return !data || (!(data.transcript || '').trim() &&
      !(data.summary || []).length && !(data.todos || []).length &&
      !(data.decisions || []).length);
  }

  // 파일 전달: Web Share 우선 → 일반 다운로드 폴백
  function deliver(blob, name, mime) {
    return new Promise(function (resolve) {
      try {
        const file = new File([blob], name, { type: mime });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          navigator.share({ files: [file], title: name })
            .then(function () { resolve('shared'); })
            .catch(function (e) {
              if (e && e.name === 'AbortError') { resolve('aborted'); return; }
              _download(blob, name); resolve('downloaded');
            });
          return;
        }
      } catch (e) { /* File/canShare 미지원 → 다운로드 */ }
      _download(blob, name); resolve('downloaded');
    });
  }
  function _download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /* ======================= 1) Markdown ======================= */
  function buildMarkdown(data) {
    const list = function (arr) {
      return (arr && arr.length)
        ? arr.map(function (s) { return '- ' + s; }).join('\n')
        : '- (없음)';
    };
    let md = '# 음성 메모 정리\n\n';
    md += '_작성일: ' + today() + '_\n\n';
    md += '## 📌 핵심 요약\n' + list(data.summary) + '\n\n';
    md += '## ✅ 할 일\n' + list(data.todos) + '\n\n';
    md += '## 📖 결정사항\n' + list(data.decisions) + '\n\n';
    if (data.keywords && data.keywords.length) {
      md += '## 🔑 자주 나온 단어\n';
      md += data.keywords.map(function (k) { return '- ' + k.word + ' (' + k.count + ')'; }).join('\n') + '\n\n';
    }
    md += '## 📝 전사 원문\n' + (data.transcript || '(없음)') + '\n';
    return md;
  }

  function saveMarkdown(data) {
    if (isEmpty(data)) return Promise.reject(new Error('내보낼 정리 결과가 없습니다.'));
    const blob = new Blob([buildMarkdown(data)], { type: 'text/markdown;charset=utf-8' });
    return deliver(blob, filename('md'), 'text/markdown');
  }

  /* ======================= 2) Word(.docx) ======================= */
  function saveDocx(data) {
    if (isEmpty(data)) return Promise.reject(new Error('내보낼 정리 결과가 없습니다.'));
    return loadScript(LIBS.docx).then(function () {
      const D = global.docx;
      if (!D) throw new Error('Word 라이브러리를 불러오지 못했습니다.');
      const FONT = 'Malgun Gothic'; // 맑은 고딕 (한글 안전)

      function h1(text) {
        return new D.Paragraph({
          spacing: { before: 240, after: 120 },
          children: [new D.TextRun({ text: text, bold: true, size: 32, font: FONT })]
        });
      }
      function bullets(arr) {
        if (!arr || !arr.length) {
          return [new D.Paragraph({ children: [new D.TextRun({ text: '(없음)', italics: true, size: 22, font: FONT })] })];
        }
        return arr.map(function (s) {
          return new D.Paragraph({
            bullet: { level: 0 },
            children: [new D.TextRun({ text: s, size: 22, font: FONT })]
          });
        });
      }
      function body(text) {
        return new D.Paragraph({ children: [new D.TextRun({ text: text, size: 22, font: FONT })] });
      }

      const children = [];
      children.push(new D.Paragraph({
        children: [new D.TextRun({ text: '음성 메모 정리', bold: true, size: 44, font: FONT })]
      }));
      children.push(body('작성일: ' + today()));
      children.push(h1('핵심 요약'));   children.push.apply(children, bullets(data.summary));
      children.push(h1('할 일'));       children.push.apply(children, bullets(data.todos));
      children.push(h1('결정사항'));    children.push.apply(children, bullets(data.decisions));
      if (data.keywords && data.keywords.length) {
        children.push(h1('자주 나온 단어'));
        children.push(body(data.keywords.map(function (k) { return k.word + '(' + k.count + ')'; }).join(', ')));
      }
      children.push(h1('전사 원문'));    children.push(body(data.transcript || '(없음)'));

      const doc = new D.Document({ sections: [{ children: children }] });
      return D.Packer.toBlob(doc).then(function (blob) {
        return deliver(blob, filename('docx'),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      });
    });
  }

  /* ======================= 3) PPT(.pptx) — 초안 ======================= */
  function savePptx(data) {
    if (isEmpty(data)) return Promise.reject(new Error('내보낼 정리 결과가 없습니다.'));
    return loadScript(LIBS.pptx).then(function () {
      const Pptx = global.PptxGenJS;
      if (!Pptx) throw new Error('PPT 라이브러리를 불러오지 못했습니다.');
      const p = new Pptx();
      p.defineLayout({ name: 'A4', width: 10, height: 5.625 });
      p.layout = 'A4';
      const FONT = 'Malgun Gothic';
      const BLUE = '2563EB';

      // 표지
      let s = p.addSlide();
      s.background = { color: BLUE };
      s.addText('음성 메모 정리', { x: 0.5, y: 1.8, w: 9, h: 1, align: 'center',
        fontFace: FONT, fontSize: 40, bold: true, color: 'FFFFFF' });
      s.addText('작성일: ' + today() + '  ·  (초안)', { x: 0.5, y: 3.0, w: 9, h: 0.6,
        align: 'center', fontFace: FONT, fontSize: 16, color: 'DCE6FF' });

      function contentSlide(title, arr) {
        const sl = p.addSlide();
        sl.addText(title, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontFace: FONT,
          fontSize: 26, bold: true, color: BLUE });
        const items = (arr && arr.length) ? arr : ['(없음)'];
        sl.addText(items.map(function (t) { return { text: t, options: { bullet: true } }; }),
          { x: 0.7, y: 1.3, w: 8.6, h: 3.8, fontFace: FONT, fontSize: 16, color: '222222',
            valign: 'top', lineSpacingMultiple: 1.2 });
      }
      contentSlide('📌 핵심 요약', data.summary);
      contentSlide('✅ 할 일', data.todos);
      contentSlide('📖 결정사항', data.decisions);

      return p.write('blob').then(function (blob) {
        return deliver(blob, filename('pptx'),
          'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      });
    });
  }

  global.ExportModule = {
    buildMarkdown: buildMarkdown,   // MD 문자열(기록용). history 저장에 사용.
    filename: filename,
    saveMarkdown: saveMarkdown,     // MD 파일 저장(선택). 기본 UI는 Word/PPT가 우선.
    saveDocx: saveDocx,
    savePptx: savePptx
  };
})(window);
