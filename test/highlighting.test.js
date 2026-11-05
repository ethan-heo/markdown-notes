const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../media/highlight-utils.js');

test('동일한 문구가 여러 곳에 있으면 임의의 영역을 하이라이트하지 않는다', () => {
  assert.equal(utils.findUniqueTextMatch('같은 문장', ['첫 문장', '같은 문장', '같은 문장']), null);
});

test('동일한 텍스트 노드 안에 같은 문구가 두 번 있어도 임의 선택하지 않는다', () => {
  assert.equal(utils.findUniqueTextMatch('반복', ['앞 반복 중간 반복 뒤']), null);
});

test('문구가 한 곳에만 있으면 정확한 노드와 offset을 반환한다', () => {
  assert.deepEqual(utils.findUniqueTextMatch('선택 영역', ['첫 번째', '메모를 남길 선택 영역입니다']), {
    nodeIndex: 1,
    index: 7,
    length: 5
  });
});

test('본문이 변경되어 앵커의 텍스트가 달라지면 오래된 하이라이트를 거부한다', () => {
  assert.equal(utils.isAnchorTextValid('변경된 본문', '원래 선택 영역'), false);
  assert.equal(utils.isAnchorTextValid('원래\n선택 영역', '원래 선택 영역'), true);
});

test('파일마다 메모 저장 키가 분리된다', () => {
  assert.notEqual(utils.storageKey('file:///notes/a.md'), utils.storageKey('file:///notes/b.md'));
  assert.equal(utils.storageKey('file:///notes/a.md'), 'markdown-selection-notes:file:///notes/a.md');
});

test('사이드바 너비는 사용 가능한 범위로 제한된다', () => {
  assert.equal(utils.clampSidebarWidth(100), 240);
  assert.equal(utils.clampSidebarWidth(800), 520);
  assert.equal(utils.clampSidebarWidth('invalid'), 320);
});
