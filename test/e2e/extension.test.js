const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const vscode = require('vscode');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const GIFEncoder = require('gif-encoder-2');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');

const DEMO_MODE = process.env.E2E_DEMO === '1';
const DEMO_DELAY = 1800;
const demoFrameDirectory = DEMO_MODE ? fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-selection-notes-demo-')) : null;
let demoFrameNumber = 0;
let demoDesktopHeight = 0;

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
  let box = await paragraph.boundingBox();
  assert.ok(box, '기본 Markdown Preview에서 문단 위치를 찾을 수 없습니다.');
  await ensureDemoFullscreen();
  box = await paragraph.boundingBox();
  assert.ok(box, '전체 화면 전환 후 Markdown Preview 문단 위치를 찾을 수 없습니다.');
  await demoCheckpoint('preview');

  const page = paragraph.page();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  if (DEMO_MODE) {
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(box.x + 8 + (102 * step / 30), box.y + 8);
      await sleep(40);
    }
  } else {
    await page.mouse.move(box.x + 110, box.y + 8, { steps: 8 });
  }
  await page.mouse.up();
  await demoCheckpoint('selection');

  const addButton = frame.locator('#markdown-selection-notes-button');
  await addButton.waitFor({ state: 'visible', timeout: 5000 });
  await addButton.click();
  await demoCheckpoint('note-editor');

  const editor = frame.locator('#markdown-selection-notes-editor');
  await editor.waitFor({ state: 'visible', timeout: 5000 });
  await editor.locator('textarea').fill('실제 Preview UI E2E 메모');
  await demoCheckpoint('note-filled');
  await editor.locator('[data-action="save"]').click();

  const card = frame.locator('.markdown-selection-note').filter({ hasText: '실제 Preview UI E2E 메모' }).first();
  await card.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await card.count(), 1);
  assert.equal(await frame.evaluate(() => CSS.highlights?.has('markdown-selection-notes') ?? false), true);
  await demoCheckpoint('note-saved');

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
  await demoCheckpoint('card-clicked');

  // 마지막 메모를 삭제하면 카드·하이라이트·사이드바 영역이 모두 사라지는지 확인한다.
  const savedCard = frame.locator('.markdown-selection-note').filter({ hasText: '실제 Preview UI E2E 메모' }).first();
  await savedCard.locator('.markdown-selection-note-delete').click();
  await savedCard.waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(await frame.locator('.markdown-selection-note').count(), 0);
  assert.equal(await frame.evaluate(() => CSS.highlights?.get('markdown-selection-notes')?.size ?? 0), 0);
  assert.equal(await frame.locator('#markdown-selection-notes-list').isHidden(), true);
  assert.equal(await frame.locator('#markdown-selection-notes-header').isHidden(), true);
  assert.equal(await frame.locator('#markdown-selection-notes-resize').isHidden(), true);
  assert.equal(await frame.evaluate(() => document.body.classList.contains('markdown-selection-notes-sidebar-open')), false);
  finishDemo();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function demoCheckpoint(name) {
  if (!DEMO_MODE) return;
  await sleep(DEMO_DELAY);
  const framePath = path.join(demoFrameDirectory, `${String(demoFrameNumber).padStart(2, '0')}-${name}.png`);
  const screenshot = spawnSync('screencapture', ['-x', '-m', framePath], { stdio: 'ignore' });
  if (screenshot.status !== 0) throw new Error('전체 화면 캡처에 실패했습니다. macOS 화면 기록 권한을 확인하세요.');
  cropDemoFrame(framePath);
  const resize = spawnSync('sips', ['-Z', '1280', framePath], { stdio: 'ignore' });
  if (resize.status !== 0) throw new Error('데모 캡처 이미지 축소에 실패했습니다.');
  demoFrameNumber += 1;
}

function cropDemoFrame(framePath) {
  const metadata = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', framePath], { encoding: 'utf8' });
  if (metadata.status !== 0) throw new Error('데모 캡처 이미지 크기를 확인하지 못했습니다.');
  const width = Number(metadata.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(metadata.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height || !demoDesktopHeight) throw new Error('데모 캡처 이미지 크기가 올바르지 않습니다.');
  const menuBarHeight = Math.round(25 * height / demoDesktopHeight);
  const crop = spawnSync('sips', [
    '--cropToHeightWidth', String(height - menuBarHeight), String(width),
    '--cropOffset', String(menuBarHeight), String(menuBarHeight), framePath
  ], { stdio: 'ignore' });
  if (crop.status !== 0) throw new Error('macOS 메뉴바를 제외한 데모 캡처에 실패했습니다.');
}

async function ensureDemoFullscreen() {
  if (!DEMO_MODE) return;
  const bounds = spawnSync('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop'], { encoding: 'utf8' });
  const dimensions = (bounds.stdout || '').match(/\d+/g)?.map(Number) || [];
  if (bounds.status !== 0 || dimensions.length < 4) {
    throw new Error('주 화면 크기를 확인하지 못했습니다. macOS 손쉬운 사용 권한을 확인하세요.');
  }
  const width = dimensions[2];
  const desktopHeight = dimensions[3];
  const height = Math.max(1, desktopHeight - 25);
  demoDesktopHeight = desktopHeight;
  const script = [
    'tell application "Visual Studio Code" to activate',
    'tell application "System Events"',
    'delay 1',
    'tell first process whose frontmost is true',
    'set position of window 1 to {0, 25}',
    `set size of window 1 to {${width}, ${height}}`,
    'end tell',
    'end tell'
  ].join('\n');
  const fullscreen = spawnSync('osascript', [
    '-e', script
  ], { stdio: 'ignore' });
  if (fullscreen.status !== 0) {
    throw new Error('VS Code 창을 주 화면 전체로 확장하지 못했습니다. macOS 손쉬운 사용 권한을 확인하세요.');
  }
  await sleep(1500);
}

function finishDemo() {
  if (!DEMO_MODE) return;
  const frames = fs.readdirSync(demoFrameDirectory).filter((file) => file.endsWith('.png')).sort();
  if (!frames.length) throw new Error('GIF로 변환할 데모 캡처가 없습니다.');
  const first = PNG.sync.read(fs.readFileSync(path.join(demoFrameDirectory, frames[0])));
  const encoder = new GIFEncoder(first.width, first.height, 'octree', true, frames.length);
  encoder.setRepeat(0);
  encoder.setDelay(DEMO_DELAY);
  encoder.setQuality(10);
  encoder.start();
  for (const frame of frames) {
    const image = PNG.sync.read(fs.readFileSync(path.join(demoFrameDirectory, frame)));
    encoder.addFrame({ getImageData: () => image });
  }
  encoder.finish();
  fs.mkdirSync(path.resolve(__dirname, '../../docs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../../docs/demo.gif'), encoder.out.getData());
  fs.rmSync(demoFrameDirectory, { recursive: true, force: true });
  console.log('Demo GIF created at docs/demo.gif');
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
