'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const webauthn = require('../../src/server/webauthn');
const {
  ALG,
  FLAGS,
  SoftwareAuthenticator,
  cborEncode,
  b64url,
  sha256,
  authenticatorData,
  clientDataJSON,
} = require('./webauthn-helpers');

const RP_ID = 'termbeam.example';
const ORIGIN = 'https://termbeam.example';
const isOriginAllowed = (o) => o === ORIGIN;
const newChallenge = () => crypto.randomBytes(32).toString('base64url');

function expectWebAuthnError(fn, pattern) {
  assert.throws(fn, (err) => {
    assert.ok(
      err instanceof webauthn.WebAuthnError,
      `expected WebAuthnError, got ${err && err.stack}`,
    );
    assert.equal(err.name, 'WebAuthnError');
    assert.match(err.message, pattern);
    return true;
  });
}

/** Run a registration ceremony; `cred` overrides the authenticator, `exp` the RP side. */
function register(authr, cred = {}, exp = {}) {
  const challenge = newChallenge();
  const credential = authr.register({ challenge, origin: ORIGIN, rpId: RP_ID, ...cred });
  return webauthn.verifyRegistration(credential, {
    challenge,
    rpId: RP_ID,
    isOriginAllowed,
    ...exp,
  });
}

/** Run an authentication ceremony against a stored credential record. */
function authenticate(authr, stored, cred = {}, exp = {}) {
  const challenge = newChallenge();
  const credential = authr.assert({ challenge, origin: ORIGIN, rpId: RP_ID, ...cred });
  return webauthn.verifyAuthentication(credential, stored, {
    challenge,
    isOriginAllowed,
    ...exp,
  });
}

/** Raw authenticator data with hand-built attested credential data. */
function rawAttestedAuthData({ credIdLen, credId = Buffer.alloc(0), rest = Buffer.alloc(0) }) {
  const head = authenticatorData({ rpId: RP_ID, flags: FLAGS.UP | FLAGS.UV | FLAGS.AT });
  const len = Buffer.alloc(2);
  len.writeUInt16BE(credIdLen, 0);
  return Buffer.concat([head, Buffer.alloc(16), len, credId, rest]);
}

function attestationWith(authData) {
  return b64url(
    cborEncode(
      new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    ),
  );
}

describe('webauthn', () => {
  const authenticators = {};

  before(() => {
    authenticators.ES256 = new SoftwareAuthenticator({ alg: ALG.ES256 });
    authenticators.EdDSA = new SoftwareAuthenticator({ alg: ALG.EDDSA });
    authenticators.RS256 = new SoftwareAuthenticator({ alg: ALG.RS256 });
  });

  describe('module surface', () => {
    it('exposes the supported COSE algorithms in preference order', () => {
      assert.deepEqual(webauthn.SUPPORTED_ALGS, [-7, -8, -257]);
    });

    it('exposes the authenticator data flag bits', () => {
      assert.deepEqual(webauthn.flags, {
        FLAG_UP: 0x01,
        FLAG_UV: 0x04,
        FLAG_BE: 0x08,
        FLAG_BS: 0x10,
        FLAG_AT: 0x40,
        FLAG_ED: 0x80,
      });
    });

    it('sha256 matches node:crypto', () => {
      assert.ok(webauthn.sha256(Buffer.from('abc')).equals(sha256(Buffer.from('abc'))));
    });
  });

  for (const [name, alg, kty] of [
    ['ES256', ALG.ES256, 'EC'],
    ['EdDSA', ALG.EDDSA, 'OKP'],
    ['RS256', ALG.RS256, 'RSA'],
  ]) {
    describe(`${name} round trip`, () => {
      let record;

      it('verifyRegistration returns a JSON-serialisable credential record', () => {
        const authr = authenticators[name];
        record = register(authr);
        assert.equal(record.id, authr.id);
        assert.equal(record.alg, alg);
        assert.equal(record.rpId, RP_ID);
        assert.equal(record.signCount, 0);
        assert.deepEqual(record.transports, ['internal', 'hybrid']);
        assert.equal(record.backupEligible, false);
        assert.equal(record.backedUp, false);
        assert.equal(record.aaguid, authr.aaguid.toString('hex'));
        assert.equal(record.publicKey.kty, kty);

        const expectedJwk = authr.keyPair.publicKey.export({ format: 'jwk' });
        for (const field of Object.keys(record.publicKey)) {
          assert.equal(record.publicKey[field], expectedJwk[field], `jwk.${field}`);
        }
        // Persisted to auth.json, so it must survive a JSON round trip.
        assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
        assert.ok(crypto.createPublicKey({ key: record.publicKey, format: 'jwk' }));
      });

      it('verifyAuthentication accepts a valid assertion and returns the new counter', () => {
        const authr = authenticators[name];
        const stored = { ...JSON.parse(JSON.stringify(record)) };
        const first = authenticate(authr, stored);
        assert.equal(first.signCount, authr.signCount);
        assert.equal(first.backedUp, false);
        stored.signCount = first.signCount;
        const second = authenticate(authr, stored);
        assert.equal(second.signCount, first.signCount + 1);
      });

      it('rejects an assertion signed by a different key', () => {
        const authr = authenticators[name];
        const other = new SoftwareAuthenticator({ alg });
        expectWebAuthnError(
          () => authenticate(authr, { ...record }, { signer: other.keyPair.privateKey }),
          /signature verification failed/,
        );
      });

      it('rejects a tampered signature', () => {
        const authr = authenticators[name];
        const challenge = newChallenge();
        const cred = authr.assert({ challenge, origin: ORIGIN, rpId: RP_ID });
        const sig = Buffer.from(cred.response.signature, 'base64url');
        sig[sig.length - 1] ^= 0x01;
        cred.response.signature = b64url(sig);
        expectWebAuthnError(
          () => webauthn.verifyAuthentication(cred, { ...record }, { challenge, isOriginAllowed }),
          /signature verification failed/,
        );
      });
    });
  }

  describe('ES256 signature encoding', () => {
    it('the software authenticator emits DER (ASN.1 SEQUENCE) signatures like browsers', () => {
      const authr = authenticators.ES256;
      const cred = authr.assert({ challenge: newChallenge(), origin: ORIGIN, rpId: RP_ID });
      assert.equal(Buffer.from(cred.response.signature, 'base64url')[0], 0x30);
    });

    it('rejects raw IEEE-P1363 (r||s) ES256 signatures', () => {
      const authr = new SoftwareAuthenticator({ alg: ALG.ES256 });
      const record = register(authr);
      const challenge = newChallenge();
      const cdj = clientDataJSON({ type: 'webauthn.get', challenge, origin: ORIGIN });
      const authData = authenticatorData({
        rpId: RP_ID,
        flags: FLAGS.UP | FLAGS.UV,
        signCount: 1,
      });
      const p1363 = crypto.sign('sha256', Buffer.concat([authData, sha256(cdj)]), {
        key: authr.keyPair.privateKey,
        dsaEncoding: 'ieee-p1363',
      });
      assert.equal(p1363.length, 64);
      const cred = authr.assert({ challenge, origin: ORIGIN, rpId: RP_ID, signCount: 1 });
      cred.response.signature = b64url(p1363);
      expectWebAuthnError(
        () => webauthn.verifyAuthentication(cred, record, { challenge, isOriginAllowed }),
        /signature verification failed/,
      );
    });
  });

  describe('verifyRegistration — rejections', () => {
    let authr;
    before(() => {
      authr = new SoftwareAuthenticator({ alg: ALG.ES256 });
    });

    it('rejects non-credentials', () => {
      const ok = authr.register({ challenge: 'c', origin: ORIGIN, rpId: RP_ID });
      for (const bad of [null, undefined, 'x', {}, { ...ok, type: 'password' }]) {
        expectWebAuthnError(
          () => webauthn.verifyRegistration(bad, { challenge: 'c', rpId: RP_ID, isOriginAllowed }),
          /invalid credential/,
        );
      }
    });

    it('rejects the wrong ceremony type', () => {
      expectWebAuthnError(
        () => register(authr, { type: 'webauthn.get' }),
        /unexpected ceremony type/,
      );
    });

    it('rejects a challenge mismatch', () => {
      expectWebAuthnError(
        () => register(authr, {}, { challenge: newChallenge() }),
        /challenge mismatch/,
      );
    });

    it('rejects a non-string challenge in clientDataJSON', () => {
      const clientData = Buffer.from(
        JSON.stringify({ type: 'webauthn.create', challenge: 42, origin: ORIGIN }),
      );
      expectWebAuthnError(
        () =>
          webauthn.verifyRegistration(authr.register({ clientData, rpId: RP_ID }), {
            challenge: '42',
            rpId: RP_ID,
            isOriginAllowed,
          }),
        /challenge mismatch/,
      );
    });

    it('rejects a disallowed origin', () => {
      expectWebAuthnError(
        () => register(authr, { origin: 'https://evil.example' }),
        /origin not allowed/,
      );
    });

    it('rejects a missing origin', () => {
      const challenge = newChallenge();
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge }));
      expectWebAuthnError(
        () =>
          webauthn.verifyRegistration(authr.register({ clientData, rpId: RP_ID }), {
            challenge,
            rpId: RP_ID,
            isOriginAllowed: () => true,
          }),
        /origin not allowed/,
      );
    });

    it('rejects crossOrigin: true but accepts crossOrigin: false', () => {
      expectWebAuthnError(
        () => register(authr, { crossOrigin: true }),
        /cross-origin ceremony not allowed/,
      );
      assert.equal(register(authr, { crossOrigin: false }).id, authr.id);
    });

    it('rejects an rpIdHash for a different RP', () => {
      expectWebAuthnError(
        () => register(authr, { rpIdHash: sha256(Buffer.from('evil.example')) }),
        /rpId hash mismatch/,
      );
      expectWebAuthnError(
        () => register(authr, {}, { rpId: 'other.example' }),
        /rpId hash mismatch/,
      );
    });

    it('requires user presence (UP)', () => {
      expectWebAuthnError(
        () => register(authr, { flags: FLAGS.UV | FLAGS.AT }),
        /user presence required/,
      );
    });

    it('requires user verification (UV)', () => {
      expectWebAuthnError(
        () => register(authr, { flags: FLAGS.UP | FLAGS.AT }),
        /user verification required/,
      );
    });

    it('requires attested credential data (AT)', () => {
      expectWebAuthnError(
        () => register(authr, { flags: FLAGS.UP | FLAGS.UV }),
        /no attested credential data/,
      );
    });

    it('rejects a rawId that does not match the attested credential id', () => {
      expectWebAuthnError(
        () => register(authr, { rawId: b64url(crypto.randomBytes(32)) }),
        /credential id mismatch/,
      );
    });

    it('falls back to credential.id when rawId is absent', () => {
      const challenge = newChallenge();
      const cred = authr.register({ challenge, origin: ORIGIN, rpId: RP_ID });
      delete cred.rawId;
      const record = webauthn.verifyRegistration(cred, { challenge, rpId: RP_ID, isOriginAllowed });
      assert.equal(record.id, authr.id);

      const mismatch = authr.register({ challenge, origin: ORIGIN, rpId: RP_ID });
      delete mismatch.rawId;
      mismatch.id = b64url(crypto.randomBytes(32));
      expectWebAuthnError(
        () => webauthn.verifyRegistration(mismatch, { challenge, rpId: RP_ID, isOriginAllowed }),
        /credential id mismatch/,
      );
    });

    it('rejects unsupported COSE algorithms', () => {
      const es384 = new Map(authr.coseKey);
      es384.set(3, -35);
      expectWebAuthnError(() => register(authr, { coseKey: es384 }), /unsupported algorithm -35/);
      const noAlg = new Map(authr.coseKey);
      noAlg.delete(3);
      expectWebAuthnError(() => register(authr, { coseKey: noAlg }), /unsupported algorithm/);
    });

    it('rejects key type / algorithm combinations that do not match', () => {
      const cases = [
        [2, -8],
        [1, -7],
        [3, -7],
        [4, -257],
      ];
      for (const [kty, alg] of cases) {
        const key = new Map(authr.coseKey);
        key.set(1, kty);
        key.set(3, alg);
        expectWebAuthnError(
          () => register(authr, { coseKey: key }),
          new RegExp(`unsupported key type ${kty}/${alg}`),
        );
      }
    });

    it('rejects invalid P-256 coordinates', () => {
      const shortX = new Map(authr.coseKey);
      shortX.set(-2, Buffer.alloc(31, 1));
      expectWebAuthnError(() => register(authr, { coseKey: shortX }), /invalid P-256 coordinates/);
      const longY = new Map(authr.coseKey);
      longY.set(-3, Buffer.alloc(33, 1));
      expectWebAuthnError(() => register(authr, { coseKey: longY }), /invalid P-256 coordinates/);
    });

    it('rejects EC2 keys on another curve or with non-bytes coordinates', () => {
      const p384 = new Map(authr.coseKey);
      p384.set(-1, 2);
      expectWebAuthnError(() => register(authr, { coseKey: p384 }), /invalid EC2 key/);
      const textX = new Map(authr.coseKey);
      textX.set(-2, 'x'.repeat(32));
      expectWebAuthnError(() => register(authr, { coseKey: textX }), /invalid EC2 key/);
    });

    it('rejects a P-256 point that is not on the curve', () => {
      const offCurve = new Map(authr.coseKey);
      offCurve.set(-2, Buffer.alloc(32, 0x01));
      offCurve.set(-3, Buffer.alloc(32, 0x02));
      expectWebAuthnError(() => register(authr, { coseKey: offCurve }), /public key rejected/);
    });

    it('rejects malformed OKP and RSA keys', () => {
      const ed = authenticators.EdDSA;
      const x25519 = new Map(ed.coseKey);
      x25519.set(-1, 4);
      expectWebAuthnError(() => register(ed, { coseKey: x25519 }), /invalid OKP key/);
      const shortEd = new Map(ed.coseKey);
      shortEd.set(-2, Buffer.alloc(31));
      expectWebAuthnError(() => register(ed, { coseKey: shortEd }), /invalid OKP key/);

      const rsa = authenticators.RS256;
      const weak = new Map(rsa.coseKey);
      weak.set(-1, Buffer.alloc(128, 0xff)); // RSA-1024 modulus
      expectWebAuthnError(() => register(rsa, { coseKey: weak }), /invalid RSA key/);
      const noE = new Map(rsa.coseKey);
      noE.set(-2, 65537);
      expectWebAuthnError(() => register(rsa, { coseKey: noE }), /invalid RSA key/);
    });

    it('rejects malformed base64url fields', () => {
      const challenge = newChallenge();
      const exp = { challenge, rpId: RP_ID, isOriginAllowed };
      const good = () => authr.register({ challenge, origin: ORIGIN, rpId: RP_ID });

      for (const bad of ['', 'abc+def', 'abc/def', 'a b', 'abc===', 42, null, 'A'.repeat(16385)]) {
        const cred = good();
        cred.response.clientDataJSON = bad;
        expectWebAuthnError(() => webauthn.verifyRegistration(cred, exp), /invalid clientDataJSON/);
      }

      const badAtt = good();
      badAtt.response.attestationObject = 'not*base64';
      expectWebAuthnError(
        () => webauthn.verifyRegistration(badAtt, exp),
        /invalid attestationObject/,
      );

      const badRaw = good();
      badRaw.rawId = 'bad id!';
      expectWebAuthnError(() => webauthn.verifyRegistration(badRaw, exp), /invalid rawId/);

      const noResponse = good();
      delete noResponse.response;
      expectWebAuthnError(
        () => webauthn.verifyRegistration(noResponse, exp),
        /invalid clientDataJSON/,
      );
    });

    it('rejects clientDataJSON that is not a JSON object', () => {
      for (const [raw, pattern] of [
        ['not json', /clientDataJSON is not JSON/],
        ['null', /invalid clientDataJSON/],
        ['42', /invalid clientDataJSON/],
      ]) {
        expectWebAuthnError(
          () =>
            webauthn.verifyRegistration(
              authr.register({ clientData: Buffer.from(raw), rpId: RP_ID }),
              {
                challenge: 'c',
                rpId: RP_ID,
                isOriginAllowed,
              },
            ),
          pattern,
        );
      }
    });

    it('rejects invalid or incomplete attestation objects', () => {
      const cases = [
        [b64url(Buffer.from([0xff])), /invalid attestation object: unsupported simple value 31/],
        [b64url(Buffer.from([0xa0, 0x00])), /invalid attestation object: trailing bytes/],
        [b64url(cborEncode([1, 2])), /attestation object missing authData/],
        [b64url(cborEncode(new Map([['fmt', 'none']]))), /attestation object missing authData/],
        [
          b64url(cborEncode(new Map([['authData', 'text']]))),
          /attestation object missing authData/,
        ],
      ];
      for (const [attestationObject, pattern] of cases) {
        expectWebAuthnError(() => register(authr, { attestationObject }), pattern);
      }
    });

    it('rejects trailing bytes after the attested credential data', () => {
      expectWebAuthnError(
        () => register(authr, { trailing: Buffer.from([0x00]) }),
        /trailing authenticator data/,
      );
    });

    it('rejects truncated / malformed attested credential data', () => {
      const shortAuthData = attestationWith(Buffer.alloc(36));
      expectWebAuthnError(
        () => register(authr, { attestationObject: shortAuthData }),
        /authenticator data too short/,
      );
      expectWebAuthnError(
        () => register(authr, { includeCredential: false }),
        /attested data truncated/,
      );
      expectWebAuthnError(
        () =>
          register(authr, {
            attestationObject: attestationWith(rawAttestedAuthData({ credIdLen: 0 })),
          }),
        /invalid credential id/,
      );
      expectWebAuthnError(
        () =>
          register(authr, {
            attestationObject: attestationWith(
              rawAttestedAuthData({ credIdLen: 1024, credId: Buffer.alloc(1024) }),
            ),
          }),
        /invalid credential id/,
      );
      expectWebAuthnError(
        () =>
          register(authr, {
            attestationObject: attestationWith(
              rawAttestedAuthData({ credIdLen: 100, credId: Buffer.alloc(10) }),
            ),
          }),
        /credential id truncated/,
      );
    });

    it('rejects a credential public key that is not a valid CBOR map', () => {
      expectWebAuthnError(
        () => register(authr, { coseKey: cborEncode([1, 2]) }),
        /credential key is not a map/,
      );
      expectWebAuthnError(
        () => register(authr, { coseKey: Buffer.from([0xff]) }),
        /invalid credential public key: unsupported simple value 31/,
      );
      expectWebAuthnError(
        () => register(authr, { coseKey: Buffer.from([0xa5, 0x01]) }),
        /invalid credential public key: unexpected end of input/,
      );
    });

    it('parses extension data when the ED flag is set', () => {
      const flags = FLAGS.UP | FLAGS.UV | FLAGS.AT | FLAGS.ED;
      const record = register(authr, {
        flags,
        extensions: new Map([
          ['credProtect', 2],
          ['hmac-secret', true],
        ]),
      });
      assert.equal(record.id, authr.id);
      expectWebAuthnError(
        () => register(authr, { flags }),
        /invalid extension data: unexpected end/,
      );
      expectWebAuthnError(
        () => register(authr, { flags, extensions: Buffer.from([0xff]) }),
        /invalid extension data/,
      );
      // Extension bytes without the ED flag are just trailing garbage
      expectWebAuthnError(
        () => register(authr, { extensions: new Map([['credProtect', 2]]) }),
        /trailing authenticator data/,
      );
    });

    it('keeps only known transports (max 6) and tolerates a missing list', () => {
      assert.deepEqual(
        register(authr, { transports: ['usb', 'bogus', 'internal', 42, 'hybrid'] }).transports,
        ['usb', 'internal', 'hybrid'],
      );
      assert.deepEqual(register(authr, { transports: 'usb' }).transports, []);
      assert.equal(register(authr, { transports: Array(10).fill('usb') }).transports.length, 6);

      const challenge = newChallenge();
      const cred = authr.register({ challenge, origin: ORIGIN, rpId: RP_ID });
      delete cred.response.transports;
      assert.deepEqual(
        webauthn.verifyRegistration(cred, { challenge, rpId: RP_ID, isOriginAllowed }).transports,
        [],
      );
    });

    it('records backup state and the initial signature counter', () => {
      const record = register(authr, {
        flags: FLAGS.UP | FLAGS.UV | FLAGS.AT | FLAGS.BE | FLAGS.BS,
        signCount: 7,
      });
      assert.equal(record.backupEligible, true);
      assert.equal(record.backedUp, true);
      assert.equal(record.signCount, 7);
    });
  });

  describe('verifyAuthentication — rejections', () => {
    let authr;
    let stored;

    before(() => {
      authr = new SoftwareAuthenticator({ alg: ALG.ES256 });
      stored = register(authr);
    });

    it('rejects non-credentials', () => {
      for (const bad of [null, {}, { type: 'public-key-ish' }]) {
        expectWebAuthnError(
          () => webauthn.verifyAuthentication(bad, stored, { challenge: 'c', isOriginAllowed }),
          /invalid credential/,
        );
      }
    });

    it('rejects the wrong ceremony type', () => {
      expectWebAuthnError(
        () => authenticate(authr, stored, { type: 'webauthn.create' }),
        /unexpected ceremony type/,
      );
    });

    it('rejects a challenge mismatch', () => {
      expectWebAuthnError(
        () => authenticate(authr, stored, {}, { challenge: newChallenge() }),
        /challenge mismatch/,
      );
    });

    it('rejects a disallowed origin and cross-origin ceremonies', () => {
      expectWebAuthnError(
        () => authenticate(authr, stored, { origin: 'http://termbeam.example' }),
        /origin not allowed/,
      );
      expectWebAuthnError(
        () => authenticate(authr, stored, { crossOrigin: true }),
        /cross-origin ceremony not allowed/,
      );
    });

    it('rejects an rpIdHash that does not match the stored rpId', () => {
      expectWebAuthnError(
        () => authenticate(authr, stored, { rpIdHash: sha256(Buffer.from('evil.example')) }),
        /rpId hash mismatch/,
      );
      expectWebAuthnError(
        () => authenticate(authr, { ...stored, rpId: 'other.example' }),
        /rpId hash mismatch/,
      );
    });

    it('requires UP and UV', () => {
      expectWebAuthnError(
        () => authenticate(authr, stored, { flags: FLAGS.UV }),
        /user presence required/,
      );
      expectWebAuthnError(
        () => authenticate(authr, stored, { flags: FLAGS.UP }),
        /user verification required/,
      );
    });

    it('rejects a signature over different client data', () => {
      const challenge = newChallenge();
      const a = authr.assert({ challenge, origin: ORIGIN, rpId: RP_ID });
      const b = authr.assert({ challenge: newChallenge(), origin: ORIGIN, rpId: RP_ID });
      a.response.signature = b.response.signature;
      expectWebAuthnError(
        () => webauthn.verifyAuthentication(a, stored, { challenge, isOriginAllowed }),
        /signature verification failed/,
      );
    });

    it('rejects garbage signatures and unusable stored keys', () => {
      expectWebAuthnError(
        () => authenticate(authr, stored, { signature: 'AAAA' }),
        /signature verification failed/,
      );
      expectWebAuthnError(
        () =>
          authenticate(authr, {
            ...stored,
            publicKey: { kty: 'EC', crv: 'P-256', x: 'AA', y: 'AA' },
          }),
        /signature verification failed/,
      );
      expectWebAuthnError(
        () => authenticate(authr, { ...stored, alg: -35 }),
        /signature verification failed/,
      );
    });

    it('rejects malformed base64url authenticatorData / signature', () => {
      const challenge = newChallenge();
      const exp = { challenge, isOriginAllowed };
      const badData = authr.assert({ challenge, origin: ORIGIN, rpId: RP_ID });
      badData.response.authenticatorData = '***';
      expectWebAuthnError(
        () => webauthn.verifyAuthentication(badData, stored, exp),
        /invalid authenticatorData/,
      );
      const badSig = authr.assert({ challenge, origin: ORIGIN, rpId: RP_ID });
      badSig.response.signature = '';
      expectWebAuthnError(
        () => webauthn.verifyAuthentication(badSig, stored, exp),
        /invalid signature/,
      );
    });

    it('rejects trailing authenticator data bytes', () => {
      expectWebAuthnError(
        () => authenticate(authr, stored, { trailing: Buffer.from([0x01, 0x02]) }),
        /trailing authenticator data/,
      );
    });

    it('accepts assertions carrying extension data (ED flag)', () => {
      const result = authenticate(
        authr,
        { ...stored, signCount: 0 },
        {
          flags: FLAGS.UP | FLAGS.UV | FLAGS.ED,
          extensions: new Map([['appid', false]]),
          signCount: 3,
        },
      );
      assert.equal(result.signCount, 3);
      expectWebAuthnError(
        () => authenticate(authr, stored, { flags: FLAGS.UP | FLAGS.UV | FLAGS.ED }),
        /invalid extension data/,
      );
    });

    it('reports the backed-up (synced) state', () => {
      const result = authenticate(
        authr,
        { ...stored, signCount: 0 },
        { flags: FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS, signCount: 0 },
      );
      assert.equal(result.backedUp, true);
    });

    describe('signature counter', () => {
      it('accepts an increasing counter', () => {
        assert.equal(
          authenticate(authr, { ...stored, signCount: 5 }, { signCount: 6 }).signCount,
          6,
        );
      });

      it('rejects a counter that did not increase (possible cloned authenticator)', () => {
        for (const signCount of [5, 4, 0]) {
          expectWebAuthnError(
            () => authenticate(authr, { ...stored, signCount: 5 }, { signCount }),
            /signature counter did not increase/,
          );
        }
      });

      it('allows 0/0 (synced passkeys never count) and a missing stored counter', () => {
        assert.equal(
          authenticate(authr, { ...stored, signCount: 0 }, { signCount: 0 }).signCount,
          0,
        );
        const noCounter = { ...stored };
        delete noCounter.signCount;
        assert.equal(authenticate(authr, noCounter, { signCount: 0 }).signCount, 0);
        assert.equal(authenticate(authr, noCounter, { signCount: 1 }).signCount, 1);
      });
    });
  });

  describe('lower-level helpers', () => {
    it('parseAuthenticatorData returns the parsed fields', () => {
      const authr = authenticators.ES256;
      const raw = authenticatorData({
        rpId: RP_ID,
        flags: FLAGS.UP | FLAGS.UV | FLAGS.AT,
        signCount: 0x01020304,
        aaguid: authr.aaguid,
        credentialId: authr.credentialId,
        coseKey: authr.coseKey,
      });
      const parsed = webauthn.parseAuthenticatorData(raw);
      assert.ok(parsed.rpIdHash.equals(sha256(Buffer.from(RP_ID))));
      assert.equal(parsed.flags, FLAGS.UP | FLAGS.UV | FLAGS.AT);
      assert.equal(parsed.signCount, 0x01020304);
      assert.ok(parsed.aaguid.equals(authr.aaguid));
      assert.ok(parsed.credentialId.equals(authr.credentialId));
      assert.ok(parsed.credentialPublicKey instanceof Map);
      assert.equal(parsed.credentialPublicKey.get(3), ALG.ES256);

      const plain = webauthn.parseAuthenticatorData(
        authenticatorData({ rpId: RP_ID, flags: FLAGS.UP }),
      );
      assert.equal(plain.credentialId, undefined);
      assert.equal(plain.credentialPublicKey, undefined);
    });

    it('parseAuthenticatorData rejects non-Buffers and short input', () => {
      expectWebAuthnError(() => webauthn.parseAuthenticatorData('x'.repeat(64)), /too short/);
      expectWebAuthnError(() => webauthn.parseAuthenticatorData(Buffer.alloc(36)), /too short/);
    });

    it('coseToJwk rejects non-Map input', () => {
      expectWebAuthnError(() => webauthn.coseToJwk({ 1: 2, 3: -7 }), /COSE key must be a map/);
      expectWebAuthnError(() => webauthn.coseToJwk(null), /COSE key must be a map/);
    });

    it('coseToJwk converts each supported key type', () => {
      for (const name of ['ES256', 'EdDSA', 'RS256']) {
        const authr = authenticators[name];
        const { jwk, alg } = webauthn.coseToJwk(authr.coseKey);
        assert.equal(alg, authr.alg);
        assert.equal(jwk.kty, authr.keyPair.publicKey.export({ format: 'jwk' }).kty);
      }
    });

    it('verifySignature returns false (never throws) for unusable input', () => {
      const { jwk } = webauthn.coseToJwk(authenticators.ES256.coseKey);
      assert.equal(
        webauthn.verifySignature({ jwk, alg: -999 }, Buffer.from('x'), Buffer.alloc(8)),
        false,
      );
      assert.equal(
        webauthn.verifySignature(
          { jwk: { kty: 'nope' }, alg: -7 },
          Buffer.from('x'),
          Buffer.alloc(8),
        ),
        false,
      );
      assert.equal(
        webauthn.verifySignature({ jwk, alg: -7 }, Buffer.from('x'), Buffer.alloc(0)),
        false,
      );
    });
  });

  describe('peekChallenge', () => {
    const credWith = (clientData) => ({
      type: 'public-key',
      response: { clientDataJSON: b64url(Buffer.from(clientData)) },
    });

    it('reads the (unverified) challenge', () => {
      const challenge = newChallenge();
      const cred = authenticators.ES256.assert({ challenge, origin: ORIGIN, rpId: RP_ID });
      assert.equal(webauthn.peekChallenge(cred), challenge);
    });

    it('accepts challenges up to 256 chars and rejects longer ones', () => {
      const at = 'a'.repeat(256);
      assert.equal(webauthn.peekChallenge(credWith(JSON.stringify({ challenge: at }))), at);
      assert.equal(
        webauthn.peekChallenge(credWith(JSON.stringify({ challenge: 'a'.repeat(257) }))),
        null,
      );
    });

    it('returns null for anything malformed', () => {
      for (const bad of [
        null,
        undefined,
        {},
        { response: null },
        { response: {} },
        { response: { clientDataJSON: '***' } },
        credWith('not json'),
        credWith('null'),
        credWith(JSON.stringify({ challenge: 12345 })),
        credWith(JSON.stringify({ type: 'webauthn.get' })),
      ]) {
        assert.equal(webauthn.peekChallenge(bad), null);
      }
    });
  });
});
