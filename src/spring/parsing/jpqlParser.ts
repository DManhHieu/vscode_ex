import { Token, tokenizeJpql } from './jpqlLexer';

export interface SelectItem {
  kind: 'path' | 'entity' | 'aggregate' | 'new' | 'subquery' | 'literal' | 'param' | 'star';
  text: string;
  path?: string[];
  functionName?: string;
  args?: Expression[];
  subquery?: SelectStatement;
}

export interface OrderItem {
  expression: Expression;
  direction: 'ASC' | 'DESC';
}

export interface Assignment {
  path: string[];
  value: Expression;
}

export interface JoinClause {
  joinType: 'INNER' | 'LEFT' | 'RIGHT';
  fetch: boolean;
  path: string[];
  alias?: string;
  on?: Expression;
}

export interface FromClause {
  entity: string;
  alias?: string;
  joins: JoinClause[];
}

export interface SelectStatement {
  kind: 'select';
  distinct: boolean;
  selectItems: SelectItem[];
  from: FromClause[];
  where?: Expression;
  groupBy?: Expression[];
  having?: Expression;
  orderBy?: OrderItem[];
}

export interface UpdateStatement {
  kind: 'update';
  entity: string;
  alias?: string;
  assignments: Assignment[];
  where?: Expression;
}

export interface DeleteStatement {
  kind: 'delete';
  entity: string;
  alias?: string;
  where?: Expression;
}

export type JpqlStatement = SelectStatement | UpdateStatement | DeleteStatement;

export type Expression =
  | { kind: 'raw'; text: string }
  | { kind: 'path'; segments: string[] }
  | { kind: 'binary'; op: string; left: Expression; right: Expression }
  | { kind: 'unary'; op: string; operand: Expression }
  | { kind: 'function'; name: string; args: Expression[] }
  | { kind: 'subquery'; query: SelectStatement }
  | { kind: 'param'; name: string }
  | { kind: 'posParam'; index: number }
  | { kind: 'literal'; value: string }
  | { kind: 'list'; items: Expression[] };

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseStatement(): JpqlStatement {
    const kw = this.peekKeyword();
    if (kw === 'SELECT') {
      return this.parseSelect();
    }
    if (kw === 'UPDATE') {
      return this.parseUpdate();
    }
    if (kw === 'DELETE') {
      return this.parseDelete();
    }
    throw new Error(`Expected SELECT, UPDATE, or DELETE but found ${this.tokens[this.pos]?.value ?? 'EOF'}`);
  }

  private parseSelect(): SelectStatement {
    this.expectKeyword('SELECT');
    const distinct = this.tryKeyword('DISTINCT');
    const selectItems = this.parseSelectList();
    this.expectKeyword('FROM');
    const from = this.parseFromClauses();
    const where = this.tryKeyword('WHERE') ? this.parseExpressionUntil(['GROUP', 'HAVING', 'ORDER']) : undefined;
    const groupBy = this.tryKeyword('GROUP') ? this.parseGroupBy() : undefined;
    const having = this.tryKeyword('HAVING') ? this.parseExpressionUntil(['ORDER']) : undefined;
    const orderBy = this.tryKeyword('ORDER') ? this.parseOrderBy() : undefined;
    return { kind: 'select', distinct, selectItems, from, where, groupBy, having, orderBy };
  }

  private parseUpdate(): UpdateStatement {
    this.expectKeyword('UPDATE');
    const entity = this.expectIdent();
    const alias = this.tryIdentAfterEntity();
    this.expectKeyword('SET');
    const assignments = this.parseAssignments();
    const where = this.tryKeyword('WHERE') ? this.parseExpressionUntil([]) : undefined;
    return { kind: 'update', entity, alias, assignments, where };
  }

  private parseDelete(): DeleteStatement {
    this.expectKeyword('DELETE');
    this.expectKeyword('FROM');
    const entity = this.expectIdent();
    const alias = this.tryIdentAfterEntity();
    const where = this.tryKeyword('WHERE') ? this.parseExpressionUntil([]) : undefined;
    return { kind: 'delete', entity, alias, where };
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    do {
      items.push(this.parseSelectItem());
    } while (this.tryToken('COMMA'));
    return items;
  }

  private parseSelectItem(): SelectItem {
    if (this.tryKeyword('NEW')) {
      const text = this.readUntil(['FROM']);
      return { kind: 'new', text: `NEW ${text}`.trim() };
    }
    if (this.peekKeyword() === 'SELECT' && this.peek(1)?.type === 'LPAREN') {
      const subquery = this.parseSubqueryInParens();
      return { kind: 'subquery', text: '(subquery)', subquery };
    }
    const expr = this.parsePrimaryExpression();
    if (expr.kind === 'function') {
      return {
        kind: 'aggregate',
        text: exprToText(expr),
        functionName: expr.name,
        args: expr.args,
      };
    }
    if (expr.kind === 'path') {
      if (expr.segments.length === 1) {
        return { kind: 'entity', text: expr.segments[0], path: expr.segments };
      }
      return { kind: 'path', text: exprToText(expr), path: expr.segments };
    }
    if (expr.kind === 'subquery') {
      return { kind: 'subquery', text: '(subquery)', subquery: expr.query };
    }
    return { kind: 'literal', text: exprToText(expr) };
  }

  private parseFromClauses(): FromClause[] {
    const clauses: FromClause[] = [];
    do {
      const entity = this.expectIdent();
      const alias = this.tryIdentAfterEntity();
      const joins: JoinClause[] = [];
      while (this.isJoinStart()) {
        joins.push(this.parseJoin());
      }
      clauses.push({ entity, alias, joins });
    } while (this.tryToken('COMMA'));
    return clauses;
  }

  private parseJoin(): JoinClause {
    let joinType: JoinClause['joinType'] = 'INNER';
    if (this.tryKeyword('LEFT')) {
      joinType = 'LEFT';
      this.tryKeyword('OUTER');
    } else if (this.tryKeyword('RIGHT')) {
      joinType = 'RIGHT';
      this.tryKeyword('OUTER');
    } else if (this.tryKeyword('INNER')) {
      joinType = 'INNER';
    }
    this.expectKeyword('JOIN');
    const fetch = this.tryKeyword('FETCH');
    const pathExpr = this.parsePathExpression();
    const alias = this.tryIdentAfterEntity();
    let on: Expression | undefined;
    if (this.tryKeyword('ON')) {
      on = this.parseExpressionUntil(['JOIN', 'LEFT', 'RIGHT', 'INNER', 'WHERE', 'GROUP', 'HAVING', 'ORDER']);
    }
    return { joinType, fetch, path: pathExpr.segments, alias, on };
  }

  private parseAssignments(): Assignment[] {
    const assignments: Assignment[] = [];
    do {
      const path = this.parsePathExpression().segments;
      this.expectToken('OP', '=');
      const value = this.parseExpressionUntil(['WHERE', ',']);
      assignments.push({ path, value });
    } while (this.tryToken('COMMA'));
    return assignments;
  }

  private parseGroupBy(): Expression[] {
    this.expectKeyword('BY');
    const items: Expression[] = [];
    do {
      items.push(this.parseExpressionUntil(['HAVING', 'ORDER']));
    } while (this.tryToken('COMMA'));
    return items;
  }

  private parseOrderBy(): OrderItem[] {
    this.expectKeyword('BY');
    const items: OrderItem[] = [];
    do {
      const expression = this.parseExpressionUntil(['ASC', 'DESC', ',']);
      const direction = this.tryKeyword('DESC') ? 'DESC' : this.tryKeyword('ASC') ? 'ASC' : 'ASC';
      items.push({ expression, direction });
    } while (this.tryToken('COMMA'));
    return items;
  }

  private parseSubqueryInParens(): SelectStatement {
    this.expectToken('LPAREN');
    const saved = this.pos;
    const stmt = this.parseSelect();
    this.expectToken('RPAREN');
    return stmt;
  }

  private parseExpressionUntil(stopKeywords: string[]): Expression {
    return this.parseOr(stopKeywords);
  }

  private parseOr(stopKeywords: string[]): Expression {
    let left = this.parseAnd(stopKeywords);
    while (this.tryKeyword('OR')) {
      const right = this.parseAnd(stopKeywords);
      left = { kind: 'binary', op: 'OR', left, right };
    }
    return left;
  }

  private parseAnd(stopKeywords: string[]): Expression {
    let left = this.parseNot(stopKeywords);
    while (this.tryKeyword('AND')) {
      const right = this.parseNot(stopKeywords);
      left = { kind: 'binary', op: 'AND', left, right };
    }
    return left;
  }

  private parseNot(stopKeywords: string[]): Expression {
    if (this.tryKeyword('NOT')) {
      return { kind: 'unary', op: 'NOT', operand: this.parseNot(stopKeywords) };
    }
    return this.parseComparison(stopKeywords);
  }

  private parseComparison(stopKeywords: string[]): Expression {
    let left = this.parseAdd(stopKeywords);
    while (true) {
      const t = this.tokens[this.pos];
      if (!t || t.type === 'EOF') {
        break;
      }
      if (t.type === 'KEYWORD' && stopKeywords.includes(t.value)) {
        break;
      }
      if (t.type === 'COMMA') {
        break;
      }
      if (this.tryKeyword('IS')) {
        const not = this.tryKeyword('NOT');
        this.expectKeyword('NULL');
        left = {
          kind: 'binary',
          op: not ? 'IS NOT NULL' : 'IS NULL',
          left,
          right: { kind: 'literal', value: 'NULL' },
        };
        continue;
      }
      if (this.tryKeyword('IN')) {
        const right = this.parseInOperand(stopKeywords);
        left = { kind: 'binary', op: 'IN', left, right };
        continue;
      }
      if (this.tryKeyword('LIKE')) {
        const right = this.parseAdd(stopKeywords);
        left = { kind: 'binary', op: 'LIKE', left, right };
        continue;
      }
      if (this.tryKeyword('BETWEEN')) {
        const low = this.parseAdd(stopKeywords);
        this.expectKeyword('AND');
        const high = this.parseAdd(stopKeywords);
        left = {
          kind: 'binary',
          op: 'BETWEEN',
          left,
          right: { kind: 'list', items: [low, high] },
        };
        continue;
      }
      if (t.type === 'OP' && ['=', '<>', '!=', '<', '>', '<=', '>='].includes(t.value)) {
        this.pos++;
        const right = this.parseAdd(stopKeywords);
        left = { kind: 'binary', op: t.value, left, right };
        continue;
      }
      break;
    }
    return left;
  }

  private parseInOperand(stopKeywords: string[]): Expression {
    if (this.tryToken('LPAREN')) {
      if (this.peekKeyword() === 'SELECT') {
        const query = this.parseSelect();
        this.expectToken('RPAREN');
        return { kind: 'subquery', query };
      }
      const items: Expression[] = [];
      do {
        items.push(this.parseAdd(stopKeywords));
      } while (this.tryToken('COMMA'));
      this.expectToken('RPAREN');
      return { kind: 'list', items };
    }
    return this.parseAdd(stopKeywords);
  }

  private parseAdd(stopKeywords: string[]): Expression {
    let left = this.parseMul(stopKeywords);
    while (true) {
      const t = this.tokens[this.pos];
      if (!t || t.type !== 'OP' || (t.value !== '+' && t.value !== '-')) {
        break;
      }
      if (this.isStopKeyword(stopKeywords)) {
        break;
      }
      this.pos++;
      const right = this.parseMul(stopKeywords);
      left = { kind: 'binary', op: t.value, left, right };
    }
    return left;
  }

  private parseMul(stopKeywords: string[]): Expression {
    let left = this.parseUnary(stopKeywords);
    while (true) {
      const t = this.tokens[this.pos];
      if (!t || t.type !== 'OP' || !['*', '/', '%'].includes(t.value)) {
        break;
      }
      if (this.isStopKeyword(stopKeywords)) {
        break;
      }
      this.pos++;
      const right = this.parseUnary(stopKeywords);
      left = { kind: 'binary', op: t.value, left, right };
    }
    return left;
  }

  private parseUnary(stopKeywords: string[]): Expression {
    const t = this.tokens[this.pos];
    if (t?.type === 'OP' && t.value === '-') {
      this.pos++;
      return { kind: 'unary', op: '-', operand: this.parseUnary(stopKeywords) };
    }
    return this.parsePrimaryExpression();
  }

  private parsePrimaryExpression(): Expression {
    const t = this.tokens[this.pos];
    if (!t) {
      throw new Error('Unexpected end of expression');
    }
    if (t.type === 'PARAM') {
      this.pos++;
      return { kind: 'param', name: t.value };
    }
    if (t.type === 'POS_PARAM') {
      this.pos++;
      return { kind: 'posParam', index: parseInt(t.value.slice(1), 10) };
    }
    if (t.type === 'STRING' || t.type === 'NUMBER') {
      this.pos++;
      return { kind: 'literal', value: t.value };
    }
    if (t.type === 'KEYWORD' && (t.value === 'TRUE' || t.value === 'FALSE' || t.value === 'NULL')) {
      this.pos++;
      return { kind: 'literal', value: t.value };
    }
    if (t.type === 'LPAREN') {
      if (this.peekKeyword() === 'SELECT') {
        const query = this.parseSubqueryInParens();
        return { kind: 'subquery', query };
      }
      this.pos++;
      const inner = this.parseExpressionUntil([]);
      this.expectToken('RPAREN');
      return inner;
    }
    if (t.type === 'IDENT' || (t.type === 'KEYWORD' && !this.isClauseKeyword(t.value))) {
      const path = this.parsePathExpression();
      const next = this.tokens[this.pos];
      if (next?.type === 'LPAREN') {
        return this.parseFunctionCall(path.segments[0], false);
      }
      return path;
    }
    if (t.type === 'KEYWORD' && ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'LENGTH', 'LOCATE', 'CONCAT', 'SUBSTRING', 'TRIM', 'LOWER', 'UPPER', 'ABS', 'SQRT', 'MOD', 'SIZE', 'INDEX', 'COALESCE', 'NULLIF', 'CAST', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP'].includes(t.value)) {
      return this.parseFunctionCall(t.value, true);
    }
    throw new Error(`Unexpected token in expression: ${t.value}`);
  }

  private parseFunctionCall(name: string, consumeNameToken = false): Expression {
    if (consumeNameToken) {
      this.pos++;
    }
    this.expectToken('LPAREN');
    const args: Expression[] = [];
    if (!this.tryToken('RPAREN')) {
      do {
        if (this.peekKeyword() === 'SELECT') {
          args.push({ kind: 'subquery', query: this.parseSubqueryInParens() });
        } else {
          args.push(this.parseExpressionUntil([',', ')']));
        }
      } while (this.tryToken('COMMA'));
      this.expectToken('RPAREN');
    }
    return { kind: 'function', name, args };
  }

  private parsePathExpression(): { kind: 'path'; segments: string[] } {
    const segments: string[] = [];
    const first = this.expectIdentOrKeywordIdent();
    segments.push(first);
    while (this.tryToken('DOT')) {
      segments.push(this.expectIdentOrKeywordIdent());
    }
    return { kind: 'path', segments };
  }

  private readUntil(stopKeywords: string[]): string {
    const start = this.pos;
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      if (t.type === 'EOF') {
        break;
      }
      if (t.type === 'KEYWORD' && stopKeywords.includes(t.value)) {
        break;
      }
      this.pos++;
    }
    return this.tokens.slice(start, this.pos).map((t) => t.value).join(' ').trim();
  }

  private isJoinStart(): boolean {
    const t = this.tokens[this.pos];
    if (!t || t.type === 'EOF') {
      return false;
    }
    if (t.type === 'KEYWORD' && ['JOIN', 'LEFT', 'RIGHT', 'INNER'].includes(t.value)) {
      return true;
    }
    return false;
  }

  private isClauseKeyword(value: string): boolean {
    return ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'AND', 'OR', 'SET', 'JOIN', 'SELECT', 'UPDATE', 'DELETE'].includes(value);
  }

  private isStopKeyword(stopKeywords: string[]): boolean {
    const t = this.tokens[this.pos];
    return t?.type === 'KEYWORD' && stopKeywords.includes(t.value);
  }

  private tryIdentAfterEntity(): string | undefined {
    const t = this.tokens[this.pos];
    if (!t || t.type === 'EOF') {
      return undefined;
    }
    if (t.type === 'IDENT') {
      this.pos++;
      return t.value;
    }
    if (t.type === 'KEYWORD' && !this.isClauseKeyword(t.value) && !['AS', 'ASC', 'DESC', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'FETCH', 'ON'].includes(t.value)) {
      this.pos++;
      return t.value;
    }
    this.tryKeyword('AS');
    const afterAs = this.tokens[this.pos];
    if (afterAs?.type === 'IDENT') {
      this.pos++;
      return afterAs.value;
    }
    return undefined;
  }

  private expectIdent(): string {
    const t = this.tokens[this.pos];
    if (t?.type === 'IDENT') {
      this.pos++;
      return t.value;
    }
    throw new Error(`Expected identifier but found ${t?.value ?? 'EOF'}`);
  }

  private expectIdentOrKeywordIdent(): string {
    const t = this.tokens[this.pos];
    if (t?.type === 'IDENT' || (t?.type === 'KEYWORD' && !this.isClauseKeyword(t.value))) {
      this.pos++;
      return t.value;
    }
    throw new Error(`Expected identifier but found ${t?.value ?? 'EOF'}`);
  }

  private expectKeyword(kw: string): void {
    const t = this.tokens[this.pos];
    if (t?.type === 'KEYWORD' && t.value === kw) {
      this.pos++;
      return;
    }
    throw new Error(`Expected keyword ${kw} but found ${t?.value ?? 'EOF'}`);
  }

  private tryKeyword(kw: string): boolean {
    const t = this.tokens[this.pos];
    if (t?.type === 'KEYWORD' && t.value === kw) {
      this.pos++;
      return true;
    }
    return false;
  }

  private peekKeyword(): string | undefined {
    const t = this.tokens[this.pos];
    return t?.type === 'KEYWORD' ? t.value : undefined;
  }

  private tryToken(type: Token['type'], value?: string): boolean {
    const t = this.tokens[this.pos];
    if (t?.type === type && (value === undefined || t.value === value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectToken(type: Token['type'], value?: string): void {
    if (!this.tryToken(type, value)) {
      const t = this.tokens[this.pos];
      throw new Error(`Expected token ${type}${value ? ` (${value})` : ''} but found ${t?.value ?? 'EOF'}`);
    }
  }

  private peek(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }
}

export function exprToText(expr: Expression): string {
  switch (expr.kind) {
    case 'raw':
      return expr.text;
    case 'path':
      return expr.segments.join('.');
    case 'binary':
      if (expr.op === 'IS NULL' || expr.op === 'IS NOT NULL') {
        return `${exprToText(expr.left)} ${expr.op}`;
      }
      if (expr.op === 'BETWEEN') {
        const items = expr.right.kind === 'list' ? expr.right.items : [expr.right];
        return `${exprToText(expr.left)} BETWEEN ${exprToText(items[0])} AND ${exprToText(items[1])}`;
      }
      return `${exprToText(expr.left)} ${expr.op} ${exprToText(expr.right)}`;
    case 'unary':
      return `${expr.op} ${exprToText(expr.operand)}`;
    case 'function':
      return `${expr.name}(${expr.args.map(exprToText).join(', ')})`;
    case 'subquery':
      return `(${statementToText(expr.query)})`;
    case 'param':
      return expr.name;
    case 'posParam':
      return `?${expr.index}`;
    case 'literal':
      return expr.value;
    case 'list':
      return expr.items.map(exprToText).join(', ');
    default:
      return '';
  }
}

export function statementToText(stmt: JpqlStatement): string {
  if (stmt.kind === 'select') {
    const parts = [
      'SELECT',
      stmt.distinct ? 'DISTINCT' : '',
      stmt.selectItems.map((i) => i.text).join(', '),
      'FROM',
      stmt.from.map((f) => f.entity + (f.alias ? ` ${f.alias}` : '')).join(', '),
    ].filter(Boolean);
    if (stmt.where) {
      parts.push('WHERE', exprToText(stmt.where));
    }
    return parts.join(' ');
  }
  if (stmt.kind === 'update') {
    return `UPDATE ${stmt.entity}`;
  }
  return `DELETE FROM ${stmt.entity}`;
}

export function parseJpql(input: string): JpqlStatement {
  const tokens = tokenizeJpql(input);
  return new Parser(tokens).parseStatement();
}
