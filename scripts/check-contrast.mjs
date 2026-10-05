#!/usr/bin/env node
// ブランド色のコントラスト自動検査(WCAG 2.x 相対輝度)。本文 4.5:1、大見出し/非テキスト 3:1。
const colors = { paper: '#EFE6D8', surface: '#F8F3EB', ink: '#27221E', muted: '#655B52', accent: '#D75936', action: '#A83923', actionText: '#FFF9F0', border: '#BFB4A6', borderFunctional: '#817365', success: '#31594D', warning: '#754D14', error: '#A42A2A', selected: '#EFCAB4' };
function lum(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const checks = [
  ['本文 ink / paper', colors.ink, colors.paper, 4.5],
  ['本文 ink / surface', colors.ink, colors.surface, 4.5],
  ['補助 muted / paper', colors.muted, colors.paper, 4.5],
  ['補助 muted / surface', colors.muted, colors.surface, 4.5],
  ['主ボタン文字 / action', colors.actionText, colors.action, 4.5],
  ['選択面の文字 ink / selected', colors.ink, colors.selected, 4.5],
  ['warning 文字 / surface', colors.warning, colors.surface, 4.5],
  ['error 文字 / surface', colors.error, colors.surface, 4.5],
  ['success 文字 / surface', colors.success, colors.surface, 4.5],
  ['非テキスト accent / paper', colors.accent, colors.paper, 3],
  ['機能境界 borderFunctional / paper', colors.borderFunctional, colors.paper, 3],
  ['機能境界 borderFunctional / surface', colors.borderFunctional, colors.surface, 3],
  ['focus ring action / paper', colors.action, colors.paper, 3],
  ['paper 文字 / ink 面', colors.paper, colors.ink, 4.5]
];
let failed = 0;
for (const [name, fg, bg, min] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.toFixed(2)}:1 (>= ${min}) ${name}`);
}
console.log(`注意: 装飾的な区切り(border #BFB4A6)は機能的境界ではないため検査対象外。`);
process.exit(failed ? 1 : 0);
