import * as vscode from 'vscode';
import { getEntityIndex } from './entityIndex';
import {
  clearCacheFile,
  getFileStat,
  hydrateIndexFromCache,
  initIndexCache,
  isFileUnchanged,
  loadCache,
  scheduleSaveCache,
  saveCacheNow,
  updateFileFingerprint,
  disposeIndexCache,
} from './indexCache';

let onIndexUpdated: (() => void) | undefined;

export function setOnIndexUpdated(callback: () => void): void {
  onIndexUpdated = callback;
}

function notifyIndexUpdated(): void {
  onIndexUpdated?.();
}

const DEFAULT_JAVA_GLOB = '**/src/main/java/**/*.java';
const DEBOUNCE_MS = 500;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let watcher: vscode.FileSystemWatcher | undefined;
let javaGlob = DEFAULT_JAVA_GLOB;

function getJavaGlob(): string {
  return vscode.workspace.getConfiguration('excuteSql.spring').get<string>('javaGlob') ?? DEFAULT_JAVA_GLOB;
}

async function readFileContent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  } catch {
    return undefined;
  }
}

export async function indexJavaFile(uri: vscode.Uri, saveToCache = true): Promise<void> {
  const stat = await getFileStat(uri);
  const content = await readFileContent(uri);

  if (content === undefined) {
    getEntityIndex().removeFile(uri);
    if (saveToCache) {
      scheduleSaveCache(javaGlob);
    }
    return;
  }

  getEntityIndex().indexFile(uri, content);

  if (stat) {
    updateFileFingerprint(uri, stat.mtimeMs, stat.size);
  }

  if (saveToCache) {
    scheduleSaveCache(javaGlob);
  }
}

async function findJavaFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(javaGlob, '**/node_modules/**');
}

export async function rebuildIndex(clearCache = false): Promise<void> {
  if (clearCache) {
    await clearCacheFile();
  }

  const index = getEntityIndex();
  index.clear();

  const files = await findJavaFiles();

  await Promise.all(
    files.map(async (uri) => {
      const stat = await getFileStat(uri);
      const content = await readFileContent(uri);
      if (content) {
        index.indexFile(uri, content);
        if (stat) {
          updateFileFingerprint(uri, stat.mtimeMs, stat.size);
        }
      }
    })
  );

  await saveCacheNow(javaGlob);
  notifyIndexUpdated();
}

async function deltaScan(): Promise<void> {
  const index = getEntityIndex();
  const files = await findJavaFiles();
  const currentPaths = new Set(files.map((f) => f.toString()));
  let changed = false;

  for (const indexedUri of index.getIndexedFileUris()) {
    if (!currentPaths.has(indexedUri)) {
      index.removeFile(vscode.Uri.parse(indexedUri));
      changed = true;
    }
  }

  for (const uri of files) {
    const stat = await getFileStat(uri);
    if (!stat) {
      continue;
    }

    if (!isFileUnchanged(uri, stat.mtimeMs, stat.size)) {
      await indexJavaFile(uri, false);
      changed = true;
    }
  }

  if (changed) {
    await saveCacheNow(javaGlob);
    notifyIndexUpdated();
  }
}

async function initializeIndex(): Promise<void> {
  javaGlob = getJavaGlob();
  const cache = await loadCache(javaGlob);

  if (cache) {
    hydrateIndexFromCache(cache);
    notifyIndexUpdated();
    await deltaScan();
    return;
  }

  await rebuildIndex(false);
}

function scheduleIncrementalUpdate(uri: vscode.Uri): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    void indexJavaFile(uri).then(() => notifyIndexUpdated());
  }, DEBOUNCE_MS);
}

function handleFileDelete(uri: vscode.Uri): void {
  getEntityIndex().removeFile(uri);
  scheduleSaveCache(javaGlob);
  notifyIndexUpdated();
}

export function startWorkspaceScanner(context: vscode.ExtensionContext): void {
  initIndexCache(context);
  void initializeIndex();

  watcher = vscode.workspace.createFileSystemWatcher('**/*.java');
  watcher.onDidCreate((uri) => scheduleIncrementalUpdate(uri), null, context.subscriptions);
  watcher.onDidChange((uri) => scheduleIncrementalUpdate(uri), null, context.subscriptions);
  watcher.onDidDelete((uri) => handleFileDelete(uri), null, context.subscriptions);
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'java') {
        scheduleIncrementalUpdate(doc.uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'java') {
        scheduleIncrementalUpdate(event.document.uri);
      }
    })
  );
}

export function disposeWorkspaceScanner(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  watcher?.dispose();
  watcher = undefined;
  disposeIndexCache();
}
