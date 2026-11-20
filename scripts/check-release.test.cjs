const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { versionOf, versionChanged } = require('./check-release.cjs');

const pkg = (version) => JSON.stringify({ name: 'x', version });

describe('versionOf', () => {
  it('reads the version field', () => {
    assert.equal(versionOf(pkg('0.1.2')), '0.1.2');
  });
});

describe('versionChanged', () => {
  it('is true when the version differs', () => {
    assert.ok(versionChanged(pkg('0.1.2'), pkg('0.2.0')));
  });

  it('is false when only other fields differ', () => {
    assert.ok(!versionChanged(pkg('0.1.2'), JSON.stringify({ name: 'y', version: '0.1.2' })));
  });

  it('is false for a file missing at the base', () => {
    assert.ok(!versionChanged(undefined, pkg('0.1.2')));
  });
});
