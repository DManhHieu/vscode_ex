# Execute SQL & Spring JPA

VS Code extension for batch SQL execution and IntelliJ-style Spring JPA support.

## Features

### SQL file execution
- Execute multiple `.sql` files in filename order via SQLTools
- Explorer context menu and command palette support

### Spring JPA (IntelliJ-style)
- **Run `@Query`** — CodeLens and context menu to run `nativeQuery = true` SQL via SQLTools
- **Copy SQL** — Copy merged query text from `@Query` (handles `"..." + "..."` concatenation) without Java string syntax
- **Entity navigation** — Ctrl+Click entity names in JPQL (`FROM User u`), table names in native SQL, alias fields (`u.email`), `@Table`, and repository generics
- **Datasource linking** — Auto-match `spring.datasource.url` from `application.properties` / `application.yml` to SQLTools connections
- **Index cache** — Entity scan results saved to workspace storage; reloads on reopen with delta scan for changed files only
- **Completion** — Entity, field, table, and column suggestions inside `@Query` string literals
- **Repository validation** — Warnings for invalid Spring Data method property names (`findByXxxAndYyy`)

## Requirements

- [SQLTools](https://marketplace.visualstudio.com/items?itemName=mtxr.sqltools) (required)
- [Language Support for Java](https://marketplace.visualstudio.com/items?itemName=redhat.java) (recommended)
- [Spring Boot Tools](https://marketplace.visualstudio.com/items?itemName=vmware.vscode-spring-boot) (recommended for syntax highlighting)

## Commands

| Command | Description |
|---------|-------------|
| `Execute SQL: Execute SQL Files` | Run selected `.sql` files in order |
| `Execute SQL: Run Spring @Query` | Run native SQL from `@Query` at cursor |
| `Execute SQL: Copy Spring @Query SQL` | Copy clean merged SQL to clipboard |
| `Execute SQL: Refresh Spring JPA Index` | Clear cache and rebuild entity/repository index |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `excuteSql.spring.autoPickDatasource` | `true` | Match Spring datasource to SQLTools connection |
| `excuteSql.spring.javaGlob` | `**/src/main/java/**/*.java` | Glob for entity indexing |
| `excuteSql.spring.connectionMappings` | `{}` | Manual JDBC URL → SQLTools connection name map |
| `excuteSql.spring.cacheIndex` | `true` | Persist index to workspace storage for fast reopen |

## Limitations (v1)

- JPQL execution requires Hibernate runtime — only native SQL can be executed
- Lombok-generated fields, Kotlin, records, and `@Embeddable` are not indexed
- Parameter substitution uses simple string replacement (for development use)
- Index cache is local per machine/workspace storage

## Sample project

See `test-samples/spring-boot-sample/` for a minimal Spring Data JPA example with `User` entity and `UserRepository` (includes concatenated `@Query` example).

## Development

```bash
npm install
npm run compile
```

Press F5 to launch the Extension Development Host.
