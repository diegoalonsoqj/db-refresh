import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustProxy, helmetOptions } from '../server/lib/http.js';

test('parseTrustProxy: vacío -> fallback; false/0 -> false; números y listas', () => {
  assert.equal(parseTrustProxy(undefined), 1);
  assert.equal(parseTrustProxy(''), 1);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('0'), false);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
});

test('helmetOptions: con HTTPS deja los defaults de helmet', () => {
  assert.deepEqual(helmetOptions({ https: true }), {});
});

test('helmetOptions: sin HTTPS quita upgrade-insecure-requests, HSTS y COOP', () => {
  const o = helmetOptions({ https: false });
  assert.equal(o.contentSecurityPolicy.directives.upgradeInsecureRequests, null);
  assert.equal(o.strictTransportSecurity, false);
  assert.equal(o.crossOriginOpenerPolicy, false);
});
