import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { keysMatch, toCanonicalKey } from './relaxedBinding';
import { findPropertyLocationInYaml, PropertyKeyLocation } from './yamlPropertyPaths';

export { findPropertyLocationInYaml };
export type { PropertyKeyLocation };

export interface SpringDatasource {
  url?: string;
  username?: string;
  password?: string;
  driverClassName?: string;
  configFile: string;
}

/** Lightweight YAML flattener for Spring config files (no external dependency). */
export function parseYamlContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of content.split('\n')) {
    const withoutComment = rawLine.split('#')[0];
    if (!withoutComment.trim()) {
      continue;
    }

    const indent = withoutComment.search(/\S/);
    if (indent < 0) {
      continue;
    }

    const trimmed = withoutComment.trim();
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex < 0) {
      continue;
    }

    const key = trimmed.substring(0, colonIndex).trim();
    let value = trimmed.substring(colonIndex + 1).trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const fullKey = [...stack.map((entry) => entry.key), key].join('.');

    if (value) {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[fullKey] = value;
    } else {
      stack.push({ indent, key });
    }
  }

  return result;
}

export function parsePropertiesContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) {
      continue;
    }
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const DEFAULT_SPRING_CONFIG_GLOBS = [
  "**/src/main/resources/application*.properties",
  "**/src/main/resources/application*.yml",
  "**/src/main/resources/application*.yaml",
  "**/src/main/resources/config/application*.yml",
  "**/src/main/resources/config/application*.yaml",
  "**/src/main/resources/config/application*.properties"
];
const SPRING_CONFIG_EXCLUDE = '{**/node_modules/**,**/target/**,**/build/**,**/.git/**}';

export function getSpringConfigGlobs(): string[] {
  const value = vscode.workspace.getConfiguration('excuteSql.spring').get<string | string[]>('configGlob');
  if (Array.isArray(value) && value.length > 0) {
    return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return DEFAULT_SPRING_CONFIG_GLOBS;
}

export { DEFAULT_SPRING_CONFIG_GLOBS };

export function resolveModuleRootFromJavaFile(javaFilePath: string): string | undefined {
  const normalized = javaFilePath.replace(/\\/g, '/');
  const marker = '/src/main/java/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) {
    return undefined;
  }
  return normalized.substring(0, index);
}

export async function findSpringConfigFileUris(): Promise<vscode.Uri[]> {
  const seen = new Set<string>();
  const uris: vscode.Uri[] = [];

  for (const pattern of getSpringConfigGlobs()) {
    const found = await vscode.workspace.findFiles(pattern, SPRING_CONFIG_EXCLUDE);
    for (const uri of found) {
      const key = uri.toString();
      if (!seen.has(key)) {
        seen.add(key);
        uris.push(uri);
      }
    }
  }

  return uris;
}

function globPatternRelativeToModuleRoot(glob: string): string {
  return glob.replace(/^\*\*\//, '');
}

/** Find config files under a Java module root using the configured globs. */
export async function findModuleConfigFileUris(moduleRoot: string): Promise<vscode.Uri[]> {
  const seen = new Set<string>();
  const uris: vscode.Uri[] = [];
  const baseUri = vscode.Uri.file(moduleRoot);

  for (const glob of getSpringConfigGlobs()) {
    const relativePattern = globPatternRelativeToModuleRoot(glob);
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(baseUri, relativePattern),
      SPRING_CONFIG_EXCLUDE
    );
    for (const uri of found) {
      const key = uri.toString();
      if (!seen.has(key)) {
        seen.add(key);
        uris.push(uri);
      }
    }
  }

  return uris;
}

/**
 * Find the line/column of a property key in .properties content using relaxed binding.
 * When allowPrefix is true, also matches the first key that starts with propertyKey
 */
export function findPropertyLocationInProperties(
  content: string,
  propertyKey: string,
  allowPrefix = false
): PropertyKeyLocation | undefined {
  const lines = content.split('\n');
  const canonicalTarget = toCanonicalKey(propertyKey);
  let prefixFallback: PropertyKeyLocation | undefined;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) {
      continue;
    }

    const key = trimmed.substring(0, eqIndex).trim();
    const lineStart = rawLine.indexOf(trimmed);
    const keyStart = lineStart >= 0 ? lineStart : rawLine.search(/\S/);

    if (keysMatch(key, propertyKey)) {
      return { line: lineNum, column: keyStart };
    }

    if (allowPrefix && !prefixFallback && toCanonicalKey(key).startsWith(`${canonicalTarget}.`)) {
      prefixFallback = { line: lineNum, column: keyStart };
    }
  }

  return prefixFallback;
}

function extractDatasource(props: Record<string, string>): SpringDatasource | undefined {
  const url = props['spring.datasource.url'] ?? props['spring.datasource.jdbc-url'];
  const username = props['spring.datasource.username'];
  const password = props['spring.datasource.password'];
  const driverClassName = props['spring.datasource.driver-class-name'];

  if (!url && !username) {
    return undefined;
  }

  return { url, username, password, driverClassName, configFile: '' };
}

async function readConfigPropertiesFromUri(uri: vscode.Uri): Promise<Record<string, string> | undefined> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(data).toString('utf8');
    const ext = path.extname(uri.fsPath).toLowerCase();
    return ext === '.properties' ? parsePropertiesContent(content) : parseYamlContent(content);
  } catch {
    return undefined;
  }
}

export async function readSpringDatasource(workspaceFolder?: vscode.WorkspaceFolder): Promise<SpringDatasource | undefined> {
  const folder = workspaceFolder ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  const uris = await findSpringConfigFileUris();
  for (const uri of uris) {
    const props = await readConfigPropertiesFromUri(uri);
    if (!props) {
      continue;
    }
    const ds = extractDatasource(props);
    if (ds) {
      ds.configFile = uri.fsPath;
      return ds;
    }
  }

  return undefined;
}

export function normalizeJdbcUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  if (normalized.startsWith('jdbc:')) {
    normalized = normalized.substring(5);
  }
  normalized = normalized.replace(/\?.*$/, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

export function readSpringDatasourceSync(filePath: string): SpringDatasource | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  const props = ext === '.properties' ? parsePropertiesContent(content) : parseYamlContent(content);
  const ds = extractDatasource(props);
  if (ds) {
    ds.configFile = filePath;
  }
  return ds;
}
