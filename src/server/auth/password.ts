import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64
const SALT_LENGTH = 16
const PREFIX = 'scrypt'

/**
 * scrypt from node:crypto - a modern memory-hard KDF with no native
 * dependency, which keeps the Alpine Docker image simple.
 * Format: scrypt$<saltBase64>$<hashBase64>
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scrypt(plain.normalize('NFKC'), salt, KEY_LENGTH)
  return `${PREFIX}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== PREFIX) return false
  const salt = Buffer.from(parts[1]!, 'base64')
  const expected = Buffer.from(parts[2]!, 'base64')
  if (expected.length !== KEY_LENGTH) return false
  const derived = await scrypt(plain.normalize('NFKC'), salt, KEY_LENGTH)
  return timingSafeEqual(derived, expected)
}

/** Minimum policy. Deliberately simple: length beats character classes. */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = []
  if (plain.length < 10) problems.push('Must be at least 10 characters long.')
  if (plain.length > 200) problems.push('Must be no more than 200 characters long.')
  if (/^\s|\s$/.test(plain)) problems.push('Must not start or end with a space.')
  if (/^(.)\1+$/.test(plain)) problems.push('Must not be a single repeated character.')
  return problems
}
