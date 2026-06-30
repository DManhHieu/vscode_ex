import * as vscode from 'vscode';
import { collectQueryKeywordRanges } from './queryKeywordRanges';

const JAVA_SELECTOR = 'java';
const REFRESH_DEBOUNCE_MS = 100;

export class QueryHighlightDecorationProvider {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      color: new vscode.ThemeColor('excuteSql.sqlKeyword'),
    });
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.decorationType.dispose();
  }

  refresh(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== JAVA_SELECTOR) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const ranges = collectQueryKeywordRanges(editor.document);
    editor.setDecorations(this.decorationType, ranges);
  }

  refreshAllVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.refresh(editor);
    }
  }

  scheduleRefresh(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document.uri.toString() === key) {
            this.refresh(editor);
          }
        }
      }, REFRESH_DEBOUNCE_MS)
    );
  }
}

export function registerQueryHighlighting(context: vscode.ExtensionContext): void {
  const provider = new QueryHighlightDecorationProvider();
  context.subscriptions.push(provider);

  const refreshIfJava = (doc: vscode.TextDocument): void => {
    if (doc.languageId === JAVA_SELECTOR) {
      provider.scheduleRefresh(doc);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        provider.refresh(editor);
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => provider.refreshAllVisible()),
    vscode.workspace.onDidChangeTextDocument((event) => refreshIfJava(event.document)),
    vscode.workspace.onDidOpenTextDocument(refreshIfJava)
  );

  if (vscode.window.activeTextEditor) {
    provider.refresh(vscode.window.activeTextEditor);
  }
  provider.refreshAllVisible();
}
