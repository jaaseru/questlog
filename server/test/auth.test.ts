import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSessionToken, Throttle, verifySessionToken } from '../src/auth.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';

const secret = 'x'.repeat(32);
const uid = '6f1c1c4e-0000-4000-8000-000000000001';
const claims = { uid, ver: 3 };

describe('session tokens', () => {
  it('round-trips the user id and session version', () => {
    expect(verifySessionToken(createSessionToken(claims, secret), secret)).toEqual(claims);
  });

  it('rejects tokens signed with another secret', () => {
    expect(verifySessionToken(createSessionToken(claims, 'y'.repeat(32)), secret)).toBeNull();
  });

  it('rejects tampered, expired and legacy tokens', () => {
    expect(verifySessionToken(createSessionToken(claims, secret, 0), secret)).toBeNull();
    const [, sig] = createSessionToken(claims, secret).split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'someone-else', ver: 1, exp: Date.now() * 2 })).toString('base64url');
    expect(verifySessionToken(`${forged}.${sig}`, secret)).toBeNull();
    // Tokens from earlier versions (no uid, or no session version) are rejected even if correctly signed.
    for (const old of [{ exp: Date.now() * 2 }, { uid, exp: Date.now() * 2 }]) {
      const payload = Buffer.from(JSON.stringify(old)).toString('base64url');
      const signature = createHmac('sha256', secret).update(payload).digest('base64url');
      expect(verifySessionToken(`${payload}.${signature}`, secret)).toBeNull();
    }
    expect(verifySessionToken('garbage', secret)).toBeNull();
    expect(verifySessionToken(undefined, secret)).toBeNull();
  });
});

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
    expect(await verifyPassword('correct horse', 'not-a-hash')).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('Throttle', () => {
  it('blocks a key after the limit until the window passes', () => {
    const t = new Throttle(2, 1000);
    t.hit('a', 0);
    expect(t.blockedFor('a', 0)).toBe(0);
    t.hit('a', 0);
    expect(t.blockedFor('a', 0)).toBe(1);
    expect(t.blockedFor('b', 0)).toBe(0);
    expect(t.blockedFor('a', 1000)).toBe(0);
    t.hit('a', 0);
    t.reset('a');
    expect(t.blockedFor('a', 0)).toBe(0);
  });
});
