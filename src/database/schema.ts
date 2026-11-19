export const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  video_path TEXT NOT NULL,
  srt_path TEXT NOT NULL,
  workspace_dir TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  total_segments INTEGER DEFAULT 0,
  translated_segments INTEGER DEFAULT 0,
  audio_segments INTEGER DEFAULT 0,
  export_path TEXT,
  is_exported INTEGER DEFAULT 0,
  last_checkpoint_id INTEGER DEFAULT 1
);
`;

export const CREATE_SEGMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS segments (
  project_id TEXT NOT NULL,
  id INTEGER NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  start_time_formatted TEXT NOT NULL,
  end_time_formatted TEXT NOT NULL,
  original_text TEXT NOT NULL,
  translated_text TEXT DEFAULT '',
  gender TEXT DEFAULT 'AUTO',
  age_tone TEXT DEFAULT 'ADULT',
  audio_path TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
`;

export const CREATE_GLOSSARY_TABLE = `
CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  source_term TEXT NOT NULL UNIQUE,
  target_term TEXT NOT NULL
);
`;

export const CREATE_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_segments_proj_id ON segments(project_id, id);
CREATE INDEX IF NOT EXISTS idx_segments_status ON segments(project_id, status);
`;
