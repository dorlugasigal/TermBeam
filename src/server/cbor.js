/**
 * Minimal, strict CBOR (RFC 8949) decoder — just enough for WebAuthn.
 *
 * WebAuthn attestation objects and COSE public keys are encoded with CTAP2
 * "canonical" CBOR: definite lengths only, small integers, byte/text strings,
 * arrays and maps. We deliberately reject everything we don't need
 * (indefinite lengths, big integers, unknown simple values) and bound depth
 * and container sizes so a hostile payload can't exhaust memory or stack.
 *
 * Maps decode to `Map` (COSE keys use integer labels such as 1, 3, -1, -2).
 */

const MAX_DEPTH = 16;
const MAX_ITEMS = 1024;

class CborError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CborError';
  }
}

function decodeFirst(buf, startOffset = 0) {
  if (!Buffer.isBuffer(buf)) throw new CborError('input must be a Buffer');
  let offset = startOffset;

  function need(n) {
    if (offset + n > buf.length) throw new CborError('unexpected end of input');
  }

  function readLength(info) {
    if (info < 24) return info;
    if (info === 24) {
      need(1);
      return buf[offset++];
    }
    if (info === 25) {
      need(2);
      const v = buf.readUInt16BE(offset);
      offset += 2;
      return v;
    }
    if (info === 26) {
      need(4);
      const v = buf.readUInt32BE(offset);
      offset += 4;
      return v;
    }
    if (info === 27) {
      need(8);
      const v = buf.readBigUInt64BE(offset);
      offset += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError('integer too large');
      return Number(v);
    }
    // 28-30 reserved, 31 = indefinite length (not allowed in CTAP2 canonical CBOR)
    throw new CborError(`unsupported additional info ${info}`);
  }

  function readItem(depth) {
    if (depth > MAX_DEPTH) throw new CborError('maximum nesting depth exceeded');
    need(1);
    const initial = buf[offset++];
    const major = initial >> 5;
    const info = initial & 0x1f;

    switch (major) {
      case 0:
        return readLength(info);
      case 1:
        return -1 - readLength(info);
      case 2: {
        const len = readLength(info);
        need(len);
        const out = Buffer.from(buf.subarray(offset, offset + len));
        offset += len;
        return out;
      }
      case 3: {
        const len = readLength(info);
        need(len);
        const out = buf.toString('utf8', offset, offset + len);
        offset += len;
        return out;
      }
      case 4: {
        const len = readLength(info);
        if (len > MAX_ITEMS) throw new CborError('array too large');
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(readItem(depth + 1));
        return arr;
      }
      case 5: {
        const len = readLength(info);
        if (len > MAX_ITEMS) throw new CborError('map too large');
        const map = new Map();
        for (let i = 0; i < len; i++) {
          const key = readItem(depth + 1);
          if (typeof key !== 'number' && typeof key !== 'string') {
            throw new CborError('unsupported map key type');
          }
          if (map.has(key)) throw new CborError('duplicate map key');
          map.set(key, readItem(depth + 1));
        }
        return map;
      }
      case 6:
        // Tagged item — WebAuthn doesn't rely on tags; return the inner value.
        readLength(info);
        return readItem(depth + 1);
      case 7: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        if (info === 25) {
          need(2);
          const half = buf.readUInt16BE(offset);
          offset += 2;
          return decodeFloat16(half);
        }
        if (info === 26) {
          need(4);
          const v = buf.readFloatBE(offset);
          offset += 4;
          return v;
        }
        if (info === 27) {
          need(8);
          const v = buf.readDoubleBE(offset);
          offset += 8;
          return v;
        }
        throw new CborError(`unsupported simple value ${info}`);
      }
      default:
        throw new CborError(`unsupported major type ${major}`);
    }
  }

  const value = readItem(0);
  return { value, offset };
}

function decodeFloat16(half) {
  const exp = (half >> 10) & 0x1f;
  const mant = half & 0x3ff;
  let val;
  if (exp === 0) val = mant * 2 ** -24;
  else if (exp !== 31) val = (mant + 1024) * 2 ** (exp - 25);
  else val = mant === 0 ? Infinity : NaN;
  return half & 0x8000 ? -val : val;
}

/** Decode a buffer that must contain exactly one CBOR item. */
function decode(buf) {
  const { value, offset } = decodeFirst(buf, 0);
  if (offset !== buf.length) throw new CborError('trailing bytes after CBOR item');
  return value;
}

module.exports = { decode, decodeFirst, CborError };
