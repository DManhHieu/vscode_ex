import { EntityIndex } from '../index/entityIndex';
import {
  deepResolveConstantValue,
  isJavaConstantReference,
  JavaConstantResolver,
  ParsedImport,
  parseImportsDetailed,
  parseStringConstantsFromSource,
} from './javaAnnotations';

function resolveFromClassConstants(
  constants: Map<string, string> | undefined,
  memberName: string
): string | undefined {
  if (!constants) {
    return undefined;
  }
  return constants.get(memberName.toLowerCase());
}

function lookupConstants(index: EntityIndex, imp: Pick<ParsedImport, 'simpleName' | 'fqn'>): Map<string, string> | undefined {
  return index.getStringConstants(imp.simpleName) ?? index.getStringConstantsByFqn(imp.fqn);
}

function resolveStaticMember(
  index: EntityIndex,
  imp: ParsedImport,
  memberName: string
): string | undefined {
  if (!imp.isStatic) {
    return undefined;
  }
  const constants = lookupConstants(index, imp);
  return resolveFromClassConstants(constants, memberName);
}

export function buildConstantResolver(sourceContent: string, index: EntityIndex): JavaConstantResolver {
  const localConstants = parseStringConstantsFromSource(sourceContent);
  const imports = parseImportsDetailed(sourceContent);
  const skippedSet = new Set<string>();

  const staticMemberImports: ParsedImport[] = [];
  const staticWildcardImports: ParsedImport[] = [];
  const typeImports = new Map<string, string>();

  for (const imp of imports) {
    if (imp.isStatic && imp.staticMember) {
      staticMemberImports.push(imp);
      continue;
    }

    if (imp.isStatic && imp.isWildcard) {
      staticWildcardImports.push(imp);
      continue;
    }

    typeImports.set(imp.simpleName, imp.fqn);
  }

  const trackSkipped = (ref: string): void => {
    if (isJavaConstantReference(ref)) {
      skippedSet.add(ref);
    }
  };

  const resolver: JavaConstantResolver = {
    get skippedConstants() {
      return [...skippedSet];
    },
    resolve(ref: string): string | undefined {
      const trimmed = ref.trim();
      if (!trimmed || !isJavaConstantReference(trimmed)) {
        return undefined;
      }

      const finish = (value: string | undefined): string | undefined =>
        value === undefined ? undefined : deepResolveConstantValue(value, resolver);

      if (trimmed.startsWith('this.')) {
        const member = trimmed.substring(5).toLowerCase();
        const local = localConstants.get(member);
        if (local !== undefined) {
          return finish(local);
        }
        trackSkipped(trimmed);
        return undefined;
      }

      const dotIdx = trimmed.lastIndexOf('.');
      if (dotIdx > 0) {
        const classRef = trimmed.substring(0, dotIdx);
        const memberName = trimmed.substring(dotIdx + 1);
        const simpleClass = classRef.includes('.') ? classRef.substring(classRef.lastIndexOf('.') + 1) : classRef;
        const fqn = classRef.includes('.') ? classRef : typeImports.get(classRef);
        const constants =
          index.getStringConstants(simpleClass) ??
          (fqn ? index.getStringConstantsByFqn(fqn) : undefined);
        const fromIndex = resolveFromClassConstants(constants, memberName);
        if (fromIndex !== undefined) {
          return finish(fromIndex);
        }
        trackSkipped(trimmed);
        return undefined;
      }

      const fromLocal = localConstants.get(trimmed.toLowerCase());
      if (fromLocal !== undefined) {
        return finish(fromLocal);
      }

      const lower = trimmed.toLowerCase();
      for (const imp of staticMemberImports) {
        if (imp.staticMember?.toLowerCase() === lower) {
          const value = resolveStaticMember(index, imp, trimmed);
          if (value !== undefined) {
            return finish(value);
          }
        }
      }

      for (const imp of staticWildcardImports) {
        const value = resolveStaticMember(index, imp, trimmed);
        if (value !== undefined) {
          return finish(value);
        }
      }

      for (const [simpleName] of typeImports) {
        if (simpleName.toLowerCase() === trimmed.toLowerCase()) {
          trackSkipped(trimmed);
          return undefined;
        }
      }

      trackSkipped(trimmed);
      return undefined;
    },
  };

  return resolver;
}
