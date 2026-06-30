import * as vscode from 'vscode';
import { EntityMetadata, getEntityIndex, RepositoryMetadata } from '../index/entityIndex';
import {
  getCamelCaseSegmentAt,
  isInsideQueryString,
  parseImportsFromSource,
} from '../parsing/javaAnnotations';
import { parseSpringDataMethodName } from '../parsing/springDataParser';
import { findFieldLineInEntity } from './entityNavigation';

function decapitalize(s: string): string {
  if (!s) {
    return s;
  }
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w]*/);
  return range ? document.getText(range) : undefined;
}

function entityLocation(entity: EntityMetadata): vscode.Location {
  return new vscode.Location(entity.fileUri, new vscode.Position(entity.classStartLine, 0));
}

function repositoryLocation(repo: RepositoryMetadata): vscode.Location {
  return new vscode.Location(repo.fileUri, new vscode.Position(repo.startLine, 0));
}

function matchesFqnPath(fileUri: vscode.Uri, fqn: string): boolean {
  const normalizedPath = fileUri.fsPath.replace(/\\/g, '/');
  const packagePath = fqn.replace(/\./g, '/');
  return normalizedPath.endsWith(`${packagePath}.java`);
}

function resolveBySimpleName(
  simpleName: string,
  fqn?: string
): vscode.Location | undefined {
  const index = getEntityIndex();

  if (fqn) {
    const entity = index.getEntityByName(simpleName);
    if (entity && matchesFqnPath(entity.fileUri, fqn)) {
      return entityLocation(entity);
    }

    const repo = index.getRepositoryByName(simpleName);
    if (repo && matchesFqnPath(repo.fileUri, fqn)) {
      return repositoryLocation(repo);
    }
  }

  const entity = index.getEntityByName(simpleName);
  if (entity) {
    return entityLocation(entity);
  }

  const repo = index.getRepositoryByName(simpleName);
  if (repo) {
    return repositoryLocation(repo);
  }

  return undefined;
}

async function resolveSpringDataMethodProperty(
  document: vscode.TextDocument,
  position: vscode.Position,
  offset: number
): Promise<vscode.Location | undefined> {
  const repos = getEntityIndex().getRepositoriesInFile(document.uri);
  if (repos.length === 0) {
    return undefined;
  }

  const content = document.getText();
  const segment = getCamelCaseSegmentAt(content, offset);
  if (!segment) {
    return undefined;
  }

  const propName = decapitalize(segment);

  for (const repo of repos) {
    for (const method of repo.methods) {
      if (method.line !== position.line) {
        continue;
      }

      const lineText = document.lineAt(method.line).text;
      const nameIndex = lineText.indexOf(method.name);
      if (nameIndex < 0) {
        continue;
      }

      const nameStart = document.offsetAt(new vscode.Position(method.line, nameIndex));
      const nameEnd = nameStart + method.name.length;
      if (offset < nameStart || offset >= nameEnd) {
        continue;
      }

      const parsed = parseSpringDataMethodName(method.name);
      if (!parsed?.properties.some((property) => property.name === propName)) {
        continue;
      }

      const entity = getEntityIndex().getEntityByName(repo.entityType);
      if (!entity) {
        continue;
      }

      const declaring = getEntityIndex().findDeclaringField(entity, propName);
      if (!declaring) {
        continue;
      }

      const fieldPos = await findFieldLineInEntity(declaring.entity, declaring.field.name);
      if (fieldPos) {
        return new vscode.Location(declaring.entity.fileUri, fieldPos);
      }
    }
  }

  return undefined;
}

function resolveImportReference(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Location | undefined {
  const lineText = document.lineAt(position.line).text;
  const importMatch = lineText.match(/^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/);
  if (!importMatch) {
    return undefined;
  }

  const fqn = importMatch[1];
  const simpleName = fqn.split('.').pop();
  if (!simpleName) {
    return undefined;
  }

  const importIndex = lineText.indexOf(simpleName);
  if (importIndex < 0) {
    return undefined;
  }

  const importEnd = importIndex + simpleName.length;
  if (position.character < importIndex || position.character > importEnd) {
    return undefined;
  }

  return resolveBySimpleName(simpleName, fqn);
}

export async function resolveSpringJavaDefinition(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Location | undefined> {
  const content = document.getText();
  const offset = document.offsetAt(position);

  if (isInsideQueryString(content, offset)) {
    return undefined;
  }

  const methodProp = await resolveSpringDataMethodProperty(document, position, offset);
  if (methodProp) {
    return methodProp;
  }

  const importLoc = resolveImportReference(document, position);
  if (importLoc) {
    return importLoc;
  }

  const word = getWordAtPosition(document, position);
  if (!word) {
    return undefined;
  }

  const imports = parseImportsFromSource(content);
  const importedFqn = imports.get(word);
  if (importedFqn) {
    const importedLoc = resolveBySimpleName(word, importedFqn);
    if (importedLoc) {
      return importedLoc;
    }
  }

  return resolveBySimpleName(word);
}
