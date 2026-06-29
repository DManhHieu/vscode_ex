import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'yaml';

export interface SpringDatasource {
  url?: string;
  username?: string;
  password?: string;
  driverClassName?: string;
  configFile: string;
}

function flattenYaml(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenYaml(value as Record<string, unknown>, fullKey));
    } else if (value !== undefined && value !== null) {
      result[fullKey] = String(value);
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

export function parseYamlContent(content: string): Record<string, string> {
  try {
    const parsed = yaml.parse(content);
    if (parsed && typeof parsed === 'object') {
      return flattenYaml(parsed as Record<string, unknown>);
    }
  } catch {
    // ignore parse errors
  }
  return {};
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

function getConfigSearchPaths(workspaceRoot: string): string[] {
  const resourcesDir = path.join(workspaceRoot, 'src', 'main', 'resources');
  const paths: string[] = [];

  const candidates = [
    'application.properties',
    'application.yml',
    'application.yaml',
    'application-dev.properties',
    'application-dev.yml',
    'application-local.properties',
    'application-local.yml',
  ];

  for (const name of candidates) {
    paths.push(path.join(resourcesDir, name));
  }

  return paths;
}

export async function readSpringDatasource(workspaceFolder?: vscode.WorkspaceFolder): Promise<SpringDatasource | undefined> {
  const folder = workspaceFolder ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  for (const configPath of getConfigSearchPaths(folder.uri.fsPath)) {
    try {
      const uri = vscode.Uri.file(configPath);
      const data = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(data).toString('utf8');
      const ext = path.extname(configPath).toLowerCase();
      const props = ext === '.properties' ? parsePropertiesContent(content) : parseYamlContent(content);
      const ds = extractDatasource(props);
      if (ds) {
        ds.configFile = configPath;
        return ds;
      }
    } catch {
      // file not found or unreadable
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
