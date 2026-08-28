import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createPasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createEmailVerificationCode(): string {
  return String(randomInt(100000, 1000000));
}

export const createPhoneVerificationCode = createEmailVerificationCode;

export const PASSWORD_POLICY_MESSAGE =
  "كلمة المرور يجب أن تكون 8 أحرف على الأقل، وتحتوي على حرف كبير وحرف صغير ورقم ورمز خاص.";

export function validatePassword(password: string): string | null {
  if (password.length < 8) return PASSWORD_POLICY_MESSAGE;
  if (!/[A-Z]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/[a-z]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/[0-9]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  if (!/[^A-Za-z0-9\s]/.test(password)) return PASSWORD_POLICY_MESSAGE;
  return null;
}

export function normalizeSaudiPhone(value: string): string | null {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const easternArabicDigits = "۰۱۲۳۴۵۶۷۸۹";
  const normalizedDigits = value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(easternArabicDigits.indexOf(digit)))
    .replace(/[\s().-]/g, "");
  const international = normalizedDigits.startsWith("00")
    ? `+${normalizedDigits.slice(2)}`
    : normalizedDigits;
  if (/^05\d{8}$/.test(international)) return `+966${international.slice(1)}`;
  if (/^5\d{8}$/.test(international)) return `+966${international}`;
  if (/^\+9665\d{8}$/.test(international)) return international;
  if (/^\+[1-9]\d{7,14}$/.test(international)) return international;
  return null;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function hashEmailVerificationCode(code: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to protect email verification codes.");
  return createHmac("sha256", secret).update(`email-verification:${code}`).digest("hex");
}

export function hashPhoneVerificationCode(code: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to protect phone verification codes.");
  return createHmac("sha256", secret).update(`phone-verification:${code}`).digest("hex");
}

function verifyHash(actualHash: string, expectedHash: string): boolean {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyCodeHash(code: string, expectedHash: string): boolean {
  return verifyHash(hashEmailVerificationCode(code), expectedHash);
}

export function verifyPhoneCodeHash(code: string, expectedHash: string): boolean {
  return verifyHash(hashPhoneVerificationCode(code), expectedHash);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}