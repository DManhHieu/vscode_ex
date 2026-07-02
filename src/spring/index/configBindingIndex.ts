import * as vscode from 'vscode';
import { ParsedConfigBinding, parseConfigBindingsFromSource } from '../parsing/configBindingsParser';
import { keysMatch, toCanonicalKey } from '../parsing/relaxedBinding';

export interface ConfigBinding {
  propertyKey: string;
  kind: 'configurationProperties' | 'value';
  className: string;
  memberName: string;
  fileUri: vscode.Uri;
  line: number;
  column: number;
}

export interface CachedConfigBinding {
  propertyKey: string;
  kind: 'configurationProperties' | 'value';
  className: string;
  memberName: string;
  line: number;
  column: number;
}

export class ConfigBindingIndex {
  private bindingsByKey = new Map<string, ConfigBinding[]>();
  private fileBindingMap = new Map<string, ConfigBinding[]>();
  private allBindings: ConfigBinding[] = [];

  clear(): void {
    this.bindingsByKey.clear();
    this.fileBindingMap.clear();
    this.allBindings = [];
  }

  indexFile(uri: vscode.Uri, content: string): void {
    const key = uri.toString();
    this.removeFile(uri);

    const parsed = parseConfigBindingsFromSource(content);
    if (parsed.length === 0) {
      return;
    }

    const bindings = parsed.map((b) => this.toBinding(b, uri));
    this.fileBindingMap.set(key, bindings);
    this.allBindings.push(...bindings);

    for (const binding of bindings) {
      const canonical = toCanonicalKey(binding.propertyKey);
      const existing = this.bindingsByKey.get(canonical) ?? [];
      existing.push(binding);
      this.bindingsByKey.set(canonical, existing);
    }
  }

  hydrateFromCache(files: Record<string, { configBindings?: CachedConfigBinding[] }>): void {
    for (const [uriStr, entry] of Object.entries(files)) {
      if (entry.configBindings?.length) {
        this.hydrateFileFromCache(uriStr, entry.configBindings);
      }
    }
  }

  hydrateFileFromCache(uriStr: string, cached: CachedConfigBinding[]): void {
    const uri = vscode.Uri.parse(uriStr);
    this.removeFile(uri);

    const bindings = cached.map((b) => ({ ...b, fileUri: uri }));
    this.fileBindingMap.set(uriStr, bindings);
    this.allBindings.push(...bindings);

    for (const binding of bindings) {
      const canonical = toCanonicalKey(binding.propertyKey);
      const existing = this.bindingsByKey.get(canonical) ?? [];
      existing.push(binding);
      this.bindingsByKey.set(canonical, existing);
    }
  }

  serializeFileBindings(uri: vscode.Uri): CachedConfigBinding[] | undefined {
    const bindings = this.fileBindingMap.get(uri.toString());
    if (!bindings?.length) {
      return undefined;
    }
    return bindings.map(({ fileUri: _, ...b }) => b);
  }

  getIndexedFileUris(): string[] {
    return [...this.fileBindingMap.keys()];
  }

  removeFile(uri: vscode.Uri): void {
    const key = uri.toString();
    const bindings = this.fileBindingMap.get(key);
    if (!bindings) {
      return;
    }

    for (const binding of bindings) {
      const canonical = toCanonicalKey(binding.propertyKey);
      const list = this.bindingsByKey.get(canonical);
      if (list) {
        const filtered = list.filter((b) => b.fileUri.toString() !== key || b.line !== binding.line);
        if (filtered.length > 0) {
          this.bindingsByKey.set(canonical, filtered);
        } else {
          this.bindingsByKey.delete(canonical);
        }
      }
    }

    this.allBindings = this.allBindings.filter((b) => b.fileUri.toString() !== key);
    this.fileBindingMap.delete(key);
  }

  findBindings(propertyKey: string): ConfigBinding[] {
    const canonical = toCanonicalKey(propertyKey);
    const exact = this.bindingsByKey.get(canonical);
    if (exact?.length) {
      return exact;
    }

    const matches: ConfigBinding[] = [];
    const seen = new Set<string>();
    for (const binding of this.allBindings) {
      if (keysMatch(propertyKey, binding.propertyKey)) {
        const id = `${binding.fileUri}|${binding.line}|${binding.column}|${binding.propertyKey}`;
        if (!seen.has(id)) {
          seen.add(id);
          matches.push(binding);
        }
      }
    }
    return matches;
  }

  getBindingsForFile(uri: vscode.Uri): ConfigBinding[] {
    return this.fileBindingMap.get(uri.toString()) ?? [];
  }

  private toBinding(parsed: ParsedConfigBinding, uri: vscode.Uri): ConfigBinding {
    return {
      propertyKey: toCanonicalKey(parsed.propertyKey),
      kind: parsed.kind,
      className: parsed.className,
      memberName: parsed.memberName,
      fileUri: uri,
      line: parsed.line,
      column: parsed.column,
    };
  }
}

let globalConfigBindingIndex: ConfigBindingIndex | undefined;

export function getConfigBindingIndex(): ConfigBindingIndex {
  if (!globalConfigBindingIndex) {
    globalConfigBindingIndex = new ConfigBindingIndex();
  }
  return globalConfigBindingIndex;
}

export function resetConfigBindingIndex(): void {
  globalConfigBindingIndex = new ConfigBindingIndex();
}
