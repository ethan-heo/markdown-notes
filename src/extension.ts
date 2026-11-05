import * as vscode from 'vscode';

type Note = {
  id: string;
  text: string;
  comment: string;
  startLine: number;
  endLine: number;
  createdAt: string;
};

const PANEL_TYPE = 'markdownSelectionNotes.preview';

export function activate(context: vscode.ExtensionContext) {
  const provider = new PreviewProvider(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownSelectionNotes.openPreview', () => {
      const previewColumn = vscode.workspace.getConfiguration('markdownSelectionNotes').get<'beside' | 'active'>('previewColumn', 'beside');
      return vscode.commands.executeCommand(previewColumn === 'beside' ? 'markdown.showPreviewToSide' : 'markdown.showPreview');
    }),
    vscode.commands.registerCommand('markdownSelectionNotes.addNote', () => provider.addNoteFromEditor()),
    vscode.workspace.onDidChangeTextDocument((event) => provider.refreshFor(event.document.uri))
  );

  return {
    extendMarkdownIt(md: any) {
      md.core.ruler.push('markdown-selection-notes-config', (state: any) => {
        const color = vscode.workspace.getConfiguration('markdownSelectionNotes').get<string>('highlightColor', '#ffd33d');
        const safeColor = color.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
        const token = new state.Token('html_block', '', 0);
        token.content = `<div id="markdown-selection-notes-config" data-highlight-color="${safeColor}"></div>`;
        state.tokens.push(token);
      });
      return md;
    }
  };
}

class PreviewProvider {
  private panel?: vscode.WebviewPanel;
  private document?: vscode.TextDocument;
  private readonly notes = new Map<string, Note[]>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async open() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      vscode.window.showInformationMessage('Markdown 파일을 연 뒤 Preview를 열어 주세요.');
      return;
    }

    this.document = editor.document;
    const column = vscode.workspace.getConfiguration('markdownSelectionNotes').get<'beside' | 'active'>('previewColumn', 'beside');
    this.panel = vscode.window.createWebviewPanel(PANEL_TYPE, `Notes: ${editor.document.fileName.split('/').pop()}`, column === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    this.panel.onDidDispose(() => { this.panel = undefined; }, null, this.context.subscriptions);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.context.subscriptions);
    this.render();
  }

  async addNoteFromEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown' || editor.selection.isEmpty) {
      vscode.window.showInformationMessage('Markdown 편집기에서 먼저 메모를 남길 영역을 선택해 주세요.');
      return;
    }
    this.document = editor.document;
    await this.saveNote(editor.document, editor.document.getText(editor.selection), editor.selection.start.line, editor.selection.end.line);
  }

  refreshFor(uri: vscode.Uri) {
    if (this.document?.uri.toString() === uri.toString()) this.render();
  }

  private async handleMessage(message: { type: string; text?: string; startLine?: number; endLine?: number }) {
    if (message.type === 'addNote' && this.document && message.text && message.startLine !== undefined && message.endLine !== undefined) {
      await this.saveNote(this.document, message.text, message.startLine, message.endLine);
    }
    if (message.type === 'openSource' && this.document && message.startLine !== undefined) {
      const editor = await vscode.window.showTextDocument(this.document, vscode.ViewColumn.One);
      const position = new vscode.Position(message.startLine, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  private async saveNote(document: vscode.TextDocument, text: string, startLine: number, endLine: number) {
    const comment = await vscode.window.showInputBox({ prompt: '선택한 Markdown 영역에 남길 메모', placeHolder: '예: 이 부분은 예시를 하나 더 추가하기' });
    if (!comment?.trim()) return;
    const key = document.uri.toString();
    const current = this.notes.get(key) ?? this.context.workspaceState.get<Note[]>(`notes:${key}`) ?? [];
    const note: Note = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text: text.trim(), comment: comment.trim(), startLine, endLine, createdAt: new Date().toISOString() };
    const next = [...current, note];
    this.notes.set(key, next);
    await this.context.workspaceState.update(`notes:${key}`, next);
    this.render();
  }

  private render() {
    if (!this.panel || !this.document) return;
    this.panel.title = `Notes: ${this.document.fileName.split('/').pop()}`;
    const key = this.document.uri.toString();
    const notes = this.notes.get(key) ?? this.context.workspaceState.get<Note[]>(`notes:${key}`) ?? [];
    this.notes.set(key, notes);
    this.panel.webview.html = getHtml(this.panel.webview, this.document.getText(), notes);
  }
}

function getHtml(webview: vscode.Webview, markdown: string, notes: Note[]) {
  const nonce = getNonce();
  const payload = JSON.stringify({ markdown, notes }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><style>${styles}</style></head><body><header><div><strong>Markdown Notes</strong><span id="status"></span></div><button id="add" disabled>선택 영역에 메모 남기기</button></header><main><article id="content"></article><aside><h2>메모 <span id="count">0</span></h2><div id="notes"></div></aside></main><script nonce="${nonce}">const vscode = acquireVsCodeApi(); const initial = ${payload}; ${script}</script></body></html>`;
}

function getNonce() { return Math.random().toString(36).slice(2); }

const styles = `:root{color-scheme:light dark}body{font:14px system-ui,sans-serif;color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0}header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:12px 22px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}header strong{font-size:15px}header span{margin-left:10px;color:var(--vscode-descriptionForeground);font-size:12px}button{border:1px solid var(--vscode-button-border,var(--vscode-button-background));background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:6px 10px;border-radius:3px;cursor:pointer}button:disabled{opacity:.5;cursor:default}main{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:28px;max-width:1180px;margin:0 auto;padding:28px}article{min-width:0;line-height:1.7}h1,h2,h3{line-height:1.3}pre{padding:12px;overflow:auto;background:var(--vscode-textCodeBlock-background)}code{font-family:var(--vscode-editor-font-family)}blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);padding-left:14px;color:var(--vscode-descriptionForeground)}a{color:var(--vscode-textLink-foreground)}.source-block{scroll-margin-top:70px}.source-block.has-note{background:color-mix(in srgb,var(--vscode-editor-findMatchHighlightBackground) 35%,transparent);border-radius:3px}.note-card{padding:11px;margin:0 0 10px;border:1px solid var(--vscode-panel-border);border-left:3px solid var(--vscode-textLink-foreground);border-radius:4px}.note-card p{margin:7px 0}.quote{color:var(--vscode-descriptionForeground);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.note-card button{font-size:12px;padding:3px 7px;background:transparent;color:var(--vscode-textLink-foreground)}aside{border-left:1px solid var(--vscode-panel-border);padding-left:20px}aside h2{font-size:15px;margin-top:0}#notes:empty:after{content:'드래그로 영역을 선택해 보세요.';color:var(--vscode-descriptionForeground);font-size:12px}`;

const script = String.raw`
const content = document.getElementById('content');
const notesEl = document.getElementById('notes');
const add = document.getElementById('add');
const status = document.getElementById('status');
const notes = initial.notes || [];
function esc(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function inline(s){return esc(s).replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>');}
function render(md){const lines=md.replace(/\r/g,'').split('\n');let html='',i=0;while(i<lines.length){const line=lines[i], start=i;if(!line.trim()){i++;continue}if(/^\x60\x60\x60/.test(line)){const lang=line.slice(3).trim(), code=[];i++;while(i<lines.length&&!/^\x60\x60\x60/.test(lines[i]))code.push(lines[i++]);i++;html+=block(start,i-1,'<pre><code class="language-'+esc(lang)+'">'+esc(code.join('\n'))+'</code></pre>');continue}if(/^#{1,6} /.test(line)){const m=line.match(/^(#+) (.*)$/);i++;html+=block(start,start,'<h'+m[1].length+'>'+inline(m[2])+'</h'+m[1].length+'>');continue}if(/^> ?/.test(line)){i++;html+=block(start,start,'<blockquote>'+inline(line.replace(/^> ?/,''))+'</blockquote>');continue}if(/^[-*] /.test(line)){const list=[];while(i<lines.length&&/^[-*] /.test(lines[i]))list.push('<li>'+inline(lines[i++].replace(/^[-*] /,''))+'</li>');html+=block(start,i-1,'<ul>'+list.join('')+'</ul>');continue}if(/^\d+\. /.test(line)){const list=[];while(i<lines.length&&/^\d+\. /.test(lines[i]))list.push('<li>'+inline(lines[i++].replace(/^\d+\. /,''))+'</li>');html+=block(start,i-1,'<ol>'+list.join('')+'</ol>');continue}const para=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(#{1,6} |\x60\x60\x60|> |[-*] |\d+\. )/.test(lines[i]))para.push(lines[i++]);html+=block(start,i-1,'<p>'+inline(para.join('\n')).replace(/\n/g,'<br>')+'</p>')}return html}
function block(start,end,html){const hit=notes.some(n=>n.startLine<=end&&n.endLine>=start);return '<section class="source-block '+(hit?'has-note':'')+'" data-start="'+start+'" data-end="'+end+'">'+html+'</section>'}
function renderNotes(){notesEl.innerHTML=notes.map(n=>'<div class="note-card"><div class="quote">'+esc(n.text)+'</div><p>'+esc(n.comment)+'</p><button data-line="'+n.startLine+'">원문으로 이동</button></div>').join('');document.getElementById('count').textContent=notes.length;notesEl.querySelectorAll('button').forEach(b=>b.onclick=()=>vscode.postMessage({type:'openSource',startLine:Number(b.dataset.line)}));}
content.innerHTML=render(initial.markdown);renderNotes();
document.addEventListener('selectionchange',()=>{const s=window.getSelection();const text=s?.toString().trim();const node=s?.anchorNode?.parentElement?.closest?.('.source-block');if(text&&node){add.disabled=false;add.dataset.text=text;add.dataset.start=node.dataset.start;add.dataset.end=node.dataset.end;status.textContent='선택됨';}else{add.disabled=true;status.textContent='';}});
add.onclick=()=>{vscode.postMessage({type:'addNote',text:add.dataset.text,startLine:Number(add.dataset.start),endLine:Number(add.dataset.end)});add.disabled=true;};
`;

export function deactivate() {}
