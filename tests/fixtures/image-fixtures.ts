import { deflateSync } from "node:zlib";

export interface ImageFixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
  orientation: "portrait" | "landscape";
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

export function makePng(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number] = [38, 94, 220, 255],
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("PNG fixture dimensions must be positive integers.");
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const rowLength = width * 4 + 1;
  const pixels = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength;
    pixels[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      pixels[offset] = rgba[0];
      pixels[offset + 1] = rgba[1];
      pixels[offset + 2] = rgba[2];
      pixels[offset + 3] = rgba[3];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAQL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCABb//2Q==";
const WEBP = "UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoDAAIAAUAmJaACdLoAA5gA/su3/i2kdCp1f/Z3f/Tu/+nd/e+AAA==";
const TIFF = "SUkqAAgAAAAKAAABBAABAAAAAgAAAAEBBAABAAAAAwAAAAIBAwADAAAAhgAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAABEBBAABAAAAjAAAABUBAwABAAAAAwAAABYBBAABAAAAAwAAABcBBAABAAAAEgAAABwBAwABAAAAAQAAAAAAAAAIAAgACAC0PKC0PKC0PKC0PKC0PKC0PKA=";
const BMP = "Qk1OAAAAAAAAADYAAAAoAAAAAwAAAAIAAAABABgAAAAAABgAAADEDgAAxA4AAAAAAAAAAAAAFKDmFKDmFKDmAAAAFKDmFKDmFKDmAAAA";
const GIF = "R0lGODdhAgADAIEAABS0tAAAAAAAAAAAACwAAAAAAgADAAAIBgABCBwYEAA7";

export const SUPPORTED_FORMAT_FIXTURES: readonly ImageFixture[] = [
  {
    name: "01-landscape.jpg",
    mimeType: "image/jpeg",
    buffer: fromBase64(JPEG),
    orientation: "landscape",
  },
  {
    name: "02-portrait.png",
    mimeType: "image/png",
    buffer: makePng(2, 4, [220, 40, 40, 255]),
    orientation: "portrait",
  },
  {
    name: "03-landscape.webp",
    mimeType: "image/webp",
    buffer: fromBase64(WEBP),
    orientation: "landscape",
  },
  {
    name: "04-portrait.tiff",
    mimeType: "image/tiff",
    buffer: fromBase64(TIFF),
    orientation: "portrait",
  },
  {
    name: "05-landscape.bmp",
    mimeType: "image/bmp",
    buffer: fromBase64(BMP),
    orientation: "landscape",
  },
  {
    name: "06-portrait.gif",
    mimeType: "image/gif",
    buffer: fromBase64(GIF),
    orientation: "portrait",
  },
] as const;
