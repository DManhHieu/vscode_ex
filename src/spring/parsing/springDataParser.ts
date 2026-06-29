const KEYWORDS = [
  'IsNotNull',
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

export interface ParsedMethodQuery {
  properties: string[];
  invalidSegments: string[];
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
      if (idx > 0) {
        if (foundAt < 0 || idx < foundAt) {
          foundAt = idx;
          foundKw = kw;
        }
      }
    }

    if (foundAt > 0) {
      segments.push(current.substring(0, foundAt));
      segments.push(foundKw);
      current = current.substring(foundAt + foundKw.length);
    } else {
      segments.push(current);
      break;
    }
  }

  return segments;
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
  const properties: string[] = [];
  const invalidSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || KEYWORD_SET.has(segment)) {
      continue;
    }
    const propName = decapitalize(segment);
    if (/^[a-z]/.test(propName)) {
      properties.push(propName);
    } else {
      invalidSegments.push(segment);
    }
  }

  return { properties, invalidSegments };
}

export function validateMethodAgainstEntity(
  methodName: string,
  entityFieldNames: string[]
): string[] {
  const parsed = parseSpringDataMethodName(methodName);
  if (!parsed) {
    return [];
  }

  const fieldSet = new Set(entityFieldNames.map((f) => f.toLowerCase()));
  const errors: string[] = [];

  for (const prop of parsed.properties) {
    if (!fieldSet.has(prop.toLowerCase())) {
      errors.push(`Unknown property '${prop}' in method '${methodName}'`);
    }
  }

  return errors;
}
