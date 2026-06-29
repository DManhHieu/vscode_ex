import * as vscode from 'vscode';
import { CachedFileEntry, getEntityIndex } from './entityIndex';

function hashWorkspaceRoot(root: string): string {
  let hash = 0;
  for (let i = 0; i < root.length; i++) {
    hash = (hash * 31 + root.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export const CACHE_VERSION = 1;
const CACHE_FILENAME = 'spring-jpa-index.json';
const SAVE_DEBOUNCE_MS = 2000;

export interface IndexCacheData {
  version: number;
  javaGlob: string;
  workspaceRoot: string;
  files: Record<string, CachedFileEntry>;
}

let extensionContext: vscode.ExtensionContext | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let fileFingerprints = new Map<string, { mtimeMs: number; size: number }>();

export function initIndexCache(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

function isCacheEnabled(): boolean {
  return vscode.workspace.getConfiguration('excuteSql.spring').get<boolean>('cacheIndex') ?? true;
}

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? '';
}

async function getCacheUri(): Promise<vscode.Uri | undefined> {
  if (!extensionContext) {
    return undefined;
  }

  if (extensionContext.storageUri) {
    await vscode.workspace.fs.createDirectory(extensionContext.storageUri);
    return vscode.Uri.joinPath(extensionContext.storageUri, CACHE_FILENAME);
  }

  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }

  const hash = hashWorkspaceRoot(root);
  const dir = vscode.Uri.joinPath(extensionContext.globalStorageUri, 'workspace-cache', hash);
  await vscode.workspace.fs.createDirectory(dir);
  return vscode.Uri.joinPath(dir, CACHE_FILENAME);
}

export async function loadCache(javaGlob: string): Promise<IndexCacheData | undefined> {
  if (!isCacheEnabled()) {
    return undefined;
  }

  try {
    const cacheUri = await getCacheUri();
    if (!cacheUri) {
      return undefined;
    }

    const data = await vscode.workspace.fs.readFile(cacheUri);
    const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as IndexCacheData;

    if (parsed.version !== CACHE_VERSION || parsed.javaGlob !== javaGlob) {
      return undefined;
    }

    const root = getWorkspaceRoot();
    if (root && parsed.workspaceRoot && parsed.workspaceRoot !== root) {
      return undefined;
    }

    fileFingerprints.clear();
    for (const [uri, entry] of Object.entries(parsed.files)) {
      fileFingerprints.set(uri, { mtimeMs: entry.mtimeMs, size: entry.size });
    }

    return parsed;
  } catch {
    return undefined;
  }
}

export function hydrateIndexFromCache(cache: IndexCacheData): void {
  const index = getEntityIndex();
  index.clear();
  index.hydrateFromCache(cache.files);
}

export async function saveCacheNow(javaGlob: string): Promise<void> {
  if (!isCacheEnabled()) {
    return;
  }

  const cacheUri = await getCacheUri();
  if (!cacheUri) {
    return;
  }

  const index = getEntityIndex();
  const data: IndexCacheData = {
    version: CACHE_VERSION,
    javaGlob,
    workspaceRoot: getWorkspaceRoot(),
    files: index.serializeToCache(fileFingerprints),
  };

  await vscode.workspace.fs.writeFile(cacheUri, Buffer.from(JSON.stringify(data), 'utf8'));
}

export function scheduleSaveCache(javaGlob: string): void {
  if (!isCacheEnabled()) {
    return;
  }

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    void saveCacheNow(javaGlob);
  }, SAVE_DEBOUNCE_MS);
}

export async function clearCacheFile(): Promise<void> {
  fileFingerprints.clear();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  try {
    const cacheUri = await getCacheUri();
    if (cacheUri) {
      await vscode.workspace.fs.delete(cacheUri, { useTrash: false });
    }
  } catch {
    // cache file may not exist
  }
}

export function updateFileFingerprint(uri: vscode.Uri, mtimeMs: number, size: number): void {
  fileFingerprints.set(uri.toString(), { mtimeMs, size });
}

export async function getFileStat(uri: vscode.Uri): Promise<{ mtimeMs: number; size: number } | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return { mtimeMs: stat.mtime, size: stat.size };
  } catch {
    return undefined;
  }
}

export function isFileUnchanged(uri: vscode.Uri, mtimeMs: number, size: number): boolean {
  const cached = fileFingerprints.get(uri.toString());
  return cached !== undefined && cached.mtimeMs === mtimeMs && cached.size === size;
}

export function disposeIndexCache(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  extensionContext = undefined;
  fileFingerprints.clear();
}
