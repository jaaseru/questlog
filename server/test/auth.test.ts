import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '../src/auth.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';

const secret = 'x'.repeat(32);
const uid = '6f1c1c4e-0000-4000-8000-000000000001';

describe('session tokens', () => {
  it('round-trips the user id', () => {
    expect(verifySessionToken(createSessionToken(uid, secret), secret)).toBe(uid);
  });

  it('rejects tokens signed with another secret', () => {
    expect(verifySessionToken(createSessionToken(uid, 'y'.repeat(32)), secret)).toBeNull();
  });

  it('rejects tampered, expired and legacy tokens', () => {
    expect(verifySessionToken(createSessionToken(uid, secret, 0), secret)).toBeNull();
    const [, sig] = createSessionToken(uid, secret).split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'someone-else', exp: Date.now() * 2 })).toString('base64url');
    expect(verifySessionToken(`${forged}.${sig}`, secret)).toBeNull();
    // Tokens from the single-user version carry no uid.
    const legacy = Buffer.from(JSON.stringify({ exp: Date.now() * 2 })).toString('base64url');
    expect(verifySessionToken(`${legacy}.${createSessionToken(uid, secret).split('.')[1]}`, secret)).toBeNull();
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
