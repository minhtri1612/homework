// Password hashing with scrypt from Node's built-in crypto module, so there is
// no native library to compile. Stored form: scrypt$N$r$p$salt$hash (base64).
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// util.promisify(scrypt) loses the overload that takes options, so its types are wrong.
function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(password).normalize('NFC'), salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(String(password).normalize('NFC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}
