import * as vscode from 'vscode';
import { getEntityIndex, EntityMetadata } from '../index/entityIndex';
import { isInsideQueryString, parseJpqlAliases } from '../parsing/javaAnnotations';
import { findFieldLineInEntity } from '../navigation/entityNavigation';
import { resolveSpringJavaDefinition } from '../navigation/javaSymbolResolver';

function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w]*/);
  return range ? document.getText(range) : undefined;
}

function getAliasFieldAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): { alias: string; field: string } | undefined {
  const line = document.lineAt(position.line).text;
  const before = line.substring(0, position.character);
  const match = before.match(/(\w+)\.(\w*)$/);
  if (!match) {
    return undefined;
  }
  return { alias: match[1], field: match[2] || getWordAtPosition(document, position) || '' };
}

async function resolveEntityLocation(entity: EntityMetadata): Promise<vscode.Location> {
  return new vscode.Location(entity.fileUri, new vscode.Position(entity.classStartLine, 0));
}

async function resolveFieldFromAlias(
  sql: string,
  alias: string,
  fieldName: string
): Promise<vscode.Location | undefined> {
  const aliases = parseJpqlAliases(sql);
  const entityName = aliases.get(alias.toLowerCase());
  if (!entityName || !fieldName) {
    return undefined;
  }

  const entity = getEntityIndex().getEntityByName(entityName);
  if (!entity) {
    return undefined;
  }

  const fieldPos = await findFieldLineInEntity(entity, fieldName);
  if (!fieldPos) {
    return undefined;
  }

  return new vscode.Location(entity.fileUri, fieldPos);
}

export class SpringDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {
    const content = document.getText();
    const offset = document.offsetAt(position);
    const index = getEntityIndex();

    const lineText = document.lineAt(position.line).text;

    const tableMatch = lineText.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/);
    if (tableMatch) {
      const entity = index.getEntityByTable(tableMatch[1]);
      if (entity) {
        return resolveEntityLocation(entity);
      }
    }

    const repoMatch = content.match(
      /interface\s+\w+\s+extends\s+[\w.]*(?:Jpa|Crud|PagingAndSorting)Repository\s*<\s*(\w+)\s*,/
    );
    if (repoMatch) {
      const genericPos = content.indexOf(`<${repoMatch[1]}`);
      if (genericPos >= 0) {
        const genericEnd = genericPos + repoMatch[1].length + 1;
        if (offset >= genericPos && offset <= genericEnd) {
          const entity = index.getEntityByName(repoMatch[1]);
          if (entity) {
            return resolveEntityLocation(entity);
          }
        }
      }
    }

    const query = isInsideQueryString(content, offset);
    if (query) {
      const word = getWordAtPosition(document, position);
      const aliasField = getAliasFieldAtPosition(document, position);

      if (aliasField && aliasField.field) {
        const fieldLoc = await resolveFieldFromAlias(query.sql, aliasField.alias, aliasField.field);
        if (fieldLoc) {
          return fieldLoc;
        }
      }

      if (word) {
        if (query.nativeQuery) {
          const entity = index.getEntityByTable(word);
          if (entity) {
            return resolveEntityLocation(entity);
          }
        } else {
          const entity = index.getEntityByName(word);
          if (entity) {
            return resolveEntityLocation(entity);
          }

          const aliases = parseJpqlAliases(query.sql);
          const entityName = aliases.get(word.toLowerCase());
          if (entityName) {
            const byAlias = index.getEntityByName(entityName);
            if (byAlias) {
              return resolveEntityLocation(byAlias);
            }
          }

          for (const [, entityNameFromAlias] of aliases) {
            const ent = index.getEntityByName(entityNameFromAlias);
            const field = ent?.fields.find(
              (f) => f.name === word || f.columnName === word
            );
            if (ent && field) {
              const fieldPos = await findFieldLineInEntity(ent, field.name);
              if (fieldPos) {
                return new vscode.Location(ent.fileUri, fieldPos);
              }
            }
          }
        }
      }
    }

    const entityInFile = index.getAllEntities().find((e) => e.fileUri.toString() === document.uri.toString());
    if (entityInFile) {
      const wordRange = document.getWordRangeAtPosition(position, /\w+/);
      if (wordRange) {
        const word = document.getText(wordRange);
        const field = entityInFile.fields.find((f) => f.name === word || f.columnName === word);
        if (field) {
          const fieldPos = await findFieldLineInEntity(entityInFile, field.name);
          if (fieldPos) {
            return new vscode.Location(document.uri, fieldPos);
          }
        }
      }
    }

    return resolveSpringJavaDefinition(document, position);
  }
}
