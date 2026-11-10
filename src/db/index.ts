import Dexie, { type Table } from 'dexie';

export interface TranscriptRecord {
  id?: number;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  durationSeconds: number;
  language: string;
  aiSummary?: string;
  aiActionItems?: string;
  aiPolished?: string;
}

export interface AppSetting {
  key: string;
  value: any;
}

export class AutoTranscriptDB extends Dexie {
  transcripts!: Table<TranscriptRecord, number>;
  settings!: Table<AppSetting, string>;

  constructor() {
    super('AutoTranscriptDB');
    this.version(1).stores({
      transcripts: '++id, title, createdAt, updatedAt, language',
      settings: 'key'
    });
  }
}

export const db = new AutoTranscriptDB();

// Helper functions for settings
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const item = await db.settings.get(key);
  if (item && item.value !== undefined) {
    return item.value as T;
  }
  return defaultValue;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}
