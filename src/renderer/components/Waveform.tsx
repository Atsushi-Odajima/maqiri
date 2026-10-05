// 波形: 実際の RMS 窓(20ms)から描く。削除候補は accent の輪郭+網掛け、保持は success の輪郭。装飾として勝手に動かさない。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateView } from '@domain/keeps';
import { OUTPUT_FPS } from '@shared/constants';

export interface WaveformProps {
  windowDb: Float32Array;
  totalFrames: number;
  candidates: CandidateView[];
  selectedId: string | null;
  playheadFrame: number;
  onSeek: (frame: number) => void;
  onSelect: (id: string | null) => void;
}

const COLORS = { ink: '#27221E', accent: '#D75936', success: '#31594D', warning: '#754D14', muted: '#655B52', paper: '#EFE6D8', selected: '#EFCAB4' };

export function Waveform({ windowDb, totalFrames, candidates, selectedId, playheadFrame, onSeek, onSelect }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const height = 120;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(200, Math.floor(containerWidth * zoom));
  const pxPerFrame = width / Math.max(1, totalFrames);

  // 列ごとの最大 dB(間引き)
  const columns = useMemo(() => {
    const cols = new Float32Array(width);
    const windowsPerFrame = 1600 / 960;
    for (let x = 0; x < width; x++) {
      const f0 = (x / width) * totalFrames;
      const f1 = ((x + 1) / width) * totalFrames;
      const w0 = Math.floor(f0 * windowsPerFrame);
      const w1 = Math.max(w0 + 1, Math.ceil(f1 * windowsPerFrame));
      let m = -160;
      for (let w = w0; w < w1 && w < windowDb.length; w++) m = Math.max(m, windowDb[w] ?? -160);
      cols[x] = m;
    }
    return cols;
  }, [windowDb, width, totalFrames]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const mid = height / 2;
    // 候補領域(背景)
    for (const c of candidates) {
      const x0 = c.startFrame * pxPerFrame;
      const x1 = c.endFrame * pxPerFrame;
      const sel = c.id === selectedId;
      if (c.status === 'kept') {
        ctx.strokeStyle = COLORS.success;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(x0 + 0.5, 6.5, Math.max(1, x1 - x0 - 1), height - 13);
        ctx.setLineDash([]);
        continue;
      }
      for (const p of c.effective) {
        const px0 = p.startFrame * pxPerFrame;
        const px1 = p.endFrame * pxPerFrame;
        ctx.fillStyle = sel ? COLORS.selected : 'rgba(215,89,54,0.08)';
        ctx.fillRect(px0, 6, Math.max(1, px1 - px0), height - 12);
        // 網掛け
        ctx.save();
        ctx.beginPath();
        ctx.rect(px0, 6, Math.max(1, px1 - px0), height - 12);
        ctx.clip();
        ctx.strokeStyle = 'rgba(215,89,54,0.45)';
        ctx.lineWidth = 1;
        for (let x = px0 - height; x < px1 + height; x += 8) {
          ctx.beginPath();
          ctx.moveTo(x, height);
          ctx.lineTo(x + height, 0);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(px0 + 0.5, 6.5, Math.max(1, px1 - px0 - 1), height - 13);
      }
      if (c.status === 'partial') {
        ctx.strokeStyle = COLORS.warning;
        ctx.setLineDash([2, 4]);
        ctx.strokeRect(x0 + 0.5, 2.5, Math.max(1, x1 - x0 - 1), height - 5);
        ctx.setLineDash([]);
      }
    }
    // 波形バー
    ctx.fillStyle = COLORS.ink;
    for (let x = 0; x < width; x++) {
      const db = columns[x] ?? -160;
      const amp = Math.max(0, Math.min(1, (db + 60) / 60));
      const h = Math.max(1, amp * (height - 24));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    // 中心線
    ctx.fillStyle = COLORS.muted;
    ctx.fillRect(0, mid, width, 1);
    // 再生位置
    const px = playheadFrame * pxPerFrame;
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(px - 1, 0, 2, height);
  }, [columns, candidates, selectedId, playheadFrame, width, pxPerFrame]);

  // 選択候補が見えるようスクロール
  useEffect(() => {
    const el = scrollRef.current;
    const c = candidates.find((x) => x.id === selectedId);
    if (!el || !c) return;
    const x = c.startFrame * pxPerFrame;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
  }, [selectedId, candidates, pxPerFrame]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.max(0, Math.min(totalFrames - 1, Math.floor(x / pxPerFrame)));
    const hit = candidates.find((c) => frame >= c.startFrame && frame < c.endFrame);
    onSelect(hit ? hit.id : null);
    onSeek(frame);
  };

  return (
    <div className="waveform">
      <div className="row between mb-2">
        <span className="label-mono">音量(20ms RMS)</span>
        <div className="row" role="group" aria-label="波形の拡大率">
          <button type="button" className="btn small" onClick={() => setZoom((z) => Math.max(1, z / 2))} disabled={zoom <= 1} aria-label="波形を縮小">
            −
          </button>
          <span className="num" style={{ fontSize: 14 }}>
            ×{zoom}
          </span>
          <button type="button" className="btn small" onClick={() => setZoom((z) => Math.min(32, z * 2))} disabled={zoom >= 32} aria-label="波形を拡大">
            ＋
          </button>
        </div>
      </div>
      <div className="waveform-scroll" ref={scrollRef}>
        <canvas ref={canvasRef} style={{ width, height, display: 'block', cursor: 'pointer' }} onClick={onClick} role="img" aria-label={`波形。${candidates.length} 件のカット候補。クリックで位置を選択。`} />
      </div>
      <div className="row between note mt-2">
        <span>0:00</span>
        <span>{Math.floor(totalFrames / OUTPUT_FPS / 60)}:{String(Math.floor((totalFrames / OUTPUT_FPS) % 60)).padStart(2, '0')}</span>
      </div>
    </div>
  );
}
