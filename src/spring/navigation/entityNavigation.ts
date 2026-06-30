import * as vscode from 'vscode';
import { EntityMetadata, getEntityIndex } from '../index/entityIndex';

async function findFieldLineInFile(
  entity: EntityMetadata,
  fieldName: string
): Promise<vscode.Position | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(entity.fileUri);
    const content = doc.getText();
    const fieldPattern = new RegExp(
      `(?:private|protected)\\s+[\\w.<>,\\s\\[\\]]+\\s+${fieldName}\\s*(?:=\\s*[^;]+)?\\s*;`
    );
    const match = fieldPattern.exec(content);
    if (!match || match.index === undefined) {
      return undefined;
    }

    const line = content.substring(0, match.index).split('\n').length - 1;
    const lastLine = content.substring(0, match.index).split('\n').pop() ?? '';
    const column = lastLine.length;
    return new vscode.Position(line, column);
  } catch {
    return undefined;
  }
}

export async function findFieldLineInEntity(
  entity: EntityMetadata,
  fieldName: string,
  visited = new Set<string>()
): Promise<vscode.Position | undefined> {
  const key = entity.className.toLowerCase();
  if (visited.has(key)) {
    return undefined;
  }
  visited.add(key);

  const fieldPos = await findFieldLineInFile(entity, fieldName);
  if (fieldPos) {
    return fieldPos;
  }

  const parent = getEntityIndex().getParentEntity(entity);
  if (parent) {
    return findFieldLineInEntity(parent, fieldName, visited);
  }

  return undefined;
}
