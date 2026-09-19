import { readFileSync, writeFileSync } from 'node:fs';

const [summaryPath, outputPath] = process.argv.slice(2);

const coverageColors = [
  { minimum: 80, color: '#4c1' },
  { minimum: 60, color: '#dfb317' },
  { minimum: 0, color: '#e05d44' },
];

const labelWidth = 62;
const valueWidth = 54;

function colorFor(percentage) {
  return coverageColors.find(({ minimum }) => percentage >= minimum).color;
}

function renderBadge(percentage) {
  const value = `${percentage.toFixed(1)}%`;
  const width = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="coverage: ${value}">
  <rect width="${labelWidth}" height="20" fill="#555"/>
  <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${colorFor(percentage)}"/>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${labelWidth / 2}" y="14">coverage</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
writeFileSync(outputPath, renderBadge(summary.total.lines.pct));
