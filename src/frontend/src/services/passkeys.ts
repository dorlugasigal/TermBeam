import { postJson } from './api';

/**
 * Passkeys (WebAuthn) for TermBeam unlock.
 *
 * Only offered in secure contexts (the HTTPS tunnel origin or localhost).
 * Options/credentials travel as base64url JSON; we convert by hand instead of
 * PublicKeyCredential.parse*OptionsFromJSON so older Safari builds work too.
 */

const REGISTERED_KEY = 'termbeam-passkey-registered';
const PROMPT_SNOOZE_KEY = 'termbeam-passkey-prompt-snooze';
const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function b64urlToBuffer(value: string): ArrayBuffer {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufferToB64url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isPasskeyCapable(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function'
  );
}

/**
 * Whether this device has a built-in, user-verifying authenticator (Face ID,
 * Touch ID, Windows Hello, Android biometrics). Used to decide whether to
 * *offer* a passkey unprompted; Settings still allows phones / security keys.
 */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  if (!isPasskeyCapable()) return false;
  try {
    const check = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    return typeof check === 'function'
      ? (await check.call(window.PublicKeyCredential)) === true
      : false;
  } catch {
    return false;
  }
}

/** Whether this device has registered a passkey with this TermBeam origin. */
export function hasLocalPasskey(): boolean {
  try {
    return localStorage.getItem(`${REGISTERED_KEY}:${location.host}`) === '1';
  } catch {
    return false;
  }
}

function markLocalPasskey(): void {
  try {
    localStorage.setItem(`${REGISTERED_KEY}:${location.host}`, '1');
  } catch {
    // storage unavailable
  }
}

export function forgetLocalPasskey(): void {
  try {
    localStorage.removeItem(`${REGISTERED_KEY}:${location.host}`);
  } catch {
    // storage unavailable
  }
}

export function isPromptSnoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(`${PROMPT_SNOOZE_KEY}:${location.host}`) || 0);
    return Date.now() < until;
  } catch {
    return true;
  }
}

export function snoozePrompt(): void {
  try {
    localStorage.setItem(
      `${PROMPT_SNOOZE_KEY}:${location.host}`,
      String(Date.now() + PROMPT_SNOOZE_MS),
    );
  } catch {
    // storage unavailable
  }
}

/** User cancelled / dismissed the system sheet — not an error worth shouting about. */
export function isCancellation(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

interface CreationOptionsJSON {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: { type: 'public-key'; id: string; transports?: AuthenticatorTransport[] }[];
}

interface RequestOptionsJSON {
  challenge: string;
  rpId: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { type: 'public-key'; id: string; transports?: AuthenticatorTransport[] }[];
}

function defaultPasskeyName(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'This device';
  return device;
}

export async function registerPasskey(name?: string): Promise<{ id: string; name: string }> {
  const { publicKey } = await postJson<{ publicKey: CreationOptionsJSON }>(
    '/api/auth/passkeys/register/options',
    { origin: window.location.origin },
  );
  const options: PublicKeyCredentialCreationOptions = {
    ...publicKey,
    challenge: b64urlToBuffer(publicKey.challenge),
    user: { ...publicKey.user, id: b64urlToBuffer(publicKey.user.id) },
    excludeCredentials: (publicKey.excludeCredentials || []).map((c) => ({
      ...c,
      id: b64urlToBuffer(c.id),
    })),
  };
  const cred = (await navigator.credentials.create({ publicKey: options })) as PublicKeyCredential;
  const response = cred.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === 'function' ? response.getTransports() : undefined;
  const result = await postJson<{ passkey: { id: string; name: string } }>(
    '/api/auth/passkeys/register',
    {
      name: name || defaultPasskeyName(),
      credential: {
        id: cred.id,
        rawId: bufferToB64url(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufferToB64url(response.clientDataJSON),
          attestationObject: bufferToB64url(response.attestationObject),
          transports,
        },
      },
    },
  );
  markLocalPasskey();
  return result.passkey;
}

export async function unlockWithPasskey(remember = true): Promise<void> {
  const { publicKey } = await postJson<{ publicKey: RequestOptionsJSON }>(
    '/api/auth/passkeys/login/options',
    { origin: window.location.origin },
  );
  const options: PublicKeyCredentialRequestOptions = {
    ...publicKey,
    challenge: b64urlToBuffer(publicKey.challenge),
    allowCredentials: (publicKey.allowCredentials || []).map((c) => ({
      ...c,
      id: b64urlToBuffer(c.id),
    })),
  };
  const cred = (await navigator.credentials.get({ publicKey: options })) as PublicKeyCredential;
  const response = cred.response as AuthenticatorAssertionResponse;
  await postJson<{ ok: boolean }>('/api/auth/passkeys/login', {
    remember,
    credential: {
      id: cred.id,
      rawId: bufferToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufferToB64url(response.clientDataJSON),
        authenticatorData: bufferToB64url(response.authenticatorData),
        signature: bufferToB64url(response.signature),
        userHandle: response.userHandle ? bufferToB64url(response.userHandle) : undefined,
      },
    },
  });
  markLocalPasskey();
}
