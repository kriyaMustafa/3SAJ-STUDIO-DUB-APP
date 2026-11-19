import * as SQLite from 'expo-sqlite';
import { Project, SubtitleSegment, GlossaryEntry, AppSettings } from '../types/project';
import {
  CREATE_PROJECTS_TABLE,
  CREATE_SEGMENTS_TABLE,
  CREATE_GLOSSARY_TABLE,
  CREATE_SETTINGS_TABLE,
  CREATE_INDEXES,
} from './schema';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let dbWriteQueue = Promise.resolve();

/**
 * Serializes all SQLite write operations to prevent concurrent/nested transactions.
 */
export function enqueueDbWrite<T>(op: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    dbWriteQueue = dbWriteQueue.then(async () => {
      try {
        const result = await op();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync('saj_studio.db');
        await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
        await initDatabase(db);
        return db;
      } catch (err) {
        console.error('Failed to open SQLite database:', err);
        // Reset promise so next call can retry
        dbPromise = null;
        throw err;
      }
    })();
  }
  return dbPromise;
}

export async function initDatabase(db?: SQLite.SQLiteDatabase): Promise<void> {
  const targetDb = db || (await getDb());
  await targetDb.execAsync(`
    ${CREATE_PROJECTS_TABLE}
    ${CREATE_SEGMENTS_TABLE}
    ${CREATE_GLOSSARY_TABLE}
    ${CREATE_SETTINGS_TABLE}
    ${CREATE_INDEXES}
  `);
}

// ----------------- PROJECTS -----------------
export async function dbSaveProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO projects (
      id, name, video_path, srt_path, workspace_dir, created_at, updated_at,
      total_segments, translated_segments, audio_segments, export_path, is_exported, last_checkpoint_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      project.id,
      project.name,
      project.videoPath,
      project.srtPath,
      project.workspaceDir,
      project.createdAt,
      project.updatedAt,
      project.totalSegments,
      project.translatedSegments,
      project.audioSegments,
      project.exportPath || null,
      project.isExported ? 1 : 0,
      project.lastCheckpointSegmentId || 1,
    ]
  );
}

export async function dbGetAllProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM projects ORDER BY updated_at DESC;'
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    videoPath: r.video_path,
    srtPath: r.srt_path,
    workspaceDir: r.workspace_dir,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalSegments: r.total_segments,
    translatedSegments: r.translated_segments,
    audioSegments: r.audio_segments,
    exportPath: r.export_path ?? undefined,
    isExported: r.is_exported === 1,
    lastCheckpointSegmentId: r.last_checkpoint_id || 1,
  }));
}

export async function dbGetProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<any>(
    'SELECT * FROM projects WHERE id = ?;',
    [id]
  );
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    videoPath: r.video_path,
    srtPath: r.srt_path,
    workspaceDir: r.workspace_dir,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalSegments: r.total_segments,
    translatedSegments: r.translated_segments,
    audioSegments: r.audio_segments,
    exportPath: r.export_path ?? undefined,
    isExported: r.is_exported === 1,
    lastCheckpointSegmentId: r.last_checkpoint_id || 1,
  };
}

export async function dbDeleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM segments WHERE project_id = ?;', [id]);
  await db.runAsync('DELETE FROM projects WHERE id = ?;', [id]);
}

// ----------------- SEGMENTS & CHECKPOINTS -----------------
export async function dbSaveSegments(
  projectId: string,
  segments: SubtitleSegment[]
): Promise<void> {
  if (segments.length === 0) return;
  return enqueueDbWrite(async () => {
    const db = await getDb();
    // Direct sequential runAsync without withTransactionAsync to prevent nested transaction errors
    for (const seg of segments) {
      await db.runAsync(
        `INSERT OR REPLACE INTO segments (
          project_id, id, start_time, end_time, start_time_formatted, end_time_formatted,
          original_text, translated_text, gender, age_tone, audio_path, duration_ms, status, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          projectId,
          seg.id,
          seg.startTime,
          seg.endTime,
          seg.startTimeFormatted,
          seg.endTimeFormatted,
          seg.originalText,
          seg.translatedText,
          seg.gender,
          seg.ageTone,
          seg.audioPath,
          seg.durationMs,
          seg.status,
          seg.errorMessage || null,
        ]
      );
    }
  });
}

export async function dbUpdateSegment(
  projectId: string,
  seg: SubtitleSegment
): Promise<void> {
  return enqueueDbWrite(async () => {
    const db = await getDb();
    await db.runAsync(
      `UPDATE segments SET
        translated_text = ?,
        gender = ?,
        age_tone = ?,
        audio_path = ?,
        duration_ms = ?,
        status = ?,
        error_message = ?
      WHERE project_id = ? AND id = ?;`,
      [
        seg.translatedText,
        seg.gender,
        seg.ageTone,
        seg.audioPath,
        seg.durationMs,
        seg.status,
        seg.errorMessage || null,
        projectId,
        seg.id,
      ]
    );
  });
}

export async function dbGetSegments(projectId: string): Promise<SubtitleSegment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM segments WHERE project_id = ? ORDER BY id ASC;',
    [projectId]
  );

  return rows.map((r) => ({
    id: r.id,
    startTime: r.start_time,
    endTime: r.end_time,
    startTimeFormatted: r.start_time_formatted,
    endTimeFormatted: r.end_time_formatted,
    originalText: r.original_text,
    translatedText: r.translated_text || '',
    gender: r.gender,
    ageTone: r.age_tone,
    audioPath: r.audio_path,
    durationMs: r.duration_ms,
    status: r.status,
    errorMessage: r.error_message ?? undefined,
  }));
}

export async function dbGetCheckpointPendingSegment(
  projectId: string
): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM segments
     WHERE project_id = ? AND status != 'ready'
     ORDER BY id ASC LIMIT 1;`,
    [projectId]
  );
  return row ? row.id : null;
}

export async function dbUpdateProjectCheckpoint(
  projectId: string,
  checkpointId: number,
  translatedCount: number,
  audioCount: number
): Promise<void> {
  return enqueueDbWrite(async () => {
    const db = await getDb();
    await db.runAsync(
      `UPDATE projects SET
        last_checkpoint_id = ?,
        translated_segments = ?,
        audio_segments = ?,
        updated_at = ?
      WHERE id = ?;`,
      [checkpointId, translatedCount, audioCount, new Date().toISOString(), projectId]
    );
  });
}

// ----------------- GLOSSARY -----------------
export async function dbGetGlossary(): Promise<GlossaryEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM glossary ORDER BY source_term ASC;');
  return rows.map((r) => ({
    id: r.id,
    source: r.source_term,
    target: r.target_term,
  }));
}

export async function dbSaveGlossaryItem(source: string, target: string): Promise<void> {
  const db = await getDb();
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await db.runAsync(
    'INSERT OR REPLACE INTO glossary (id, source_term, target_term) VALUES (?, ?, ?);',
    [id, source.trim(), target.trim()]
  );
}

export async function dbDeleteGlossaryItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM glossary WHERE id = ?;', [id]);
}

// ----------------- SETTINGS CACHE -----------------
export async function dbSaveSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [key, value]);
}

export async function dbGetSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?;',
    [key]
  );
  return row ? row.value : null;
}
