const HOST_RE = /^[A-Za-z0-9_\-.]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GPG_SIGNING_KEY_RE = /^[A-Z0-9]+$/;

/**
 * @throws {Error} If value contains characters other than letters, numbers, dash, dot, or underscore.
 */
export function validateProfileName(value: string) {
  if (!HOST_RE.test(value)) {
    throw new Error('Profile name must contain only letters, numbers, dash, dot, or underscore.');
  }
}

/**
 * @throws {Error} If value is empty or contains characters other than letters, numbers, dash, dot, or underscore.
 */
export function validateHost(value: string) {
  if (!HOST_RE.test(value)) {
    throw new Error('Host must contain only letters, numbers, dash, dot, or underscore.');
  }
}

/**
 * @throws {Error} If value is empty or only whitespace.
 */
export function validateUsername(value: string) {
  if (!value.trim()) {
    throw new Error('Name must not be blank.');
  }
}

/**
 * @throws {Error} If value is not a valid email address.
 */
export function validateEmail(value: string) {
  if (!EMAIL_RE.test(value)) {
    throw new Error('Must be a valid email address.');
  }
}

/**
 * @throws {Error} If value is present but contains characters other than uppercase letters and numbers.
 */
export function validateGpgSigningKey(value: string) {
  if (!GPG_SIGNING_KEY_RE.test(value)) {
    throw new Error('GPG Signing key must contain only uppercase letters and numbers.');
  }
}

/**
 * @throws {Error} If value is not present.
 */
export function validateSshSigningKey(value: string) {
  if (!value) {
    throw new Error('SSH Signing key must be specified.');
  }
}

/**
 * @throws {Error} If value is already a key in existing.
 */
export function validateUnique(existing: { name: string }[], name: string) {
  if (existing.some((p) => p.name === name)) {
    throw new Error(`Profile '${name}' already exists.`);
  }
}
