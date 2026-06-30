export const JPQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'ON', 'ORDER', 'BY', 'GROUP', 'HAVING', 'DISTINCT', 'AS', 'IN', 'NOT', 'NULL',
  'LIKE', 'BETWEEN', 'IS', 'ASC', 'DESC', 'FETCH', 'SET',
];

export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'ON', 'ORDER', 'BY', 'GROUP', 'HAVING', 'DISTINCT', 'AS', 'IN', 'NOT', 'NULL',
  'LIKE', 'BETWEEN', 'IS', 'ASC', 'DESC', 'INSERT', 'UPDATE', 'DELETE', 'INTO',
  'VALUES', 'SET', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
];

export const JPQL_KEYWORD_SET = new Set(JPQL_KEYWORDS);
export const SQL_KEYWORD_SET = new Set(SQL_KEYWORDS);
