const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      Position: class {
        constructor(line, character) {
          this.line = line;
          this.character = character;
        }
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const fs = require('fs');
const path = require('path');
const { getPropertyKeyAtPosition } = require('../out/spring/navigation/propertyKeyAtPosition');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeYamlDocument(content, languageId = 'yaml') {
  const lines = content.split(/\r?\n/);
  return {
    languageId,
    fileName: 'application.yml',
    lineAt(line) {
      return { text: lines[line] ?? '' };
    },
  };
}

function makePropertiesDocument(content, languageId = 'properties') {
  const lines = content.split(/\r?\n/);
  return {
    languageId,
    fileName: 'application.properties',
    lineAt(line) {
      return { text: lines[line] ?? '' };
    },
  };
}

function keyAt(doc, line, character) {
  const { Position } = require('vscode');
  return getPropertyKeyAtPosition(doc, new Position(line, character));
}

const yamlContent = fs.readFileSync(
  path.join(__dirname, '../test-samples/spring-boot-sample/src/main/resources/application.yml'),
  'utf8'
);

const yaml = makeYamlDocument(yamlContent);

assert(keyAt(yaml, 11, 4) === 'spring.datasource.url', 'yaml key click should resolve');
assert(keyAt(yaml, 11, 15) === 'spring.datasource.url', 'yaml value click should resolve');
assert(keyAt(yaml, 11, 30) === 'spring.datasource.url', 'yaml jdbc url click should resolve');

assert(keyAt(yaml, 1, 4) === 'app.cron', 'app.cron key click should resolve');
assert(keyAt(yaml, 1, 10) === 'app.cron', 'app.cron value click should resolve');

const yamlWithComment = makeYamlDocument('spring:\n  datasource:\n    url: jdbc:demo # not a binding');
assert(keyAt(yamlWithComment, 2, 14) === 'spring.datasource.url', 'yaml value before comment should resolve');
assert(keyAt(yamlWithComment, 2, 20) === undefined, 'yaml comment click should not resolve');

const props = makePropertiesDocument('spring.datasource.url=jdbc:postgresql://localhost:5432/demo');
assert(keyAt(props, 0, 0) === 'spring.datasource.url', 'properties key click should resolve');
assert(keyAt(props, 0, 25) === 'spring.datasource.url', 'properties value click should resolve');

const springBootYaml = makeYamlDocument(yamlContent, 'spring-boot-properties-yaml');
assert(keyAt(springBootYaml, 11, 15) === 'spring.datasource.url', 'spring-boot-properties-yaml value click should resolve');

const springBootProps = makePropertiesDocument(
  'spring.datasource.url=jdbc:postgresql://localhost:5432/demo',
  'spring-boot-properties'
);
assert(keyAt(springBootProps, 0, 25) === 'spring.datasource.url', 'spring-boot-properties value click should resolve');

console.log('OK  property key at position');
