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
      Uri: {
        file: (p) => ({ fsPath: p, toString: () => `file://${p}` }),
      },
      Location: class {
        constructor(uri, range) {
          this.uri = uri;
          this.range = range;
        }
      },
      workspace: {
        findFiles: async () => [],
        fs: { readFile: async () => Buffer.from('') },
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const fs = require('fs');
const path = require('path');
const { getPropertyPlaceholderAtPosition } = require('../out/spring/navigation/configPropertyNavigation');
const {
  findPropertyLocationInYaml,
  findPropertyLocationInProperties,
  resolveModuleRootFromJavaFile,
  DEFAULT_SPRING_CONFIG_GLOBS,
} = require('../out/spring/parsing/springConfig');
const { parseConfigBindingsFromSource } = require('../out/spring/parsing/configBindingsParser');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeJavaDocument(source, fileName = 'AppConfig.java') {
  const lines = source.split('\n');
  return {
    languageId: 'java',
    fileName,
    uri: { fsPath: `/project/src/main/java/com/example/demo/config/${fileName}`, toString: () => `file:///project/src/main/java/com/example/demo/config/${fileName}` },
    getText: () => source,
    lineAt(line) {
      return { text: lines[line] ?? '' };
    },
    offsetAt(position) {
      let offset = 0;
      for (let i = 0; i < position.line; i++) {
        offset += lines[i].length + 1;
      }
      return offset + position.character;
    },
    getWordRangeAtPosition() {
      return undefined;
    },
  };
}

function placeholderAt(source, line, character) {
  const { Position } = require('vscode');
  return getPropertyPlaceholderAtPosition(makeJavaDocument(source), new Position(line, character));
}

function readSample(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../test-samples/spring-boot-sample', relativePath), 'utf8');
}

const valueWithDefault = readSample('src/main/java/com/example/demo/config/AppConfig.java');
assert(
  placeholderAt(valueWithDefault, 8, 12) === 'spring.datasource.url',
  'cursor on property key inside placeholder'
);
assert(
  placeholderAt(valueWithDefault, 8, 35) === 'spring.datasource.url',
  'cursor on default value inside placeholder'
);

const colonDefaultSource =
  '@Value("${spring.datasource.url:jdbc:postgresql://localhost:5432/x}") private String url;';
assert(
  placeholderAt(colonDefaultSource, 0, 40) === 'spring.datasource.url',
  'default containing colons still resolves property key'
);

const scheduledSource = readSample('src/main/java/com/example/demo/config/SchedulerConfig.java');
assert(
  placeholderAt(scheduledSource, 8, 5) === 'app.cron',
  'click on @Scheduled resolves property key'
);
assert(
  placeholderAt(scheduledSource, 8, 15) === 'app.cron',
  'click on cron attribute resolves property key'
);
assert(
  placeholderAt(scheduledSource, 8, 25) === 'app.cron',
  'click inside scheduled placeholder resolves property key'
);

const moduleRoot = resolveModuleRootFromJavaFile(
  path.join(__dirname, '../test-samples/spring-boot-sample/src/main/java/com/example/demo/config/AppConfig.java')
);
assert(
  moduleRoot && moduleRoot.replace(/\\/g, '/').endsWith('spring-boot-sample'),
  'module root resolves from java file path'
);

assert(Array.isArray(DEFAULT_SPRING_CONFIG_GLOBS) && DEFAULT_SPRING_CONFIG_GLOBS.length >= 3, 'default config globs exported');

const yamlContent = readSample('src/main/resources/application.yml');
const urlLoc = findPropertyLocationInYaml(yamlContent, 'spring.datasource.url');
assert(urlLoc && urlLoc.line === 11, 'yaml reverse lookup for spring.datasource.url');

const cronLoc = findPropertyLocationInYaml(yamlContent, 'app.cron');
assert(cronLoc && cronLoc.line === 1, 'yaml reverse lookup for app.cron');

const hostLoc = findPropertyLocationInYaml(yamlContent, 'app.mail.host');
assert(hostLoc && hostLoc.line === 3, 'yaml reverse lookup for app.mail.host');

const propsContent = readSample('src/main/resources/application.properties');
const propsLoc = findPropertyLocationInProperties(propsContent, 'spring.datasource.url');
assert(propsLoc && propsLoc.line === 0, 'properties reverse lookup for spring.datasource.url');

const defaultBindings = parseConfigBindingsFromSource(valueWithDefault);
assert(
  defaultBindings.some((b) => b.propertyKey === 'spring.datasource.url'),
  '@Value with default still indexed'
);

console.log('OK  config property navigation');
