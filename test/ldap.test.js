import '../test-support/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeFilter } from '../server/auth/strategies/ad.js';

test('escapeFilter: deja intactos los valores normales', () => {
  assert.equal(escapeFilter('jdoe'), 'jdoe');
  assert.equal(escapeFilter('juan.perez@empresa.local'), 'juan.perez@empresa.local');
});

test('escapeFilter: neutraliza metacaracteres LDAP (anti-inyección RFC 4515)', () => {
  assert.equal(escapeFilter('*'), '\\2a');
  assert.equal(escapeFilter('('), '\\28');
  assert.equal(escapeFilter(')'), '\\29');
  assert.equal(escapeFilter('\\'), '\\5c');
  // un intento de inyección no debe dejar metacaracteres activos
  const out = escapeFilter('*)(uid=*))(|(uid=*');
  assert.ok(!/[*()]/.test(out.replace(/\\../g, '')), 'no deben quedar ( ) * sin escapar');
});

import { normalizeAdUsername, directBindName, AD_USERNAME_RE } from '../server/auth/ldap.js';
import { withAdDefaults, validateAd } from '../server/services/settings.service.js';
import { ValidationError } from '../server/domain/errors.js';

test('normalizeAdUsername: quita dominio NetBIOS/UPN y pasa a minúsculas', () => {
  assert.equal(normalizeAdUsername('EMPRESA\\JPerez'), 'jperez');
  assert.equal(normalizeAdUsername(' jperez@empresa.com '), 'jperez');
  assert.equal(normalizeAdUsername('jperez'), 'jperez');
  assert.ok(!AD_USERNAME_RE.test(normalizeAdUsername('a*b')));
  assert.ok(!AD_USERNAME_RE.test(''));
});

test('directBindName: DNS -> UPN, NetBIOS -> DOMINIO\\usuario', () => {
  assert.equal(directBindName('empresa.com', 'jperez'), 'jperez@empresa.com');
  assert.equal(directBindName('EMPRESA', 'jperez'), 'EMPRESA\\jperez');
});

test('withAdDefaults: config previa {url,baseDn,bindDn} sigue como search + cifrado según URL', () => {
  const s = withAdDefaults({ url: 'ldaps://dc:636', baseDn: 'DC=x', bindDn: 'CN=svc' });
  assert.equal(s.enabled, true);
  assert.equal(s.mode, 'search');
  assert.equal(s.security, 'ldaps');
  assert.equal(s.searchBase, 'DC=x');
  assert.equal(s.userFilter, '(sAMAccountName={{username}})');
  assert.equal(withAdDefaults({}).enabled, false);
});

test('validateAd: coherencia URL/cifrado y campos obligatorios por modo', () => {
  const base = withAdDefaults({ enabled: true, mode: 'direct', domain: 'EMPRESA', security: 'starttls', url: 'ldap://dc' });
  validateAd(base, { hasBindPassword: false });
  assert.throws(() => validateAd({ ...base, url: 'ldaps://dc' }, { hasBindPassword: false }), ValidationError);
  assert.throws(() => validateAd({ ...base, security: 'ldaps' }, { hasBindPassword: false }), ValidationError);
  assert.throws(() => validateAd({ ...base, domain: '' }, { hasBindPassword: false }), ValidationError);
  assert.throws(() => validateAd({ ...base, domain: 'EMP\\X' }, { hasBindPassword: false }), ValidationError);
  assert.throws(() => validateAd({ ...base, userFilter: '(cn=x)' }, { hasBindPassword: false }), ValidationError);
  const search = { ...base, mode: 'search', bindDn: 'CN=svc', searchBase: 'DC=x' };
  assert.throws(() => validateAd(search, { hasBindPassword: false }), ValidationError);
  validateAd(search, { hasBindPassword: true });
  // deshabilitado: se puede guardar a medias
  validateAd({ ...withAdDefaults({}), enabled: false }, { hasBindPassword: false });
});
