import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function validUsername(value) { return typeof value === 'string' && /^[a-z0-9._-]{3,32}$/.test(value); }
export function validPassword(value) { return typeof value === 'string' && value.length >= 10 && value.length <= 128 && /\p{L}/u.test(value); }
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('invalid_password');
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  try {
    const [kind, n, r, p, saltHex, keyHex] = String(stored).split('$');
    if (kind !== 'scrypt' || Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p || !/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{64}$/.test(keyHex)) return false;
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), 32, PARAMS);
    return timingSafeEqual(actual, Buffer.from(keyHex, 'hex'));
  } catch { return false; }
}
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export const ALLOWED_PERMISSIONS = ['order', 'queue', 'stock', 'report'];
export function normalizePermissions(input) { return Object.fromEntries(ALLOWED_PERMISSIONS.map(key => [key, input?.[key] === true])); }
export function mayView(user, view) { return user?.active && (user.role === 'admin' || ALLOWED_PERMISSIONS.includes(view) && user.permissions?.[view] === true); }
