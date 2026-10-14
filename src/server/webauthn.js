/**
 * WebAuthn (passkey) relying-party helpers — dependency-free.
 *
 * Implements exactly what TermBeam needs:
 *   - registration ("attestation: none"): parse the attestation object,
 *     extract the credential id + COSE public key, convert it to a JWK
 *   - authentication: verify the assertion signature over
 *     authenticatorData || SHA-256(clientDataJSON)
 *
 * We intentionally do not verify attestation statements: registration is
 * only reachable from an already-authenticated session (trust on first use),
 * which is the standard model for consumer passkeys.
 *
 * Spec: https://www.w3.org/TR/webauthn-3/
 */
const crypto = require('crypto');
const cbor = require('./cbor');

const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified
const FLAG_BE = 0x08; // backup eligible
const FLAG_BS = 0x10; // backed up (synced passkey)
const FLAG_AT = 0x40; // attested credential data included
const FLAG_ED = 0x80; // extension data included

// COSE algorithm identifiers we accept, in preference order.
const COSE_ALG_ES256 = -7;
const COSE_ALG_EDDSA = -8;
const COSE_ALG_RS256 = -257;
const SUPPORTED_ALGS = [COSE_ALG_ES256, COSE_ALG_EDDSA, COSE_ALG_RS256];

const KNOWN_TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card']);

class WebAuthnError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WebAuthnError';
  }
}

function b64urlToBuffer(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16384) {
    throw new WebAuthnError(`invalid ${field}`);
  }
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new WebAuthnError(`invalid ${field}`);
  return Buffer.from(value, 'base64url');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

/**
 * Parse authenticator data (WebAuthn §6.1).
 * @returns {{ rpIdHash: Buffer, flags: number, signCount: number,
 *   aaguid?: Buffer, credentialId?: Buffer, credentialPublicKey?: Map }}
 */
function parseAuthenticatorData(authData) {
  if (!Buffer.isBuffer(authData) || authData.length < 37) {
    throw new WebAuthnError('authenticator data too short');
  }
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);
  const out = { rpIdHash, flags, signCount };
  let offset = 37;

  if (flags & FLAG_AT) {
    if (authData.length < offset + 18) throw new WebAuthnError('attested data truncated');
    out.aaguid = authData.subarray(offset, offset + 16);
    offset += 16;
    const credIdLen = authData.readUInt16BE(offset);
    offset += 2;
    if (credIdLen === 0 || credIdLen > 1023) throw new WebAuthnError('invalid credential id');
    if (authData.length < offset + credIdLen) throw new WebAuthnError('credential id truncated');
    out.credentialId = authData.subarray(offset, offset + credIdLen);
    offset += credIdLen;
    let decoded;
    try {
      decoded = cbor.decodeFirst(authData, offset);
    } catch (err) {
      throw new WebAuthnError(`invalid credential public key: ${err.message}`);
    }
    if (!(decoded.value instanceof Map)) throw new WebAuthnError('credential key is not a map');
    out.credentialPublicKey = decoded.value;
    offset = decoded.offset;
  }

  if (flags & FLAG_ED) {
    try {
      offset = cbor.decodeFirst(authData, offset).offset;
    } catch (err) {
      throw new WebAuthnError(`invalid extension data: ${err.message}`);
    }
  }

  if (offset !== authData.length) throw new WebAuthnError('trailing authenticator data');
  return out;
}

/** Convert a COSE_Key map to `{ jwk, alg }`, validating it can be imported. */
function coseToJwk(coseKey) {
  if (!(coseKey instanceof Map)) throw new WebAuthnError('COSE key must be a map');
  const kty = coseKey.get(1);
  const alg = coseKey.get(3);
  if (!SUPPORTED_ALGS.includes(alg)) throw new WebAuthnError(`unsupported algorithm ${alg}`);

  let jwk;
  if (kty === 2 && alg === COSE_ALG_ES256) {
    const crv = coseKey.get(-1);
    const x = coseKey.get(-2);
    const y = coseKey.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
      throw new WebAuthnError('invalid EC2 key');
    }
    if (x.length !== 32 || y.length !== 32) throw new WebAuthnError('invalid P-256 coordinates');
    jwk = { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') };
  } else if (kty === 1 && alg === COSE_ALG_EDDSA) {
    const crv = coseKey.get(-1);
    const x = coseKey.get(-2);
    if (crv !== 6 || !Buffer.isBuffer(x) || x.length !== 32) {
      throw new WebAuthnError('invalid OKP key');
    }
    jwk = { kty: 'OKP', crv: 'Ed25519', x: x.toString('base64url') };
  } else if (kty === 3 && alg === COSE_ALG_RS256) {
    const n = coseKey.get(-1);
    const e = coseKey.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) {
      throw new WebAuthnError('invalid RSA key');
    }
    jwk = { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') };
  } else {
    throw new WebAuthnError(`unsupported key type ${kty}/${alg}`);
  }

  try {
    crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (err) {
    throw new WebAuthnError(`public key rejected: ${err.message}`);
  }
  return { jwk, alg };
}

function verifySignature({ jwk, alg }, data, signature) {
  let key;
  try {
    key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return false;
  }
  try {
    if (alg === COSE_ALG_ES256) {
      return crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
    }
    if (alg === COSE_ALG_RS256) return crypto.verify('sha256', data, key, signature);
    if (alg === COSE_ALG_EDDSA) return crypto.verify(null, data, key, signature);
  } catch {
    return false;
  }
  return false;
}

function parseClientData(clientDataB64) {
  const raw = b64urlToBuffer(clientDataB64, 'clientDataJSON');
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebAuthnError('clientDataJSON is not JSON');
  }
  if (!data || typeof data !== 'object') throw new WebAuthnError('invalid clientDataJSON');
  return { raw, data };
}

function checkClientData(data, { type, challenge, isOriginAllowed }) {
  if (data.type !== type) throw new WebAuthnError('unexpected ceremony type');
  if (typeof data.challenge !== 'string' || data.challenge !== challenge) {
    throw new WebAuthnError('challenge mismatch');
  }
  if (typeof data.origin !== 'string' || !isOriginAllowed(data.origin)) {
    throw new WebAuthnError('origin not allowed');
  }
  if (data.crossOrigin === true) throw new WebAuthnError('cross-origin ceremony not allowed');
}

function checkAuthData(parsed, rpId, { requireUserVerification = true } = {}) {
  if (!crypto.timingSafeEqual(parsed.rpIdHash, sha256(Buffer.from(rpId, 'utf8')))) {
    throw new WebAuthnError('rpId hash mismatch');
  }
  if (!(parsed.flags & FLAG_UP)) throw new WebAuthnError('user presence required');
  if (requireUserVerification && !(parsed.flags & FLAG_UV)) {
    throw new WebAuthnError('user verification required');
  }
}

/**
 * Verify a registration response. Returns the credential record to persist.
 * @param {object} credential - PublicKeyCredential JSON from the browser
 * @param {{ challenge: string, rpId: string, isOriginAllowed: (o: string) => boolean }} expected
 */
function verifyRegistration(credential, expected) {
  if (!credential || typeof credential !== 'object' || credential.type !== 'public-key') {
    throw new WebAuthnError('invalid credential');
  }
  const response = credential.response || {};
  const { data: clientData } = parseClientData(response.clientDataJSON);
  checkClientData(clientData, {
    type: 'webauthn.create',
    challenge: expected.challenge,
    isOriginAllowed: expected.isOriginAllowed,
  });

  let attestation;
  try {
    attestation = cbor.decode(b64urlToBuffer(response.attestationObject, 'attestationObject'));
  } catch (err) {
    if (err instanceof WebAuthnError) throw err;
    throw new WebAuthnError(`invalid attestation object: ${err.message}`);
  }
  if (!(attestation instanceof Map) || !Buffer.isBuffer(attestation.get('authData'))) {
    throw new WebAuthnError('attestation object missing authData');
  }

  const authData = parseAuthenticatorData(attestation.get('authData'));
  checkAuthData(authData, expected.rpId);
  if (!(authData.flags & FLAG_AT) || !authData.credentialId || !authData.credentialPublicKey) {
    throw new WebAuthnError('no attested credential data');
  }

  const credentialId = authData.credentialId.toString('base64url');
  const rawId = b64urlToBuffer(credential.rawId || credential.id, 'rawId').toString('base64url');
  if (rawId !== credentialId) throw new WebAuthnError('credential id mismatch');

  const { jwk, alg } = coseToJwk(authData.credentialPublicKey);
  const transports = Array.isArray(response.transports)
    ? response.transports.filter((t) => KNOWN_TRANSPORTS.has(t)).slice(0, 6)
    : [];

  return {
    id: credentialId,
    publicKey: jwk,
    alg,
    signCount: authData.signCount,
    rpId: expected.rpId,
    transports,
    backupEligible: !!(authData.flags & FLAG_BE),
    backedUp: !!(authData.flags & FLAG_BS),
    aaguid: authData.aaguid ? authData.aaguid.toString('hex') : null,
  };
}

/**
 * Verify an authentication assertion against a stored credential.
 * Returns the new signature counter.
 */
function verifyAuthentication(credential, stored, expected) {
  if (!credential || typeof credential !== 'object' || credential.type !== 'public-key') {
    throw new WebAuthnError('invalid credential');
  }
  const response = credential.response || {};
  const { raw: clientDataRaw, data: clientData } = parseClientData(response.clientDataJSON);
  checkClientData(clientData, {
    type: 'webauthn.get',
    challenge: expected.challenge,
    isOriginAllowed: expected.isOriginAllowed,
  });

  const authDataRaw = b64urlToBuffer(response.authenticatorData, 'authenticatorData');
  const authData = parseAuthenticatorData(authDataRaw);
  checkAuthData(authData, stored.rpId);

  const signature = b64urlToBuffer(response.signature, 'signature');
  const signedData = Buffer.concat([authDataRaw, sha256(clientDataRaw)]);
  if (!verifySignature({ jwk: stored.publicKey, alg: stored.alg }, signedData, signature)) {
    throw new WebAuthnError('signature verification failed');
  }

  // Signature counter: synced passkeys always report 0. A non-zero counter
  // that fails to increase indicates a possibly cloned authenticator.
  const prev = stored.signCount || 0;
  if ((authData.signCount !== 0 || prev !== 0) && authData.signCount <= prev) {
    throw new WebAuthnError('signature counter did not increase');
  }
  return { signCount: authData.signCount, backedUp: !!(authData.flags & FLAG_BS) };
}

/** Read the (unverified) challenge from a credential so the RP can look it up. */
function peekChallenge(credential) {
  try {
    const { data } = parseClientData(
      credential && credential.response && credential.response.clientDataJSON,
    );
    return typeof data.challenge === 'string' && data.challenge.length <= 256
      ? data.challenge
      : null;
  } catch {
    return null;
  }
}

module.exports = {
  WebAuthnError,
  SUPPORTED_ALGS,
  parseAuthenticatorData,
  coseToJwk,
  verifySignature,
  verifyRegistration,
  verifyAuthentication,
  peekChallenge,
  sha256,
  flags: { FLAG_UP, FLAG_UV, FLAG_BE, FLAG_BS, FLAG_AT, FLAG_ED },
};
