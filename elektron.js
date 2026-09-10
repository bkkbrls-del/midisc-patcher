/** Elektron Octatrack .syx / aPLib / ELUP helpers (browser port). */

const SYX_START = 0xf0;
const SYX_END = 0xf7;
const SYX_MASK7 = 0x7f;
const SYX_HIGH_BIT = 0x80;
const SYX_7IN8_GROUP = 7;
const SYX_CMD_DATA = 0x7e;
const SYX_CMD_MARKER = 0x7f;
const PK_DEV = 3;
const PK_CMD = 5;
const LEGACY_THDR = 14;
const ELEK_DEC_PKT = 63;
const PREELE_COUNTER = 0x4000;
const ELEK_SECT_OFF = 0x12;
const DEV_OCTATRACK = 0x05;

const APLIB_OFFSET_BIAS = 767;
const APLIB_REUSE_GAMMA = 2;
const APLIB_FAR_THRESHOLD = 3328;
const APLIB_MIN_MATCH = 2;
const APLIB_SECT_HDR = 8;
const MAX_MATCH = 2048;

const ELUP_SEED = 0x2f1349d2;
const XOR_A = 0x9e3b16a2;
const XOR_B = 0x764e28ca;
const C3 = 0x360fa955;
const C7 = 0xef4a9ab6;
const M = 0xffffffff;

function legacyCk(dev, nb, payloadSum) {
  const s = dev + nb.reduce((a, b) => a + b, 0) + payloadSum;
  return ((s >> 4) + s) & 0xf;
}

function decodePayload(dec, p) {
  let k = 0;
  while (k < p.length) {
    const ms = p[k];
    const nd = Math.min(SYX_7IN8_GROUP, p.length - k - 1);
    for (let n = 0; n < nd; n++) {
      dec.push(p[k + 1 + n] | (((ms >> (SYX_7IN8_GROUP - 1 - n)) & 1) * SYX_HIGH_BIT));
    }
    k += SYX_7IN8_GROUP + 1;
  }
}

export function decodeSyxElek(buf) {
  const dec = [];
  let dev = 0;
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== SYX_START) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < buf.length && buf[j] !== SYX_END) j++;
    if (j >= buf.length) break;
    const m = buf.subarray(i + 1, j);
    if (m.length > PK_DEV && !dev) dev = m[PK_DEV];
    if (m.length > LEGACY_THDR && m[PK_CMD] === SYX_CMD_DATA) {
      decodePayload(dec, m.subarray(LEGACY_THDR));
    }
    i = j + 1;
  }
  if (dec.length < 4 || dec[0] !== 0x45 || dec[1] !== 0x4c || dec[2] !== 0x45 || dec[3] !== 0x4b) {
    throw new Error("decoded stream does not start with ELEK — not a stock Octatrack OS .syx?");
  }
  return { container: new Uint8Array(dec), device: dev || DEV_OCTATRACK };
}

function preeleNib6(v) {
  const out = new Uint8Array(6);
  for (let k = 0; k < 6; k++) out[k] = (v >> (4 * (5 - k))) & 0xf;
  return out;
}

function encode8in7(data) {
  const out = [];
  for (let i = 0; i < data.length; i += SYX_7IN8_GROUP) {
    const nd = Math.min(SYX_7IN8_GROUP, data.length - i);
    let ms = 0;
    for (let n = 0; n < nd; n++) {
      if (data[i + n] & SYX_HIGH_BIT) ms |= 1 << (SYX_7IN8_GROUP - 1 - n);
    }
    out.push(ms);
    for (let n = 0; n < nd; n++) out.push(data[i + n] & SYX_MASK7);
  }
  return new Uint8Array(out);
}

function emitLegacyData(dev, nb, chunk) {
  const mfr = [0x00, 0x20, 0x3c];
  let s = 0;
  for (let i = 0; i < chunk.length; i++) s = (s + chunk[i]) >>> 0;
  const C = legacyCk(dev, nb, s);
  const body = encode8in7(chunk);
  const out = new Uint8Array(1 + 3 + 1 + 1 + 1 + 2 + nb.length + body.length + 1);
  let o = 0;
  out[o++] = SYX_START;
  out[o++] = mfr[0];
  out[o++] = mfr[1];
  out[o++] = mfr[2];
  out[o++] = dev;
  out[o++] = 0x00;
  out[o++] = SYX_CMD_DATA;
  out[o++] = (C >> 4) & 0xf;
  out[o++] = C & 0xf;
  out.set(nb, o);
  o += nb.length;
  out.set(body, o);
  o += body.length;
  out[o++] = SYX_END;
  return out;
}

export function encodeSyxElek(container, dev = DEV_OCTATRACK) {
  const parts = [];
  let total = 0;
  for (let off = 0; off < container.length; off += ELEK_DEC_PKT) {
    const n = Math.min(ELEK_DEC_PKT, container.length - off);
    const pkt = emitLegacyData(dev, preeleNib6(PREELE_COUNTER + off), container.subarray(off, off + n));
    parts.push(pkt);
    total += pkt.length;
  }
  const mfr = [0x00, 0x20, 0x3c];
  const tn = preeleNib6(container.length);
  // F0 + mfr + dev + 00 7E F7, then F0 + mfr + dev + 00 7F + nib6 + F7
  const trailer = new Uint8Array(8 + 14);
  let o = 0;
  trailer[o++] = SYX_START;
  trailer.set(mfr, o);
  o += 3;
  trailer[o++] = dev;
  trailer[o++] = 0x00;
  trailer[o++] = SYX_CMD_DATA;
  trailer[o++] = SYX_END;
  trailer[o++] = SYX_START;
  trailer.set(mfr, o);
  o += 3;
  trailer[o++] = dev;
  trailer[o++] = 0x00;
  trailer[o++] = SYX_CMD_MARKER;
  trailer.set(tn, o);
  o += 6;
  trailer[o++] = SYX_END;
  total += trailer.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  out.set(trailer, p);
  return out;
}

export function setElekVersion(container, version) {
  const voff = 0x08;
  const cap = ELEK_SECT_OFF - voff;
  if (version.length > cap) throw new Error(`version too long (${version.length} > ${cap})`);
  const pad = " ".repeat(cap - version.length) + version;
  for (let i = 0; i < cap; i++) container[voff + i] = pad.charCodeAt(i);
}

export function replaceElekSection(container, packedSection) {
  const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
  const streamLen = view.getUint32(ELEK_SECT_OFF);
  const oldComp = 8 + streamLen;
  const secEnd = ELEK_SECT_OFF + oldComp;
  const out = new Uint8Array(ELEK_SECT_OFF + packedSection.length + Math.max(0, container.length - secEnd));
  out.set(container.subarray(0, ELEK_SECT_OFF), 0);
  out.set(packedSection, ELEK_SECT_OFF);
  if (secEnd < container.length) out.set(container.subarray(secEnd), ELEK_SECT_OFF + packedSection.length);
  return out;
}

function getbit(b) {
  b.tag <<= 1;
  if ((b.tag & 0xff) === 0) {
    if (b.ip >= b.iend) {
      b.err = true;
      return 0;
    }
    const by = b.src[b.ip++];
    b.tag = (by << 1) | 1;
    return (by >> 7) & 1;
  }
  return (b.tag >> 8) & 1;
}

function getgamma(b) {
  let v = 1;
  while (true) {
    v = (v << 1) + getbit(b);
    if (getbit(b)) break;
    if (b.err || v > 0x02000000) break;
  }
  return v;
}

export function apDepack(src, outcap = null) {
  const b = { src, ip: APLIB_SECT_HDR, iend: src.length, tag: 0, err: false };
  const out = [];
  const oend = outcap ?? src.length * 8;
  let lastOff = 1;
  while (true) {
    if (b.err) break;
    if (getbit(b)) {
      if (out.length >= oend) throw new Error("depack output overflow");
      if (b.ip >= b.iend) break;
      out.push(b.src[b.ip++]);
      continue;
    }
    const g = getgamma(b);
    let off;
    if (g === APLIB_REUSE_GAMMA) {
      off = lastOff;
    } else {
      if (b.ip >= b.iend) break;
      off = (g << 8) + b.src[b.ip++];
      if (off === APLIB_OFFSET_BIAS) break;
      off -= APLIB_OFFSET_BIAS;
      lastOff = off;
    }
    const ba = getbit(b);
    const bb = getbit(b);
    let sl = 2 * ba + bb;
    let L = sl || getgamma(b) + 2;
    if (b.err) break;
    if (off > APLIB_FAR_THRESHOLD) L += 1;
    const n = L + 1;
    if (off === 0 || out.length < off) throw new Error(`depack bad offset ${off}`);
    if (out.length + n > oend) throw new Error("depack match overflow");
    let start = out.length - off;
    for (let i = 0; i < n; i++) out.push(out[start++]);
  }
  return new Uint8Array(out);
}

class Packer {
  constructor(outcap) {
    this.o = new Uint8Array(outcap);
    this.cap = outcap;
    this.n = APLIB_SECT_HDR;
    this.tagpos = -1;
    this.tagbits = 0;
    this.err = false;
  }
  putBit(bit) {
    if (this.tagbits === 0) {
      if (this.n >= this.cap) {
        this.err = true;
        return;
      }
      this.tagpos = this.n;
      this.o[this.n++] = 0;
      this.tagbits = 8;
    }
    if (bit) this.o[this.tagpos] |= 1 << (this.tagbits - 1);
    this.tagbits--;
  }
  putByte(v) {
    if (this.n >= this.cap) {
      this.err = true;
      return;
    }
    this.o[this.n++] = v & 0xff;
  }
  putGamma(v) {
    let nb = 0;
    let t = v;
    while (t) {
      nb++;
      t >>= 1;
    }
    for (let i = nb - 2; i >= 0; i--) {
      this.putBit((v >> i) & 1);
      this.putBit(i === 0 ? 1 : 0);
    }
  }
  putLiteral(b) {
    this.putBit(1);
    this.putByte(b);
  }
  putMatch(off, matchlen, lastOff) {
    this.putBit(0);
    if (off === lastOff[0]) {
      this.putGamma(APLIB_REUSE_GAMMA);
    } else {
      const raw = off + APLIB_OFFSET_BIAS;
      this.putGamma(raw >> 8);
      this.putByte(raw & 0xff);
      lastOff[0] = off;
    }
    const bonus = off > APLIB_FAR_THRESHOLD ? 1 : 0;
    const Lbase = matchlen - 1 - bonus;
    if (Lbase <= 3) {
      this.putBit(Lbase >> 1);
      this.putBit(Lbase & 1);
    } else {
      this.putBit(0);
      this.putBit(0);
      this.putGamma(Lbase - 2);
    }
  }
}

function matchRun(data, a, b, cap) {
  let l = 0;
  while (l < cap && data[a + l] === data[b + l]) l++;
  return l;
}

export function apPack(data) {
  const length = data.length;
  const p = new Packer(length + (length >> 1) + 256);
  if (length === 0) return new Uint8Array(8);
  const lastOff = [1];
  let i = 0;
  while (i < length) {
    let bestOff = 0;
    let bestLen = 0;
    const start = Math.max(0, i - 512);
    for (let j = i - 1; j >= start; j--) {
      const off = i - j;
      const cap = Math.min(length - i, MAX_MATCH);
      const l = matchRun(data, j, i, cap);
      const mn = off > APLIB_FAR_THRESHOLD ? APLIB_MIN_MATCH + 1 : APLIB_MIN_MATCH;
      if (l >= mn && l > bestLen) {
        bestOff = off;
        bestLen = l;
        if (bestLen >= 64) break;
      }
    }
    const need = bestOff > APLIB_FAR_THRESHOLD ? APLIB_MIN_MATCH + 1 : APLIB_MIN_MATCH;
    if (bestLen >= need) {
      p.putMatch(bestOff, bestLen, lastOff);
      i += bestLen;
    } else {
      p.putLiteral(data[i]);
      i++;
    }
    if (p.err) throw new Error("ap_pack overflow");
  }
  p.putBit(0);
  p.putGamma(0x1000002);
  p.putByte(0xff);
  if (p.err) throw new Error("ap_pack overflow at EOS");
  const out = p.o.subarray(0, p.n);
  let stream = out.length - APLIB_SECT_HDR;
  let ssum = 0;
  for (let k = APLIB_SECT_HDR; k < out.length; k++) ssum = (ssum + out[k]) >>> 0;
  const hdr = new Uint8Array(8);
  const dv = new DataView(hdr.buffer);
  dv.setUint32(0, stream);
  dv.setUint32(4, ssum);
  const packed = new Uint8Array(8 + stream);
  packed.set(hdr, 0);
  packed.set(out.subarray(APLIB_SECT_HDR), 8);
  return packed;
}

function rot16(v) {
  return (((v << 16) | (v >>> 16)) >>> 0) & M;
}

function bswap(v) {
  return (
    ((((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v & 0xff0000) >>> 8) | (v >>> 24)) >>> 0) & M
  );
}

function encodeWord(k, p) {
  const x = (k ^ ((k & 0x800000) === 0 ? C3 : C7) ^ p) >>> 0;
  if ((k & 0x800000) === 0) return (rot16(x) ^ XOR_A) >>> 0;
  return (bswap(x) ^ XOR_B) >>> 0;
}

export function makeElupBin(elekContainer) {
  const payload = new Uint8Array(4 + elekContainer.length);
  new DataView(payload.buffer).setUint32(0, elekContainer.length);
  payload.set(elekContainer, 4);
  const pad = (4 - (payload.length % 4)) % 4;
  const padded = pad ? new Uint8Array(payload.length + pad) : payload;
  if (pad) {
    padded.set(payload, 0);
  }
  const words = padded.length / 4;
  const cipher = new Uint32Array(words + 1);
  let k = ELUP_SEED;
  let acc = 0;
  const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  for (let i = 0; i < words; i++) {
    const p = dv.getUint32(i * 4);
    const c = encodeWord(k, p);
    cipher[i] = c;
    acc = (acc + p) >>> 0;
    k = c;
  }
  cipher[words] = encodeWord(k, acc);
  const blob = new Uint8Array(8 + cipher.length * 4);
  const out = new DataView(blob.buffer);
  out.setUint32(0, 0x454c5550);
  out.setUint32(4, ELUP_SEED);
  for (let i = 0; i < cipher.length; i++) out.setUint32(8 + i * 4, cipher[i]);
  return blob;
}

export async function sha256Hex(bytes) {
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function extractMainOs(container) {
  const sec = container.subarray(ELEK_SECT_OFF);
  const ulen = new DataView(sec.buffer, sec.byteOffset, sec.byteLength).getUint32(0);
  return apDepack(sec.subarray(0, ulen + 8));
}
