import { JPQL_KEYWORDS } from './queryKeywords';

const KEYWORD_SET = new Set(JPQL_KEYWORDS.map((k) => k.toUpperCase()));

export type TokenType =
  | 'KEYWORD'
  | 'IDENT'
  | 'STRING'
  | 'NUMBER'
  | 'PARAM'
  | 'POS_PARAM'
  | 'DOT'
  | 'COMMA'
  | 'LPAREN'
  | 'RPAREN'
  | 'OP'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export class JpqlLexer {
  private pos = 0;

  constructor(private readonly input: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) {
        break;
      }
      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }
    tokens.push({ type: 'EOF', value: '', start: this.input.length, end: this.input.length });
    return tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private nextToken(): Token | undefined {
    const start = this.pos;
    const ch = this.input[this.pos];

    if (ch === "'" || ch === '"') {
      return this.readString(ch);
    }
    if (ch === ':') {
      const match = this.input.slice(this.pos).match(/^:([a-zA-Z_][\w]*)/);
      if (match) {
        this.pos += match[0].length;
        return { type: 'PARAM', value: match[0], start, end: this.pos };
      }
      this.pos++;
      return { type: 'OP', value: ':', start, end: this.pos };
    }
    if (ch === '?') {
      const match = this.input.slice(this.pos).match(/^\?(\d+)/);
      if (match) {
        this.pos += match[0].length;
        return { type: 'POS_PARAM', value: match[0], start, end: this.pos };
      }
      this.pos++;
      return { type: 'OP', value: '?', start, end: this.pos };
    }
    if (ch === '.') {
      this.pos++;
      return { type: 'DOT', value: '.', start, end: this.pos };
    }
    if (ch === ',') {
      this.pos++;
      return { type: 'COMMA', value: ',', start, end: this.pos };
    }
    if (ch === '(') {
      this.pos++;
      return { type: 'LPAREN', value: '(', start, end: this.pos };
    }
    if (ch === ')') {
      this.pos++;
      return { type: 'RPAREN', value: ')', start, end: this.pos };
    }
    if (/[0-9]/.test(ch)) {
      return this.readNumber();
    }
    if (/[=<>!+\-*/%]/.test(ch)) {
      return this.readOperator();
    }
    if (/[a-zA-Z_]/.test(ch)) {
      return this.readIdentOrKeyword();
    }

    this.pos++;
    return { type: 'OP', value: ch, start, end: this.pos };
  }

  private readString(quote: string): Token {
    const start = this.pos;
    this.pos++;
    let value = quote;
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      value += ch;
      this.pos++;
      if (ch === quote) {
        if (this.input[this.pos] === quote) {
          value += this.input[this.pos];
          this.pos++;
          continue;
        }
        break;
      }
      if (ch === '\\' && this.pos < this.input.length) {
        value += this.input[this.pos];
        this.pos++;
      }
    }
    return { type: 'STRING', value, start, end: this.pos };
  }

  private readNumber(): Token {
    const start = this.pos;
    while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) {
      this.pos++;
    }
    return { type: 'NUMBER', value: this.input.slice(start, this.pos), start, end: this.pos };
  }

  private readOperator(): Token {
    const start = this.pos;
    const two = this.input.slice(this.pos, this.pos + 2);
    if (['<>', '!=', '<=', '>='].includes(two)) {
      this.pos += 2;
      return { type: 'OP', value: two, start, end: this.pos };
    }
    this.pos++;
    return { type: 'OP', value: this.input[start], start, end: this.pos };
  }

  private readIdentOrKeyword(): Token {
    const start = this.pos;
    while (this.pos < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.pos])) {
      this.pos++;
    }
    const value = this.input.slice(start, this.pos);
    const upper = value.toUpperCase();
    if (KEYWORD_SET.has(upper)) {
      return { type: 'KEYWORD', value: upper, start, end: this.pos };
    }
    return { type: 'IDENT', value, start, end: this.pos };
  }
}

export function tokenizeJpql(input: string): Token[] {
  return new JpqlLexer(input.trim()).tokenize();
}
