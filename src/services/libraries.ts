import { invoke } from '@tauri-apps/api/core';

export interface LibraryInfo {
  id: string;
  name: string;
  dbPath: string;
  createdAt: number;
  path?: string;
  isDefault?: boolean;
}

const LIBRARIES_KEY = 'notch.libraries';
const ACTIVE_LIBRARY_KEY = 'notch.activeLibraryId';
const LIBRARY_LOCATION_PROMPT_KEY = 'notch.libraryLocationPrompted';

const defaultLibrary: LibraryInfo = {
  id: 'default',
  name: 'Default Library',
  dbPath: 'sqlite:notch.db',
  createdAt: 0,
  isDefault: true,
};

function normalizePath(path: string): string {
  return path.replace(/\/+$/, '');
}

function databasePathForLibraryPath(path: string): string {
  return `sqlite:${normalizePath(path)}/notch.db`;
}

function normalizeLibrary(value: Partial<LibraryInfo> | null | undefined): LibraryInfo | null {
  if (!value || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null;
  }

  if (value.id === defaultLibrary.id) {
    return defaultLibrary;
  }

  const path = typeof value.path === 'string' && value.path.trim()
    ? normalizePath(value.path)
    : undefined;
  const dbPath = typeof value.dbPath === 'string' && value.dbPath.trim()
    ? value.dbPath
    : path
      ? databasePathForLibraryPath(path)
      : '';

  if (!dbPath) return null;

  return {
    id: value.id,
    name: value.name,
    path,
    dbPath,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  };
}

function uniqueLibraries(libraries: LibraryInfo[]): LibraryInfo[] {
  const result: LibraryInfo[] = [defaultLibrary];

  for (const library of libraries) {
    if (library.id === defaultLibrary.id) continue;

    const existingIndex = result.findIndex(existing =>
      existing.id === library.id ||
      (existing.path && library.path && normalizePath(existing.path) === normalizePath(library.path))
    );

    if (existingIndex >= 0) {
      result[existingIndex] = library;
    } else {
      result.push(library);
    }
  }

  return result;
}

function readLibraries(): LibraryInfo[] {
  try {
    const stored = window.localStorage.getItem(LIBRARIES_KEY);
    if (!stored) return [defaultLibrary];

    const parsed = JSON.parse(stored) as Partial<LibraryInfo>[];
    if (!Array.isArray(parsed)) return [defaultLibrary];

    return uniqueLibraries(parsed.map(normalizeLibrary).filter(Boolean) as LibraryInfo[]);
  } catch {
    return [defaultLibrary];
  }
}

function writeLibraries(libraries: LibraryInfo[]): void {
  window.localStorage.setItem(LIBRARIES_KEY, JSON.stringify(uniqueLibraries(libraries)));
}

function upsertLibrary(library: LibraryInfo): void {
  writeLibraries([...readLibraries(), library]);
}

export function getLibraries(): LibraryInfo[] {
  return readLibraries();
}

export function getActiveLibraryId(): string {
  const libraries = readLibraries();
  const fallbackId = libraries[0]?.id ?? defaultLibrary.id;

  try {
    const storedId = window.localStorage.getItem(ACTIVE_LIBRARY_KEY);
    return storedId && libraries.some(library => library.id === storedId) ? storedId : fallbackId;
  } catch {
    return fallbackId;
  }
}

export function setActiveLibraryId(id: string): void {
  window.localStorage.setItem(ACTIVE_LIBRARY_KEY, id);
}

export async function createLibrary(name: string, path: string): Promise<LibraryInfo> {
  const library = await invoke<LibraryInfo>('create_library_package', { path, name });
  upsertLibrary(library);
  setActiveLibraryId(library.id);
  return library;
}

export async function openLibrary(path: string): Promise<LibraryInfo> {
  const library = await invoke<LibraryInfo>('open_library_package', { path });
  upsertLibrary(library);
  setActiveLibraryId(library.id);
  return library;
}

export async function renameLibrary(library: LibraryInfo, name: string): Promise<LibraryInfo> {
  if (!library.path) {
    throw new Error('The default library cannot be renamed.');
  }
  const renamed = await invoke<LibraryInfo>('rename_library_package', { path: library.path, name });
  upsertLibrary(renamed);
  return renamed;
}

export async function refreshLibrary(library: LibraryInfo): Promise<LibraryInfo> {
  if (!library.path) return library;

  const refreshed = await invoke<LibraryInfo>('open_library_package', { path: library.path });
  upsertLibrary(refreshed);
  return refreshed;
}

export async function takePendingLibraryPath(): Promise<string | null> {
  return invoke<string | null>('take_pending_library_path');
}

export function shouldPromptForLibraryLocation(): boolean {
  try {
    return !window.localStorage.getItem(LIBRARIES_KEY) &&
      window.localStorage.getItem(LIBRARY_LOCATION_PROMPT_KEY) !== 'true';
  } catch {
    return false;
  }
}

export function markLibraryLocationPrompted(): void {
  try {
    window.localStorage.setItem(LIBRARY_LOCATION_PROMPT_KEY, 'true');
  } catch {
    // Non-persistent storage should not block app startup.
  }
}

export function libraryFilename(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    || 'Untitled Library';

  return sanitized.toLowerCase().endsWith('.notch') ? sanitized : `${sanitized}.notch`;
}
