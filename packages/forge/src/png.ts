// A minimal PNG decoder (8-bit, non-interlaced grey/RGB/grey+alpha/RGBA, i.e. what Chromium screenshots are) on
// node:zlib, so the pre-check can read screenshot pixels without a dependency.
import { inflateSync } from "node:zlib";

/** Decoded pixels, always as 8-bit RGBA rows. */
export type Pixels = { width: number; height: number; data: Uint8Array };

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(png: Buffer): Pixels {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const len = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      channels = CHANNELS[colour ?? -1] ?? 0;
      if (depth !== 8 || !channels || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${colour}, interlace ${interlace})`);
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  if (!width || !height) throw new Error("PNG has no IHDR");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("PNG data is truncated");

  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    const prev = out - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= channels ? rows[out + x - channels]! : 0;
      const b = y > 0 ? rows[prev + x]! : 0;
      const c = y > 0 && x >= channels ? rows[prev + x - channels]! : 0;
      rows[out + x] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const grey = channels <= 2;
    data[i * 4] = rows[j]!;
    data[i * 4 + 1] = grey ? rows[j]! : rows[j + 1]!;
    data[i * 4 + 2] = grey ? rows[j]! : rows[j + 2]!;
    data[i * 4 + 3] = channels === 2 ? rows[j + 1]! : 255;
  }
  return { width, height, data };
}
