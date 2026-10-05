// 仕上がりの間隔: プリセット 3 種 + 初心者向け「残す間」「検出する長さ」+ 詳細(閾値/前後余白を個別)。
import { useId, useState } from 'react';
import { matchPreset, splitTotalPad, type AnalysisSettings } from '@domain/settings';
import { PRESETS, SETTINGS_LIMITS, type PresetId } from '@shared/constants';

function Slider({ id, label, value, min, max, step, unit, format, onChange, hint }: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; format?: (v: number) => string; onChange: (v: number) => void; hint?: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="setting">
      <div className="row between">
        <label htmlFor={id} className="body">
          {label}
        </label>
        <span className="num" aria-hidden="true">
          {format ? format(value) : value} {unit}
        </span>
      </div>
      <input id={id} className="slider" type="range" min={min} max={max} step={step} value={value} style={{ ['--fill' as string]: `${fill}%` }} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={`${format ? format(value) : value} ${unit}`} />
      {hint && <p className="note">{hint}</p>}
    </div>
  );
}

export function SettingsPanel({ settings, onPreset, onChange, disabled }: { settings: AnalysisSettings; onPreset: (id: PresetId) => void; onChange: (patch: Partial<AnalysisSettings>) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const active = matchPreset(settings);
  const totalPad = settings.padBeforeMs + settings.padAfterMs;
  return (
    <section className="settings-panel" aria-labelledby={`${baseId}-h`}>
      <h2 className="heading-sm" id={`${baseId}-h`}>
        仕上がりの間隔
      </h2>
      <div className="preset-row" role="radiogroup" aria-label="プリセット">
        {(Object.keys(PRESETS) as PresetId[]).map((id) => (
          <button key={id} type="button" role="radio" aria-checked={active === id} className={`btn preset${active === id ? ' selected' : ''}`} onClick={() => onPreset(id)} disabled={disabled}>
            {PRESETS[id].label}
          </button>
        ))}
      </div>
      <p className="note">{active ? PRESETS[active].note : 'カスタム設定です。'}</p>
      <Slider
        id={`${baseId}-pad`}
        label="残す間"
        value={totalPad}
        min={SETTINGS_LIMITS.padBeforeMs.min + SETTINGS_LIMITS.padAfterMs.min}
        max={SETTINGS_LIMITS.padBeforeMs.max + SETTINGS_LIMITS.padAfterMs.max}
        step={20}
        unit="秒"
        format={(v) => (v / 1000).toFixed(2)}
        onChange={(v) => onChange(splitTotalPad(v))}
        hint="声の前後を保護する余白。元に存在する無音だけを残します。"
      />
      <Slider id={`${baseId}-min`} label="検出する長さ" value={settings.minSilenceMs} min={SETTINGS_LIMITS.minSilenceMs.min} max={SETTINGS_LIMITS.minSilenceMs.max} step={SETTINGS_LIMITS.minSilenceMs.step} unit="秒" format={(v) => (v / 1000).toFixed(2)} onChange={(v) => onChange({ minSilenceMs: v })} hint="これより長い無音だけを候補にします。" />
      <details className="detail" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>詳細設定</summary>
        <div className="stack mt-3">
          <Slider
            id={`${baseId}-th`}
            label="小さい声を残す"
            value={settings.thresholdDb}
            min={SETTINGS_LIMITS.thresholdDb.min}
            max={SETTINGS_LIMITS.thresholdDb.max}
            step={SETTINGS_LIMITS.thresholdDb.step}
            unit="dBFS"
            onChange={(v) => onChange({ thresholdDb: v })}
            hint="値を小さく(より負に)すると、小声も「話している」と判定して残します。例: -35 は囁き声程度、-45 は息づかい程度まで残します。"
          />
          <Slider id={`${baseId}-pb`} label="直前の発話後を残す" value={settings.padBeforeMs} min={SETTINGS_LIMITS.padBeforeMs.min} max={SETTINGS_LIMITS.padBeforeMs.max} step={SETTINGS_LIMITS.padBeforeMs.step} unit="ms" onChange={(v) => onChange({ padBeforeMs: v })} />
          <Slider id={`${baseId}-pa`} label="次の発話前を残す" value={settings.padAfterMs} min={SETTINGS_LIMITS.padAfterMs.min} max={SETTINGS_LIMITS.padAfterMs.max} step={SETTINGS_LIMITS.padAfterMs.step} unit="ms" onChange={(v) => onChange({ padAfterMs: v })} />
        </div>
      </details>
      <p className="note">小声や操作中の無音は、残せます。語尾が切れる場合は、つなぎ目を聞いて「この間を残す」で戻してください。</p>
    </section>
  );
}
