import * as vscode from 'vscode';
import * as path from 'path';
import { getConfigBindingIndex } from './configBindingIndex';
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

type ProgressReporter = (message: string, increment?: number) => void;

export interface IndexOperationOptions {
  showProgress?: boolean;
  showCompletion?: boolean;
}

const DEFAULT_JAVA_GLOB = '**/src/main/java/**/*.java';
const FIND_FILES_EXCLUDE = '{**/node_modules/**,**/target/**,**/build/**,**/.git/**}';
const DEBOUNCE_MS = 1000;
const INDEX_BATCH_SIZE = 10;
const STAT_BATCH_SIZE = 25;

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
    getConfigBindingIndex().removeFile(uri);
    if (saveToCache) {
      scheduleSaveCache(javaGlob);
    }
    return;
  }

  getEntityIndex().indexFile(uri, content);
  getConfigBindingIndex().indexFile(uri, content);

  if (stat) {
    updateFileFingerprint(uri, stat.mtimeMs, stat.size);
  }

  if (saveToCache) {
    scheduleSaveCache(javaGlob);
  }
}

async function findJavaFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(javaGlob, FIND_FILES_EXCLUDE);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function indexFilesInBatches(files: vscode.Uri[], report?: ProgressReporter): Promise<void> {
  const index = getEntityIndex();
  const bindingIndex = getConfigBindingIndex();

  for (let i = 0; i < files.length; i += INDEX_BATCH_SIZE) {
    const batch = files.slice(i, i + INDEX_BATCH_SIZE);
    const processed = Math.min(i + batch.length, files.length);
    report?.(
      `Indexing ${processed}/${files.length} Java files`,
      files.length > 0 ? (batch.length / files.length) * 100 : undefined
    );

    await Promise.all(
      batch.map(async (uri) => {
        const stat = await getFileStat(uri);
        const content = await readFileContent(uri);
        if (content) {
          index.indexFile(uri, content);
          bindingIndex.indexFile(uri, content);
          if (stat) {
            updateFileFingerprint(uri, stat.mtimeMs, stat.size);
          }
        }
      })
    );
    await yieldToEventLoop();
  }
}

async function runIndexOperation<T>(
  title: string,
  options: IndexOperationOptions | undefined,
  task: (report: ProgressReporter) => Promise<T>
): Promise<T> {
  const showProgress = options?.showProgress ?? true;

  if (!showProgress) {
    return task(() => undefined);
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    async (progress) => {
      const report: ProgressReporter = (message, increment) => {
        progress.report({ message, increment });
      };
      return task(report);
    }
  );
}

function summarizeIndex(): string {
  const index = getEntityIndex();
  const entityCount = index.getAllEntities().length;
  const repositoryCount = index.getRepositories().length;
  return `${entityCount} entit${entityCount === 1 ? 'y' : 'ies'}, ${repositoryCount} repositor${repositoryCount === 1 ? 'y' : 'ies'}`;
}

export async function rebuildIndex(
  clearCache = false,
  options?: IndexOperationOptions,
  parentReport?: ProgressReporter
): Promise<void> {
  const execute = async (report: ProgressReporter) => {
    if (clearCache) {
      report('Clearing cached index...');
      await clearCacheFile();
    }

    const index = getEntityIndex();
    const bindingIndex = getConfigBindingIndex();
    index.clear();
    bindingIndex.clear();

    report('Finding Java source files...');
    const files = await findJavaFiles();

    if (files.length === 0) {
      await saveCacheNow(javaGlob);
      notifyIndexUpdated();
      return;
    }

    await indexFilesInBatches(files, report);

    report('Saving index cache...');
    await saveCacheNow(javaGlob);
    notifyIndexUpdated();

    if (options?.showCompletion) {
      vscode.window.showInformationMessage(
        `Spring JPA index refreshed (${summarizeIndex()}).`
      );
    }
  };

  if (parentReport) {
    await execute(parentReport);
    return;
  }

  await runIndexOperation('Spring JPA Index', options, execute);
}

async function deltaScan(report?: ProgressReporter): Promise<boolean> {
  const index = getEntityIndex();
  const bindingIndex = getConfigBindingIndex();
  report?.('Checking for changed Java files...');
  const files = await findJavaFiles();
  const currentPaths = new Set(files.map((f) => f.toString()));
  let changed = false;

  const indexedUris = new Set([...index.getIndexedFileUris(), ...bindingIndex.getIndexedFileUris()]);
  for (const indexedUri of indexedUris) {
    if (!currentPaths.has(indexedUri)) {
      index.removeFile(vscode.Uri.parse(indexedUri));
      bindingIndex.removeFile(vscode.Uri.parse(indexedUri));
      changed = true;
    }
  }

  const staleFiles: vscode.Uri[] = [];
  for (let i = 0; i < files.length; i += STAT_BATCH_SIZE) {
    const batch = files.slice(i, i + STAT_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (uri) => {
        const stat = await getFileStat(uri);
        if (!stat || isFileUnchanged(uri, stat.mtimeMs, stat.size)) {
          return undefined;
        }
        return uri;
      })
    );
    staleFiles.push(...results.filter((uri): uri is vscode.Uri => uri !== undefined));
    await yieldToEventLoop();
  }

  if (staleFiles.length > 0) {
    for (let i = 0; i < staleFiles.length; i++) {
      const uri = staleFiles[i];
      report?.(
        `Updating ${i + 1}/${staleFiles.length}: ${path.basename(uri.fsPath)}`,
        staleFiles.length > 0 ? (1 / staleFiles.length) * 100 : undefined
      );
      await indexJavaFile(uri, false);
      changed = true;
    }
  }

  if (changed) {
    report?.('Saving index cache...');
    await saveCacheNow(javaGlob);
  }

  return changed;
}

async function initializeIndex(): Promise<void> {
  if (indexInitialized || indexInitializing) {
    return;
  }

  indexInitializing = true;
  javaGlob = getJavaGlob();

  try {
    await runIndexOperation('Spring JPA Index', { showProgress: false }, async (report) => {
      const cache = await loadCache(javaGlob);

      if (cache) {
        report('Loading cached index...');
        await hydrateIndexFromCache(cache);
        await deltaScan(report);
        notifyIndexUpdated();
      } else {
        report('Building index from workspace...');
        await rebuildIndex(false, undefined, report);
      }
    });

    indexInitialized = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Execute SQL: index initialization failed: ${message}`);
    vscode.window.showErrorMessage(`Spring JPA index failed: ${message}`);
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
  getConfigBindingIndex().removeFile(uri);
  scheduleSaveCache(javaGlob);
  notifyIndexUpdated();
}

export function scheduleIndexInitialization(): void {
  void initializeIndex();
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
