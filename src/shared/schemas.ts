// Zod スキーマ: プロジェクトファイル(.maqiri.json) と IPC ペイロード。
import { z } from 'zod';
import { MAX_CANDIDATES, SETTINGS_LIMITS } from './constants';
import type { IpcChannelName } from './channels';

export const frameInt = z.number().int().min(0).max(10_000_000);

export const frameRangeSchema = z
  .object({ startFrame: frameInt, endFrame: frameInt })
  .refine((r) => r.endFrame > r.startFrame, { message: 'endFrame must be > startFrame' });

export const settingsSchema = z.object({
  thresholdDb: z.number().int().min(SETTINGS_LIMITS.thresholdDb.min).max(SETTINGS_LIMITS.thresholdDb.max),
  minSilenceMs: z.number().int().min(SETTINGS_LIMITS.minSilenceMs.min).max(SETTINGS_LIMITS.minSilenceMs.max),
  padBeforeMs: z.number().int().min(SETTINGS_LIMITS.padBeforeMs.min).max(SETTINGS_LIMITS.padBeforeMs.max),
  padAfterMs: z.number().int().min(SETTINGS_LIMITS.padAfterMs.min).max(SETTINGS_LIMITS.padAfterMs.max)
});

export const outputPresetSchema = z.enum(['1080p30', '720p30']);

export const projectSettingsSchema = settingsSchema.extend({ outputPreset: outputPresetSchema });

const nonNegInt = z.number().int().min(0);
const posInt = z.number().int().min(1);

export const projectSourceSchema = z.object({
  basename: z.string().min(1).max(255),
  /** 絶対パスはプロジェクトにのみ保存し、レンダラーへは渡さない */
  absolutePath: z.string().min(1).max(32767),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: nonNegInt,
  mtimeMs: nonNegInt,
  durationUs: posInt,
  firstVideoPtsUs: z.number().int(),
  videoStreamIndex: nonNegInt,
  audioStreamIndex: nonNegInt,
  displayWidth: posInt,
  displayHeight: posInt,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  frameRateNum: posInt,
  frameRateDen: posInt,
  sampleRate: posInt,
  channels: z.number().int().min(1).max(2),
  codec: z.string().min(1).max(32),
  colorInfo: z.object({
    range: z.string().nullable(),
    space: z.string().nullable(),
    transfer: z.string().nullable(),
    primaries: z.string().nullable(),
    pixFmt: z.string(),
    assumedBt709: z.boolean()
  })
});

export const keepRangeSchema = frameRangeSchema.safeExtend({
  id: z.string().min(1).max(64),
  reason: z.enum(['user-keep', 'edge-adjust']),
  candidateId: z.string().max(64).optional()
});

export const manualCutRangeSchema = frameRangeSchema.safeExtend({
  id: z.string().min(1).max(64),
  runStartMs: nonNegInt,
  runEndMs: nonNegInt
});

export const cutRangeSchema = frameRangeSchema.safeExtend({
  id: z.string().min(1).max(64),
  candidateId: z.string().min(1).max(64),
  reason: z.enum(['auto', 'adjusted'])
});

export const lastExportSchema = z.object({
  exportedAt: z.string(),
  outputBasename: z.string(),
  outputFrames: nonNegInt,
  outputPreset: outputPresetSchema,
  revision: nonNegInt
});

export const projectSchema = z.object({
  product: z.literal('Maqiri'),
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: projectSourceSchema,
  settings: projectSettingsSchema,
  manualKeepRanges: z.array(keepRangeSchema).max(MAX_CANDIDATES * 4),
  manualCutRanges: z.array(manualCutRangeSchema).max(MAX_CANDIDATES * 4).default([]),
  cutRanges: z.array(cutRangeSchema).max(MAX_CANDIDATES * 2),
  algorithmVersion: z.string().min(1).max(32),
  revision: nonNegInt,
  lastExport: lastExportSchema.nullable()
});

export type ProjectFile = z.infer<typeof projectSchema>;
export type ProjectSource = z.infer<typeof projectSourceSchema>;

/** スキーマ版だけ先に読む。未知版は編集せずエラー。 */
export const projectHeaderSchema = z.object({ product: z.string(), schemaVersion: z.number() });

export const recentFileSchema = z.object({
  entries: z
    .array(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().max(120),
        sourceBasename: z.string().max(255),
        updatedAt: z.string(),
        projectPath: z.string().max(32767)
      })
    )
    .max(50)
});

// ---- IPC payloads ----
export const uuidSchema = z.string().uuid();
export const assetIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const jobIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/);

export const ipcSchemas = {
  'source:pick': z.object({}).strict(),
  'source:useSample': z.object({}).strict(),
  'source:probe': z.object({ assetId: assetIdSchema }).strict(),
  'source:hash': z.object({ assetId: assetIdSchema }).strict(),
  'source:selectAudio': z.object({ assetId: assetIdSchema, audioStreamIndex: nonNegInt }).strict(),
  'analysis:start': z.object({ assetId: assetIdSchema }).strict(),
  'job:cancel': z.object({ jobId: jobIdSchema }).strict(),
  'junction:generate': z
    .object({
      assetId: assetIdSchema,
      candidateId: z.string().min(1).max(64),
      revision: nonNegInt,
      cut: frameRangeSchema,
      outputWidth: posInt,
      outputHeight: posInt
    })
    .strict(),
  'preview:render': z
    .object({
      assetId: assetIdSchema,
      kind: z.enum(['proxy', 'full']),
      revision: nonNegInt,
      cutRanges: z.array(frameRangeSchema).max(MAX_CANDIDATES * 2)
    })
    .strict(),
  'export:pickDestination': z
    .object({
      assetId: assetIdSchema,
      suggestedBasename: z.string().min(1).max(200),
      outputPreset: outputPresetSchema,
      outputFrames: nonNegInt
    })
    .strict(),
  'export:start': z
    .object({
      assetId: assetIdSchema,
      destinationToken: tokenSchema,
      outputPreset: outputPresetSchema,
      cutRanges: z.array(frameRangeSchema).max(MAX_CANDIDATES * 2),
      revision: nonNegInt,
      settings: settingsSchema,
      projectId: uuidSchema.nullable(),
      overwriteConfirmed: z.boolean()
    })
    .strict(),
  'export:openResult': z.object({ exportToken: tokenSchema, action: z.enum(['play', 'reveal']) }).strict(),
  'project:save': z
    .object({
      project: projectSchema.omit({ source: true }).extend({ assetId: assetIdSchema }),
      saveAs: z.boolean()
    })
    .strict(),
  'project:open': z.object({ projectId: uuidSchema.nullable() }).strict(),
  'project:relink': z.object({ projectId: uuidSchema }).strict(),
  'project:listRecent': z.object({}).strict(),
  'project:exportCuts': z
    .object({
      assetId: assetIdSchema,
      format: z.enum(['csv', 'json']),
      cutRanges: z.array(cutRangeSchema).max(MAX_CANDIDATES * 2),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      basename: z.string().min(1).max(255)
    })
    .strict(),
  'app:getInfo': z.object({}).strict(),
  'app:openHelp': z.object({ topic: z.enum(['formats', 'license', 'privacy']) }).strict(),
  'cache:clear': z.object({}).strict(),
  'cache:info': z.object({}).strict(),
  'diagnostics:read': z.object({}).strict(),
  'settings:get': z.object({}).strict(),
  'settings:set': z.object({ outputPreset: outputPresetSchema.optional(), cacheLimitBytes: nonNegInt.optional() }).strict(),
  'recovery:list': z.object({}).strict(),
  'recovery:resolve': z.object({ recoveryToken: tokenSchema, action: z.enum(['restore', 'discard']) }).strict()
} as const;

export type IpcChannel = keyof typeof ipcSchemas;
// channels.ts の一覧と一致することをコンパイル時に確認する
type _AssertChannels = [IpcChannel] extends [IpcChannelName] ? ([IpcChannelName] extends [IpcChannel] ? true : never) : never;
const _channelsMatch: _AssertChannels = true;
void _channelsMatch;
export type IpcPayload<C extends IpcChannel> = z.infer<(typeof ipcSchemas)[C]>;
