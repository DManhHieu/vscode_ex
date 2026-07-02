import * as vscode from 'vscode';
import { getEntityIndex, EntityMetadata } from '../index/entityIndex';
import { isInsideQueryString, parseJpqlAliases } from '../parsing/javaAnnotations';
import {
  findConfigPropertyLocations,
  getConfigurationPropertiesPrefixAtPosition,
  getConfigurationPropertyKeyAtPosition,
  getPropertyPlaceholderAtPosition,
} from '../navigation/configPropertyNavigation';
import { findFieldLineInEntity } from '../navigation/entityNavigation';
import { resolveSpringJavaDefinition } from '../navigation/javaSymbolResolver';

function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][\w]*/);
  return range ? document.getText(range) : undefined;
}

function getPropertyPathAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): { root: string; path: string[] } | undefined {
  const line = document.lineAt(position.line).text;
  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][\w]*/);
  if (!wordRange) {
    return undefined;
  }

  const word = document.getText(wordRange);
  const before = line.substring(0, wordRange.start.character);
  const nestedMatch = before.match(/(\w+(?:\.\w+)*)\.$/);
  if (nestedMatch) {
    const segments = nestedMatch[1].split('.');
    return { root: segments[0], path: [...segments.slice(1), word] };
  }

  const singleMatch = before.match(/(\w+)\.$/);
  if (singleMatch) {
    return { root: singleMatch[1], path: [word] };
  }

  return undefined;
}

async function resolveEntityLocation(entity: EntityMetadata): Promise<vscode.Location> {
  return new vscode.Location(entity.fileUri, new vscode.Position(entity.classStartLine, 0));
}

async function resolveFieldLocation(
  declaring: { entity: EntityMetadata; field: { name: string } }
): Promise<vscode.Location | undefined> {
  const fieldPos = await findFieldLineInEntity(declaring.entity, declaring.field.name);
  if (!fieldPos) {
    return undefined;
  }
  return new vscode.Location(declaring.entity.fileUri, fieldPos);
}

async function resolveFieldFromPath(
  sql: string,
  root: string,
  path: string[]
): Promise<vscode.Location | undefined> {
  const aliases = parseJpqlAliases(sql);
  const entityName = aliases.get(root.toLowerCase());
  if (!entityName || path.length === 0) {
    return undefined;
  }

  const index = getEntityIndex();
  const entity = index.getEntityByName(entityName);
  if (!entity) {
    return undefined;
  }

  const declaring = index.findDeclaringFieldPath(entity, path);
  if (!declaring) {
    return undefined;
  }

  return resolveFieldLocation(declaring);
}

export class SpringDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {
    const content = document.getText();
    const offset = document.offsetAt(position);
    const index = getEntityIndex();

    const placeholderKey = getPropertyPlaceholderAtPosition(document, position);
    if (placeholderKey) {
      const configLocations = await findConfigPropertyLocations(placeholderKey, document.uri);
      if (configLocations.length > 0) {
        return configLocations;
      }
      return undefined;
    }

    const configurationPropertiesPrefix = getConfigurationPropertiesPrefixAtPosition(document, position);
    if (configurationPropertiesPrefix) {
      const configLocations = await findConfigPropertyLocations(configurationPropertiesPrefix, document.uri, true);
      if (configLocations.length > 0) {
        return configLocations;
      }
      return undefined;
    }

    const configurationPropertyKey = getConfigurationPropertyKeyAtPosition(document, position);
    if (configurationPropertyKey) {
      const configLocations = await findConfigPropertyLocations(configurationPropertyKey, document.uri);
      if (configLocations.length > 0) {
        return configLocations;
      }
      return undefined;
    }

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
      const propertyPath = getPropertyPathAtPosition(document, position);

      if (propertyPath && propertyPath.path.length > 0) {
        const fieldLoc = await resolveFieldFromPath(query.sql, propertyPath.root, propertyPath.path);
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
          const aliases = parseJpqlAliases(query.sql);

          const entityFromAlias = aliases.get(word.toLowerCase());
          if (entityFromAlias) {
            const ent = index.getEntityByName(entityFromAlias);
            if (ent) {
              return resolveEntityLocation(ent);
            }
          }

          const entityByName = index.getEntityByName(word);
          if (entityByName) {
            return resolveEntityLocation(entityByName);
          }

          for (const [, entityNameFromAlias] of aliases) {
            const ent = index.getEntityByName(entityNameFromAlias);
            const declaring = ent ? index.findDeclaringField(ent, word) : undefined;
            if (declaring) {
              const fieldLoc = await resolveFieldLocation(declaring);
              if (fieldLoc) {
                return fieldLoc;
              }
            }
          }
        }
      }

      return undefined;
    }

    const entityInFile = index.getAllEntities().find((e) => e.fileUri.toString() === document.uri.toString());
    if (entityInFile) {
      const wordRange = document.getWordRangeAtPosition(position, /\w+/);
      if (wordRange) {
        const word = document.getText(wordRange);
        const declaring = index.findDeclaringField(entityInFile, word);
        if (declaring) {
          const fieldLoc = await resolveFieldLocation(declaring);
          if (fieldLoc) {
            return fieldLoc;
          }
        }
      }
    }

    return resolveSpringJavaDefinition(document, position);
  }
}
