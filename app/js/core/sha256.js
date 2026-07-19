/**
 * sha256.js — Self-contained SHA-256 / HMAC-SHA256 / PBKDF2-HMAC-SHA256.
 *
 * WHY THIS EXISTS
 * ------------------------------------------------------------------
 * Password hashing normally goes through `crypto.subtle`, which is only
 * exposed in a secure context. Chromium and Firefox do treat `file://` as
 * secure, but that behaviour has changed across versions and can be disabled
 * by enterprise policy — and an administrator locked out of their own USB
 * drive has no recovery path. This module is the deterministic fallback:
 * it produces byte-identical output to the WebCrypto path, so a password set
 * on one machine still verifies on another. See core/crypto.js.
 *
 * All functions operate on Uint8Array and are pure.
 */
(function (NS) {
  'use strict';

  // First 32 bits of the fractional parts of the cube roots of the first
  // 64 primes (FIPS 180-4, §4.2.2).
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // First 32 bits of the fractional parts of the square roots of the first
  // 8 primes (FIPS 180-4, §5.3.3).
  var H0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  var BLOCK = 64; // bytes
  var DIGEST = 32; // bytes

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  /**
   * @param {Uint8Array} msg
   * @returns {Uint8Array} 32-byte digest
   */
  function sha256(msg) {
    var len = msg.length;

    // Padded length: message + 0x80 + zeros + 8-byte big-endian bit length.
    var padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(msg);
    padded[len] = 0x80;

    // Bit length as a 64-bit big-endian integer. Uint8Array cannot hold more
    // than 2^32-1 bytes, so the high word only needs the top 3 bits of len.
    var bitLenHi = Math.floor(len / 536870912); // len * 8 / 2^32
    var bitLenLo = (len << 3) >>> 0;
    var dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bitLenHi, false);
    dv.setUint32(padded.length - 4, bitLenLo, false);

    var h = H0.slice();
    var w = new Uint32Array(64);

    for (var off = 0; off < padded.length; off += BLOCK) {
      var i;

      for (i = 0; i < 16; i++) {
        w[i] = dv.getUint32(off + i * 4, false);
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }

      var a = h[0], b = h[1], c = h[2], d = h[3];
      var e = h[4], f = h[5], g = h[6], hh = h[7];

      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;

        hh = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }

      h[0] = (h[0] + a) >>> 0;
      h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0;
      h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0;
      h[7] = (h[7] + hh) >>> 0;
    }

    var out = new Uint8Array(DIGEST);
    var odv = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) odv.setUint32(j * 4, h[j], false);
    return out;
  }

  /**
   * HMAC-SHA256 (RFC 2104).
   * @param {Uint8Array} key
   * @param {Uint8Array} msg
   * @returns {Uint8Array} 32-byte MAC
   */
  function hmac(key, msg) {
    var k = key.length > BLOCK ? sha256(key) : key;

    var ipad = new Uint8Array(BLOCK + msg.length);
    var opad = new Uint8Array(BLOCK + DIGEST);

    var i;
    for (i = 0; i < BLOCK; i++) {
      var kb = i < k.length ? k[i] : 0;
      ipad[i] = kb ^ 0x36;
      opad[i] = kb ^ 0x5c;
    }

    ipad.set(msg, BLOCK);
    opad.set(sha256(ipad), BLOCK);
    return sha256(opad);
  }

  /**
   * PBKDF2-HMAC-SHA256 (RFC 8018 §5.2).
   * @param {Uint8Array} password
   * @param {Uint8Array} salt
   * @param {number} iterations
   * @param {number} dkLen derived key length in bytes
   * @returns {Uint8Array}
   */
  function pbkdf2(password, salt, iterations, dkLen) {
    var blocks = Math.ceil(dkLen / DIGEST);
    var out = new Uint8Array(blocks * DIGEST);

    for (var b = 1; b <= blocks; b++) {
      // U1 = PRF(P, S || INT_32_BE(b))
      var input = new Uint8Array(salt.length + 4);
      input.set(salt);
      new DataView(input.buffer).setUint32(salt.length, b, false);

      var u = hmac(password, input);
      var t = u.slice();

      for (var i = 1; i < iterations; i++) {
        u = hmac(password, u);
        for (var j = 0; j < DIGEST; j++) t[j] ^= u[j];
      }

      out.set(t, (b - 1) * DIGEST);
    }

    return out.subarray(0, dkLen);
  }

  NS.define('Sha256', {
    hash: sha256,
    hmac: hmac,
    pbkdf2: pbkdf2,
    DIGEST_LENGTH: DIGEST,
  });
})(window.USBLib);
