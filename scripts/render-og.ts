import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('static/og-image.svg', 'utf8');
const resvg = new Resvg(svg, { fitTo: { mode: 'width', width: 1200 }, font: { loadSystemFonts: true } });
const png = resvg.render().asPng();
writeFileSync('static/og-image.png', png);
console.log(`static/og-image.png regenerated (${png.length} bytes, 1200x630)`);
