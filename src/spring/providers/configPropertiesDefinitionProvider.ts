import * as vscode from 'vscode';
import { getConfigBindingIndex } from '../index/configBindingIndex';
import { getPropertyKeyAtPosition } from '../navigation/propertyKeyAtPosition';

export class ConfigPropertiesDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    const key = getPropertyKeyAtPosition(document, position);
    if (!key) {
      return undefined;
    }

    const bindings = getConfigBindingIndex().findBindings(key);
    if (bindings.length === 0) {
      return undefined;
    }

    return bindings.map(
      (binding) => new vscode.Location(binding.fileUri, new vscode.Position(binding.line, binding.column))
    );
  }
}
