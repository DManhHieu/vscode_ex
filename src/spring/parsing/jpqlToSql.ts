import { EntityIndex, EntityMetadata } from '../index/entityIndex';
import { EntityField } from './javaAnnotations';
import { mapJpqlFunction, SqlDialect, translateSizeFunction } from './jpqlFunctions';
import {
  Assignment,
  DeleteStatement,
  Expression,
  FromClause,
  JoinClause,
  JpqlStatement,
  OrderItem,
  parseJpql,
  SelectItem,
  SelectStatement,
  UpdateStatement,
} from './jpqlParser';

export interface JpqlTranslationResult {
  sql: string;
  warnings: string[];
}

export interface JpqlTranslationError {
  message: string;
  unsupported?: string;
}

export interface JpqlTranslationOptions {
  dialect?: SqlDialect;
}

interface AliasContext {
  aliasToEntity: Map<string, EntityMetadata>;
  aliasToTable: Map<string, string>;
  rootEntity?: EntityMetadata;
}

export function translateJpqlToSql(
  jpql: string,
  index: EntityIndex,
  options?: JpqlTranslationOptions
): JpqlTranslationResult | JpqlTranslationError {
  try {
    const stmt = parseJpql(jpql);
    const ctx: TranslationContext = {
      index,
      dialect: options?.dialect ?? 'generic',
      warnings: [],
    };
    const sql = translateStatement(stmt, ctx);
    return { sql, warnings: ctx.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { message: `Cannot translate JPQL: ${message}` };
  }
}

interface TranslationContext {
  index: EntityIndex;
  dialect: SqlDialect;
  warnings: string[];
}

function translateStatement(stmt: JpqlStatement, ctx: TranslationContext): string {
  switch (stmt.kind) {
    case 'select':
      return translateSelect(stmt, ctx);
    case 'update':
      return translateUpdate(stmt, ctx);
    case 'delete':
      return translateDelete(stmt, ctx);
    default:
      throw new Error('Unsupported statement type');
  }
}

function buildAliasContext(from: FromClause[], index: EntityIndex): AliasContext {
  const aliasToEntity = new Map<string, EntityMetadata>();
  const aliasToTable = new Map<string, string>();
  let rootEntity: EntityMetadata | undefined;

  for (const clause of from) {
    const entity = index.getEntityByName(clause.entity);
    if (!entity) {
      throw new Error(`Unknown entity: ${clause.entity}`);
    }
    rootEntity ??= entity;
    const alias = (clause.alias ?? clause.entity).toLowerCase();
    aliasToEntity.set(alias, entity);
    aliasToTable.set(alias, entity.tableName);
  }

  return { aliasToEntity, aliasToTable, rootEntity };
}

function resolveDirectEntityJoin(
  join: JoinClause,
  aliasCtx: AliasContext,
  index: EntityIndex
): EntityMetadata | undefined {
  if (join.path.length !== 1) {
    return undefined;
  }

  const name = join.path[0];
  if (aliasCtx.aliasToEntity.has(name.toLowerCase())) {
    return undefined;
  }

  return index.getEntityByName(name);
}

function extendAliasContextForJoin(
  aliasCtx: AliasContext,
  join: JoinClause,
  index: EntityIndex
): void {
  if (join.alias) {
    const directEntity = resolveDirectEntityJoin(join, aliasCtx, index);
    if (directEntity) {
      aliasCtx.aliasToEntity.set(join.alias.toLowerCase(), directEntity);
      aliasCtx.aliasToTable.set(join.alias.toLowerCase(), directEntity.tableName);
      return;
    }

    const ownerAlias = join.path[0]?.toLowerCase();
    const ownerEntity = ownerAlias ? aliasCtx.aliasToEntity.get(ownerAlias) : undefined;
    if (!ownerEntity) {
      throw new Error(`Unknown alias in join path: ${join.path.join('.')}`);
    }

    const fieldName = join.path.slice(1).join('.') || join.path[join.path.length - 1];
    const fieldPath = join.path.length > 1 ? join.path.slice(1) : [join.path[join.path.length - 1]];
    const declaring = index.findDeclaringFieldPath(ownerEntity, fieldPath.length > 1 ? fieldPath : [fieldName]);
    if (!declaring) {
      throw new Error(`Unknown association path: ${join.path.join('.')}`);
    }

    const targetEntity = resolveAssociationTarget(declaring.field, index);
    if (!targetEntity) {
      throw new Error(`Cannot resolve association target for: ${join.path.join('.')}`);
    }

    aliasCtx.aliasToEntity.set(join.alias.toLowerCase(), targetEntity);
    aliasCtx.aliasToTable.set(join.alias.toLowerCase(), targetEntity.tableName);
  }
}

function resolveAssociationTarget(field: EntityField, index: EntityIndex): EntityMetadata | undefined {
  if (field.association?.targetEntity) {
    return index.getEntityByName(field.association.targetEntity);
  }
  const simpleType = field.type.replace(/\[\]$/, '').trim().split(/[<,>]/)[0]?.trim();
  if (simpleType) {
    return index.getEntityByName(simpleType);
  }
  return undefined;
}

function translateSelect(stmt: SelectStatement, ctx: TranslationContext): string {
  for (const item of stmt.selectItems) {
    if (item.kind === 'new') {
      throw new Error(`unsupported construct \`${item.text.replace(/\s+/g, ' ')}\`. Set nativeQuery = true and write native SQL, or simplify the query.`);
    }
  }

  const aliasCtx = buildAliasContext(stmt.from, ctx.index);
  for (const clause of stmt.from) {
    for (const join of clause.joins) {
      if (join.fetch) {
        ctx.warnings.push('FETCH removed; results may differ from JPA runtime.');
      }
      extendAliasContextForJoin(aliasCtx, join, ctx.index);
    }
  }

  const selectClause = translateSelectItems(stmt.selectItems, aliasCtx, ctx);
  const fromClause = translateFromClause(stmt.from, aliasCtx, ctx);
  const parts = [`SELECT${stmt.distinct ? ' DISTINCT' : ''} ${selectClause}`, fromClause];

  if (stmt.where) {
    parts.push(`WHERE ${translateExpression(stmt.where, aliasCtx, ctx)}`);
  }
  if (stmt.groupBy?.length) {
    parts.push(`GROUP BY ${stmt.groupBy.map((e) => translateExpression(e, aliasCtx, ctx)).join(', ')}`);
  }
  if (stmt.having) {
    parts.push(`HAVING ${translateExpression(stmt.having, aliasCtx, ctx)}`);
  }
  if (stmt.orderBy?.length) {
    parts.push(`ORDER BY ${translateOrderBy(stmt.orderBy, aliasCtx, ctx)}`);
  }

  return parts.join(' ');
}

function translateSelectItems(items: SelectItem[], aliasCtx: AliasContext, ctx: TranslationContext): string {
  return items
    .map((item) => {
      switch (item.kind) {
        case 'entity': {
          const alias = item.path?.[0];
          if (!alias) {
            return item.text;
          }
          const entity = aliasCtx.aliasToEntity.get(alias.toLowerCase());
          if (!entity) {
            throw new Error(`Unknown alias: ${alias}`);
          }
          const fields = ctx.index.getEffectiveFields(entity);
          return fields.map((f) => `${alias}.${f.columnName}`).join(', ');
        }
        case 'path':
          return translatePath(item.path ?? [], aliasCtx, ctx);
        case 'aggregate':
        case 'literal':
          if (item.functionName && item.args) {
            return translateFunction(item.functionName, item.args, aliasCtx, ctx);
          }
          return item.text;
        case 'subquery':
          if (!item.subquery) {
            throw new Error('Missing subquery');
          }
          return `(${translateSelect(item.subquery, ctx)})`;
        default:
          return item.text;
      }
    })
    .join(', ');
}

function translateFromClause(from: FromClause[], aliasCtx: AliasContext, ctx: TranslationContext): string {
  const parts: string[] = [];
  for (const clause of from) {
    const entity = ctx.index.getEntityByName(clause.entity);
    if (!entity) {
      throw new Error(`Unknown entity: ${clause.entity}`);
    }
    const alias = clause.alias ?? clause.entity;
    parts.push(`${entity.tableName} ${alias}`);

    for (const join of clause.joins) {
      parts.push(translateJoin(join, aliasCtx, ctx));
    }
  }
  return `FROM ${parts.join(' ')}`;
}

function translateJoin(join: JoinClause, aliasCtx: AliasContext, ctx: TranslationContext): string {
  const joinKw = join.joinType === 'LEFT' ? 'LEFT JOIN' : join.joinType === 'RIGHT' ? 'RIGHT JOIN' : 'JOIN';

  const directEntity = resolveDirectEntityJoin(join, aliasCtx, ctx.index);
  if (directEntity) {
    if (!join.on) {
      throw new Error(`Direct entity join requires ON clause: ${join.path.join('.')}`);
    }

    const joinAlias = join.alias ?? directEntity.className.toLowerCase().charAt(0);
    aliasCtx.aliasToEntity.set(joinAlias.toLowerCase(), directEntity);
    aliasCtx.aliasToTable.set(joinAlias.toLowerCase(), directEntity.tableName);

    return `${joinKw} ${directEntity.tableName} ${joinAlias} ON ${translateExpression(join.on, aliasCtx, ctx)}`;
  }

  const ownerAlias = join.path[0]?.toLowerCase();
  const ownerEntity = ownerAlias ? aliasCtx.aliasToEntity.get(ownerAlias) : undefined;
  if (!ownerEntity) {
    throw new Error(`Unknown alias in join: ${join.path.join('.')}`);
  }

  const fieldPath = join.path.length > 1 ? join.path.slice(1) : [join.path[join.path.length - 1]];
  const declaring = ctx.index.findDeclaringFieldPath(ownerEntity, fieldPath);
  if (!declaring) {
    throw new Error(`Unknown join path: ${join.path.join('.')}`);
  }

  const targetEntity = resolveAssociationTarget(declaring.field, ctx.index);
  if (!targetEntity) {
    throw new Error(`Cannot resolve join target for: ${join.path.join('.')}`);
  }

  const joinAlias = join.alias ?? targetEntity.className.toLowerCase().charAt(0);
  aliasCtx.aliasToEntity.set(joinAlias.toLowerCase(), targetEntity);
  aliasCtx.aliasToTable.set(joinAlias.toLowerCase(), targetEntity.tableName);

  let onClause = join.on ? translateExpression(join.on, aliasCtx, ctx) : buildJoinOn(ownerEntity, join.path[0], declaring.field, targetEntity, joinAlias, ctx.index);

  return `${joinKw} ${targetEntity.tableName} ${joinAlias} ON ${onClause}`;
}

function buildJoinOn(
  ownerEntity: EntityMetadata,
  ownerAlias: string,
  field: EntityField,
  targetEntity: EntityMetadata,
  joinAlias: string,
  index: EntityIndex
): string {
  const ownerFields = index.getEffectiveFields(ownerEntity);
  const idField = ownerFields.find((f) => f.name === 'id') ?? ownerFields[0];

  if (field.association?.joinColumn) {
    return `${joinAlias}.${field.association.joinColumn} = ${ownerAlias}.${idField?.columnName ?? 'id'}`;
  }

  if (field.association?.mappedBy) {
    const inverseField = targetEntity.fields.find((f) => f.name === field.association!.mappedBy);
    const fkColumn = inverseField?.association?.joinColumn ?? inverseField?.columnName ?? camelToSnake(field.association.mappedBy);
    return `${joinAlias}.${fkColumn} = ${ownerAlias}.${idField?.columnName ?? 'id'}`;
  }

  const fkColumn = field.columnName !== field.name ? field.columnName : camelToSnake(field.name);
  const targetId = index.getEffectiveFields(targetEntity).find((f) => f.name === 'id')?.columnName ?? 'id';
  return `${ownerAlias}.${fkColumn} = ${joinAlias}.${targetId}`;
}

function camelToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function translateUpdate(stmt: UpdateStatement, ctx: TranslationContext): string {
  const entity = ctx.index.getEntityByName(stmt.entity);
  if (!entity) {
    throw new Error(`Unknown entity: ${stmt.entity}`);
  }

  const alias = stmt.alias ?? stmt.entity;
  const aliasCtx: AliasContext = {
    aliasToEntity: new Map([[alias.toLowerCase(), entity]]),
    aliasToTable: new Map([[alias.toLowerCase(), entity.tableName]]),
    rootEntity: entity,
  };

  const setClause = stmt.assignments
    .map((a) => translateAssignment(a, aliasCtx, ctx))
    .join(', ');

  const parts = [`UPDATE ${entity.tableName} SET ${setClause}`];
  if (stmt.where) {
    parts.push(`WHERE ${translateExpression(stmt.where, aliasCtx, ctx, true)}`);
  }
  return parts.join(' ');
}

function translateDelete(stmt: DeleteStatement, ctx: TranslationContext): string {
  const entity = ctx.index.getEntityByName(stmt.entity);
  if (!entity) {
    throw new Error(`Unknown entity: ${stmt.entity}`);
  }

  const alias = stmt.alias ?? stmt.entity;
  const aliasCtx: AliasContext = {
    aliasToEntity: new Map([[alias.toLowerCase(), entity]]),
    aliasToTable: new Map([[alias.toLowerCase(), entity.tableName]]),
    rootEntity: entity,
  };

  const parts = [`DELETE FROM ${entity.tableName}`];
  if (stmt.where) {
    parts.push(`WHERE ${translateExpression(stmt.where, aliasCtx, ctx, true)}`);
  }
  return parts.join(' ');
}

function translateAssignment(assignment: Assignment, aliasCtx: AliasContext, ctx: TranslationContext): string {
  const column = resolveColumnFromPath(assignment.path, aliasCtx, ctx, true);
  return `${column} = ${translateExpression(assignment.value, aliasCtx, ctx, true)}`;
}

function translateOrderBy(items: OrderItem[], aliasCtx: AliasContext, ctx: TranslationContext): string {
  return items
    .map((item) => `${translateExpression(item.expression, aliasCtx, ctx)} ${item.direction}`)
    .join(', ');
}

function translateExpression(expr: Expression, aliasCtx: AliasContext, ctx: TranslationContext, bareColumns = false): string {
  switch (expr.kind) {
    case 'path':
      return translatePath(expr.segments, aliasCtx, ctx, bareColumns);
    case 'binary':
      if (expr.op === 'IS NULL' || expr.op === 'IS NOT NULL') {
        return `${translateExpression(expr.left, aliasCtx, ctx, bareColumns)} ${expr.op}`;
      }
      if (expr.op === 'BETWEEN') {
        const items = expr.right.kind === 'list' ? expr.right.items : [expr.right];
        return `${translateExpression(expr.left, aliasCtx, ctx, bareColumns)} BETWEEN ${translateExpression(items[0], aliasCtx, ctx, bareColumns)} AND ${translateExpression(items[1], aliasCtx, ctx, bareColumns)}`;
      }
      if (expr.op === 'IN' && expr.right.kind === 'subquery') {
        return `${translateExpression(expr.left, aliasCtx, ctx, bareColumns)} IN (${translateSelect(expr.right.query, ctx)})`;
      }
      if (expr.op === 'IN' && expr.right.kind === 'list') {
        return `${translateExpression(expr.left, aliasCtx, ctx, bareColumns)} IN (${expr.right.items.map((i) => translateExpression(i, aliasCtx, ctx, bareColumns)).join(', ')})`;
      }
      return `${translateExpression(expr.left, aliasCtx, ctx, bareColumns)} ${expr.op} ${translateExpression(expr.right, aliasCtx, ctx, bareColumns)}`;
    case 'unary':
      return `${expr.op} ${translateExpression(expr.operand, aliasCtx, ctx, bareColumns)}`;
    case 'function':
      return translateFunction(expr.name, expr.args, aliasCtx, ctx, bareColumns);
    case 'subquery':
      return `(${translateSelect(expr.query, ctx)})`;
    case 'param':
      return expr.name;
    case 'posParam':
      return `?${expr.index}`;
    case 'literal':
      return expr.value;
    case 'list':
      return expr.items.map((i) => translateExpression(i, aliasCtx, ctx)).join(', ');
    case 'raw':
      return expr.text;
    default:
      return '';
  }
}

function translateFunction(name: string, args: Expression[], aliasCtx: AliasContext, ctx: TranslationContext, bareColumns = false): string {
  const upper = name.toUpperCase();

  if (upper === 'SIZE' && args.length === 1 && args[0].kind === 'path') {
    const { sql, warning } = translateSizeFunction(args[0].segments.join('.'));
    ctx.warnings.push(warning);
    return sql;
  }

  const mapped = mapJpqlFunction(name, ctx.dialect);
  if (!mapped) {
    throw new Error(`Unsupported JPQL function: ${name}`);
  }

  if (upper === 'LOCATE' && ctx.dialect === 'postgres' && args.length >= 2) {
    return `POSITION(${translateExpression(args[0], aliasCtx, ctx, bareColumns)} IN ${translateExpression(args[1], aliasCtx, ctx, bareColumns)})`;
  }

  const translatedArgs = args.map((a) => {
    if (a.kind === 'subquery') {
      return `(${translateSelect(a.query, ctx)})`;
    }
    return translateExpression(a, aliasCtx, ctx, bareColumns);
  });

  if (upper === 'COUNT' && args.length === 1 && args[0].kind === 'path' && args[0].segments.length === 1) {
    return 'COUNT(*)';
  }

  return `${mapped}(${translatedArgs.join(', ')})`;
}

function translatePath(segments: string[], aliasCtx: AliasContext, ctx: TranslationContext, bareColumns = false): string {
  if (segments.length === 0) {
    return '';
  }
  if (segments.length === 1) {
    const alias = segments[0].toLowerCase();
    if (aliasCtx.aliasToEntity.has(alias)) {
      const entity = aliasCtx.aliasToEntity.get(alias)!;
      const fields = ctx.index.getEffectiveFields(entity);
      return fields.map((f) => `${segments[0]}.${f.columnName}`).join(', ');
    }
    return segments[0];
  }

  const column = resolveColumnFromPath(segments, aliasCtx, ctx, bareColumns);
  return column;
}

function resolveColumnFromPath(path: string[], aliasCtx: AliasContext, ctx: TranslationContext, bareColumns = false): string {
  const aliasName = path[0].toLowerCase();
  const entity = aliasCtx.aliasToEntity.get(aliasName);
  if (!entity) {
    return path.join('.');
  }

  if (path.length === 1) {
    return aliasCtx.aliasToTable.get(aliasName) ?? path[0];
  }

  const fieldPath = path.slice(1);
  const declaring = ctx.index.findDeclaringFieldPath(entity, fieldPath);
  if (declaring) {
    return bareColumns ? declaring.field.columnName : `${path[0]}.${declaring.field.columnName}`;
  }

  if (fieldPath.length === 1) {
    const fallbackColumn = camelToSnake(fieldPath[0]);
    ctx.warnings.push(
      `Assumed column '${fallbackColumn}' for property '${fieldPath[0]}' (field not found in entity index).`
    );
    return bareColumns ? fallbackColumn : `${path[0]}.${fallbackColumn}`;
  }

  throw new Error(`Unknown field path: ${path.join('.')}`);
}

export { parseJpql };
