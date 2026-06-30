import * as vscode from 'vscode';
import { getEntityIndex } from '../index/entityIndex';
import { validateMethodAgainstEntity } from '../parsing/springDataParser';

const DIAGNOSTIC_SOURCE = 'excute-sql-spring';
const VALIDATE_DEBOUNCE_MS = 300;

export class RepositoryDiagnosticProvider {
  private collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  private validateAllTimer: ReturnType<typeof setTimeout> | undefined;
  private validateQueue: vscode.TextDocument[] = [];
  private validateScheduled = false;

  dispose(): void {
    if (this.validateAllTimer) {
      clearTimeout(this.validateAllTimer);
      this.validateAllTimer = undefined;
    }
    this.collection.dispose();
  }

  validateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== 'java') {
      this.collection.delete(document.uri);
      return;
    }

    const index = getEntityIndex();
    const repos = index.getRepositoriesInFile(document.uri);
    const diagnostics: vscode.Diagnostic[] = [];

    for (const repo of repos) {
      const entity = index.getEntityByName(repo.entityType);
      if (!entity) {
        continue;
      }

      const fields = index.getEffectiveFields(entity).map((f) => ({ name: f.name, type: f.type }));
      const resolveEntity = (typeName: string) => {
        const related = index.getEntityByName(typeName);
        return related ? index.getEffectiveFields(related).map((f) => ({ name: f.name, type: f.type })) : undefined;
      };

      for (const method of repo.methods) {
        const errors = validateMethodAgainstEntity(method.name, fields, resolveEntity);
        for (const error of errors) {
          const lineText = document.lineAt(method.line).text;
          const methodNameIndex = lineText.indexOf(method.name);
          let startCol = method.column;
          let endCol = startCol + method.name.length;

          if (methodNameIndex >= 0) {
            const segmentIndex = method.name.indexOf(error.segment);
            if (segmentIndex >= 0) {
              startCol = methodNameIndex + segmentIndex;
              endCol = startCol + error.segment.length;
            } else {
              startCol = methodNameIndex;
              endCol = startCol + method.name.length;
            }
          }

          const range = new vscode.Range(method.line, startCol, method.line, endCol);
          const diagnostic = new vscode.Diagnostic(
            range,
            error.message,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.source = DIAGNOSTIC_SOURCE;
          diagnostics.push(diagnostic);
        }
      }
    }

    if (diagnostics.length > 0) {
      this.collection.set(document.uri, diagnostics);
    } else {
      this.collection.delete(document.uri);
    }
  }

  scheduleValidateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== 'java') {
      return;
    }

    if (!this.validateQueue.some((doc) => doc.uri.toString() === document.uri.toString())) {
      this.validateQueue.push(document);
    }
    this.scheduleValidateQueue();
  }

  validateAllOpenDocuments(): void {
    if (this.validateAllTimer) {
      clearTimeout(this.validateAllTimer);
    }

    this.validateAllTimer = setTimeout(() => {
      this.validateAllTimer = undefined;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.languageId === 'java') {
          this.scheduleValidateDocument(editor.document);
        }
      }
    }, VALIDATE_DEBOUNCE_MS);
  }

  private scheduleValidateQueue(): void {
    if (this.validateScheduled) {
      return;
    }

    this.validateScheduled = true;
    setImmediate(() => {
      this.validateScheduled = false;
      const batch = this.validateQueue.splice(0, 3);
      for (const document of batch) {
        this.validateDocument(document);
      }
      if (this.validateQueue.length > 0) {
        this.scheduleValidateQueue();
      }
    });
  }
}
