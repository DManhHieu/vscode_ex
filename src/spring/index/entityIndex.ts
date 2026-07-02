import * as vscode from 'vscode';
import {
  EntityField,
  ParsedEntity,
  ParsedRepository,
  parseClassHierarchyFromSource,
  parseEntityFromSource,
  parseRepositoriesFromSource,
  parseStringConstantsFromSource,
  parseTypeNameFromSource,
  parsePackageFromSource,
} from '../parsing/javaAnnotations';
import { extractSimpleType } from '../parsing/springDataParser';
import { CachedConfigBinding } from './configBindingIndex';

export interface EntityMetadata {
  className: string;
  entityName: string;
  tableName: string;
  fields: EntityField[];
  fileUri: vscode.Uri;
  classStartLine: number;
  superClassName?: string;
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
  superClassName?: string;
}

export interface CachedRepository {
  interfaceName: string;
  entityType: string;
  idType: string;
  methods: Array<{ name: string; line: number; column: number }>;
  startLine: number;
}

export interface CachedClassHierarchy {
  className: string;
  superClassName?: string;
  fields: EntityField[];
}

export interface CachedFileEntry {
  mtimeMs: number;
  size: number;
  entity?: CachedEntity;
  classHierarchy?: CachedClassHierarchy;
  repositories?: CachedRepository[];
  configBindings?: CachedConfigBinding[];
  stringConstantsClassName?: string;
  stringConstantsFqn?: string;
  stringConstants?: Record<string, string>;
}

interface ClassHierarchyEntry {
  className: string;
  superClassName?: string;
  fields: EntityField[];
  fileUri: vscode.Uri;
}

export class EntityIndex {
  private entities = new Map<string, EntityMetadata>();
  private entitiesByTable = new Map<string, EntityMetadata>();
  private classHierarchy = new Map<string, ClassHierarchyEntry>();
  private fileClassMap = new Map<string, ClassHierarchyEntry>();
  private repositories: RepositoryMetadata[] = [];
  private repositoriesByName = new Map<string, RepositoryMetadata>();
  private fileEntityMap = new Map<string, EntityMetadata>();
  private fileRepoMap = new Map<string, RepositoryMetadata[]>();
  private stringConstantsByClass = new Map<string, Map<string, string>>();
  private stringConstantsByFqn = new Map<string, Map<string, string>>();
  private fileStringConstantsMeta = new Map<string, { classKey: string; fqn?: string }>();

  clear(): void {
    this.entities.clear();
    this.entitiesByTable.clear();
    this.classHierarchy.clear();
    this.fileClassMap.clear();
    this.repositories = [];
    this.repositoriesByName.clear();
    this.fileEntityMap.clear();
    this.fileRepoMap.clear();
    this.stringConstantsByClass.clear();
    this.stringConstantsByFqn.clear();
    this.fileStringConstantsMeta.clear();
  }

  indexFile(uri: vscode.Uri, content: string): void {
    const key = uri.toString();
    this.removeFile(uri);

    const classMeta = parseClassHierarchyFromSource(content);
    if (classMeta) {
      const hierarchyEntry: ClassHierarchyEntry = {
        ...classMeta,
        fileUri: uri,
      };
      this.classHierarchy.set(classMeta.className.toLowerCase(), hierarchyEntry);
      this.fileClassMap.set(key, hierarchyEntry);
    }

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
      for (const repo of repoMetas) {
        this.repositoriesByName.set(repo.interfaceName.toLowerCase(), repo);
      }
    }

    const typeName = parseTypeNameFromSource(content);
    if (typeName) {
      const constants = parseStringConstantsFromSource(content);
      if (constants.size > 0) {
        const typeKey = typeName.toLowerCase();
        const packageName = parsePackageFromSource(content);
        const fqn = packageName ? `${packageName}.${typeName}`.toLowerCase() : undefined;
        this.stringConstantsByClass.set(typeKey, constants);
        this.fileStringConstantsMeta.set(key, { classKey: typeKey, fqn });
        if (fqn) {
          this.stringConstantsByFqn.set(fqn, constants);
        }
      }
    }
  }

  hydrateFromCache(files: Record<string, CachedFileEntry>): void {
    for (const [uriStr, entry] of Object.entries(files)) {
      this.hydrateFileFromCache(uriStr, entry);
    }
  }

  hydrateFileFromCache(uriStr: string, entry: CachedFileEntry): void {
    const uri = vscode.Uri.parse(uriStr);
    this.removeFile(uri);

    if (entry.entity) {
      const meta: EntityMetadata = { ...entry.entity, fileUri: uri };
      this.entities.set(meta.className.toLowerCase(), meta);
      this.entities.set(meta.entityName.toLowerCase(), meta);
      this.entitiesByTable.set(meta.tableName.toLowerCase(), meta);
      this.fileEntityMap.set(uriStr, meta);
    }

    if (entry.classHierarchy) {
      const hierarchyEntry: ClassHierarchyEntry = { ...entry.classHierarchy, fileUri: uri };
      this.classHierarchy.set(hierarchyEntry.className.toLowerCase(), hierarchyEntry);
      this.fileClassMap.set(uriStr, hierarchyEntry);
    }

    if (entry.repositories && entry.repositories.length > 0) {
      const repoMetas = entry.repositories.map((r) => ({ ...r, fileUri: uri }));
      this.fileRepoMap.set(uriStr, repoMetas);
      this.repositories.push(...repoMetas);
      for (const repo of repoMetas) {
        this.repositoriesByName.set(repo.interfaceName.toLowerCase(), repo);
      }
    }

    if (entry.stringConstants && entry.stringConstantsClassName) {
      const constants = new Map(Object.entries(entry.stringConstants));
      const typeKey = entry.stringConstantsClassName.toLowerCase();
      const fqn = entry.stringConstantsFqn?.toLowerCase();
      this.stringConstantsByClass.set(typeKey, constants);
      this.fileStringConstantsMeta.set(uriStr, { classKey: typeKey, fqn });
      if (fqn) {
        this.stringConstantsByFqn.set(fqn, constants);
      }
    }
  }

  serializeFileToCache(
    uriStr: string,
    fingerprint: { mtimeMs: number; size: number },
    configBindings?: CachedConfigBinding[]
  ): CachedFileEntry | undefined {
    const entity = this.fileEntityMap.get(uriStr);
    const classHierarchy = this.fileClassMap.get(uriStr);
    const repos = this.fileRepoMap.get(uriStr);

    const entry: CachedFileEntry = {
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
    };

    if (entity) {
      const { fileUri: _, ...cachedEntity } = entity;
      entry.entity = cachedEntity;
    }

    if (classHierarchy) {
      const { fileUri: _, ...cachedClassHierarchy } = classHierarchy;
      entry.classHierarchy = cachedClassHierarchy;
    }

    if (repos && repos.length > 0) {
      entry.repositories = repos.map(({ fileUri: _, ...r }) => r);
    }

    if (configBindings?.length) {
      entry.configBindings = configBindings;
    }

    const constMeta = this.fileStringConstantsMeta.get(uriStr);
    if (constMeta) {
      const constants = this.stringConstantsByClass.get(constMeta.classKey);
      if (constants && constants.size > 0) {
        entry.stringConstantsClassName = constMeta.classKey;
        entry.stringConstants = Object.fromEntries(constants);
        if (constMeta.fqn) {
          entry.stringConstantsFqn = constMeta.fqn;
        }
      }
    }

    if (
      entry.entity ||
      entry.classHierarchy ||
      entry.repositories ||
      entry.configBindings ||
      entry.stringConstants
    ) {
      return entry;
    }

    return undefined;
  }

  serializeToCache(
    fingerprints: Map<string, { mtimeMs: number; size: number }>,
    configBindingsByFile?: Map<string, CachedConfigBinding[] | undefined>
  ): Record<string, CachedFileEntry> {
    const result: Record<string, CachedFileEntry> = {};
    const allKeys = new Set([
      ...this.fileEntityMap.keys(),
      ...this.fileClassMap.keys(),
      ...this.fileRepoMap.keys(),
      ...this.fileStringConstantsMeta.keys(),
      ...(configBindingsByFile ? [...configBindingsByFile.keys()] : []),
    ]);

    for (const key of allKeys) {
      const fp = fingerprints.get(key);
      if (!fp) {
        continue;
      }

      const entry = this.serializeFileToCache(key, fp, configBindingsByFile?.get(key));
      if (entry) {
        result[key] = entry;
      }
    }

    return result;
  }

  getIndexedFileUris(): string[] {
    const keys = new Set([
      ...this.fileEntityMap.keys(),
      ...this.fileClassMap.keys(),
      ...this.fileRepoMap.keys(),
      ...this.fileStringConstantsMeta.keys(),
    ]);
    return [...keys];
  }

  removeFile(uri: vscode.Uri): void {
    const key = uri.toString();
    const constMeta = this.fileStringConstantsMeta.get(key);
    if (constMeta) {
      this.stringConstantsByClass.delete(constMeta.classKey);
      if (constMeta.fqn) {
        this.stringConstantsByFqn.delete(constMeta.fqn);
      }
      this.fileStringConstantsMeta.delete(key);
    }

    const classEntry = this.fileClassMap.get(key);
    if (classEntry) {
      this.classHierarchy.delete(classEntry.className.toLowerCase());
      this.fileClassMap.delete(key);
    }

    const entity = this.fileEntityMap.get(key);
    if (entity) {
      this.entities.delete(entity.className.toLowerCase());
      this.entities.delete(entity.entityName.toLowerCase());
      this.entitiesByTable.delete(entity.tableName.toLowerCase());
      this.fileEntityMap.delete(key);
    }

    const repos = this.fileRepoMap.get(key);
    if (repos) {
      for (const repo of repos) {
        this.repositoriesByName.delete(repo.interfaceName.toLowerCase());
      }
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

  getRepositoryByName(name: string): RepositoryMetadata | undefined {
    return this.repositoriesByName.get(name.toLowerCase());
  }

  getStringConstants(className: string): Map<string, string> | undefined {
    return this.stringConstantsByClass.get(className.toLowerCase());
  }

  getStringConstantsByFqn(fqn: string): Map<string, string> | undefined {
    return this.stringConstantsByFqn.get(fqn.toLowerCase());
  }

  getFieldNames(entityName: string): string[] {
    const entity = this.getEntityByName(entityName);
    return entity ? this.getEffectiveFields(entity).map((f) => f.name) : [];
  }

  getParentEntity(entity: EntityMetadata): EntityMetadata | undefined {
    if (!entity.superClassName) {
      return undefined;
    }
    return this.getEntityByName(entity.superClassName);
  }

  private getClassEntry(className: string): ClassHierarchyEntry | undefined {
    return this.classHierarchy.get(className.toLowerCase());
  }

  private getEffectiveFieldsForClass(className: string, visited = new Set<string>()): EntityField[] {
    const key = className.toLowerCase();
    if (visited.has(key)) {
      return [];
    }
    visited.add(key);

    const entry = this.getClassEntry(className);
    if (!entry) {
      return [];
    }

    const fieldsMap = new Map<string, EntityField>();

    if (entry.superClassName) {
      for (const field of this.getEffectiveFieldsForClass(entry.superClassName, visited)) {
        fieldsMap.set(field.name.toLowerCase(), field);
      }
    }

    for (const field of entry.fields) {
      fieldsMap.set(field.name.toLowerCase(), field);
    }

    return [...fieldsMap.values()];
  }

  private findFieldInClass(
    className: string,
    fieldName: string,
    visited = new Set<string>()
  ): { className: string; field: EntityField } | undefined {
    const key = className.toLowerCase();
    if (visited.has(key)) {
      return undefined;
    }
    visited.add(key);

    const entry = this.getClassEntry(className);
    if (!entry) {
      return undefined;
    }

    const lower = fieldName.toLowerCase();
    const local = entry.fields.find(
      (f) => f.name.toLowerCase() === lower || f.columnName.toLowerCase() === lower
    );
    if (local) {
      return { className: entry.className, field: local };
    }

    if (entry.superClassName) {
      return this.findFieldInClass(entry.superClassName, fieldName, visited);
    }

    return undefined;
  }

  getEffectiveFields(entity: EntityMetadata, visited = new Set<string>()): EntityField[] {
    return this.getEffectiveFieldsForClass(entity.className, visited);
  }

  findDeclaringField(
    entity: EntityMetadata,
    fieldName: string,
    visited = new Set<string>()
  ): { entity: EntityMetadata; field: EntityField } | undefined {
    const found = this.findFieldInClass(entity.className, fieldName, visited);
    if (!found) {
      return undefined;
    }

    return {
      entity: this.getEntityByName(found.className) ?? entity,
      field: found.field,
    };
  }

  findDeclaringFieldPath(
    entity: EntityMetadata,
    path: string[],
    visited = new Set<string>()
  ): { entity: EntityMetadata; field: EntityField } | undefined {
    if (path.length === 0) {
      return undefined;
    }
    if (path.length === 1) {
      return this.findDeclaringField(entity, path[0], visited);
    }

    const [head, ...rest] = path;
    const lower = head.toLowerCase();
    const field = this.getEffectiveFields(entity, new Set(visited)).find(
      (f) => f.name.toLowerCase() === lower
    );
    if (!field) {
      return undefined;
    }

    const related = this.getEntityByName(extractSimpleType(field.type));
    if (!related) {
      return undefined;
    }

    return this.findDeclaringFieldPath(related, rest, visited);
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
