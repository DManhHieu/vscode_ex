export type SqlDialect = 'postgres' | 'mysql' | 'generic';

const DIRECT_FUNCTION_MAP: Record<string, string> = {
  CONCAT: 'CONCAT',
  SUBSTRING: 'SUBSTRING',
  TRIM: 'TRIM',
  LOWER: 'LOWER',
  UPPER: 'UPPER',
  ABS: 'ABS',
  SQRT: 'SQRT',
  MOD: 'MOD',
  COALESCE: 'COALESCE',
  NULLIF: 'NULLIF',
  CAST: 'CAST',
  COUNT: 'COUNT',
  SUM: 'SUM',
  AVG: 'AVG',
  MIN: 'MIN',
  MAX: 'MAX',
  CURRENT_DATE: 'CURRENT_DATE',
  CURRENT_TIME: 'CURRENT_TIME',
  CURRENT_TIMESTAMP: 'CURRENT_TIMESTAMP',
};

export function mapJpqlFunction(name: string, dialect: SqlDialect): string | undefined {
  const upper = name.toUpperCase();

  if (DIRECT_FUNCTION_MAP[upper]) {
    return DIRECT_FUNCTION_MAP[upper];
  }

  switch (upper) {
    case 'LENGTH':
      return 'LENGTH';
    case 'LOCATE':
      return dialect === 'postgres' ? 'POSITION' : dialect === 'mysql' ? 'LOCATE' : 'LOCATE';
    case 'INDEX':
      return dialect === 'postgres' ? 'ARRAY_POSITION' : undefined;
    case 'SIZE':
      return undefined;
    default:
      return undefined;
  }
}

export function isAggregateFunction(name: string): boolean {
  return ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(name.toUpperCase());
}

export function translateSizeFunction(collectionPath: string): { sql: string; warning: string } {
  return {
    sql: `(SELECT COUNT(*) FROM /* SIZE(${collectionPath}) — manual join required */ )`,
    warning: `SIZE(${collectionPath}) requires a manual subquery; translation may be incomplete`,
  };
}
