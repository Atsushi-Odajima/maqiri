// 元プレビュー: 選択元を直接再生。概略再生では HTML video の seek で削除区間を飛ぶ(最終精度ではないことを明示)。
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { FrameRange } from '@domain/ranges';
import { formatFrameClock, formatFrameTimecode } from '@domain/time';
import { OUTPUT_FPS } from '@shared/constants';
import { Icon } from './common';

export interface VideoPreviewHandle {
  seekFrame(frame: number): void;
  togglePlay(): void;
  stepFrame(delta: number): void;
}

export const VideoPreview = forwardRef<VideoPreviewHandle, { src: string; totalFrames: number; cuts: FrameRange[]; onFrame: (frame: number) => void; portrait: boolean }>(function VideoPreview({ src, totalFrames, cuts, onFrame, portrait }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const [skip, setSkip] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const cutsRef = useRef(cuts);
  cutsRef.current = cuts;
  const skipRef = useRef(skip);
  skipRef.current = skip;

  useImperativeHandle(ref, () => ({
    seekFrame(f) {
      const v = video.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(totalFrames - 1, f)) / OUTPUT_FPS + 0.0001;
    },
    togglePlay() {
      const v = video.current;
      if (!v) return;
      if (v.paused) void v.play().catch(() => undefined);
      else v.pause();
    },
    stepFrame(delta) {
      const v = video.current;
      if (!v) return;
      v.pause();
      const cur = Math.round(v.currentTime * OUTPUT_FPS);
      v.currentTime = Math.max(0, Math.min(totalFrames - 1, cur + delta)) / OUTPUT_FPS + 0.0001;
    }
  }));

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const t = v.currentTime;
      const f = Math.floor(t * OUTPUT_FPS);
      setFrame(f);
      onFrame(f);
      if (skipRef.current && !v.paused) {
        const hit = cutsRef.current.find((c) => f >= c.startFrame && f < c.endFrame);
        if (hit) v.currentTime = hit.endFrame / OUTPUT_FPS + 0.0001;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [onFrame]);

  return (
    <div className={`video-preview ink-panel${portrait ? ' portrait' : ''}`}>
      <div className="video-label label-mono" style={{ color: 'var(--paper)' }}>
        {skip ? '概略プレビュー(削除区間を飛ばします・最終精度ではありません)' : '元の動画'}
      </div>
      <video ref={video} src={src} preload="metadata" playsInline />
      <div className="video-bar on-dark">
        <button type="button" className="icon-btn on-dark" onClick={() => (video.current?.paused ? void video.current.play().catch(() => undefined) : video.current?.pause())} aria-label={playing ? '一時停止' : '再生'} style={{ filter: 'invert(1)' }}>
          <Icon name="play" />
        </button>
        <span className="num" aria-live="off" style={{ color: 'var(--paper)' }}>
          {formatFrameTimecode(frame)} / {formatFrameClock(totalFrames)}
        </span>
        <label className="row note" style={{ color: 'var(--paper)', marginLeft: 'auto' }}>
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> 削除区間を飛ばす(概略)
        </label>
      </div>
    </div>
  );
});
