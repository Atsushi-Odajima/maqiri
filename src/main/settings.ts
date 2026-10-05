// アプリ設定(userData/settings.json)。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CACHE_LIMIT_BYTES } from '@shared/constants';
import { atomicWriteFile } from './fsutil';

const schema = z.object({
  outputPreset: z.enum(['1080p30', '720p30']).default('1080p30'),
  cacheLimitBytes: z.number().int().min(256 * 1024 * 1024).default(CACHE_LIMIT_BYTES),
  lastExportDir: z.string().nullable().default(null),
  projectsDir: z.string().nullable().default(null)
});
export type AppSettings = z.infer<typeof schema>;

export class SettingsStore {
  private data: AppSettings = schema.parse({});
  private readonly file: string;
  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'settings.json');
  }
  async load(): Promise<AppSettings> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      const parsed = schema.safeParse(raw);
      if (parsed.success) this.data = parsed.data;
    } catch {
      /* defaults */
    }
    return this.data;
  }
  get(): AppSettings {
    return this.data;
  }
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.data = schema.parse({ ...this.data, ...patch });
    await atomicWriteFile(this.file, JSON.stringify(this.data, null, 2), false);
    return this.data;
  }
}
