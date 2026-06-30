const KEYWORDS = [
  'IsNotEmpty',
  'IsNotNull',
  'IsNot',
  'IsEmpty',
  'IsFalse',
  'IsTrue',
  'IsNull',
  'NotNull',
  'NotLike',
  'NotIn',
  'NotContaining',
  'LessThanEqual',
  'GreaterThanEqual',
  'StartingWith',
  'EndingWith',
  'Containing',
  'LessThan',
  'GreaterThan',
  'IgnoreCase',
  'OrderBy',
  'Between',
  'Distinct',
  'NotLike',
  'Like',
  'After',
  'Before',
  'Exists',
  'Within',
  'Regex',
  'Matches',
  'Near',
  'True',
  'False',
  'Null',
  'Not',
  'And',
  'Or',
  'In',
  'Asc',
  'Desc',
  'Top',
  'First',
  'All',
];

const KEYWORD_SET = new Set(KEYWORDS);

const PREFIXES = [
  'findDistinctBy',
  'findFirstBy',
  'findTopBy',
  'findAllBy',
  'findBy',
  'countBy',
  'deleteBy',
  'removeBy',
  'existsBy',
  'queryBy',
  'readBy',
  'getBy',
  'searchBy',
];

const PRIMITIVE_TYPES = new Set([
  'String',
  'Long',
  'Integer',
  'Short',
  'Byte',
  'Double',
  'Float',
  'Boolean',
  'Character',
  'BigDecimal',
  'BigInteger',
  'LocalDate',
  'LocalDateTime',
  'LocalTime',
  'Instant',
  'ZonedDateTime',
  'OffsetDateTime',
  'Date',
  'UUID',
  'int',
  'long',
  'short',
  'byte',
  'double',
  'float',
  'boolean',
  'char',
  'void',
  'byte[]',
  'Byte[]',
]);

export interface ParsedProperty {
  name: string;
  segment: string;
}

export interface ParsedMethodQuery {
  properties: ParsedProperty[];
  invalidSegments: string[];
}

export interface EntityFieldRef {
  name: string;
  type: string;
}

export interface MethodValidationError {
  property: string;
  segment: string;
  message: string;
}

function decapitalize(s: string): string {
  if (!s) {
    return s;
  }
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function splitByKeywords(remainder: string): string[] {
  const segments: string[] = [];
  let current = remainder;

  while (current.length > 0) {
    let foundAt = -1;
    let foundKw = '';

    for (const kw of KEYWORDS) {
      const idx = current.indexOf(kw);
      if (idx >= 0) {
        if (foundAt < 0 || idx < foundAt || (idx === foundAt && kw.length > foundKw.length)) {
          foundAt = idx;
          foundKw = kw;
        }
      }
    }

    if (foundAt >= 0) {
      if (foundAt > 0) {
        segments.push(current.substring(0, foundAt));
      }
      segments.push(foundKw);
      current = current.substring(foundAt + foundKw.length);
    } else {
      segments.push(current);
      break;
    }
  }

  return segments;
}

export function extractSimpleType(type: string): string {
  const withoutGenerics = type.replace(/<[^>]*>/g, '').trim();
  const parts = withoutGenerics.split('.');
  return parts[parts.length - 1] ?? withoutGenerics;
}

function isRelationType(type: string): boolean {
  const simpleType = extractSimpleType(type);
  return !PRIMITIVE_TYPES.has(simpleType) && /^[A-Z]/.test(simpleType);
}

function fieldMap(fields: EntityFieldRef[]): Map<string, EntityFieldRef> {
  return new Map(fields.map((field) => [field.name.toLowerCase(), field]));
}

function hasField(fields: EntityFieldRef[], name: string): boolean {
  const lower = name.toLowerCase();
  return fields.some((field) => field.name.toLowerCase() === lower);
}

function resolveNestedProperty(
  parentField: EntityFieldRef,
  childName: string,
  resolveEntity?: (typeName: string) => EntityFieldRef[] | undefined
): boolean {
  if (!resolveEntity || !isRelationType(parentField.type)) {
    return false;
  }

  const relatedFields = resolveEntity(extractSimpleType(parentField.type));
  return relatedFields ? hasField(relatedFields, childName) : false;
}

export function isPropertyValidOnEntity(
  prop: string,
  fields: EntityFieldRef[],
  resolveEntity?: (typeName: string) => EntityFieldRef[] | undefined
): boolean {
  if (hasField(fields, prop)) {
    return true;
  }

  const fieldsByName = fieldMap(fields);

  const underscoreIndex = prop.indexOf('_');
  if (underscoreIndex > 0) {
    const parentName = prop.substring(0, underscoreIndex);
    const childName = prop.substring(underscoreIndex + 1);
    const parentField = fieldsByName.get(parentName.toLowerCase());
    if (parentField && childName) {
      return resolveNestedProperty(parentField, childName, resolveEntity);
    }
  }

  if (prop.endsWith('Id') && prop.length > 2) {
    const parentName = prop.slice(0, -2);
    const parentField = fieldsByName.get(parentName.toLowerCase());
    if (parentField) {
      return resolveNestedProperty(parentField, 'id', resolveEntity);
    }
  }

  return false;
}

export function parseSpringDataMethodName(methodName: string): ParsedMethodQuery | null {
  let remainder = methodName;
  let matched = false;

  for (const prefix of PREFIXES) {
    if (remainder.startsWith(prefix)) {
      remainder = remainder.substring(prefix.length);
      matched = true;
      break;
    }
  }

  if (!matched || !remainder) {
    return null;
  }

  const orderByIndex = remainder.indexOf('OrderBy');
  if (orderByIndex > 0) {
    remainder = remainder.substring(0, orderByIndex);
  }

  const segments = splitByKeywords(remainder);
  const properties: ParsedProperty[] = [];
  const invalidSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || KEYWORD_SET.has(segment)) {
      continue;
    }
    const propName = decapitalize(segment);
    if (/^[a-z]/.test(propName)) {
      properties.push({ name: propName, segment });
    } else {
      invalidSegments.push(segment);
    }
  }

  return { properties, invalidSegments };
}

export function validateMethodAgainstEntity(
  methodName: string,
  fields: EntityFieldRef[],
  resolveEntity?: (typeName: string) => EntityFieldRef[] | undefined
): MethodValidationError[] {
  const parsed = parseSpringDataMethodName(methodName);
  if (!parsed) {
    return [];
  }

  const errors: MethodValidationError[] = [];

  for (const prop of parsed.properties) {
    if (!isPropertyValidOnEntity(prop.name, fields, resolveEntity)) {
      errors.push({
        property: prop.name,
        segment: prop.segment,
        message: `Unknown property '${prop.name}' in method '${methodName}'`,
      });
    }
  }

  return errors;
}
