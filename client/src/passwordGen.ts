// No 0/O, 1/l/I: easy to read out or type from a phone.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random password like "k7Hd-29xq-Pm4t-wB8e" (~94 bits). */
export function generatePassword(groups = 4, size = 4): string {
  const out: string[] = [];
  const bytes = new Uint32Array(groups * size);
  crypto.getRandomValues(bytes);
  for (let g = 0; g < groups; g++) {
    let part = '';
    for (let i = 0; i < size; i++) part += ALPHABET[bytes[g * size + i]! % ALPHABET.length];
    out.push(part);
  }
  return out.join('-');
}
