const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      Uri: {
        parse: (value) => ({ toString: () => value, fsPath: value.replace(/^file:\/\//, '') }),
        file: (path) => ({ toString: () => `file://${path}`, fsPath: path }),
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { EntityIndex } = require('../out/spring/index/entityIndex');
const { hashFileUri, CACHE_VERSION } = require('../out/spring/index/indexCache');

function serializeFingerprints(fingerprintMap) {
  const onDisk = {};
  for (const [uri, fp] of fingerprintMap) {
    onDisk[hashFileUri(uri)] = { uri, mtimeMs: fp.mtimeMs, size: fp.size };
  }
  return onDisk;
}

function loadFingerprintsFromDisk(onDisk) {
  const map = new Map();
  for (const entry of Object.values(onDisk)) {
    map.set(entry.uri, { mtimeMs: entry.mtimeMs, size: entry.size });
  }
  return map;
}

function isFileUnchanged(fingerprintMap, uri, mtimeMs, size) {
  const cached = fingerprintMap.get(uri);
  return cached !== undefined && cached.mtimeMs === mtimeMs && cached.size === size;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const sampleJava = `
package com.example.demo;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.data.jpa.repository.JpaRepository;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    @Query("SELECT u FROM User u WHERE u.name = :name")
    User findByName(@Param("name") String name);
}
`;

const uri = 'file:///workspace/src/main/java/com/example/demo/repository/UserRepository.java';
const index = new EntityIndex();
index.indexFile({ toString: () => uri, fsPath: uri.replace(/^file:\/\//, '') }, sampleJava);

const fingerprint = { mtimeMs: 1234567890, size: 4096 };
const entry = index.serializeFileToCache(uri, fingerprint);
assert(entry, 'expected cache entry for indexed file');
assert(entry.repositories?.length === 1, 'expected one repository in cache entry');
assert(entry.mtimeMs === fingerprint.mtimeMs, 'expected fingerprint mtime preserved');

const restored = new EntityIndex();
restored.hydrateFileFromCache(uri, entry);
const repos = restored.getRepositories();
assert(repos.length === 1, 'expected one repository after hydrate');
assert(repos[0].interfaceName === 'UserRepository', 'expected repository name preserved');

const hash1 = hashFileUri(uri);
const hash2 = hashFileUri(uri);
assert(hash1 === hash2, 'expected stable file uri hash');
assert(/^[0-9a-f]{8}$/.test(hash1), 'expected 8-char hex hash');

assert(CACHE_VERSION === 6, 'expected cache version 6');

const fingerprintMap = new Map([[uri, fingerprint]]);
const onDisk = serializeFingerprints(fingerprintMap);
const restoredFingerprints = loadFingerprintsFromDisk(onDisk);
assert(restoredFingerprints.size === 1, 'expected one fingerprint after round-trip');
assert(
  isFileUnchanged(restoredFingerprints, uri, fingerprint.mtimeMs, fingerprint.size),
  'expected unchanged fingerprint match'
);
assert(
  !isFileUnchanged(restoredFingerprints, uri, fingerprint.mtimeMs + 1, fingerprint.size),
  'expected stale fingerprint mismatch'
);

console.log('index cache tests passed');
