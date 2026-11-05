const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const previewScript = fs.readFileSync(path.join(__dirname, '../../media/preview.js'), 'utf8');

function createPreview({ source = 'file:///notes/demo.md', markdown = '첫 번째 문장입니다.\n같은 문장입니다. 같은 문장입니다.', notes = [], collapsed = false, highlightColor } = {}) {
  const config = highlightColor ? `<div id="markdown-selection-notes-config" data-highlight-color="${highlightColor}"></div>` : '';
  const dom = new JSDOM(`<!doctype html><html><head><div id="vscode-markdown-preview-data" data-settings='${JSON.stringify({ source })}'></div></head><body>${config}<div class="markdown-body"><p>${markdown}</p></div></body></html>`, {
    url: 'https://vscode-webview.test/preview',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const highlights = new Map();
  window.CSS = { highlights };
  window.Highlight = class Highlight extends Set {
    constructor(...ranges) { super(ranges); }
  };
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.Range.prototype.getBoundingClientRect = () => ({ top: 100, height: 20 });
  window.scrollTo = (...args) => { window.__lastScroll = args; };
  window.localStorage.setItem('markdown-selection-notes:' + source, JSON.stringify(notes));
  window.localStorage.setItem('markdown-selection-notes-layout', JSON.stringify({ width: 320, collapsed }));
  window.eval(previewScript);
  return dom;
}

function selectText(window, element, start, end) {
  const textNode = element.firstChild;
  const range = window.document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  element.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 180, clientY: 240 }));
}

function waitForPreview() {
  return new Promise(resolve => setTimeout(resolve, 15));
}

describe('Markdown Selection Notes Preview E2E', function () {
  it('드래그 후 메모 버튼을 표시하고 저장하면 선택 영역을 하이라이트한다', async function () {
    const dom = createPreview();
    const { window } = dom;
    const paragraph = window.document.querySelector('p');
    selectText(window, paragraph, 0, 6);
    await waitForPreview();

    const button = window.document.getElementById('markdown-selection-notes-button');
    assert.equal(button.style.display, 'block');
    button.click();
    assert.equal(button.style.display, 'none');
    assert.equal(window.document.getElementById('markdown-selection-notes-editor').style.display, 'block');

    const textarea = window.document.querySelector('#markdown-selection-notes-editor textarea');
    textarea.value = '첫 문장을 검토합니다.';
    window.document.querySelector('[data-action="save"]').click();
    await waitForPreview();

    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 1);
    assert.equal(window.CSS.highlights.has('markdown-selection-notes'), true);
    assert.equal(window.CSS.highlights.has('markdown-selection-notes-draft'), false);
  });

  it('사용자에게 보이는 조작 문구를 아이콘으로 표시하고 접근성 이름은 유지한다', async function () {
    const dom = createPreview();
    const { window } = dom;
    const addButton = window.document.getElementById('markdown-selection-notes-button');
    const saveButton = window.document.querySelector('[data-action="save"]');
    const cancelButton = window.document.querySelector('[data-action="cancel"]');
    assert.equal(addButton.textContent, '＋');
    assert.equal(addButton.getAttribute('aria-label'), '메모 추가');
    assert.equal(saveButton.textContent, '✓');
    assert.equal(cancelButton.textContent, '×');
    assert.equal(window.document.querySelector('.markdown-selection-note-empty'), null);
  });

  it('메모 버튼을 누르면 버튼은 사라지고 드래그 영역은 입력 중에도 유지된다', async function () {
    const dom = createPreview();
    const { window } = dom;
    const paragraph = window.document.querySelector('p');
    selectText(window, paragraph, 0, 6);
    await waitForPreview();
    window.document.getElementById('markdown-selection-notes-button').click();

    assert.equal(window.document.getElementById('markdown-selection-notes-button').style.display, 'none');
    assert.equal(window.CSS.highlights.has('markdown-selection-notes-draft'), true);
  });

  it('접힌 메모 영역에서도 드래그하면 메모 버튼이 나타나고 입력창은 선택 위치에 표시된다', async function () {
    const dom = createPreview({ collapsed: true });
    const { window } = dom;
    const paragraph = window.document.querySelector('p');
    selectText(window, paragraph, 0, 6);
    await waitForPreview();
    const button = window.document.getElementById('markdown-selection-notes-button');
    assert.equal(button.style.display, 'block');
    button.click();
    const editor = window.document.getElementById('markdown-selection-notes-editor');
    assert.equal(editor.classList.contains('markdown-selection-notes-editor-floating'), true);
  });

  it('메모 카드를 클릭하면 원문 위치로 스크롤한다', async function () {
    const dom = createPreview();
    const { window } = dom;
    const paragraph = window.document.querySelector('p');
    selectText(window, paragraph, 0, 6);
    await waitForPreview();
    window.document.getElementById('markdown-selection-notes-button').click();
    window.document.querySelector('#markdown-selection-notes-editor textarea').value = '이동 테스트';
    window.document.querySelector('[data-action="save"]').click();
    await waitForPreview();
    window.document.querySelector('.markdown-selection-note').click();
    assert.ok(window.__lastScroll);
  });

  it('취소하면 입력창과 임시 하이라이트가 사라지고 메모는 저장되지 않는다', async function () {
    const dom = createPreview();
    const { window } = dom;
    selectText(window, window.document.querySelector('p'), 0, 6);
    await waitForPreview();
    window.document.getElementById('markdown-selection-notes-button').click();
    window.document.querySelector('[data-action="cancel"]').click();

    assert.equal(window.document.getElementById('markdown-selection-notes-editor').style.display, 'none');
    assert.equal(window.CSS.highlights.has('markdown-selection-notes-draft'), false);
    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 0);
    assert.deepEqual(JSON.parse(window.localStorage.getItem('markdown-selection-notes:file:///notes/demo.md')), []);
  });

  it('메모 내용이 비어 있으면 저장하지 않는다', async function () {
    const dom = createPreview();
    const { window } = dom;
    selectText(window, window.document.querySelector('p'), 0, 6);
    await waitForPreview();
    window.document.getElementById('markdown-selection-notes-button').click();
    window.document.querySelector('[data-action="save"]').click();

    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 0);
    assert.equal(window.CSS.highlights.has('markdown-selection-notes-draft'), true);
  });

  it('메모 카드를 삭제하면 카드와 저장 데이터가 함께 제거된다', async function () {
    const notes = [{ id: 'delete-me', source: 'file:///notes/demo.md', text: '첫 번째 문장입니다.', comment: '삭제 대상', createdAt: new Date().toISOString() }];
    const dom = createPreview({ notes });
    const { window } = dom;
    await waitForPreview();
    window.document.querySelector('.markdown-selection-note-delete').click();

    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 0);
    assert.deepEqual(JSON.parse(window.localStorage.getItem('markdown-selection-notes:file:///notes/demo.md')), []);
    assert.equal(window.CSS.highlights.get('markdown-selection-notes').size, 0);
  });

  it('메모 영역을 접고 펼치면 상태와 접근성 라벨을 저장한다', async function () {
    const notes = [{ id: 'toggle-me', source: 'file:///notes/demo.md', text: '첫 번째 문장입니다.', comment: '접기 테스트', createdAt: new Date().toISOString() }];
    const dom = createPreview({ notes });
    const { window } = dom;
    const header = window.document.getElementById('markdown-selection-notes-header');
    const toggle = window.document.getElementById('markdown-selection-notes-toggle');
    const card = window.document.querySelector('.markdown-selection-note');
    assert.ok(header);
    assert.equal(toggle.parentElement, header);
    assert.equal(card.parentElement.id, 'markdown-selection-notes-list');
    toggle.click();
    assert.equal(window.document.body.classList.contains('markdown-selection-notes-sidebar-collapsed'), true);
    assert.equal(toggle.getAttribute('aria-label'), '메모 영역 펼치기');
    assert.equal(JSON.parse(window.localStorage.getItem('markdown-selection-notes-layout')).collapsed, true);
    toggle.click();
    assert.equal(window.document.body.classList.contains('markdown-selection-notes-sidebar-collapsed'), false);
    assert.equal(toggle.getAttribute('aria-label'), '메모 영역 접기');
  });

  it('메모 영역을 드래그로 조절하면 범위 내 너비와 레이아웃을 저장한다', async function () {
    const dom = createPreview();
    const { window } = dom;
    const handle = window.document.getElementById('markdown-selection-notes-resize');
    const down = new window.Event('pointerdown', { bubbles: true });
    Object.defineProperty(down, 'clientX', { value: 100 });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    handle.dispatchEvent(down);
    const move = new window.Event('pointermove', { bubbles: true });
    Object.defineProperty(move, 'clientX', { value: 20 });
    handle.dispatchEvent(move);
    const up = new window.Event('pointerup', { bubbles: true });
    handle.dispatchEvent(up);

    assert.equal(window.document.body.style.getPropertyValue('--markdown-selection-notes-width'), '400px');
    assert.equal(JSON.parse(window.localStorage.getItem('markdown-selection-notes-layout')).width, 400);
  });

  it('더 보기 버튼으로 메모 목록을 다음 페이지까지 렌더링한다', async function () {
    const notes = Array.from({ length: 81 }, (_, index) => ({
      id: 'page-' + index,
      source: 'file:///notes/demo.md',
      text: '인용문 ' + index,
      comment: '페이지 ' + index,
      createdAt: new Date().toISOString()
    }));
    const dom = createPreview({ notes });
    const { window } = dom;
    await waitForPreview();
    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 40);
    window.document.getElementById('markdown-selection-notes-more').click();
    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 80);
  });

  it('다른 파일로 Preview가 전환되면 해당 파일의 메모와 하이라이트만 표시한다', async function () {
    const sourceA = 'file:///notes/a.md';
    const sourceB = 'file:///notes/b.md';
    const notesA = [{ id: 'a-note', source: sourceA, text: '첫 번째 문장입니다.', comment: 'A 파일 메모', createdAt: new Date().toISOString() }];
    const notesB = [{ id: 'b-note', source: sourceB, text: '첫 번째 문장입니다.', comment: 'B 파일 메모', createdAt: new Date().toISOString() }];
    const dom = createPreview({ source: sourceA, notes: notesA });
    const { window } = dom;
    window.localStorage.setItem('markdown-selection-notes:' + sourceB, JSON.stringify(notesB));
    const data = window.document.getElementById('vscode-markdown-preview-data');
    data.setAttribute('data-settings', JSON.stringify({ source: sourceB }));
    await waitForPreview();

    assert.equal(window.document.querySelector('.markdown-selection-note-comment').textContent, 'B 파일 메모');
    assert.equal(window.CSS.highlights.get('markdown-selection-notes').size, 1);
  });

  it('저장된 메모는 첫 렌더링부터 원문 하이라이트를 복원한다', async function () {
    const notes = [{ id: 'restore-me', source: 'file:///notes/demo.md', text: '첫 번째 문장입니다.', comment: '복원 테스트', createdAt: new Date().toISOString() }];
    const dom = createPreview({ notes });
    const { window } = dom;
    assert.equal(window.document.querySelector('.markdown-selection-note-comment').textContent, '복원 테스트');
    assert.equal(window.CSS.highlights.get('markdown-selection-notes').size, 1);
  });

  it('Preview 설정의 하이라이팅 색상을 CSS 변수에 반영한다', async function () {
    const dom = createPreview({ highlightColor: 'rgba(255, 0, 0, 0.8)' });
    const { window } = dom;
    assert.equal(window.document.documentElement.style.getPropertyValue('--markdown-selection-notes-highlight-color'), 'rgba(255, 0, 0, 0.8)');
  });

  it('많은 메모를 한 번에 렌더링하지 않고 더 보기로 나누어 표시한다', async function () {
    const notes = Array.from({ length: 120 }, (_, index) => ({
      id: 'note-' + index,
      source: 'file:///notes/demo.md',
      text: '인용문 ' + index,
      comment: '메모 내용 ' + index,
      createdAt: new Date().toISOString()
    }));
    const dom = createPreview({ notes });
    const { window } = dom;
    await waitForPreview();
    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 40);
    assert.ok(window.document.getElementById('markdown-selection-notes-more'));

    window.document.getElementById('markdown-selection-notes-more').click();
    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 80);
    window.document.getElementById('markdown-selection-notes-more').click();
    assert.equal(window.document.querySelectorAll('.markdown-selection-note').length, 120);
  });
});
