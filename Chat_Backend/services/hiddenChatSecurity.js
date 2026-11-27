import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export const isValidHiddenChatPin = pin => typeof pin === 'string' && /^\d{4}$/.test(pin);

export const hashHiddenChatPin = async pin => {
  if (!isValidHiddenChatPin(pin)) {
    throw Object.assign(new Error('Mã khóa phải gồm 4 chữ số'), {status: 400});
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(pin, salt, KEY_LENGTH);
  return `v1$${salt}$${derived.toString('hex')}`;
};

export const verifyHiddenChatPin = async (pin, encodedHash) => {
  if (!isValidHiddenChatPin(pin) || typeof encodedHash !== 'string') return false;
  const [version, salt, hashHex] = encodedHash.split('$');
  if (version !== 'v1' || !salt || !/^[a-f0-9]{128}$/i.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(pin, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
