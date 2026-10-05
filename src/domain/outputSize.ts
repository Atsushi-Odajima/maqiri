/** 出力寸法: 縦横比維持、拡大禁止、偶数へ丸め。OS 依存なしの純粋関数。 */
export function fitOutputSize(displayWidth: number, displayHeight: number, maxLong: number, maxShort: number): { width: number; height: number } {
  const landscape = displayWidth >= displayHeight;
  const maxW = landscape ? maxLong : maxShort;
  const maxH = landscape ? maxShort : maxLong;
  const scale = Math.min(1, maxW / displayWidth, maxH / displayHeight);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(displayWidth * scale), height: even(displayHeight * scale) };
}
