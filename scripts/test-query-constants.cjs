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

const path = require('path');
const { EntityIndex } = require('../out/spring/index/entityIndex');
const {
  extractQuerySql,
  parseQueriesFromSource,
  parseStringConstantsFromSource,
  getQueryAnnotationBodyAtLine,
} = require('../out/spring/parsing/javaAnnotations');
const { buildConstantResolver } = require('../out/spring/parsing/queryConstantResolver');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function indexSource(index, className, source) {
  const filePath = path.join(__dirname, `../test-samples/mock/${className}.java`);
  index.indexFile({ toString: () => filePath, fsPath: filePath }, source);
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function runCase(name, source, annotationBody, expectedSql, index) {
  const resolver = buildConstantResolver(source, index);
  const sql = extractQuerySql(annotationBody, resolver);
  assert(
    normalizeSql(sql) === normalizeSql(expectedSql),
    `${name}: expected "${expectedSql}" but got "${sql}"`
  );
  console.log(`OK  ${name}`);
}

const index = new EntityIndex();

indexSource(
  index,
  'QueryConstants',
  `package com.example.demo.repository;

public final class QueryConstants {
  public static final String ACTIVE_USER_FILTER = "u.active = true";
}`
);

const sameFileSource = `package com.example.demo.repository;

public interface UserRepository {
  String STATUS_FILTER = "u.email = :email";

  @Query("SELECT u FROM User u WHERE " + STATUS_FILTER)
  void findByStatus();
}`;

runCase(
  'same-file constant',
  sameFileSource,
  '"SELECT u FROM User u WHERE " + STATUS_FILTER',
  'SELECT u FROM User u WHERE u.email = :email',
  index
);

const externalClassSource = `package com.example.demo.repository;

import com.example.demo.repository.QueryConstants;

public interface UserRepository {
  @Query("SELECT u FROM User u WHERE " + QueryConstants.ACTIVE_USER_FILTER)
  void findActive();
}`;

runCase(
  'external class constant',
  externalClassSource,
  '"SELECT u FROM User u WHERE " + QueryConstants.ACTIVE_USER_FILTER',
  'SELECT u FROM User u WHERE u.active = true',
  index
);

indexSource(
  index,
  'QueryConstantsMulti',
  `package com.example.demo.repository;

public final class QueryConstantsMulti {
  public static final String ACTIVE_USER_FILTER_MULTIPLE_LINE =
      "u.active = true" +
      " AND u.deleted = false";

  public static final String ACTIVE_USER_FILTER_TEXT_BLOCK =
      """
           u.active = true
           AND u.deleted = false
           """;
}`
);

const multiLineConstantSource = `package com.example.demo.repository;

import com.example.demo.repository.QueryConstantsMulti;

public interface UserRepository {
  @Query("SELECT u FROM User u WHERE " + QueryConstantsMulti.ACTIVE_USER_FILTER_MULTIPLE_LINE)
  void findActiveMultipleLines();

  @Query("SELECT u FROM User u WHERE " + QueryConstantsMulti.ACTIVE_USER_FILTER_TEXT_BLOCK)
  void findActiveTextBlock();
}`;

runCase(
  'external multi-line concat constant',
  multiLineConstantSource,
  '"SELECT u FROM User u WHERE " + QueryConstantsMulti.ACTIVE_USER_FILTER_MULTIPLE_LINE',
  'SELECT u FROM User u WHERE u.active = true AND u.deleted = false',
  index
);

runCase(
  'external text-block constant',
  multiLineConstantSource,
  '"SELECT u FROM User u WHERE " + QueryConstantsMulti.ACTIVE_USER_FILTER_TEXT_BLOCK',
  'SELECT u FROM User u WHERE u.active = true AND u.deleted = false',
  index
);

const { mergeQuotedJavaConcat, resolveJavaStringExpression } = require('../out/spring/parsing/javaAnnotations');
assert(
  mergeQuotedJavaConcat('SELECT u FROM User u WHERE u.active = true" + " AND u.age = 18') ===
    'SELECT u FROM User u WHERE u.active = true AND u.age = 18',
  'mergeQuotedJavaConcat removes quoted concat'
);
assert(
  mergeQuotedJavaConcat('WITH x AS ( + SELECT fee FROM fees UNION SELECT fee FROM fees_monthly)') ===
    'WITH x AS ( + SELECT fee FROM fees UNION SELECT fee FROM fees_monthly)',
  'mergeQuotedJavaConcat must not strip SQL keywords after +'
);
assert(
  resolveJavaStringExpression('"u.active = true" + " AND u.age = 18"') === 'u.active = true AND u.age = 18',
  'resolveJavaStringExpression merges quoted concat'
);

const staleIndex = new EntityIndex();
staleIndex.hydrateFromCache({
  'file:///stale/QueryConstants.java': {
    mtimeMs: 1,
    size: 1,
    stringConstantsClassName: 'queryconstants',
    stringConstantsFqn: 'com.example.queryconstants.queryconstants',
    stringConstants: {
      stale_filter: '"u.active = true" + " AND u.age = 18"',
    },
  },
});
const staleRepo = `package com.example.repo;
import com.example.queryconstants.QueryConstants;
interface R {
  @Query("SELECT u FROM User u WHERE " + QueryConstants.STALE_FILTER)
  void m();
}`;
const staleResolver = buildConstantResolver(staleRepo, staleIndex);
const staleSql = extractQuerySql(
  '"SELECT u FROM User u WHERE " + QueryConstants.STALE_FILTER',
  staleResolver
);
assert(
  normalizeSql(staleSql) === normalizeSql('SELECT u FROM User u WHERE u.active = true AND u.age = 18'),
  `stale indexed constant must be cleaned: got "${staleSql}"`
);
console.log('OK  stale indexed constant concat syntax is removed');

const staticImportSource = `package com.example.demo.repository;

import static com.example.demo.repository.QueryConstants.ACTIVE_USER_FILTER;

public interface UserRepository {
  @Query("SELECT u FROM User u WHERE " + ACTIVE_USER_FILTER)
  void findActive();
}`;

runCase(
  'static import constant',
  staticImportSource,
  '"SELECT u FROM User u WHERE " + ACTIVE_USER_FILTER',
  'SELECT u FROM User u WHERE u.active = true',
  index
);

const mixedSource = `package com.example.demo.repository;

public interface UserRepository {
  String ORDER = "ORDER BY u.id ASC";

  @Query("SELECT u FROM User u WHERE u.active = true " + ORDER)
  void findOrdered();
}`;

runCase(
  'mixed literal and constant',
  mixedSource,
  '"SELECT u FROM User u WHERE u.active = true " + ORDER',
  'SELECT u FROM User u WHERE u.active = true ORDER BY u.id ASC',
  index
);

const unresolvableSource = `package com.example.demo.repository;

public interface UserRepository {
  @Query("SELECT u FROM User u WHERE " + MISSING_CONSTANT)
  void findMissing();
}`;

const unresolvableResolver = buildConstantResolver(unresolvableSource, index);
const unresolvableSql = extractQuerySql(
  '"SELECT u FROM User u WHERE " + MISSING_CONSTANT',
  unresolvableResolver
);
assert(
  unresolvableSql === 'SELECT u FROM User u WHERE',
  `unresolvable: expected partial SQL but got "${unresolvableSql}"`
);
assert(
  unresolvableResolver.skippedConstants?.includes('MISSING_CONSTANT'),
  'unresolvable: expected MISSING_CONSTANT in skippedConstants'
);
console.log('OK  unresolvable constant falls back without crash');

const constants = parseStringConstantsFromSource(`public interface X {
  String A = "hello";
  String B = A + " world";
}`);
assert(constants.get('a') === 'hello', 'parse constants: A');
assert(constants.get('b') === 'hello world', 'parse constants: B ref A');
console.log('OK  parseStringConstantsFromSource chained constants');

const fullParse = parseQueriesFromSource(sameFileSource, buildConstantResolver(sameFileSource, index));
assert(fullParse.length === 1, 'parseQueriesFromSource should find one query');
assert(
  fullParse[0].sql === 'SELECT u FROM User u WHERE u.email = :email',
  'parseQueriesFromSource merged SQL'
);
console.log('OK  parseQueriesFromSource with resolver');

// Static wildcard import
indexSource(
  index,
  'FiservFeesMonthlyConstants',
  `package com.example.fiserv;

public interface FiservFeesMonthlyConstants {
  String vw_clx_summary_fees_fee_fees_daily = "SELECT fee FROM fees_daily";
  String vw_clx_summary_fees_fee_fees_monthly = "SELECT fee FROM fees_monthly";
}`
);

const wildcardSource = `package com.example.repo;

import static com.example.fiserv.FiservFeesMonthlyConstants.*;

public interface SummaryFeesRepository {
  @Query(value = "WITH fees AS (" + vw_clx_summary_fees_fee_fees_daily + " UNION " + vw_clx_summary_fees_fee_fees_monthly + ") SELECT * FROM fees", nativeQuery = true)
  void getFees();
}`;

runCase(
  'static wildcard import',
  wildcardSource,
  '"WITH fees AS (" + vw_clx_summary_fees_fee_fees_daily + " UNION " + vw_clx_summary_fees_fee_fees_monthly + ") SELECT * FROM fees',
  'WITH fees AS (SELECT fee FROM fees_daily UNION SELECT fee FROM fees_monthly) SELECT * FROM fees',
  index
);

indexSource(
  index,
  'DiscountFleetConstants',
  `package com.example.fiserv;

public interface DiscountFleetConstants {
  String vw_clx_discount_frequency_merchant = "SELECT freq FROM discount_frequency WHERE merchant_id = :merchantId";
  String pricetype_passthru_merchant = "SELECT price FROM pricetype WHERE merchant_id = :merchantId";
  String vw_clx_fee_sequence_codes_discount_fleet = "SELECT code FROM fee_sequence WHERE merchant_id = :merchantId";
  String vw_clx_detail_fees_service_charges_discount_fleet_daily_mtd =
      "SELECT amount FROM service_charges_daily WHERE merchant_id = :merchantId";
  String vw_clx_detail_fees_service_charges_discount_fleet_monthly_mtd =
      "SELECT amount FROM service_charges_monthly WHERE merchant_id = :merchantId";
}`
);

const discountFleetSource = `package com.example.repo;

import static com.example.fiserv.DiscountFleetConstants.*;

public interface FeeStatementRepository {
    @Query(
        value = "WITH discount_fleet AS ( " +
            "WITH vw_clx_discount_frequency AS (" + vw_clx_discount_frequency_merchant + "), " +
            "clx_pricetype_passthru AS (" + pricetype_passthru_merchant + ")," +
            "vw_clx_fee_sequence_codes_discount_fleet AS (" + vw_clx_fee_sequence_codes_discount_fleet + ")," +
            "service_charges_discount_fleet_daily_mtd AS (" + vw_clx_detail_fees_service_charges_discount_fleet_daily_mtd + ")," +
            "service_charges_discount_fleet_monthly_mtd AS (" + vw_clx_detail_fees_service_charges_discount_fleet_monthly_mtd + ") " +
            "   SELECT * " +
            "   FROM service_charges_discount_fleet_daily_mtd " +
            "   UNION " +
            "   SELECT * " +
            "   FROM service_charges_discount_fleet_monthly_mtd )" +
            "SELECT statement_period AS statementPeriod FROM discount_fleet",
        nativeQuery = true
    )
    List<Object> getServiceChargesDiscountFleetMTD();
}`;

const discountFleetResolver = buildConstantResolver(discountFleetSource, index);
const discountFleetQueries = parseQueriesFromSource(discountFleetSource, discountFleetResolver);
assert(discountFleetQueries.length === 1, 'discount fleet: expected one query');
const discountFleetSql = discountFleetQueries[0].sql;
assert(!discountFleetSql.includes('" +'), `discount fleet: must not contain Java concat: ${discountFleetSql.substring(0, 120)}`);
assert(!/\(\s*\+\s*\+/.test(discountFleetSql), `discount fleet: must not contain stray + tokens: ${discountFleetSql.substring(0, 120)}`);
assert(discountFleetSql.includes('SELECT freq FROM discount_frequency'), 'discount fleet: missing frequency CTE');
assert(discountFleetSql.includes('SELECT amount FROM service_charges_daily'), 'discount fleet: missing daily CTE');
assert(discountFleetSql.includes('UNION'), 'discount fleet: missing UNION');
assert(discountFleetSql.includes('SELECT statement_period AS statementPeriod FROM discount_fleet'), 'discount fleet: missing outer select');
console.log('OK  native query with wildcard constants and SQL keywords');

// Cache hydrate restores string constants
const hydrateIndex = new EntityIndex();
const constantsUri = 'file:///mock/FiservFeesMonthlyConstants.java';
const constantsSource = `package com.example.fiserv;

public final class FiservFeesMonthlyDailyConstants {
  public static final String vw_fiserv_fee_funding_adjustments = "SELECT adj FROM adjustments";
}`;
hydrateIndex.indexFile({ toString: () => constantsUri, fsPath: constantsUri }, constantsSource);
const fingerprints = new Map([[constantsUri, { mtimeMs: 1, size: 100 }]]);
const cached = hydrateIndex.serializeToCache(fingerprints);
const restoredIndex = new EntityIndex();
restoredIndex.hydrateFromCache(cached);
const hydrateRepoSource = `package com.example.repo;

import static com.example.fiserv.FiservFeesMonthlyDailyConstants.vw_fiserv_fee_funding_adjustments;

public interface SummaryFeesRepository {
  @Query(value = "WITH base AS (" + vw_fiserv_fee_funding_adjustments + ") SELECT * FROM base", nativeQuery = true)
  void getFees();
}`;
const hydrateResolver = buildConstantResolver(hydrateRepoSource, restoredIndex);
const hydrateSql = extractQuerySql(
  '"WITH base AS (" + vw_fiserv_fee_funding_adjustments + ") SELECT * FROM base',
  hydrateResolver
);
assert(
  normalizeSql(hydrateSql) === normalizeSql('WITH base AS (SELECT adj FROM adjustments) SELECT * FROM base'),
  `cache hydrate: got "${hydrateSql}"`
);
console.log('OK  cache hydrate restores string constants');

// Skipped list dedupes repeated unresolved refs
const dupResolver = buildConstantResolver(
  `interface R { @Query("x" + MISSING + " y " + MISSING) void m(); }`,
  new EntityIndex()
);
extractQuerySql('"x" + MISSING + " y " + MISSING', dupResolver);
assert(
  dupResolver.skippedConstants?.length === 1,
  `dedupe skipped: expected 1 got ${dupResolver.skippedConstants?.length}`
);
console.log('OK  skipped constants are deduped');

const parenInStringSource = `package com.example.repo;

public interface MerchantDowngradesRepository {
  @Query(value = "SELECT m FROM MerchantDowngrades m WHERE m.merchantId IN (:merchantIds)")
  List<MerchantDowngrades> findAllDowngradesByMerchantIds(List<String> merchantIds);
}`;

const parenParsed = parseQueriesFromSource(parenInStringSource);
assert(parenParsed.length === 1, 'paren in string: expected one query');
assert(
  parenParsed[0].sql.includes('IN (:merchantIds)'),
  `paren in string: got "${parenParsed[0].sql}"`
);
const parenResolver = buildConstantResolver(parenInStringSource, new EntityIndex());
const parenBody = getQueryAnnotationBodyAtLine(parenInStringSource, parenParsed[0].startLine);
extractQuerySql(parenBody, parenResolver);
assert(
  (parenResolver.skippedConstants?.length ?? 0) === 0,
  `paren in string: spurious skipped ${parenResolver.skippedConstants?.join(', ')}`
);
console.log('OK  @Query paren inside string literal does not truncate');

const chainedConstantSource = `package com.example.sql;
public final class PricingConstants {
  public static final String CLX_PRICETYPE = "WITH clx_pricetype_passthru AS (" +
      "SELECT m.merchant_id, " +
      "mcpi.pass_bankcard_interchange" +
      " FROM merchant m " +
      " AND m.merchant_id = :merchantId" +
  "),";
}`;

const chainedConstants = parseStringConstantsFromSource(chainedConstantSource);
const clx = chainedConstants.get('clx_pricetype');
assert(clx && !clx.includes('" +'), `chained constant must not contain Java concat syntax: ${clx?.substring(0, 80)}`);
assert(clx.includes('SELECT m.merchant_id'), 'chained constant missing SQL body');
console.log('OK  chained String constant initializer is fully merged');

indexSource(
  index,
  'PricingConstants2',
  `package com.example.sql;
public final class PricingConstants2 {
  public static final String AUTHORIZATION_UNION = "WITH authorization_union AS (";
  public static final String CLX_PRICETYPE = "WITH clx_pricetype_passthru AS (" +
      "SELECT m.merchant_id, " +
      "mcpi.pass_bankcard_interchange" +
      " FROM merchant m " +
      " AND m.merchant_id = :merchantId" +
  "),";
}`
);

const multiConstRepo = `package com.example.repo;
import static com.example.sql.PricingConstants2.*;
public interface MerchantRepo {
  @Query(value = AUTHORIZATION_UNION + CLX_PRICETYPE + "SELECT 1", nativeQuery = true)
  void find();
}`;
const multiResolver = buildConstantResolver(multiConstRepo, index);
const multiQueries = parseQueriesFromSource(multiConstRepo, multiResolver);
assert(!multiQueries[0].sql.includes('" +'), 'query with chained constants must not contain "+');
assert(multiQueries[0].sql.includes('authorization_union'), 'missing first constant');
assert(multiQueries[0].sql.includes('clx_pricetype'), 'missing second constant body');
console.log('OK  @Query with chained constants from index');

console.log('\nAll query constant tests passed.');
