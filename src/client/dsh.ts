/**
 * Minimal structural types for the DSH client-plugin context this plugin
 * consumes. The real faces live in the DSH client packages; the plugin keeps
 * them structural so the published package needs no DSH dependencies and the
 * bundle still runs against the shipped loader.
 */

import type { Translator } from './types';

export type Disposable = () => void;

export interface LocaleDictionary {
  zh: Record<string, string>;
  en: Record<string, string>;
}

export interface DshLocaleService {
  bind(namespace: string): Translator;
  register(namespace: string, dictionaries: LocaleDictionary): Disposable;
}

export type DshEffectService = (callback: () => Disposable | void, label?: string) => Disposable | void;

export interface DshSlotInjectContext {
  name: string;
  key?: string;
  id?: string;
}

export interface DshSlotRegisterOptions {
  name: string;
  key?: string;
  id?: string;
  order?: number;
  locale?: string;
  inject?: () => Record<string, unknown>;
  children?: unknown;
}

export interface DshSlotService {
  inject(name: string, callback: () => Disposable | void): Disposable;
  register(options: DshSlotRegisterOptions, component: unknown): Disposable;
}

export interface DshSidebarRightTabGuide {
  id: string;
  order: number;
  title: () => string;
  description: () => string;
  icon: unknown;
}

export interface DshSidebarRightTabRegistration {
  id: string;
  kind: string;
  priority: string;
  title: () => string;
  guide: DshSidebarRightTabGuide[];
}

export interface DshSidebarTabsService {
  register(options: DshSidebarRightTabRegistration): Disposable;
}

export interface DshSidebarRightActiveTab {
  kind?: string;
}

export interface DshSidebarRightService {
  openTab(kind: string): void;
  active(): DshSidebarRightActiveTab | undefined;
  isExpanded(): boolean;
  toggleExpanded(): void;
  /** Observable of the on-screen Session id; present once the sidebar mounts. */
  mounted?: {
    getSnapshot(): string | undefined;
    subscribe(listener: () => void): Disposable;
  };
}

export interface DshClientContext {
  locale: DshLocaleService;
  effect: DshEffectService;
  slots: DshSlotService;
  sidebarRightTabs: DshSidebarTabsService;
  sidebarRight: DshSidebarRightService;
}
