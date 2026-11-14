// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// Decoder for LERC version 1 ("CntZImage", Esri Limited Error Raster Compression), the format that
// ArcGIS ImageServer `exportImage?format=lerc` returns (Moon Trek runs ArcGIS Server 10.6.1).
// Written from the public format description (Esri, github.com/Esri/lerc, Apache-2.0); a single band
// of float values with an optional validity mask. Every decoded value is within maxZError of the
// server's float32 value (checked against the uncompressed `format=bsq` output in the tests).
//
// Layout (little-endian):
//   "CntZImage " (10 bytes) | int32 version (11) | int32 type (8 = CntZImage) | uint32 height |
//   uint32 width | float64 maxZError |
//   mask part:   uint32 numBlocksY, numBlocksX, numBytes | float32 maxValue | numBytes of RLE bitset |
//   pixel part:  uint32 numBlocksY, numBlocksX, numBytes | float32 maxValue | blocks...
// Mask RLE: int16 count; count > 0 → that many literal bytes; count < 0 → one byte repeated −count
// times; −32768 ends. Bits are MSB first, 1 = valid. A mask part with numBytes 0 and maxValue 0
// means no valid pixel; with maxValue 1, all pixels valid.
// Pixel blocks (row-major over a grid of numBlocksY × numBlocksX blocks of floor(H/numBlocksY) ×
// floor(W/numBlocksX) pixels, plus one extra partial row/column of blocks when H or W is not a
// multiple): one header byte, low 6 bits = encoding (0 raw float32, 1 bit-stuffed, 2 all zero,
// 3 constant = offset), high 2 bits = offset type (0 float32, 1 int16, 2 int8). Encoding 1 then has
// one byte (low 6 bits = bits per value, high 2 bits = count type: 0 uint32, 1 uint16, 2 uint8) and
// the count of valid pixels, then the values packed MSB-first in little-endian uint32 words.
// Value = offset + n · 2·maxZError (clamped to the block's max).

/**
 * Decode a LERC1 blob.
 * @param {ArrayBuffer} buf
 * @returns {{width:number, height:number, maxZError:number, pixels:Float32Array, mask:Uint8Array|null}}
 *   pixels row-major (row 0 = top); invalid pixels are NaN; mask[i] = 1 valid / 0 invalid (null = all valid).
 */
export function decodeLerc1(buf) {
  const u8 = new Uint8Array(buf);
  const id = String.fromCharCode(...u8.subarray(0, 10));
  if (id !== 'CntZImage ') throw new Error(`lerc1: not a CntZImage blob (${JSON.stringify(id)})`);
  const dv = new DataView(buf);
  let fp = 10;
  const version = dv.getInt32(fp, true), type = dv.getInt32(fp + 4, true);
  const height = dv.getUint32(fp + 8, true), width = dv.getUint32(fp + 12, true);
  const maxZError = dv.getFloat64(fp + 16, true);
  fp += 24;
  if (version !== 11 || type !== 8) throw new Error(`lerc1: unsupported version ${version} / type ${type}`);
  const n = width * height;

  // ---- mask ----
  const mNumBytes = dv.getUint32(fp + 8, true), mMax = dv.getFloat32(fp + 12, true);
  fp += 16;
  let bitset = null;
  if (mNumBytes > 0) {
    bitset = new Uint8Array(Math.ceil(n / 8));
    let ip = fp, op = 0;
    let cnt = dv.getInt16(ip, true); ip += 2;
    while (cnt !== -32768) {
      if (cnt > 0) { while (cnt--) bitset[op++] = u8[ip++]; }
      else { const v = u8[ip++]; cnt = -cnt; while (cnt--) bitset[op++] = v; }
      cnt = dv.getInt16(ip, true); ip += 2;
    }
    if (op < bitset.length) throw new Error('lerc1: truncated mask');
    fp += mNumBytes;
  } else if (mMax === 0) {
    bitset = new Uint8Array(Math.ceil(n / 8)); // no valid pixel
  }

  // ---- pixel blocks ----
  const numBlocksY = dv.getUint32(fp, true), numBlocksX = dv.getUint32(fp + 4, true);
  const pNumBytes = dv.getUint32(fp + 8, true), pMax = dv.getFloat32(fp + 12, true);
  fp += 16;
  const blockH = Math.floor(height / numBlocksY), blockW = Math.floor(width / numBlocksX);
  const nby = numBlocksY + (height % numBlocksY > 0 ? 1 : 0);
  const nbx = numBlocksX + (width % numBlocksX > 0 ? 1 : 0);
  const scale = 2 * maxZError;
  const pixels = new Float32Array(n);
  const mask = bitset ? new Uint8Array(n) : null;
  const isValid = (i) => (bitset[i >> 3] & (0x80 >> (i & 7))) !== 0;
  const vals = new Float64Array(blockW * blockH);
  const end = fp + pNumBytes;

  for (let by = 0; by < nby; by++) {
    const bh = by < numBlocksY ? blockH : height % numBlocksY;
    for (let bx = 0; bx < nbx; bx++) {
      const bw = bx < numBlocksX ? blockW : width % numBlocksX;
      const r0 = by * blockH, c0 = bx * blockW;
      // Count the valid pixels of this block (the stored values cover valid pixels only).
      let nValid = bw * bh;
      if (bitset) {
        nValid = 0;
        for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) if (isValid((r0 + r) * width + c0 + c)) nValid++;
      }
      const head = u8[fp++];
      const enc = head & 63;
      if (enc > 3) throw new Error(`lerc1: bad block encoding ${enc}`);
      let offset = 0;
      if (enc === 1 || enc === 3) {
        const ot = head >> 6;
        if (ot === 0) { offset = dv.getFloat32(fp, true); fp += 4; }
        else if (ot === 1) { offset = dv.getInt16(fp, true); fp += 2; }
        else if (ot === 2) { offset = dv.getInt8(fp); fp += 1; }
        else throw new Error('lerc1: bad offset type');
      }
      if (enc === 0) {
        for (let k = 0; k < nValid; k++) { vals[k] = dv.getFloat32(fp, true); fp += 4; }
      } else if (enc === 1) {
        const b = u8[fp++];
        const bits = b & 63, ct = b >> 6;
        let count;
        if (ct === 0) { count = dv.getUint32(fp, true); fp += 4; }
        else if (ct === 1) { count = dv.getUint16(fp, true); fp += 2; }
        else if (ct === 2) { count = u8[fp]; fp += 1; }
        else throw new Error('lerc1: bad count type');
        if (count !== nValid) throw new Error(`lerc1: block count ${count} != valid pixels ${nValid}`);
        const nBytes = Math.ceil((count * bits) / 8);
        const nWords = Math.ceil(nBytes / 4);
        const words = new Uint32Array(nWords);
        const wb = new Uint8Array(words.buffer);
        wb.set(u8.subarray(fp, fp + nBytes));
        fp += nBytes;
        // The last word holds only the tail bytes: shift them to its top end.
        const tail = nWords * 4 - nBytes;
        if (tail > 0) words[nWords - 1] = (words[nWords - 1] << (8 * tail)) >>> 0;
        const nmax = Math.ceil((pMax - offset) / scale);
        const bitMask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
        let wi = 0, left = 0, cur = 0;
        for (let k = 0; k < count; k++) {
          let v = 0;
          if (bits > 0) {
            if (left === 0) { cur = words[wi++]; left = 32; }
            if (left >= bits) {
              v = ((cur >>> (left - bits)) & bitMask) >>> 0;
              left -= bits;
            } else {
              const miss = bits - left; // 1..bits-1
              v = ((cur & ((1 << left) - 1)) * 2 ** miss);
              cur = words[wi++];
              left = 32 - miss;
              v += cur >>> left;
            }
          }
          vals[k] = v < nmax ? offset + v * scale : pMax;
        }
      } else {
        const cv = enc === 2 ? 0 : offset;
        for (let k = 0; k < nValid; k++) vals[k] = cv;
      }
      let k = 0;
      for (let r = 0; r < bh; r++) {
        for (let c = 0; c < bw; c++) {
          const i = (r0 + r) * width + c0 + c;
          if (bitset && !isValid(i)) { pixels[i] = NaN; mask[i] = 0; continue; }
          pixels[i] = vals[k++];
          if (mask) mask[i] = 1;
        }
      }
    }
  }
  if (fp > end) throw new Error('lerc1: pixel part overruns its byte count');
  return { width, height, maxZError, pixels, mask };
}
