const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const sourcePath = path.join(__dirname, '..', 'electron', 'icon.svg');
const outputPath = path.join(__dirname, '..', 'electron', 'icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;

  images.forEach(({ size, data }, index) => {
    const entry = directory.subarray(index * 16, (index + 1) * 16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map(({ data }) => data)]);
}

const svg = fs.readFileSync(sourcePath, 'utf8');
const images = sizes.map((size) => ({
  size,
  data: new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
}));

fs.writeFileSync(outputPath, makeIco(images));
console.log(`Generated ${path.relative(process.cwd(), outputPath)}`);
