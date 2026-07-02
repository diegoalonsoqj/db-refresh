import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../server/lib/crypto.js';

test('encrypt/decrypt: roundtrip conserva el contenido', () => {
  const pt = JSON.stringify({ secreto: 'P4$$w0rD', n: 42 });
  const blob = encrypt(pt);
  assert.ok(Buffer.isBuffer(blob));
  assert.ok(blob.length > pt.length); // iv(12)+tag(16)+ct
  assert.equal(decrypt(blob), pt);
});

test('encrypt: dos cifrados del mismo texto difieren (IV aleatorio)', () => {
  const a = encrypt('mismo-texto');
  const b = encrypt('mismo-texto');
  assert.notEqual(a.toString('hex'), b.toString('hex'));
  assert.equal(decrypt(a), 'mismo-texto');
  assert.equal(decrypt(b), 'mismo-texto');
});

test('decrypt: detecta manipulación del ciphertext (auth tag GCM)', () => {
  const blob = encrypt('datos sensibles de la service account');
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0xff; // altera el último byte del ciphertext
  assert.throws(() => decrypt(tampered));
});
