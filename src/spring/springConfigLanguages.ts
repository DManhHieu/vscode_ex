import * as vscode from 'vscode';

/** Language IDs used by Spring Boot Tools for application*.properties / application*.yml. */
export const SPRING_BOOT_PROPERTIES_LANGUAGE = 'spring-boot-properties';
export const SPRING_BOOT_PROPERTIES_YAML_LANGUAGE = 'spring-boot-properties-yaml';

const CONFIG_PROPERTIES_LANGUAGE_IDS = new Set(['properties', SPRING_BOOT_PROPERTIES_LANGUAGE]);
const CONFIG_YAML_LANGUAGE_IDS = new Set(['yaml', SPRING_BOOT_PROPERTIES_YAML_LANGUAGE]);

export const SPRING_CONFIG_LANGUAGE_IDS = new Set([
  'java',
  ...CONFIG_PROPERTIES_LANGUAGE_IDS,
  ...CONFIG_YAML_LANGUAGE_IDS,
]);

export const CONFIG_PROPERTIES_SELECTOR: vscode.DocumentSelector = [
  { language: 'properties', scheme: 'file' },
  { language: SPRING_BOOT_PROPERTIES_LANGUAGE, scheme: 'file' },
];

export const CONFIG_YAML_SELECTOR: vscode.DocumentSelector = [
  { language: 'yaml', scheme: 'file' },
  { language: SPRING_BOOT_PROPERTIES_YAML_LANGUAGE, scheme: 'file' },
];

export function isSpringConfigDocument(document: vscode.TextDocument): boolean {
  return SPRING_CONFIG_LANGUAGE_IDS.has(document.languageId);
}

export function isPropertiesConfigDocument(document: vscode.TextDocument): boolean {
  return CONFIG_PROPERTIES_LANGUAGE_IDS.has(document.languageId) || document.fileName.endsWith('.properties');
}

export function isYamlConfigDocument(document: vscode.TextDocument): boolean {
  return (
    CONFIG_YAML_LANGUAGE_IDS.has(document.languageId) ||
    document.fileName.endsWith('.yml') ||
    document.fileName.endsWith('.yaml')
  );
}
