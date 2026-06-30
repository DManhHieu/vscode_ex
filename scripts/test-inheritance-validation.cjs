const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return { Uri: { parse: (s) => ({ toString: () => String(s), fsPath: String(s) }) } };
  }
  return originalLoad(request, parent, isMain);
};

const { parseEntityFromSource } = require('../out/spring/parsing/javaAnnotations');
const { EntityIndex } = require('../out/spring/index/entityIndex');
const { validateMethodAgainstEntity } = require('../out/spring/parsing/springDataParser');

const base = `package com.formos.ats.domain;
import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;

@MappedSuperclass
public abstract class AbstractAuditingEntity<T> {
    @Column(name = "is_delete", nullable = false)
    private Boolean isDelete = false;

    @Column(name = "created_by", updatable = false)
    private String createdBy;
}`;

const entity = `package com.formos.ats.domain;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "technical_test_ai_scoring")
public class TechnicalTestAiScoring extends AbstractAuditingEntity<Long> {
    @Id
    private Long id;

    @Column(name = "technical_test_details_id")
    private Long technicalTestDetailsId;
}`;

const classMatch = base.match(
  /(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|sealed\s+|non-sealed\s+)*\bclass\s+(\w+)(?:\s+extends\s+([\w.]+))?/
);
console.log('classMatch on base', classMatch?.[1]);

const parsedBase = parseEntityFromSource(base, 'base.java');
const parsedEntity = parseEntityFromSource(entity, 'entity.java');
console.log('parsedBase className:', parsedBase?.className);
console.log('parsedBase fields:', parsedBase?.fields.map((f) => f.name));
console.log('parsedEntity super:', parsedEntity?.superClassName);

const idx = new EntityIndex();
idx.indexFile({ toString: () => 'base', fsPath: 'base' }, base);
idx.indexFile({ toString: () => 'entity', fsPath: 'entity' }, entity);

const meta = idx.getEntityByName('TechnicalTestAiScoring');
console.log('get base direct', idx.getEntityByName('AbstractAuditingEntity'));
console.log('all entities', idx.getAllEntities().map((e) => e.className));
console.log('parent', idx.getParentEntity(meta)?.className);
console.log('fields', idx.getEffectiveFields(meta).map((f) => f.name));

const fields = idx.getEffectiveFields(meta).map((f) => ({ name: f.name, type: f.type }));
const errors = validateMethodAgainstEntity(
  'findByTechnicalTestDetailsIdAndIsDeleteFalse',
  fields
);
console.log('errors', errors);
if (errors.length > 0) {
  process.exit(1);
}
console.log('inheritance validation OK');
