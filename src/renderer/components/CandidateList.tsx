// カット候補一覧(仮想化)。元時刻で昇順。開始/終了/除去秒/採用・保持。
import { useRef, useState, type KeyboardEvent } from 'react';
import type { CandidateView } from '@domain/keeps';
import { formatFrameTimecode, formatFramesAsSeconds } from '@domain/time';

const ROW_H = 48;
const VIEW_H = 320;

export function CandidateList({ candidates, selectedId, reviewed, onSelect, onToggleKeep }: { candidates: CandidateView[]; selectedId: string | null; reviewed: Set<string>; onSelect: (id: string) => void; onToggleKeep: (id: string) => void }) {
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const total = candidates.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const last = Math.min(total, Math.ceil((scrollTop + VIEW_H) / ROW_H) + 5);
  const visible = candidates.slice(first, last);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = candidates.findIndex((c) => c.id === selectedId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const n = candidates[Math.min(total - 1, idx + 1)];
      if (n) onSelect(n.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const n = candidates[Math.max(0, idx - 1)];
      if (n) onSelect(n.id);
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault();
      onToggleKeep(selectedId);
    }
  };

  return (
    <div className="candidate-list surface" role="listbox" aria-label="カット候補一覧" tabIndex={0} onKeyDown={onKey} aria-activedescendant={selectedId ? `cand-${selectedId}` : undefined}>
      <div className="candidate-head label-mono" aria-hidden="true">
        <span>#</span>
        <span>開始</span>
        <span>終了</span>
        <span>除去</span>
        <span>状態</span>
        <span>操作</span>
      </div>
      <div className="candidate-scroll" style={{ height: Math.min(VIEW_H, Math.max(ROW_H, total * ROW_H)) }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} ref={ref}>
        <div style={{ height: total * ROW_H, position: 'relative' }}>
          {visible.map((c, i) => {
            const index = first + i;
            const selected = c.id === selectedId;
            const statusLabel = c.status === 'cut' ? '採用' : c.status === 'kept' ? '保持' : '一部保持';
            return (
              <div
                key={c.id}
                id={`cand-${c.id}`}
                role="option"
                aria-selected={selected}
                className={`candidate-row${selected ? ' selected' : ''}`}
                style={{ top: index * ROW_H, height: ROW_H }}
                onClick={() => onSelect(c.id)}
              >
                <span className="num" style={{ fontSize: 14 }}>
                  {index + 1}
                </span>
                <span className="num">{formatFrameTimecode(c.startFrame)}</span>
                <span className="num">{formatFrameTimecode(c.endFrame)}</span>
                <span className="num">{formatFramesAsSeconds(c.removedFrames)}秒</span>
                <span className={`status ${c.status}`}>
                  {statusLabel}
                  {reviewed.has(c.id) ? ' ✓' : ''}
                </span>
                <span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleKeep(c.id);
                    }}
                    aria-label={c.status === 'kept' ? `${index + 1} 番の間を再び詰める` : `${index + 1} 番の間を残す`}
                  >
                    {c.status === 'kept' ? '再び詰める' : 'この間を残す'}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {total === 0 && <p className="note" style={{ padding: 16 }}>カット候補はありません。</p>}
    </div>
  );
}
