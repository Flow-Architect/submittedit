import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repositoryRoot, "packages/ui/assets/brand/submittedit-mark.svg");
const outputDirectory = resolve(repositoryRoot, "apps/extension/public");
const sizes = [16, 32, 48, 128];
const supersampling = 4;
const checkOnly = process.argv.includes("--check");

const parseAttributes = (source) => {
  const attributes = {};
  const attributePattern = /([A-Za-z][A-Za-z0-9:-]*)="([^"]*)"/g;

  for (const match of source.matchAll(attributePattern)) {
    attributes[match[1]] = match[2];
  }

  return attributes;
};

const parseColor = (value) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`Unsupported SVG color: ${value}`);
  }

  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    255,
  ];
};

const source = readFileSync(sourcePath, "utf8");
const svgAttributes = parseAttributes(source.match(/<svg\b[^>]*>/)?.[0] ?? "");

if (svgAttributes.viewBox !== "0 0 128 128") {
  throw new Error("The canonical mark must use viewBox 0 0 128 128.");
}

if (/<(?:path|circle|ellipse|polygon|polyline|image|use|script)\b/i.test(source)) {
  throw new Error("The icon generator supports the canonical rect-only SVG subset.");
}

const rectangles = [...source.matchAll(/<rect\b([^>]*)\/>/g)].map((match) => {
  const attributes = parseAttributes(match[1]);
  const x = Number(attributes.x);
  const y = Number(attributes.y);
  const width = Number(attributes.width);
  const height = Number(attributes.height);
  const radius = Number(attributes.rx ?? 0);

  if (![x, y, width, height, radius].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error(`Invalid canonical mark rectangle: ${match[0]}`);
  }

  return {
    color: parseColor(attributes.fill),
    height,
    radius: Math.min(radius, width / 2, height / 2),
    width,
    x,
    y,
  };
});

if (rectangles.length !== 11) {
  throw new Error(`Expected 11 canonical mark rectangles, found ${rectangles.length}.`);
}

const isInsideRoundedRectangle = (pointX, pointY, rectangle, scale) => {
  const x = rectangle.x * scale;
  const y = rectangle.y * scale;
  const width = rectangle.width * scale;
  const height = rectangle.height * scale;
  const radius = rectangle.radius * scale;

  if (pointX < x || pointX >= x + width || pointY < y || pointY >= y + height) {
    return false;
  }

  if (radius === 0) {
    return true;
  }

  const closestX = Math.max(x + radius, Math.min(pointX, x + width - radius));
  const closestY = Math.max(y + radius, Math.min(pointY, y + height - radius));
  const deltaX = pointX - closestX;
  const deltaY = pointY - closestY;

  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
};

const render = (size) => {
  const highSize = size * supersampling;
  const scale = highSize / 128;
  const highPixels = new Uint8Array(highSize * highSize * 4);

  for (const rectangle of rectangles) {
    for (let pixelY = 0; pixelY < highSize; pixelY += 1) {
      for (let pixelX = 0; pixelX < highSize; pixelX += 1) {
        if (!isInsideRoundedRectangle(pixelX + 0.5, pixelY + 0.5, rectangle, scale)) {
          continue;
        }

        const offset = (pixelY * highSize + pixelX) * 4;
        highPixels.set(rectangle.color, offset);
      }
    }
  }

  const pixels = new Uint8Array(size * size * 4);
  const sampleCount = supersampling * supersampling;

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      let alphaTotal = 0;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;

      for (let sampleY = 0; sampleY < supersampling; sampleY += 1) {
        for (let sampleX = 0; sampleX < supersampling; sampleX += 1) {
          const sourceX = pixelX * supersampling + sampleX;
          const sourceY = pixelY * supersampling + sampleY;
          const sourceOffset = (sourceY * highSize + sourceX) * 4;
          const alpha = highPixels[sourceOffset + 3];

          alphaTotal += alpha;
          redTotal += highPixels[sourceOffset] * alpha;
          greenTotal += highPixels[sourceOffset + 1] * alpha;
          blueTotal += highPixels[sourceOffset + 2] * alpha;
        }
      }

      const targetOffset = (pixelY * size + pixelX) * 4;
      const alpha = Math.round(alphaTotal / sampleCount);

      if (alphaTotal > 0) {
        pixels[targetOffset] = Math.round(redTotal / alphaTotal);
        pixels[targetOffset + 1] = Math.round(greenTotal / alphaTotal);
        pixels[targetOffset + 2] = Math.round(blueTotal / alphaTotal);
      }

      pixels[targetOffset + 3] = alpha;
    }
  }

  return pixels;
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

const crc32 = (buffer) => {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
};

const createChunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));

  return Buffer.concat([length, typeBuffer, data, checksum]);
};

const adler32 = (buffer) => {
  let first = 1;
  let second = 0;

  for (const byte of buffer) {
    first = (first + byte) % 65521;
    second = (second + first) % 65521;
  }

  return ((second << 16) | first) >>> 0;
};

const encodeStoredDeflate = (buffer) => {
  const chunks = [Buffer.from([0x78, 0x01])];

  for (let offset = 0; offset < buffer.length; offset += 65535) {
    const block = buffer.subarray(offset, Math.min(offset + 65535, buffer.length));
    const header = Buffer.alloc(5);
    const isFinal = offset + block.length === buffer.length;

    header[0] = isFinal ? 0x01 : 0x00;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(0xffff - block.length, 3);
    chunks.push(header, block);
  }

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(buffer));
  chunks.push(checksum);

  return Buffer.concat(chunks);
};

const encodePng = (size, pixels) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const scanlines = Buffer.alloc(size * (size * 4 + 1));

  for (let row = 0; row < size; row += 1) {
    const targetOffset = row * (size * 4 + 1);
    scanlines[targetOffset] = 0;
    scanlines.set(pixels.subarray(row * size * 4, (row + 1) * size * 4), targetOffset + 1);
  }

  return Buffer.concat([
    signature,
    createChunk("IHDR", header),
    createChunk("IDAT", encodeStoredDeflate(scanlines)),
    createChunk("IEND", Buffer.alloc(0)),
  ]);
};

mkdirSync(outputDirectory, { recursive: true });

for (const size of sizes) {
  const outputPath = resolve(outputDirectory, `icon-${size}.png`);
  const generated = encodePng(size, render(size));

  if (checkOnly) {
    let existing;

    try {
      existing = readFileSync(outputPath);
    } catch {
      throw new Error(`Missing generated icon: ${outputPath}`);
    }

    if (!existing.equals(generated)) {
      throw new Error(`Generated icon is stale: ${outputPath}`);
    }
  } else {
    writeFileSync(outputPath, generated);
  }
}

console.log(
  checkOnly
    ? `Icon assets are reproducible at ${sizes.join(", ")} pixels.`
    : `Generated SubmittedIt icons at ${sizes.join(", ")} pixels.`,
);
