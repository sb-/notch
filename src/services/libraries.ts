export interface LibraryInfo {
  id: string;
  name: string;
  dbPath: string;
  createdAt: number;
}

const LIBRARIES_KEY = 'notch.libraries';
const ACTIVE_LIBRARY_KEY = 'notch.activeLibraryId';

const defaultLibrary: LibraryInfo = {
  id: 'default',
  name: 'Default Library',
  dbPath: 'sqlite:notch.db',
  createdAt: 0,
};

function readLibraries(): LibraryInfo[] {
  try {
    const stored = window.localStorage.getItem(LIBRARIES_KEY);
    if (!stored) return [defaultLibrary];
    const parsed = JSON.parse(stored) as LibraryInfo[];
    const hasDefault = parsed.some(library => library.id === defaultLibrary.id);
    return hasDefault ? parsed : [defaultLibrary, ...parsed];
  } catch {
    return [defaultLibrary];
  }
}

function writeLibraries(libraries: LibraryInfo[]): void {
  window.localStorage.setItem(LIBRARIES_KEY, JSON.stringify(libraries));
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

export function createLibrary(name: string): LibraryInfo {
  const trimmedName = name.trim() || 'Untitled Library';
  const id = crypto.randomUUID();
  const library: LibraryInfo = {
    id,
    name: trimmedName,
    dbPath: `sqlite:notch-library-${id}.db`,
    createdAt: Date.now(),
  };
  const libraries = [...readLibraries(), library];
  writeLibraries(libraries);
  setActiveLibraryId(id);
  return library;
}
