// S3 書き出し: 1080p30 / 720p30、元の縦横比維持、保存先、未確認候補数、進捗とキャンセル。
import { useStore } from '../state/store';
import { Dialog, ErrorCallout, ProgressBlock, formatBytes } from '../components/common';
import { OUTPUT_PRESETS, type OutputPresetId } from '@shared/constants';
import { fitOutputSize } from '@domain/outputSize';
import { formatFrameClock } from '@domain/time';

export function ExportDialog() {
  const s = useStore();
  const { exportState: ex, selected, result, reviewed, appInfo } = s;
  if (!ex.open || !selected || !result) return null;
  const unreviewed = result.candidates.filter((c) => c.status !== 'kept' && !reviewed.has(c.id)).length;
  const size = (p: OutputPresetId) => fitOutputSize(selected.displayWidth, selected.displayHeight, OUTPUT_PRESETS[p].maxLong, OUTPUT_PRESETS[p].maxShort);
  const busy = !!ex.job;
  const canStart = !!ex.destination && !busy && (unreviewed === 0 || ex.includeUnreviewed) && result.outputFrames > 0;
  return (
    <Dialog title="書き出し" onClose={busy ? undefined : s.closeExport}>
      <div className="stack loose">
        <div className="row between">
          <span className="body">出力の長さ</span>
          <span className="num">
            {formatFrameClock(result.outputFrames)}({result.outputFrames} フレーム / 30fps)
          </span>
        </div>
        <fieldset className="stack tight" disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="body">画質</legend>
          {(Object.keys(OUTPUT_PRESETS) as OutputPresetId[]).map((p) => {
            const sz = size(p);
            return (
              <label key={p} className="row">
                <input type="radio" name="preset" checked={ex.outputPreset === p} onChange={() => s.setExportPreset(p)} />
                <span>
                  {OUTPUT_PRESETS[p].label} — 出力 {sz.width}×{sz.height}(元の縦横比を維持、拡大しません)
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="stack tight">
          <div className="row between wrap">
            <span className="body">保存先</span>
            <button type="button" className="btn small" onClick={() => void s.pickDestination()} disabled={busy}>
              {ex.destination ? '保存先を変更…' : '保存先を選ぶ…'}
            </button>
          </div>
          {ex.destination && (
            <p className="note">
              {ex.destination.folderDisplay} / <strong>{ex.destination.basename}</strong> — 空き {formatBytes(ex.destination.freeBytes)}(必要 約 {formatBytes(ex.destination.requiredBytes)})
              {ex.destination.willOverwrite && <span className="callout warning" style={{ display: 'block', marginTop: 8 }}>同名のファイルがあります。保存すると上書きします。</span>}
            </p>
          )}
        </div>
        {unreviewed > 0 && (
          <label className="row callout warning" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={ex.includeUnreviewed} onChange={(e) => s.setIncludeUnreviewed(e.target.checked)} disabled={busy} style={{ marginTop: 6 }} />
            <span>
              つなぎ目を確認していない候補が {unreviewed} 件あります。小声がカット候補に含まれることがあります。確認せずに保存する場合はチェックしてください。
            </span>
          </label>
        )}
        {appInfo?.edition === 'demo' && <p className="callout info">デモ版は先頭 90 秒だけを書き出します。</p>}
        {ex.error && <ErrorCallout error={ex.error} onRetry={ex.error.code === 'E_SPACE' || ex.error.code === 'E_SAME_PATH' || ex.error.code === 'E_NETWORK_DRIVE' ? () => void s.pickDestination() : () => void s.startExport()} retryLabel={ex.error.code === 'E_SPACE' || ex.error.code === 'E_SAME_PATH' || ex.error.code === 'E_NETWORK_DRIVE' ? '保存先を変更' : '再試行'} />}
        {ex.progress && <ProgressBlock stage={ex.progress.stage} ratio={ex.progress.ratio} onCancel={() => void s.cancelExport()} />}
        <div className="row between">
          <button type="button" className="btn ghost" onClick={s.closeExport} disabled={busy}>
            閉じる
          </button>
          <button type="button" className="btn primary" onClick={() => void s.startExport()} disabled={!canStart}>
            {unreviewed > 0 && ex.includeUnreviewed ? '未確認を含めて保存' : 'この設定で保存'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
