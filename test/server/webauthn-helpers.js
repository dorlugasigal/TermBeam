'use strict';

/**
 * Test-only helpers (NOT a *.test.js file, so the runner never executes it):
 *   - a tiny CBOR encoder (enough for COSE keys, attestation objects and
 *     extension maps)
 *   - a software WebAuthn authenticator for ES256 (P-256), EdDSA (Ed25519)
 *     and RS256 (RSA-2048) that produces the exact PublicKeyCredential JSON
 *     the TermBeam frontend posts (see src/frontend/src/services/passkeys.ts)
 */
const crypto = require('crypto');

const ALG = { ES256: -7, EDDSA: -8, RS256: -257 };
const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };

// --- CBOR encoder -------------------------------------------------------------

function cborHead(major, n) {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 0x100) return Buffer.from([m | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = m | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  if (n < 0x100000000) {
    const b = Buffer.alloc(5);
    b[0] = m | 26;
    b.writeUInt32BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = m | 27;
  b.writeBigUInt64BE(BigInt(n), 1);
  return b;
}

/**
 * Encode ints, Buffers, strings, arrays, Maps / plain objects (as maps),
 * booleans, null, undefined and non-integer numbers (as float64).
 */
function cborEncode(value) {
  if (value === false) return Buffer.from([0xf4]);
  if (value === true) return Buffer.from([0xf5]);
  if (value === null) return Buffer.from([0xf6]);
  if (value === undefined) return Buffer.from([0xf7]);
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
    }
    const b = Buffer.alloc(9);
    b[0] = 0xfb;
    b.writeDoubleBE(value, 1);
    return b;
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (typeof value === 'string') {
    const s = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, s.length), s]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(cborEncode)]);
  }
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([
    cborHead(5, entries.length),
    ...entries.flatMap(([k, v]) => [cborEncode(k), cborEncode(v)]),
  ]);
}

// --- Crypto helpers -------------------------------------------------------------

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function generateKeyPair(alg) {
  if (alg === ALG.ES256) return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  if (alg === ALG.EDDSA) return crypto.generateKeyPairSync('ed25519');
  if (alg === ALG.RS256) return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  throw new Error(`test helper: unsupported alg ${alg}`);
}

/** COSE_Key map for a Node KeyObject, built from its JWK export. */
function coseKeyFor(alg, publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = (v) => Buffer.from(v, 'base64url');
  if (alg === ALG.ES256) {
    return new Map([
      [1, 2], // kty: EC2
      [3, alg],
      [-1, 1], // crv: P-256
      [-2, raw(jwk.x)],
      [-3, raw(jwk.y)],
    ]);
  }
  if (alg === ALG.EDDSA) {
    return new Map([
      [1, 1], // kty: OKP
      [3, alg],
      [-1, 6], // crv: Ed25519
      [-2, raw(jwk.x)],
    ]);
  }
  return new Map([
    [1, 3], // kty: RSA
    [3, alg],
    [-1, raw(jwk.n)],
    [-2, raw(jwk.e)],
  ]);
}

/** Sign like a real authenticator: ES256 signatures are DER (Node's default). */
function signWith(alg, privateKey, data) {
  if (alg === ALG.EDDSA) return crypto.sign(null, data, privateKey);
  return crypto.sign('sha256', data, privateKey);
}

function clientDataJSON({ type, challenge, origin, crossOrigin, extra = {} }) {
  const data = { type, challenge, origin };
  if (crossOrigin !== undefined) data.crossOrigin = crossOrigin;
  return Buffer.from(JSON.stringify({ ...data, ...extra }), 'utf8');
}

/** WebAuthn §6.1 authenticator data. */
function authenticatorData({
  rpId,
  rpIdHash,
  flags,
  signCount = 0,
  aaguid = Buffer.alloc(16),
  credentialId = null,
  coseKey = null,
  extensions,
  trailing,
}) {
  const head = Buffer.alloc(37);
  (rpIdHash || sha256(Buffer.from(rpId, 'utf8'))).copy(head, 0);
  head[32] = flags;
  head.writeUInt32BE(signCount, 33);
  const parts = [head];
  if (credentialId) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(credentialId.length, 0);
    parts.push(aaguid, len, credentialId, Buffer.isBuffer(coseKey) ? coseKey : cborEncode(coseKey));
  }
  if (extensions !== undefined) {
    parts.push(Buffer.isBuffer(extensions) ? extensions : cborEncode(extensions));
  }
  if (trailing) parts.push(trailing);
  return Buffer.concat(parts);
}

class SoftwareAuthenticator {
  constructor({ alg = ALG.ES256, credentialId, aaguid } = {}) {
    this.alg = alg;
    this.keyPair = generateKeyPair(alg);
    this.credentialId = credentialId || crypto.randomBytes(32);
    this.aaguid = aaguid || crypto.randomBytes(16);
    this.signCount = 0;
    this.userHandle = null;
  }

  get id() {
    return b64url(this.credentialId);
  }

  get coseKey() {
    return coseKeyFor(this.alg, this.keyPair.publicKey);
  }

  /** navigator.credentials.create() → JSON body posted to /passkeys/register. */
  register({
    challenge,
    origin,
    rpId,
    userHandle = null,
    type = 'webauthn.create',
    crossOrigin,
    clientData,
    flags = FLAGS.UP | FLAGS.UV | FLAGS.AT,
    signCount = 0,
    rpIdHash,
    coseKey,
    includeCredential,
    extensions,
    trailing,
    rawId,
    transports = ['internal', 'hybrid'],
    attestationObject,
  } = {}) {
    this.userHandle = userHandle;
    const cdj = clientData || clientDataJSON({ type, challenge, origin, crossOrigin });
    const withCredential =
      includeCredential === undefined ? !!(flags & FLAGS.AT) : includeCredential;
    const authData = authenticatorData({
      rpId,
      rpIdHash,
      flags,
      signCount,
      aaguid: this.aaguid,
      credentialId: withCredential ? this.credentialId : null,
      coseKey: coseKey || this.coseKey,
      extensions,
      trailing,
    });
    const att =
      attestationObject !== undefined
        ? attestationObject
        : b64url(
            cborEncode(
              new Map([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', authData],
              ]),
            ),
          );
    const id = rawId !== undefined ? rawId : this.id;
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(cdj),
        attestationObject: att,
        transports,
      },
    };
  }

  /** navigator.credentials.get() → JSON body posted to /passkeys/login. */
  assert({
    challenge,
    origin,
    rpId,
    type = 'webauthn.get',
    crossOrigin,
    flags = FLAGS.UP | FLAGS.UV,
    signCount,
    rpIdHash,
    extensions,
    trailing,
    userHandle = this.userHandle,
    signer,
    signature,
  } = {}) {
    const count = signCount === undefined ? ++this.signCount : signCount;
    const cdj = clientDataJSON({ type, challenge, origin, crossOrigin });
    const authData = authenticatorData({
      rpId,
      rpIdHash,
      flags,
      signCount: count,
      extensions,
      trailing,
    });
    const sig =
      signature !== undefined
        ? signature
        : signWith(
            this.alg,
            signer || this.keyPair.privateKey,
            Buffer.concat([authData, sha256(cdj)]),
          );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(cdj),
        authenticatorData: b64url(authData),
        signature: Buffer.isBuffer(sig) ? b64url(sig) : sig,
        userHandle: userHandle || undefined,
      },
    };
  }
}

module.exports = {
  ALG,
  FLAGS,
  cborEncode,
  b64url,
  sha256,
  generateKeyPair,
  coseKeyFor,
  signWith,
  clientDataJSON,
  authenticatorData,
  SoftwareAuthenticator,
};
