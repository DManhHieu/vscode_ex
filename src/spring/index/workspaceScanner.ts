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
const DEBOUNCE_MS = 1000;
const INDEX_BATCH_SIZE = 20;
const STARTUP_DELAY_MS = 5000;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let watcher: vscode.FileSystemWatcher | undefined;
let javaGlob = DEFAULT_JAVA_GLOB;
let indexInitialized = false;
let indexInitializing = false;

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

async function indexFilesInBatches(files: vscode.Uri[]): Promise<void> {
  const index = getEntityIndex();

  for (let i = 0; i < files.length; i += INDEX_BATCH_SIZE) {
    const batch = files.slice(i, i + INDEX_BATCH_SIZE);
    await Promise.all(
      batch.map(async (uri) => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function rebuildIndex(clearCache = false): Promise<void> {
  if (clearCache) {
    await clearCacheFile();
  }

  const index = getEntityIndex();
  index.clear();

  const files = await findJavaFiles();
  await indexFilesInBatches(files);

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
  if (indexInitialized || indexInitializing) {
    return;
  }

  indexInitializing = true;
  javaGlob = getJavaGlob();

  try {
    const cache = await loadCache(javaGlob);

    if (cache) {
      hydrateIndexFromCache(cache);
      notifyIndexUpdated();
      await deltaScan();
    } else {
      await rebuildIndex(false);
    }

    indexInitialized = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Execute SQL: index initialization failed: ${message}`);
  } finally {
    indexInitializing = false;
  }
}

function scheduleIncrementalUpdate(uri: vscode.Uri): void {
  if (!indexInitialized) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    void indexJavaFile(uri).then(() => notifyIndexUpdated());
  }, DEBOUNCE_MS);
}

function handleFileDelete(uri: vscode.Uri): void {
  if (!indexInitialized) {
    return;
  }

  getEntityIndex().removeFile(uri);
  scheduleSaveCache(javaGlob);
  notifyIndexUpdated();
}

export function scheduleIndexInitialization(): void {
  setTimeout(() => {
    void initializeIndex();
  }, STARTUP_DELAY_MS);
}

export function startWorkspaceScanner(context: vscode.ExtensionContext): void {
  initIndexCache(context);
  scheduleIndexInitialization();

  const watchGlob = getJavaGlob();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, watchGlob)
  );
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
}

export function disposeWorkspaceScanner(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  watcher?.dispose();
  watcher = undefined;
  disposeIndexCache();
  indexInitialized = false;
  indexInitializing = false;
}
