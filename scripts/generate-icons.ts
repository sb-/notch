import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const svgPath = join(import.meta.dir, '../src-tauri/icons/icon.svg');
const iconsDir = join(import.meta.dir, '../src-tauri/icons');
const iconsetDir = join(iconsDir, 'icon.iconset');

if (!existsSync(iconsetDir)) {
  mkdirSync(iconsetDir, { recursive: true });
}

const svg = readFileSync(svgPath, 'utf-8');

// Tauri icons
const tauriSizes = [
  { name: 'icon.png', size: 512 },
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
];

// macOS iconset sizes
const iconsetSizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

function generatePng(size: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: size,
    },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

// Generate Tauri icons
for (const { name, size } of tauriSizes) {
  writeFileSync(join(iconsDir, name), generatePng(size));
  console.log(`Generated ${name} (${size}x${size})`);
}

// Generate macOS iconset
for (const { name, size } of iconsetSizes) {
  writeFileSync(join(iconsetDir, name), generatePng(size));
  console.log(`Generated iconset/${name} (${size}x${size})`);
}

console.log('\nAll icons generated!');
console.log('Run: iconutil -c icns src-tauri/icons/icon.iconset -o src-tauri/icons/icon.icns');
