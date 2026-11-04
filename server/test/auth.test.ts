import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '../src/auth.js';

const secret = 'x'.repeat(32);

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    expect(verifySessionToken(createSessionToken(secret), secret)).toBe(true);
  });

  it('rejects tokens signed with another secret', () => {
    expect(verifySessionToken(createSessionToken('y'.repeat(32)), secret)).toBe(false);
  });

  it('rejects tampered and expired tokens', () => {
    const token = createSessionToken(secret, 0);
    expect(verifySessionToken(token, secret)).toBe(false);
    const [, sig] = createSessionToken(secret).split('.');
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() * 2 })).toString('base64url');
    expect(verifySessionToken(`${forged}.${sig}`, secret)).toBe(false);
    expect(verifySessionToken('garbage', secret)).toBe(false);
    expect(verifySessionToken(undefined, secret)).toBe(false);
  });
});
