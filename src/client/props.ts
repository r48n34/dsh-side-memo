/**
 * Props contracts for the React components this plugin registers into DSH
 * slots. Slot hosts provide the faces the component asks for through `inject`
 * (see `apply`), plus the framework-level helpers such as `useTabInfo` and
 * `useSessions`.
 */

import type { ReactNode } from 'react';

import type {
  ComposerInputActions,
  DrawerStore,
  MountedBinding,
  NotesStore,
  Translator,
  UseSessions
} from './types';

export interface BaseProps {
  t?: Translator;
}

/**
 * Icon wrappers forward every unknown prop (className, data-*, aria-*) to the
 * underlying SVG element, so the contract is intentionally open.
 */
export interface IconProps {
  size?: number;
  children?: ReactNode;
  [key: string]: unknown;
}

export interface NotesBodyProps extends BaseProps {
  notes: NotesStore;
  inputActions?: ComposerInputActions | null;
  renderSlot?: unknown;
}

export interface NotesTitleProps {
  useTabInfo(): { tab: { title: string } };
}

export interface NotesToggleProps extends BaseProps {
  toggle?: () => void;
}

export interface NotesHeroToggleProps extends NotesToggleProps {
  drawer: DrawerStore;
  mountedBinding: MountedBinding;
  useSessions: UseSessions;
}

export interface NotesDrawerProps extends BaseProps {
  drawer: DrawerStore;
  notes: NotesStore;
}
