import * as vscode from 'vscode';
import { ParsedQuery } from './parsing/javaAnnotations';

export async function promptQueryParameters(query: ParsedQuery): Promise<Record<string, string> | undefined> {
  const values: Record<string, string> = {};

  for (const param of query.namedParams) {
    const value = await vscode.window.showInputBox({
      prompt: `Enter value for parameter :${param}`,
      placeHolder: param,
    });
    if (value === undefined) {
      return undefined;
    }
    values[param] = value;
  }

  const maxPos = query.positionalParams.length > 0 ? Math.max(...query.positionalParams) : 0;
  for (let i = 1; i <= maxPos; i++) {
    const value = await vscode.window.showInputBox({
      prompt: `Enter value for positional parameter ?${i}`,
      placeHolder: `?${i}`,
    });
    if (value === undefined) {
      return undefined;
    }
    values[`?${i}`] = value;
  }

  return values;
}

export function substituteQueryParameters(sql: string, params: Record<string, string>): string {
  let result = sql;

  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('?')) {
      const escaped = value.replace(/'/g, "''");
      result = result.replace(key, `'${escaped}'`);
    } else {
      const escaped = value.replace(/'/g, "''");
      const regex = new RegExp(`:${key}\\b`, 'g');
      result = result.replace(regex, `'${escaped}'`);
    }
  }

  return result;
}
