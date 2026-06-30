const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      Uri: {
        parse: (s) => ({ toString: () => String(s), fsPath: String(s).replace(/^file:\/\//, '') }),
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { EntityIndex } = require('../out/spring/index/entityIndex');
const { parseEntityFromSource } = require('../out/spring/parsing/javaAnnotations');
const { translateJpqlToSql } = require('../out/spring/parsing/jpqlToSql');
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadSampleIndex() {
  const index = new EntityIndex();
  const entityPath = path.join(
    __dirname,
    '../test-samples/spring-boot-sample/src/main/java/com/example/demo/entity/User.java'
  );
  const content = fs.readFileSync(entityPath, 'utf8');
  const entity = parseEntityFromSource(content, entityPath);
  assert(entity, 'Failed to parse User entity');
  index.indexFile({ toString: () => entityPath, fsPath: entityPath }, content);
  return index;
}

function indexEntityFromSource(index, className, source) {
  const entityPath = path.join(__dirname, `../test-samples/mock/${className}.java`);
  const entity = parseEntityFromSource(source, entityPath);
  assert(entity, `Failed to parse ${className} entity`);
  index.indexFile({ toString: () => entityPath, fsPath: entityPath }, source);
}

function loadExplicitJoinIndex() {
  const index = new EntityIndex();
  indexEntityFromSource(
    index,
    'TechnicalTestAiScoring',
    `
@Entity
@Table(name = "technical_test_ai_scoring")
public class TechnicalTestAiScoring {
  @Id private Long id;
  private Long technicalTestDetailsId;
  private Boolean isDelete;
  private String status;
}
`
  );
  indexEntityFromSource(
    index,
    'TechnicalTestDetails',
    `
@Entity
@Table(name = "technical_test_details")
public class TechnicalTestDetails {
  @Id private Long id;
  private Long interviewRoundId;
  private String testState;
  private Long sourceCodeId;
  private String result;
  private Double aiScore;
  private java.time.Instant submissionDate;
}
`
  );
  indexEntityFromSource(
    index,
    'InterviewRound',
    `
@Entity
@Table(name = "interview_round")
public class InterviewRound {
  @Id private Long id;
  private Boolean isDelete;
  private String result;
}
`
  );
  return index;
}

function runCase(name, jpql, index, assertFn) {
  const result = translateJpqlToSql(jpql, index);
  if ('message' in result && !('sql' in result)) {
    throw new Error(`${name}: translation failed: ${result.message}`);
  }
  assertFn(result);
  console.log(`OK  ${name}`);
  if (result.warnings?.length) {
    console.log(`    warnings: ${result.warnings.join('; ')}`);
  }
  console.log(`    => ${result.sql}`);
}

function runErrorCase(name, jpql, index, expectedFragment) {
  const result = translateJpqlToSql(jpql, index);
  assert('message' in result && !('sql' in result), `${name}: expected error`);
  assert(
    result.message.toLowerCase().includes(expectedFragment.toLowerCase()),
    `${name}: expected message containing "${expectedFragment}" but got "${result.message}"`
  );
  console.log(`OK  ${name} (expected error)`);
}

const index = loadSampleIndex();

runCase(
  'SELECT JPQL with alias',
  'SELECT u FROM User u WHERE u.email = :email',
  index,
  (result) => {
    assert(result.sql.includes('FROM users u'), 'missing FROM users u');
    assert(result.sql.includes('u.email'), 'missing u.email column ref');
    assert(result.sql.includes(':email'), 'missing :email param');
  }
);

runCase(
  'UPDATE JPQL',
  'UPDATE User u SET u.email = :email WHERE u.id = :id',
  index,
  (result) => {
    assert(result.sql.startsWith('UPDATE users SET'), 'bad UPDATE prefix');
    assert(result.sql.includes('email = :email'), 'missing SET email');
    assert(result.sql.includes('WHERE id = :id'), 'missing WHERE id');
  }
);

runCase(
  'DELETE JPQL',
  'DELETE FROM User u WHERE u.email = :email',
  index,
  (result) => {
    assert(result.sql.startsWith('DELETE FROM users'), 'bad DELETE prefix');
    assert(result.sql.includes('email = :email'), 'missing WHERE email');
  }
);

runCase(
  'SELECT COUNT',
  'SELECT COUNT(u) FROM User u',
  index,
  (result) => {
    assert(result.sql.includes('COUNT(*)'), 'expected COUNT(*)');
    assert(result.sql.includes('FROM users u'), 'missing FROM users u');
  }
);

runCase(
  'Subquery IN',
  'SELECT u FROM User u WHERE u.id IN (SELECT u2.id FROM User u2 WHERE u2.age > :minAge)',
  index,
  (result) => {
    assert(result.sql.includes('IN (SELECT'), 'missing subquery');
    assert(result.sql.includes('users u2'), 'missing inner alias table');
  }
);

runErrorCase(
  'SELECT NEW unsupported',
  'SELECT NEW com.example.Dto(u.email) FROM User u',
  index,
  'unsupported construct'
);

runErrorCase(
  'Unknown entity',
  'SELECT x FROM UnknownEntity x',
  index,
  'Unknown entity'
);

const explicitJoinIndex = loadExplicitJoinIndex();
runCase(
  'Explicit entity JOIN with ON',
  `SELECT tas.technicalTestDetailsId
   FROM TechnicalTestAiScoring tas
   JOIN TechnicalTestDetails ttd ON ttd.id = tas.technicalTestDetailsId
   JOIN InterviewRound ir ON ir.id = ttd.interviewRoundId
   WHERE tas.isDelete = false
     AND tas.status IN :trackerStatuses
     AND ir.isDelete = false
     AND ttd.testState = :submittedState
   ORDER BY ttd.submissionDate ASC`,
  explicitJoinIndex,
  (result) => {
    assert(result.sql.includes('FROM technical_test_ai_scoring tas'), 'missing root FROM');
    assert(result.sql.includes('JOIN technical_test_details ttd ON'), 'missing ttd join');
    assert(result.sql.includes('JOIN interview_round ir ON'), 'missing ir join');
    assert(result.sql.includes('tas.technical_test_details_id'), 'missing select column');
    assert(result.sql.includes(':trackerStatuses'), 'missing IN param');
  }
);

console.log('\nAll JPQL translation tests passed.');
