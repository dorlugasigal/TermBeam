'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { decode, decodeFirst, CborError } = require('../../src/server/cbor');
const { cborEncode } = require('./webauthn-helpers');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

function assertCborError(fn, pattern) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof CborError, `expected CborError, got ${err && err.name}`);
    assert.equal(err.name, 'CborError');
    assert.match(err.message, pattern);
    return true;
  });
}

describe('cbor.decode', () => {
  describe('major type 0/1 — integers (RFC 8949 Appendix A)', () => {
    const vectors = [
      ['00', 0],
      ['01', 1],
      ['0a', 10],
      ['17', 23],
      ['1818', 24],
      ['1819', 25],
      ['1864', 100],
      ['1903e8', 1000],
      ['1a000f4240', 1000000],
      ['1b000000e8d4a51000', 1000000000000],
      ['1b001fffffffffffff', Number.MAX_SAFE_INTEGER],
      ['20', -1],
      ['29', -10],
      ['3863', -100],
      ['3903e7', -1000],
      ['3b001fffffffffffff', -(2 ** 53)],
    ];
    for (const [input, expected] of vectors) {
      it(`decodes 0x${input} → ${expected}`, () => {
        assert.equal(decode(hex(input)), expected);
      });
    }

    it('rejects unsigned integers above 2^53 - 1', () => {
      assertCborError(() => decode(hex('1b0020000000000000')), /integer too large/);
      assertCborError(() => decode(hex('1bffffffffffffffff')), /integer too large/);
    });

    it('rejects negative integers below -2^53', () => {
      assertCborError(() => decode(hex('3b0020000000000000')), /integer too large/);
      assertCborError(() => decode(hex('3bffffffffffffffff')), /integer too large/);
    });

    it('rejects reserved additional info 28-30', () => {
      for (const b of ['1c', '1d', '1e', '3c']) {
        assertCborError(() => decode(hex(b)), /unsupported additional info (28|29|30)/);
      }
    });
  });

  describe('major type 2/3 — byte and text strings', () => {
    it('decodes byte strings into (copied) Buffers', () => {
      const input = hex('4401020304');
      const out = decode(input);
      assert.ok(Buffer.isBuffer(out));
      assert.deepEqual([...out], [1, 2, 3, 4]);
      input[1] = 0xff; // mutating the source must not leak into the result
      assert.equal(out[0], 1);
      assert.equal(decode(hex('40')).length, 0);
    });

    it('decodes byte strings with 1/2-byte lengths', () => {
      const long = Buffer.concat([hex('5900ff'), Buffer.alloc(255, 7)]);
      const out = decode(long);
      assert.equal(out.length, 255);
      assert.ok(out.every((b) => b === 7));
    });

    const texts = [
      ['60', ''],
      ['6161', 'a'],
      ['6449455446', 'IETF'],
      ['62225c', '"\\'],
      ['62c3bc', '\u00fc'],
      ['63e6b0b4', '\u6c34'],
      ['64f0908591', '\u{10151}'],
    ];
    for (const [input, expected] of texts) {
      it(`decodes text 0x${input} → ${JSON.stringify(expected)}`, () => {
        assert.equal(decode(hex(input)), expected);
      });
    }

    it('rejects indefinite-length strings', () => {
      assertCborError(() => decode(hex('5f42010243030405ff')), /unsupported additional info 31/);
      assertCborError(() => decode(hex('7f657374726561646d696e67ff')), /additional info 31/);
    });

    it('rejects string lengths above 2^53 instead of allocating', () => {
      assertCborError(() => decode(hex('5bffffffffffffffff')), /integer too large/);
      assertCborError(() => decode(hex('5b001fffffffffffff')), /unexpected end of input/);
    });
  });

  describe('major type 4/5 — arrays and maps', () => {
    it('decodes arrays (including nested)', () => {
      assert.deepEqual(decode(hex('80')), []);
      assert.deepEqual(decode(hex('83010203')), [1, 2, 3]);
      assert.deepEqual(decode(hex('8301820203820405')), [1, [2, 3], [4, 5]]);
      const twentyFive = hex('98190102030405060708090a0b0c0d0e0f101112131415161718181819');
      assert.deepEqual(
        decode(twentyFive),
        Array.from({ length: 25 }, (_, i) => i + 1),
      );
    });

    it('decodes maps to Map instances (string and int keys)', () => {
      const empty = decode(hex('a0'));
      assert.ok(empty instanceof Map);
      assert.equal(empty.size, 0);

      const intKeys = decode(hex('a201020304'));
      assert.ok(intKeys instanceof Map);
      assert.deepEqual(
        [...intKeys],
        [
          [1, 2],
          [3, 4],
        ],
      );

      const mixed = decode(hex('a26161016162820203'));
      assert.equal(mixed.get('a'), 1);
      assert.deepEqual(mixed.get('b'), [2, 3]);

      const arrOfMap = decode(hex('826161a161626163'));
      assert.equal(arrOfMap[0], 'a');
      assert.ok(arrOfMap[1] instanceof Map);
      assert.equal(arrOfMap[1].get('b'), 'c');
    });

    it('decodes nested maps with negative/positive int keys (COSE style)', () => {
      // {1: {-1: h'0102', 2: [1, {3: "x"}]}, "k": -5}
      const out = decode(hex('a2 01 a2 20 42 0102 02 82 01 a1 03 6178 616b 24'));
      assert.ok(out instanceof Map);
      const inner = out.get(1);
      assert.ok(inner instanceof Map);
      assert.deepEqual([...inner.get(-1)], [1, 2]);
      const arr = inner.get(2);
      assert.equal(arr[0], 1);
      assert.ok(arr[1] instanceof Map);
      assert.equal(arr[1].get(3), 'x');
      assert.equal(out.get('k'), -5);
      // Int keys stay numbers, never stringified
      assert.equal(out.has('1'), false);
      assert.equal(inner.has('-1'), false);
    });

    it('round-trips a real COSE EC2 key produced by the test encoder', () => {
      const x = Buffer.alloc(32, 0xaa);
      const y = Buffer.alloc(32, 0xbb);
      const cose = new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]);
      const out = decode(cborEncode(cose));
      assert.deepEqual([...out.keys()], [1, 3, -1, -2, -3]);
      assert.equal(out.get(3), -7);
      assert.ok(out.get(-2).equals(x));
      assert.ok(out.get(-3).equals(y));
    });

    it('accepts exactly MAX_ITEMS (1024) array elements and map entries', () => {
      const arr = Buffer.concat([hex('990400'), Buffer.alloc(1024, 0x00)]);
      assert.equal(decode(arr).length, 1024);
      const map = cborEncode(new Map(Array.from({ length: 1024 }, (_, i) => [i, true])));
      assert.equal(decode(map).size, 1024);
    });

    it('rejects arrays/maps above MAX_ITEMS before allocating', () => {
      assertCborError(() => decode(hex('990401')), /array too large/);
      assertCborError(() => decode(hex('b90401')), /map too large/);
      // A hostile 2^40-element header fails fast instead of looping
      assertCborError(() => decode(hex('9b0000010000000000')), /array too large/);
      assertCborError(() => decode(hex('bb0000010000000000')), /map too large/);
    });

    it('rejects duplicate map keys', () => {
      assertCborError(() => decode(hex('a2 01 01 01 02')), /duplicate map key/);
      assertCborError(() => decode(hex('a2 6161 01 6161 02')), /duplicate map key/);
    });

    it('rejects unsupported map key types', () => {
      for (const input of ['a1 40 01', 'a1 80 01', 'a1 a0 01', 'a1 f6 01', 'a1 f5 01']) {
        assertCborError(() => decode(hex(input)), /unsupported map key type/);
      }
    });

    it('rejects indefinite-length arrays and maps', () => {
      assertCborError(() => decode(hex('9fff')), /unsupported additional info 31/);
      assertCborError(() => decode(hex('9f018202039f0405ffff')), /additional info 31/);
      assertCborError(() => decode(hex('bfff')), /unsupported additional info 31/);
      assertCborError(() => decode(hex('bf61610161629f0203ffff')), /additional info 31/);
    });
  });

  describe('nesting depth', () => {
    const nestedArrays = (n) => Buffer.concat([Buffer.alloc(n - 1, 0x81), hex('80')]);

    it('accepts 17 nested containers (depth 0..16)', () => {
      let v = decode(nestedArrays(17));
      let levels = 0;
      while (Array.isArray(v)) {
        levels++;
        v = v[0];
      }
      assert.equal(levels, 17);
    });

    it('rejects nesting deeper than MAX_DEPTH (16)', () => {
      assertCborError(() => decode(nestedArrays(18)), /maximum nesting depth exceeded/);
      // Maps count too
      const nestedMaps = Buffer.concat([
        Buffer.alloc(36).fill(Buffer.from([0xa1, 0x01])),
        hex('a0'),
      ]);
      assertCborError(() => decode(nestedMaps), /maximum nesting depth exceeded/);
      // ...and so do tags (each tag adds a level)
      const nestedTags = Buffer.concat([Buffer.alloc(20, 0xc1), hex('01')]);
      assertCborError(() => decode(nestedTags), /maximum nesting depth exceeded/);
    });
  });

  describe('major type 6 — tags', () => {
    it('returns the tagged inner value', () => {
      assert.equal(
        decode(hex('c074323031332d30332d32315432303a30343a30305a')),
        '2013-03-21T20:04:00Z',
      );
      assert.equal(decode(hex('c11a514b67b0')), 1363896240);
      assert.deepEqual([...decode(hex('d74401020304'))], [1, 2, 3, 4]);
      assert.equal(
        decode(hex('d82076687474703a2f2f7777772e6578616d706c652e636f6d')),
        'http://www.example.com',
      );
    });

    it('rejects a tag with no content', () => {
      assertCborError(() => decode(hex('c1')), /unexpected end of input/);
    });
  });

  describe('major type 7 — simple values and floats', () => {
    it('decodes false/true/null/undefined', () => {
      assert.equal(decode(hex('f4')), false);
      assert.equal(decode(hex('f5')), true);
      assert.equal(decode(hex('f6')), null);
      assert.equal(decode(hex('f7')), undefined);
    });

    it('rejects unassigned / one-byte simple values and a lone break', () => {
      assertCborError(() => decode(hex('e0')), /unsupported simple value 0/);
      assertCborError(() => decode(hex('f0')), /unsupported simple value 16/);
      assertCborError(() => decode(hex('f818')), /unsupported simple value 24/);
      assertCborError(() => decode(hex('f8ff')), /unsupported simple value 24/);
      assertCborError(() => decode(hex('ff')), /unsupported simple value 31/);
    });

    const halfVectors = [
      ['f90000', 0],
      ['f93c00', 1],
      ['f93e00', 1.5],
      ['f97bff', 65504],
      ['f90001', 5.960464477539063e-8],
      ['f903ff', 0.00006097555160522461],
      ['f90400', 0.00006103515625],
      ['f9c400', -4],
      ['f97c00', Infinity],
      ['f9fc00', -Infinity],
    ];
    for (const [input, expected] of halfVectors) {
      it(`decodes float16 0x${input} → ${expected}`, () => {
        assert.equal(decode(hex(input)), expected);
      });
    }

    it('decodes float16 negative zero and NaN', () => {
      assert.ok(Object.is(decode(hex('f98000')), -0));
      assert.ok(Number.isNaN(decode(hex('f97e00'))));
    });

    it('decodes float32', () => {
      assert.equal(decode(hex('fa47c35000')), 100000);
      assert.equal(decode(hex('fa7f7fffff')), 3.4028234663852886e38);
      assert.equal(decode(hex('fa7f800000')), Infinity);
      assert.equal(decode(hex('faff800000')), -Infinity);
      assert.ok(Number.isNaN(decode(hex('fa7fc00000'))));
    });

    it('decodes float64', () => {
      assert.equal(decode(hex('fb3ff199999999999a')), 1.1);
      assert.equal(decode(hex('fb7e37e43c8800759c')), 1e300);
      assert.equal(decode(hex('fbc010666666666666')), -4.1);
      assert.equal(decode(hex('fb7ff0000000000000')), Infinity);
      assert.equal(decode(hex('fbfff0000000000000')), -Infinity);
      assert.ok(Number.isNaN(decode(hex('fb7ff8000000000000'))));
    });
  });

  describe('truncated input', () => {
    const truncated = [
      '',
      '18',
      '1903',
      '1a000f42',
      '1b000000e8d4a510',
      '4401020304'.slice(0, 6),
      '636162',
      '8201',
      'a101',
      'a2010203',
      'f9',
      'f93c',
      'fa47c350',
      'fb3ff19999999999',
    ];
    for (const input of truncated) {
      it(`rejects truncated 0x${input || '(empty)'}`, () => {
        assertCborError(() => decode(hex(input)), /unexpected end of input/);
      });
    }
  });

  describe('decode() vs decodeFirst()', () => {
    it('decode() rejects trailing bytes after the first item', () => {
      assertCborError(() => decode(hex('0102')), /trailing bytes after CBOR item/);
      assertCborError(() => decode(hex('a0 00')), /trailing bytes/);
    });

    it('decodeFirst() returns the value and the offset after it', () => {
      assert.deepEqual(decodeFirst(hex('0102')), { value: 1, offset: 1 });
      assert.deepEqual(decodeFirst(hex('0102'), 1), { value: 2, offset: 2 });
      const { value, offset } = decodeFirst(hex('ff ff 83010203 ff'), 2);
      assert.deepEqual(value, [1, 2, 3]);
      assert.equal(offset, 6);
    });

    it('rejects non-Buffer input', () => {
      assertCborError(() => decode('a0'), /input must be a Buffer/);
      assertCborError(() => decodeFirst(new Uint8Array([0])), /input must be a Buffer/);
      assertCborError(() => decode(null), /input must be a Buffer/);
    });
  });
});
