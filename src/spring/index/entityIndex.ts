import * as vscode from 'vscode';
import {
  EntityField,
  ParsedEntity,
  ParsedRepository,
  parseEntityFromSource,
  parseRepositoriesFromSource,
} from '../parsing/javaAnnotations';

export interface EntityMetadata {
  className: string;
  entityName: string;
  tableName: string;
  fields: EntityField[];
  fileUri: vscode.Uri;
  classStartLine: number;
}

export interface RepositoryMetadata {
  interfaceName: string;
  entityType: string;
  idType: string;
  methods: Array<{ name: string; line: number; column: number }>;
  fileUri: vscode.Uri;
  startLine: number;
}

export interface CachedEntity {
  className: string;
  entityName: string;
  tableName: string;
  fields: EntityField[];
  classStartLine: number;
}

export interface CachedRepository {
  interfaceName: string;
  entityType: string;
  idType: string;
  methods: Array<{ name: string; line: number; column: number }>;
  startLine: number;
}

export interface CachedFileEntry {
  mtimeMs: number;
  size: number;
  entity?: CachedEntity;
  repositories?: CachedRepository[];
}

export class EntityIndex {
  private entities = new Map<string, EntityMetadata>();
  private entitiesByTable = new Map<string, EntityMetadata>();
  private repositories: RepositoryMetadata[] = [];
  private fileEntityMap = new Map<string, EntityMetadata>();
  private fileRepoMap = new Map<string, RepositoryMetadata[]>();

  clear(): void {
    this.entities.clear();
    this.entitiesByTable.clear();
    this.repositories = [];
    this.fileEntityMap.clear();
    this.fileRepoMap.clear();
  }

  indexFile(uri: vscode.Uri, content: string): void {
    const key = uri.toString();
    this.removeFile(uri);

    const entity = parseEntityFromSource(content, uri.fsPath);
    if (entity) {
      const meta: EntityMetadata = {
        ...entity,
        fileUri: uri,
      };
      this.entities.set(entity.className.toLowerCase(), meta);
      this.entities.set(entity.entityName.toLowerCase(), meta);
      this.entitiesByTable.set(entity.tableName.toLowerCase(), meta);
      this.fileEntityMap.set(key, meta);
    }

    const repos = parseRepositoriesFromSource(content);
    if (repos.length > 0) {
      const repoMetas = repos.map((r: ParsedRepository) => ({
        ...r,
        fileUri: uri,
      }));
      this.fileRepoMap.set(key, repoMetas);
      this.repositories.push(...repoMetas);
    }
  }

  hydrateFromCache(files: Record<string, CachedFileEntry>): void {
    for (const [uriStr, entry] of Object.entries(files)) {
      const uri = vscode.Uri.parse(uriStr);
      this.removeFile(uri);

      if (entry.entity) {
        const meta: EntityMetadata = { ...entry.entity, fileUri: uri };
        this.entities.set(meta.className.toLowerCase(), meta);
        this.entities.set(meta.entityName.toLowerCase(), meta);
        this.entitiesByTable.set(meta.tableName.toLowerCase(), meta);
        this.fileEntityMap.set(uriStr, meta);
      }

      if (entry.repositories && entry.repositories.length > 0) {
        const repoMetas = entry.repositories.map((r) => ({ ...r, fileUri: uri }));
        this.fileRepoMap.set(uriStr, repoMetas);
        this.repositories.push(...repoMetas);
      }
    }
  }

  serializeToCache(fingerprints: Map<string, { mtimeMs: number; size: number }>): Record<string, CachedFileEntry> {
    const result: Record<string, CachedFileEntry> = {};
    const allKeys = new Set([...this.fileEntityMap.keys(), ...this.fileRepoMap.keys()]);

    for (const key of allKeys) {
      const fp = fingerprints.get(key);
      if (!fp) {
        continue;
      }

      const entity = this.fileEntityMap.get(key);
      const repos = this.fileRepoMap.get(key);

      const entry: CachedFileEntry = {
        mtimeMs: fp.mtimeMs,
        size: fp.size,
      };

      if (entity) {
        const { fileUri: _, ...cachedEntity } = entity;
        entry.entity = cachedEntity;
      }

      if (repos && repos.length > 0) {
        entry.repositories = repos.map(({ fileUri: _, ...r }) => r);
      }

      if (entry.entity || entry.repositories) {
        result[key] = entry;
      }
    }

    return result;
  }

  getIndexedFileUris(): string[] {
    const keys = new Set([...this.fileEntityMap.keys(), ...this.fileRepoMap.keys()]);
    return [...keys];
  }

  removeFile(uri: vscode.Uri): void {
    const key = uri.toString();
    const entity = this.fileEntityMap.get(key);
    if (entity) {
      this.entities.delete(entity.className.toLowerCase());
      this.entities.delete(entity.entityName.toLowerCase());
      this.entitiesByTable.delete(entity.tableName.toLowerCase());
      this.fileEntityMap.delete(key);
    }

    const repos = this.fileRepoMap.get(key);
    if (repos) {
      this.repositories = this.repositories.filter((r) => r.fileUri.toString() !== key);
      this.fileRepoMap.delete(key);
    }
  }

  getEntityByName(name: string): EntityMetadata | undefined {
    return this.entities.get(name.toLowerCase());
  }

  getEntityByTable(tableName: string): EntityMetadata | undefined {
    return this.entitiesByTable.get(tableName.toLowerCase());
  }

  getAllEntities(): EntityMetadata[] {
    const seen = new Set<string>();
    const result: EntityMetadata[] = [];
    for (const entity of this.entities.values()) {
      if (!seen.has(entity.className)) {
        seen.add(entity.className);
        result.push(entity);
      }
    }
    return result;
  }

  getRepositories(): RepositoryMetadata[] {
    return this.repositories;
  }

  getRepositoriesInFile(uri: vscode.Uri): RepositoryMetadata[] {
    return this.fileRepoMap.get(uri.toString()) ?? [];
  }

  getFieldNames(entityName: string): string[] {
    const entity = this.getEntityByName(entityName);
    return entity?.fields.map((f) => f.name) ?? [];
  }
}

let globalIndex: EntityIndex | undefined;

export function getEntityIndex(): EntityIndex {
  if (!globalIndex) {
    globalIndex = new EntityIndex();
  }
  return globalIndex;
}

export function resetEntityIndex(): void {
  globalIndex = new EntityIndex();
}
