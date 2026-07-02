import * as vscode from 'vscode';
import { getConfigBindingIndex } from './configBindingIndex';
import { CachedFileEntry, getEntityIndex } from './entityIndex';

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export const CACHE_VERSION = 6;
const CACHE_DIR_NAME = 'spring-jpa-index';
const LEGACY_CACHE_FILENAME = 'spring-jpa-index.json';
const MANIFEST_FILENAME = 'manifest.json';
const FINGERPRINTS_FILENAME = 'fingerprints.json';
const FILES_DIR_NAME = 'files';
const SAVE_DEBOUNCE_MS = 2000;
const HYDRATE_YIELD_EVERY = 200;

const textDecoder = new TextDecoder('utf-8');

interface CacheManifest {
  version: number;
  javaGlob: string;
  workspaceRoot: string;
}

interface CachedFileEntryOnDisk extends CachedFileEntry {
  uri: string;
}

interface FingerprintEntry {
  uri: string;
  mtimeMs: number;
  size: number;
}

type FingerprintsOnDisk = Record<string, FingerprintEntry>;

interface LegacyIndexCacheData {
  version: number;
  javaGlob: string;
  workspaceRoot: string;
  files: Record<string, CachedFileEntry>;
}

let extensionContext: vscode.ExtensionContext | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSaveUri: vscode.Uri | undefined;
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

export function hashFileUri(uri: string): string {
  return hashString(uri);
}

function parseCacheJson(data: Uint8Array): unknown {
  return JSON.parse(textDecoder.decode(data));
}

async function getStorageRoot(): Promise<vscode.Uri | undefined> {
  if (!extensionContext) {
    return undefined;
  }

  if (extensionContext.storageUri) {
    await vscode.workspace.fs.createDirectory(extensionContext.storageUri);
    return extensionContext.storageUri;
  }

  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }

  const hash = hashString(root);
  const dir = vscode.Uri.joinPath(extensionContext.globalStorageUri, 'workspace-cache', hash);
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

async function getCacheDir(): Promise<vscode.Uri | undefined> {
  const storageRoot = await getStorageRoot();
  if (!storageRoot) {
    return undefined;
  }

  const cacheDir = vscode.Uri.joinPath(storageRoot, CACHE_DIR_NAME);
  await vscode.workspace.fs.createDirectory(cacheDir);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(cacheDir, FILES_DIR_NAME));
  return cacheDir;
}

async function getLegacyCacheUri(): Promise<vscode.Uri | undefined> {
  const storageRoot = await getStorageRoot();
  if (!storageRoot) {
    return undefined;
  }
  return vscode.Uri.joinPath(storageRoot, LEGACY_CACHE_FILENAME);
}

function getFileCacheUri(cacheDir: vscode.Uri, uriStr: string): vscode.Uri {
  return vscode.Uri.joinPath(cacheDir, FILES_DIR_NAME, `${hashFileUri(uriStr)}.json`);
}

function isManifestCompatible(manifest: CacheManifest, javaGlob: string): boolean {
  if (manifest.javaGlob !== javaGlob) {
    return false;
  }

  const root = getWorkspaceRoot();
  if (root && manifest.workspaceRoot && manifest.workspaceRoot !== root) {
    return false;
  }

  return manifest.version === CACHE_VERSION || manifest.version === 5;
}

async function writeManifest(cacheDir: vscode.Uri, javaGlob: string): Promise<void> {
  const manifest: CacheManifest = {
    version: CACHE_VERSION,
    javaGlob,
    workspaceRoot: getWorkspaceRoot(),
  };
  const manifestUri = vscode.Uri.joinPath(cacheDir, MANIFEST_FILENAME);
  await vscode.workspace.fs.writeFile(manifestUri, Buffer.from(JSON.stringify(manifest), 'utf8'));
}

async function readManifest(cacheDir: vscode.Uri): Promise<CacheManifest | undefined> {
  try {
    const manifestUri = vscode.Uri.joinPath(cacheDir, MANIFEST_FILENAME);
    const data = await vscode.workspace.fs.readFile(manifestUri);
    return parseCacheJson(data) as CacheManifest;
  } catch {
    return undefined;
  }
}

async function writeFingerprints(cacheDir: vscode.Uri): Promise<void> {
  const onDisk: FingerprintsOnDisk = {};
  for (const [uri, fp] of fileFingerprints) {
    onDisk[hashFileUri(uri)] = { uri, mtimeMs: fp.mtimeMs, size: fp.size };
  }
  const fingerprintsUri = vscode.Uri.joinPath(cacheDir, FINGERPRINTS_FILENAME);
  await vscode.workspace.fs.writeFile(fingerprintsUri, Buffer.from(JSON.stringify(onDisk), 'utf8'));
}

async function loadFingerprints(cacheDir: vscode.Uri): Promise<boolean> {
  try {
    const fingerprintsUri = vscode.Uri.joinPath(cacheDir, FINGERPRINTS_FILENAME);
    const data = await vscode.workspace.fs.readFile(fingerprintsUri);
    const parsed = parseCacheJson(data) as FingerprintsOnDisk;
    fileFingerprints.clear();
    for (const entry of Object.values(parsed)) {
      if (entry.uri) {
        fileFingerprints.set(entry.uri, { mtimeMs: entry.mtimeMs, size: entry.size });
      }
    }
    return fileFingerprints.size > 0;
  } catch {
    return false;
  }
}

async function listFileCacheUris(cacheDir: vscode.Uri): Promise<vscode.Uri[]> {
  try {
    const filesDir = vscode.Uri.joinPath(cacheDir, FILES_DIR_NAME);
    const entries = await vscode.workspace.fs.readDirectory(filesDir);
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
      .map(([name]) => vscode.Uri.joinPath(filesDir, name));
  } catch {
    return [];
  }
}

async function buildFingerprintsFromCacheFiles(cacheDir: vscode.Uri): Promise<void> {
  fileFingerprints.clear();
  const fileCacheUris = await listFileCacheUris(cacheDir);
  for (let i = 0; i < fileCacheUris.length; i++) {
    try {
      const data = await vscode.workspace.fs.readFile(fileCacheUris[i]);
      const entry = parseCacheJson(data) as CachedFileEntryOnDisk;
      if (entry.uri) {
        fileFingerprints.set(entry.uri, { mtimeMs: entry.mtimeMs, size: entry.size });
      }
    } catch {
      // skip corrupt cache entries
    }

    if (i > 0 && i % HYDRATE_YIELD_EVERY === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

async function migrateLegacyCache(cacheDir: vscode.Uri, javaGlob: string): Promise<boolean> {
  const legacyUri = await getLegacyCacheUri();
  if (!legacyUri) {
    return false;
  }

  const existingManifest = await readManifest(cacheDir);
  if (existingManifest) {
    return false;
  }

  try {
    const data = await vscode.workspace.fs.readFile(legacyUri);
    const parsed = parseCacheJson(data) as LegacyIndexCacheData;

    if (parsed.version !== 4 || parsed.javaGlob !== javaGlob) {
      return false;
    }

    const root = getWorkspaceRoot();
    if (root && parsed.workspaceRoot && parsed.workspaceRoot !== root) {
      return false;
    }

    for (const [uriStr, entry] of Object.entries(parsed.files)) {
      const onDisk: CachedFileEntryOnDisk = { uri: uriStr, ...entry };
      fileFingerprints.set(uriStr, { mtimeMs: entry.mtimeMs, size: entry.size });
      const fileCacheUri = getFileCacheUri(cacheDir, uriStr);
      await vscode.workspace.fs.writeFile(fileCacheUri, Buffer.from(JSON.stringify(onDisk), 'utf8'));
    }

    await writeManifest(cacheDir, javaGlob);
    await writeFingerprints(cacheDir);
    await vscode.workspace.fs.delete(legacyUri, { useTrash: false });
    return true;
  } catch {
    return false;
  }
}

async function ensureFingerprintsLoaded(cacheDir: vscode.Uri, javaGlob: string, manifest: CacheManifest): Promise<boolean> {
  if (await loadFingerprints(cacheDir)) {
    if (manifest.version === CACHE_VERSION) {
      return true;
    }
    await writeManifest(cacheDir, javaGlob);
    return true;
  }

  await buildFingerprintsFromCacheFiles(cacheDir);
  if (fileFingerprints.size === 0) {
    return false;
  }

  await writeManifest(cacheDir, javaGlob);
  await writeFingerprints(cacheDir);
  return true;
}

export async function loadIndexFromCache(javaGlob: string): Promise<boolean> {
  if (!isCacheEnabled()) {
    return false;
  }

  try {
    const cacheDir = await getCacheDir();
    if (!cacheDir) {
      return false;
    }

    await migrateLegacyCache(cacheDir, javaGlob);

    const manifest = await readManifest(cacheDir);
    if (!manifest || !isManifestCompatible(manifest, javaGlob)) {
      return false;
    }

    return ensureFingerprintsLoaded(cacheDir, javaGlob, manifest);
  } catch {
    return false;
  }
}

export async function hydrateFileCacheEntry(uriStr: string): Promise<boolean> {
  const cacheDir = await getCacheDir();
  if (!cacheDir) {
    return false;
  }

  try {
    const fileCacheUri = getFileCacheUri(cacheDir, uriStr);
    const data = await vscode.workspace.fs.readFile(fileCacheUri);
    const entry = parseCacheJson(data) as CachedFileEntryOnDisk;

    const index = getEntityIndex();
    const bindingIndex = getConfigBindingIndex();
    index.hydrateFileFromCache(uriStr, entry);
    if (entry.configBindings?.length) {
      bindingIndex.hydrateFileFromCache(uriStr, entry.configBindings);
    }
    return true;
  } catch {
    return false;
  }
}

async function serializeAndWriteFileCache(cacheDir: vscode.Uri, uri: vscode.Uri): Promise<void> {
  const uriStr = uri.toString();
  const index = getEntityIndex();
  const bindingIndex = getConfigBindingIndex();
  const fingerprint = fileFingerprints.get(uriStr);

  if (!fingerprint) {
    return;
  }

  const configBindings = bindingIndex.serializeFileBindings(uri);
  const entry = index.serializeFileToCache(uriStr, fingerprint, configBindings);
  const fileCacheUri = getFileCacheUri(cacheDir, uriStr);

  if (!entry) {
    try {
      await vscode.workspace.fs.delete(fileCacheUri, { useTrash: false });
    } catch {
      // cache file may not exist
    }
    return;
  }

  const onDisk: CachedFileEntryOnDisk = { uri: uriStr, ...entry };
  await vscode.workspace.fs.writeFile(fileCacheUri, Buffer.from(JSON.stringify(onDisk), 'utf8'));
}

export async function saveFileCacheNow(uri: vscode.Uri, javaGlob: string): Promise<void> {
  if (!isCacheEnabled()) {
    return;
  }

  const cacheDir = await getCacheDir();
  if (!cacheDir) {
    return;
  }

  const manifest = await readManifest(cacheDir);
  if (!manifest) {
    await writeManifest(cacheDir, javaGlob);
  }

  await serializeAndWriteFileCache(cacheDir, uri);
  await writeFingerprints(cacheDir);
}

export async function saveCacheNow(javaGlob: string): Promise<void> {
  if (!isCacheEnabled()) {
    return;
  }

  const cacheDir = await getCacheDir();
  if (!cacheDir) {
    return;
  }

  const index = getEntityIndex();
  const bindingIndex = getConfigBindingIndex();
  const indexedUris = new Set([
    ...index.getIndexedFileUris(),
    ...bindingIndex.getIndexedFileUris(),
    ...fileFingerprints.keys(),
  ]);

  await writeManifest(cacheDir, javaGlob);

  for (const uriStr of indexedUris) {
    await serializeAndWriteFileCache(cacheDir, vscode.Uri.parse(uriStr));
  }

  const indexedUriSet = new Set(indexedUris);
  for (const uriStr of fileFingerprints.keys()) {
    if (!indexedUriSet.has(uriStr)) {
      const fileCacheUri = getFileCacheUri(cacheDir, uriStr);
      try {
        await vscode.workspace.fs.delete(fileCacheUri, { useTrash: false });
      } catch {
        // cache file may not exist
      }
      fileFingerprints.delete(uriStr);
    }
  }

  await writeFingerprints(cacheDir);
}

export async function removeOrphanCacheEntries(currentPaths: Set<string>): Promise<boolean> {
  let changed = false;
  for (const uriStr of [...fileFingerprints.keys()]) {
    if (!currentPaths.has(uriStr)) {
      await deleteFileCache(vscode.Uri.parse(uriStr));
      changed = true;
    }
  }
  return changed;
}

export function scheduleSaveCache(javaGlob: string, uri?: vscode.Uri): void {
  if (!isCacheEnabled()) {
    return;
  }

  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  pendingSaveUri = uri;

  saveTimer = setTimeout(() => {
    const saveUri = pendingSaveUri;
    pendingSaveUri = undefined;
    if (saveUri) {
      void saveFileCacheNow(saveUri, javaGlob);
    } else {
      void saveCacheNow(javaGlob);
    }
  }, SAVE_DEBOUNCE_MS);
}

export async function deleteFileCache(uri: vscode.Uri): Promise<void> {
  const uriStr = uri.toString();
  fileFingerprints.delete(uriStr);

  try {
    const cacheDir = await getCacheDir();
    if (!cacheDir) {
      return;
    }

    const fileCacheUri = getFileCacheUri(cacheDir, uriStr);
    await vscode.workspace.fs.delete(fileCacheUri, { useTrash: false });
    await writeFingerprints(cacheDir);
  } catch {
    // cache file may not exist
  }
}

export async function clearCacheFile(): Promise<void> {
  fileFingerprints.clear();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  pendingSaveUri = undefined;

  try {
    const cacheDir = await getCacheDir();
    if (cacheDir) {
      await vscode.workspace.fs.delete(cacheDir, { recursive: true, useTrash: false });
    }

    const legacyUri = await getLegacyCacheUri();
    if (legacyUri) {
      await vscode.workspace.fs.delete(legacyUri, { useTrash: false });
    }
  } catch {
    // cache directory may not exist
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
  pendingSaveUri = undefined;
  extensionContext = undefined;
  fileFingerprints.clear();
}
