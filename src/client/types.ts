/**
 * Shared domain types for the side-memo client plugin.
 *
 * These describe the values the plugin stores, hands to the DSH loader, and
 * exposes to tests. Nothing here is emitted: every import of this module is a
 * type-only import, so the compiled client stays a single CommonJS module.
 */

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  id: string;
}

export type NoteBlock = TextBlock | ImageBlock;

export interface Note {
  id: string;
  title: string;
  body: string;
  content: NoteBlock[];
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
  labels: string[];
}

export interface NotePatch {
  title?: string;
  body?: string;
  content?: unknown;
  favorite?: boolean;
  labels?: unknown;
}

export interface FittedContent {
  content: NoteBlock[];
  body: string;
}

export interface ImageRecord {
  id: string;
  src: string;
  width: number;
  height: number;
  size: number;
  createdAt: number;
}

export type ImageMap = Record<string, ImageRecord>;

export interface NotesSnapshot {
  notes: Note[];
  images: ImageMap;
  imagesReady: boolean;
  imagesAvailable: boolean;
  saveFailed: boolean;
}

export interface NotesLimits {
  maxNotes: number;
  maxTitle: number;
  maxBody: number;
  maxImages: number;
}

export type AddImageResult =
  | { ok: true; record: ImageRecord }
  | { ok: false; reason: 'unavailable' | 'unsupported' | 'quota' | 'budget' };

export interface ImportEntry {
  title?: unknown;
  body?: unknown;
  labels?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  favorite?: unknown;
}

export interface ImportResult {
  added: number;
  skipped: number;
  limit: number;
}

export interface ImportedNote {
  title: string;
  body: string;
  favorite: boolean;
  labels: string[];
  createdAt: number;
  updatedAt: number;
}

export interface NotesStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NotesSnapshot;
  create(): Note | undefined;
  update(id: string, patch: NotePatch): Note | undefined;
  setFavorite(id: string, favorite: boolean): Note | undefined;
  remove(id: string): boolean;
  importMany(entries: ImportEntry[]): ImportResult;
  flush(): void;
  addImage(record: unknown): Promise<AddImageResult>;
  collectOrphans(): Promise<void>;
  limits: NotesLimits;
}

export interface DrawerStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): boolean;
  set(value: unknown): void;
  toggle(): void;
}

export interface MountedSessionStore {
  getSnapshot(): string | undefined;
  subscribe(listener: () => void): () => void;
}

export interface MountedBinding {
  getSnapshot(): string | undefined;
  subscribe(listener: () => void): () => void;
}

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export type LooseTranslateProps = {
  t?: Translator;
};

export interface EditorState {
  content: NoteBlock[];
  body: string;
  length: number;
  truncated: boolean;
}

export type ImageSource = ImageBitmap | { image: HTMLImageElement; url: string };

export type PrepareImageResult =
  | { ok: true; src: string; width: number; height: number; name: string }
  | { ok: false; reason: 'unsupported' | 'tooLarge' };

export interface MemoDragPayload {
  mime: string;
  text: string;
  json: string;
}

export interface DragPayload {
  id: string;
  title: string;
  text: string;
}

export type DropPlan =
  | { kind: 'ignore' }
  | { kind: 'insert'; editor: HTMLElement; payload: DragPayload };

export interface ComposerInputActions {
  captureInsertion(): unknown;
  insertText(text: string, span: unknown): unknown;
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

export interface XlsxTextPart {
  name: string;
  text: string;
}

export interface SessionSummary {
  blank?: boolean;
}

export interface SessionsSnapshot {
  byId?: Record<string, SessionSummary>;
}

export type UseSessions = (
  selector: (snapshot: SessionsSnapshot | undefined) => boolean | undefined
) => boolean | undefined;
