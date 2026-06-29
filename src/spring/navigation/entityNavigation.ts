import * as vscode from 'vscode';
import { EntityMetadata } from '../index/entityIndex';

export async function findFieldLineInEntity(
  entity: EntityMetadata,
  fieldName: string
): Promise<vscode.Position | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(entity.fileUri);
    const content = doc.getText();
    const fieldPattern = new RegExp(
      `(?:private|protected)\\s+[\\w.<>,\\s\\[\\]]+\\s+${fieldName}\\s*;`
    );
    const match = fieldPattern.exec(content);
    if (!match || match.index === undefined) {
      return new vscode.Position(entity.classStartLine, 0);
    }

    const line = content.substring(0, match.index).split('\n').length - 1;
    const lastLine = content.substring(0, match.index).split('\n').pop() ?? '';
    const column = lastLine.length;
    return new vscode.Position(line, column);
  } catch {
    return new vscode.Position(entity.classStartLine, 0);
  }
}
