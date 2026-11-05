const assert = require('node:assert/strict');
const vscode = require('vscode');
const { chromium } = require('playwright');

async function run() {
  const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'markdown-selection-notes');
  assert.ok(extension, '개발 중인 Markdown Selection Notes 확장을 찾을 수 없습니다.');
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('markdownSelectionNotes.openPreview'));
  assert.ok(commands.includes('markdownSelectionNotes.addNote'));

  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: '# E2E Preview\n\n선택 영역에 메모를 남깁니다.'
  });
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  editor.selection = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 6));
  await vscode.commands.executeCommand('markdownSelectionNotes.openPreview');
  assert.equal(document.languageId, 'markdown');

  if (process.env.E2E_UI === '1') {
    await runRealPreviewInteraction(document);
    if (process.env.E2E_KEEP_OPEN === '1') {
      await vscode.window.showInformationMessage(
        '실제 Preview UI E2E가 완료되었습니다. 메모 카드와 하이라이트를 확인한 뒤 종료하세요.',
        '테스트 종료'
      );
    }
    return;
  }

  if (process.env.E2E_KEEP_OPEN === '1') {
    await vscode.window.showInformationMessage(
      '기본 Markdown Preview에서 텍스트를 실제로 드래그하고 메모를 저장한 뒤 종료하세요.',
      '테스트 종료'
    );
  }
}

async function runRealPreviewInteraction(document) {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  let frame = await waitForPreviewFrameWithText(browser, '선택 영역에 메모를 남깁니다.');
  const paragraph = frame.locator('.markdown-body p').filter({ hasText: '선택 영역에 메모를 남깁니다.' }).first();
  await paragraph.waitFor({ state: 'visible', timeout: 15000 });
  const box = await paragraph.boundingBox();
  assert.ok(box, '기본 Markdown Preview에서 문단 위치를 찾을 수 없습니다.');

  const page = paragraph.page();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 8, { steps: 8 });
  await page.mouse.up();

  const addButton = frame.locator('#markdown-selection-notes-button');
  await addButton.waitFor({ state: 'visible', timeout: 5000 });
  await addButton.click();

  const editor = frame.locator('#markdown-selection-notes-editor');
  await editor.waitFor({ state: 'visible', timeout: 5000 });
  await editor.locator('textarea').fill('실제 Preview UI E2E 메모');
  await editor.locator('[data-action="save"]').click();

  const card = frame.locator('.markdown-selection-note').filter({ hasText: '실제 Preview UI E2E 메모' }).first();
  await card.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await card.count(), 1);
  assert.equal(await frame.evaluate(() => CSS.highlights?.has('markdown-selection-notes') ?? false), true);

  // 저장된 메모가 있는 상태에서 Preview를 닫았다가 다시 열어도 최초 렌더링에 하이라이트가 복원되는지 확인한다.
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('markdownSelectionNotes.openPreview');
  frame = await waitForPreviewFrameWithText(browser, '선택 영역에 메모를 남깁니다.');
  assert.equal(await frame.locator('.markdown-selection-note').filter({ hasText: '실제 Preview UI E2E 메모' }).count(), 1);
  assert.equal(await frame.evaluate(() => CSS.highlights?.get('markdown-selection-notes')?.size > 0), true);

  // 다른 파일을 열었다가 원래 파일로 돌아왔을 때 파일별 메모와 하이라이트가 복원되는지 확인한다.
  const otherDocument = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: '# 다른 파일\n\n이 파일에는 메모가 없습니다.'
  });
  await vscode.window.showTextDocument(otherDocument, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('markdownSelectionNotes.openPreview');
  const otherFrame = await waitForPreviewFrameWithText(browser, '이 파일에는 메모가 없습니다.');
  assert.equal(await otherFrame.locator('.markdown-selection-note').count(), 0);
  assert.equal(await otherFrame.evaluate(() => CSS.highlights?.get('markdown-selection-notes')?.size ?? 0), 0);

  await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('markdownSelectionNotes.openPreview');
  frame = await waitForPreviewFrameWithText(browser, '선택 영역에 메모를 남깁니다.');
  assert.equal(await frame.locator('.markdown-selection-note').filter({ hasText: '실제 Preview UI E2E 메모' }).count(), 1);
  assert.equal(await frame.evaluate(() => CSS.highlights?.get('markdown-selection-notes')?.size > 0), true);

  // 메모 카드 클릭이 원문 위치 이동을 호출하는지 확인한다.
  await frame.evaluate(() => {
    window.__markdownSelectionNotesScrollCalls = [];
    window.scrollTo = (...args) => window.__markdownSelectionNotesScrollCalls.push(args);
  });
  await frame.locator('.markdown-selection-note').filter({ hasText: '실제 Preview UI E2E 메모' }).click();
  assert.ok(await frame.evaluate(() => window.__markdownSelectionNotesScrollCalls.length > 0));
}

async function waitForPreviewFrameWithText(browser, text) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        for (const frame of page.frames()) {
          if (await frame.locator('#vscode-markdown-preview-data').count() && await frame.locator('.markdown-body').filter({ hasText: text }).count()) return frame;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`기본 Markdown Preview Webview에서 다음 문서를 찾지 못했습니다: ${text}`);
}

module.exports = { run };
