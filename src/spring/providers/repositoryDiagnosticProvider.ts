import * as vscode from 'vscode';
import { getEntityIndex } from '../index/entityIndex';
import { validateMethodAgainstEntity } from '../parsing/springDataParser';

const DIAGNOSTIC_SOURCE = 'excute-sql-spring';

export class RepositoryDiagnosticProvider {
  private collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);

  dispose(): void {
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

      const fieldNames = entity.fields.map((f) => f.name);

      for (const method of repo.methods) {
        const errors = validateMethodAgainstEntity(method.name, fieldNames);
        for (const error of errors) {
          const propMatch = error.match(/Unknown property '(\w+)'/);
          const propName = propMatch?.[1];
          const lineText = document.lineAt(method.line).text;
          const nameIndex = propName ? lineText.indexOf(propName) : lineText.indexOf(method.name);
          const startCol = nameIndex >= 0 ? nameIndex : method.column;
          const endCol = startCol + (propName?.length ?? method.name.length);

          const range = new vscode.Range(method.line, startCol, method.line, endCol);
          const diagnostic = new vscode.Diagnostic(
            range,
            error,
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

  validateAllOpenDocuments(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === 'java') {
        this.validateDocument(editor.document);
      }
    }
  }
}
