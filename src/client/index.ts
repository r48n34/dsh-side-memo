/**
 * Side Memo — a toggleable right-side notes panel for DeepSeek Harness.
 *
 * The Client half registers one right-sidebar tab type (`side-memo`), its tab
 * body and chip title, and a Session-header toggle. Notes keep their text in
 * this browser's localStorage and their inline images in IndexedDB, shared
 * across Sessions.
 */

import * as React from 'react';

import type { DshClientContext, DshSidebarRightService } from './dsh';
import type {
  IconProps,
  NotesBodyProps,
  NotesDrawerProps,
  NotesHeroToggleProps,
  NotesTitleProps,
  NotesToggleProps
} from './props';
import type {
  AddImageResult,
  ComposerInputActions,
  DragPayload,
  DrawerStore,
  DropPlan,
  EditorState,
  FittedContent,
  ImageMap,
  ImageRecord,
  ImageSource,
  ImportEntry,
  ImportedNote,
  NotesSnapshot,
  MemoDragPayload,
  MountedBinding,
  MountedSessionStore,
  Note,
  NoteBlock,
  NotesStore,
  PrepareImageResult,
  SessionsSnapshot,
  Translator,
  ZipFile
} from './types';

const h = React.createElement;

var PKG = 'dsh-side-memo';
var NS = 'sideMemo';
// Deliberately not the generic `notes` kind: @zzerx/dsh-plugin-notes owns that
// kind in this profile (both are `extension` band, so a shared kind would throw).
var KIND = 'side-memo';
var STORAGE_KEY = 'dsh.side-memo.notes.v1';
var IMAGE_DB_NAME = 'dsh-side-memo-images';
var IMAGE_DB_VERSION = 1;
var IMAGE_DB_STORE = 'images';
var MAX_NOTES = 300;
var MAX_TITLE = 120;
var MAX_BODY = 8000;
// Labels are short free-form tags. They are part of the notes payload, so
// they stay small and bounded: 12 per memo, 24 characters each.
var MAX_LABELS = 12;
var MAX_LABEL_LEN = 24;
// Images are kept out of the notes payload and out of localStorage: they
// live in IndexedDB and the note content stores only ordered block ids.
var MAX_IMAGES = 20;
var MAX_IMAGE_DIMENSION = 1400;
var MAX_IMAGE_FILE_BYTES = 24 * 1024 * 1024;
var MAX_IMAGE_DATA_BYTES = 1200 * 1024;
var MAX_TOTAL_IMAGE_BYTES = 60 * 1024 * 1024;
var IMAGE_QUALITY = 0.82;
var SAVE_DELAY_MS = 250;
var COPY_FEEDBACK_MS = 1600;
var COPY_FAILED_MS = 2600;
var DELETE_ARM_MS = 3000;
var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var XLSX_MAX_FILE_BYTES = 8 * 1024 * 1024;
var XLSX_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
var XLSX_MAX_ENTRIES = 64;
// Dragging a memo row onto the chat composer pastes the memo text there.
// The private MIME type identifies our payload, while text/plain keeps the
// drop usable by the browser's own editable targets.
var MEMO_DRAG_MIME = 'application/x-dsh-side-memo';
var MEMO_DRAG_VERSION = 1;

/** Mutable translate fallback; replaced with the bound namespace in apply. */
var fallbackT: Translator = function (key) {
  return key;
};

// ---------------------------------------------------------------------
// Dictionaries (zh is the key-set source of truth)
// ---------------------------------------------------------------------

var zh = {
  'type.label': '侧边便签',
  'guide.title': '侧边便签',
  'guide.description': '轻量的侧边便签，随手记下内容并快速复制。',
  'toggle.label': '侧边便签',
  'toggle.aria': '打开或收起侧边便签面板',
  'drawer.close': '关闭侧边便签面板',
  'search.placeholder': '搜索便签或标签',
  'search.clear': '清除搜索',
  'search.empty': '没有匹配“{query}”的便签。',
  'labels.filter': '按标签筛选',
  'labels.all': '全部标签',
  'labels.group': '按标签分组',
  'labels.ungroup': '取消分组',
  'labels.untagged': '无标签',
  'labels.emptyFiltered': '没有匹配这些标签的便签。',
  'labels.add': '添加标签',
  'labels.placeholder': '添加标签…',
  'labels.remove': '移除标签 {label}',
  'labels.limit': '每条便签最多 {max} 个标签。',
  'labels.duplicate': '标签“{label}”已存在。',
  'labels.added': '已添加标签“{label}”。',
  'labels.removed': '已移除标签“{label}”。',
  'count.filtered': '{visible} / {total} 条便签',
  new: '新建',
  'empty.title': '还没有便签',
  'empty.body': '新建一条便签，记下要保留或快速粘贴的内容。',
  'editor.titlePlaceholder': '标题（可选）',
  'editor.bodyPlaceholder': '写点什么…',
  'editor.back': '返回便签列表',
  'editor.new': '新建便签',
  'editor.untitled': '无标题便签',
  'editor.chars': '{count} 个字符',
  'editor.limit': '每条便签最多 {max} 个字符。',
  copy: '复制',
  copied: '已复制',
  'copy.failed': '复制失败，请手动选择文本。',
  'drag.hint': '拖到聊天输入框即可粘贴内容',
  'drag.pasted': '已粘贴到聊天输入框',
  'drag.pasteFailed': '输入框现在无法接收粘贴，请稍后再试，或改用复制。',
  delete: '删除',
  'delete.confirm': '确认删除',
  'time.now': '刚刚',
  'time.minutes': '{count} 分钟前',
  'time.hours': '{count} 小时前',
  'time.days': '{count} 天前',
  'count.one': '1 条便签',
  'count.other': '{count} 条便签',
  'limit.hint': '最多保存 {max} 条便签。先删除一些，再新建。',
  'limit.reached': '已达 {max} 条上限',
  'storage.failed': '便签无法保存到这个浏览器，刷新后可能丢失。',
  import: '导入',
  export: '导出',
  'xlsx.imported': '已导入 {added} 条便签。',
  'xlsx.importedSkipped': '已导入 {added} 条便签，跳过 {skipped} 行空数据。',
  'xlsx.importedLimited': '已导入 {added} 条便签，{limit} 行超出数量上限。',
  'xlsx.importEmpty': '文件里没有可导入的便签。',
  'xlsx.importFailed': '导入失败，请选择从 Excel 或侧边便签导出的 .xlsx 文件。',
  'xlsx.tooLarge': '文件太大，最大支持 8 MB。',
  'xlsx.exportEmpty': '还没有可导出的便签。',
  'xlsx.exported': '已导出 {count} 条便签到 .xlsx。',
  'xlsx.exportFailed': '导出失败，请重试。',
  'favorite.add': '收藏便签',
  'favorite.remove': '取消收藏',
  'favorite.pinned': '已收藏并置顶',
  'favorite.unpinned': '已取消收藏',
  'image.add': '插入图片',
  'image.remove': '移除图片',
  'image.memo': '图片便签',
  'image.count.one': '1 张图片',
  'image.count.other': '{count} 张图片',
  'image.processing': '正在处理图片…',
  'image.added': '已插入图片',
  'image.removed': '已移除图片',
  'image.tooLarge': '图片太大，最大支持 {max} MB。',
  'image.unsupported': '无法读取这张图片。',
  'image.disabled': '这个浏览器无法保存图片便签。',
  'image.limit': '每条便签最多 {max} 张图片。',
  'image.budget': '图片存储已满，请删除一些图片便签。',
  'image.saveFailed': '图片无法保存到这个浏览器。',
  'image.unavailable': '图片数据不可用',
  'image.loading': '正在加载图片…'
};

var en = {
  'type.label': 'Side Memo',
  'guide.title': 'Side Memo',
  'guide.description': 'A lightweight side notes tab for quick memos and copy-paste.',
  'toggle.label': 'Side Memo',
  'toggle.aria': 'Open or collapse the Side Memo panel',
  'drawer.close': 'Close the Side Memo panel',
  'search.placeholder': 'Search notes or labels',
  'search.clear': 'Clear search',
  'search.empty': 'No notes match "{query}".',
  'labels.filter': 'Filter by label',
  'labels.all': 'All labels',
  'labels.group': 'Group by label',
  'labels.ungroup': 'Ungroup',
  'labels.untagged': 'Untagged',
  'labels.emptyFiltered': 'No notes match these labels.',
  'labels.add': 'Add label',
  'labels.placeholder': 'Add a label…',
  'labels.remove': 'Remove label {label}',
  'labels.limit': 'Up to {max} labels per memo.',
  'labels.duplicate': 'Label "{label}" is already on this memo.',
  'labels.added': 'Added label "{label}".',
  'labels.removed': 'Removed label "{label}".',
  'count.filtered': '{visible} of {total} notes',
  new: 'New',
  'empty.title': 'No notes yet',
  'empty.body': 'Create a note for anything you want to keep or paste quickly.',
  'editor.titlePlaceholder': 'Title (optional)',
  'editor.bodyPlaceholder': 'Write something…',
  'editor.back': 'Back to notes',
  'editor.new': 'New memo',
  'editor.untitled': 'Untitled note',
  'editor.chars': '{count} characters',
  'editor.limit': 'Each memo can hold up to {max} characters.',
  copy: 'Copy',
  copied: 'Copied',
  'copy.failed': 'Copy failed; select the text and copy manually.',
  'drag.hint': 'Drag a memo into the chat box to paste it',
  'drag.pasted': 'Pasted into the chat box',
  'drag.pasteFailed': 'The chat box cannot take a paste right now. Try again or use copy.',
  delete: 'Delete',
  'delete.confirm': 'Confirm delete',
  'time.now': 'just now',
  'time.minutes': '{count}m ago',
  'time.hours': '{count}h ago',
  'time.days': '{count}d ago',
  'count.one': '1 note',
  'count.other': '{count} notes',
  'limit.hint': 'You can keep {max} notes. Delete a few before creating more.',
  'limit.reached': 'Limit {max} reached',
  'storage.failed': 'Notes cannot be saved to this browser and may be lost on reload.',
  import: 'Import',
  export: 'Export',
  'xlsx.imported': 'Imported {added} notes.',
  'xlsx.importedSkipped': 'Imported {added} notes; skipped {skipped} empty rows.',
  'xlsx.importedLimited': 'Imported {added} notes; {limit} rows exceeded the note limit.',
  'xlsx.importEmpty': 'No notes to import from this file.',
  'xlsx.importFailed': 'Import failed. Choose an .xlsx file exported from Excel or Side Memo.',
  'xlsx.tooLarge': 'File is too large (max 8 MB).',
  'xlsx.exportEmpty': 'There are no notes to export yet.',
  'xlsx.exported': 'Exported {count} notes to .xlsx.',
  'xlsx.exportFailed': 'Export failed. Please try again.',
  'favorite.add': 'Add to favorites',
  'favorite.remove': 'Remove from favorites',
  'favorite.pinned': 'Added to favorites and pinned to top',
  'favorite.unpinned': 'Removed from favorites',
  'image.add': 'Insert image',
  'image.remove': 'Remove image',
  'image.memo': 'Image memo',
  'image.count.one': '1 image',
  'image.count.other': '{count} images',
  'image.processing': 'Processing image…',
  'image.added': 'Image inserted',
  'image.removed': 'Image removed',
  'image.tooLarge': 'Image is too large (max {max} MB).',
  'image.unsupported': 'Could not read this image.',
  'image.disabled': 'Images cannot be stored in this browser.',
  'image.limit': 'Up to {max} images per memo.',
  'image.budget': 'Image storage is full. Delete some image memos.',
  'image.saveFailed': 'The image could not be saved to this browser.',
  'image.unavailable': 'Image data unavailable',
  'image.loading': 'Loading images…'
};

// ---------------------------------------------------------------------
// Styles (theme tokens only; literal colors are reserved for artwork)
// ---------------------------------------------------------------------

var STYLE = [
  '.dsm-root{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;',
  'color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13.5px;line-height:1.45;background:transparent}',
  '.dsm-toolbar{display:flex;align-items:center;gap:6px;padding:10px 10px 8px;flex:0 0 auto}',
  '.dsm-toolbar-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto}',
  '.dsm-search{position:relative;flex:1 1 auto;min-width:0;display:flex;align-items:center}',
  '.dsm-search-icon{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:flex;',
  'color:var(--dsw-alias-label-secondary);pointer-events:none}',
  '.dsm-search input{width:100%;height:32px;box-sizing:border-box;padding:0 26px 0 28px;border:1px solid transparent;',
  'border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;',
  'font-size:13px;outline:none}',
  '.dsm-search input::placeholder{color:var(--dsw-alias-label-secondary)}',
  '.dsm-search input:focus-visible{border-color:var(--dsw-alias-brand-primary)}',
  '.dsm-search input::-webkit-search-cancel-button,.dsm-search input::-webkit-search-decoration{-webkit-appearance:none;appearance:none}',
  '.dsm-search-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:flex;align-items:center;',
  'justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;',
  'color:var(--dsw-alias-label-secondary);cursor:pointer}',
  '.dsm-search-clear:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 11px;',
  'border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;',
  'color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}',
  '.dsm-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
  '.dsm-btn:disabled{opacity:.5;cursor:default}',
  '.dsm-btn:disabled:hover{background:transparent}',
  '.dsm-btn.dsm-danger-armed{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
  '.dsm-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;',
  'border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:0 0 auto}',
  '.dsm-icon-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-icon-btn:disabled{opacity:.45;cursor:default}',
  '.dsm-icon-btn:disabled:hover{color:var(--dsw-alias-label-secondary);background:transparent}',
  '.dsm-icon-btn[data-copied="true"]{color:var(--dsw-alias-state-success-primary)}',
  '.dsm-btn:focus-visible,.dsm-icon-btn:focus-visible,.dsm-row-main:focus-visible,.dsm-search-clear:focus-visible{',
  'outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsm-notice{margin:0 10px 6px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);',
  'color:var(--dsw-alias-state-warn-primary);font-size:12px}',
  '.dsm-notice[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
  '.dsm-notice[data-tone="success"]{color:var(--dsw-alias-state-success-primary)}',
  '.dsm-notice[data-tone="info"]{color:var(--dsw-alias-label-secondary)}',
  '.dsm-list-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:0 8px 8px;display:flex;flex-direction:column}',
  '.dsm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}',
  '.dsm-row{display:flex;align-items:stretch;gap:4px;border-radius:8px}',
  '.dsm-row:hover{background:var(--dsw-alias-bg-layer-2)}',
  '.dsm-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;padding:9px 10px;',
  'border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dsm-row-main:focus-visible{outline-offset:-2px}',
  '.dsm-row-title{display:flex;align-items:baseline;gap:8px;min-width:0}',
  '.dsm-row-title-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'font-weight:600;font-size:14px;line-height:1.35}',
  '.dsm-row-time{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:11.5px;',
  'font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.dsm-row-snippet{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);',
  'font-size:13px;line-height:1.4}',
  '.dsm-row-copy{align-self:center;margin-right:2px;opacity:.6}',
  '.dsm-row:hover .dsm-row-copy,.dsm-row-copy:focus-visible,.dsm-row-copy[data-copied="true"]{opacity:1}',
  '.dsm-row-star{align-self:center;opacity:.5}',
  '.dsm-row:hover .dsm-row-star,.dsm-row-star:focus-visible,.dsm-row-star[data-favorite="true"]{opacity:1}',
  '.dsm-row[draggable="true"]{cursor:grab}',
  '.dsm-row[draggable="true"]:active{cursor:grabbing}',
  '.dsm-row[data-dragging="true"]{opacity:.55;background:var(--dsw-alias-bg-layer-2)}',
  '.dsm-foot-hint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '[data-composer-input].dsm-composer-drop{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:10px}',
  '.dsm-icon-btn[data-favorite="true"]{color:var(--dsw-alias-brand-primary)}',
  '.dsm-icon-btn[data-favorite="true"]:hover{color:var(--dsw-alias-brand-primary)}',
  '.dsm-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;',
  'gap:6px;padding:24px 18px;text-align:center;color:var(--dsw-alias-label-secondary)}',
  '.dsm-empty-icon{opacity:.65}',
  '.dsm-empty-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dsm-empty-body{max-width:280px;font-size:12.5px}',
  '.dsm-foot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;',
  'border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11.5px}',
  '.dsm-editor-head{display:flex;align-items:center;gap:4px;padding:8px 8px 6px;flex:0 0 auto}',
  '.dsm-editor-meta{flex:1 1 auto;min-width:0;margin:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  'color:var(--dsw-alias-label-secondary);font-size:11.5px}',
  '.dsm-editor-title{margin:0 10px;padding:6px 2px;border:0;background:transparent;color:var(--dsw-alias-label-primary);',
  'font:inherit;font-size:16px;font-weight:600;line-height:1.4;outline:none}',
  '.dsm-editor-title::placeholder{color:var(--dsw-alias-label-secondary);font-weight:600}',
  '.dsm-labels-editor{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:0 10px 6px;flex:0 0 auto}',
  '.dsm-labels-editor .dsm-label-chip{height:20px;padding:0 3px 0 7px;background:var(--dsw-alias-bg-layer-2);',
  'color:var(--dsw-alias-label-primary);font-size:11px}',
  '.dsm-label-input{flex:1 1 90px;min-width:80px;padding:2px 4px;border:1px solid transparent;border-radius:6px;',
  'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;outline:none}',
  '.dsm-label-input::placeholder{color:var(--dsw-alias-label-secondary)}',
  '.dsm-label-input:focus-visible{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}',
  '.dsm-label-remove{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;',
  'padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);',
  'cursor:pointer;flex:0 0 auto}',
  '.dsm-label-remove:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-label-remove:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsm-label-notice{margin:-2px 10px 6px;flex:0 0 auto}',
  '.dsm-editor-wrap{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;margin:0 10px 8px}',
  '.dsm-editor-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 2px;border:0;background:transparent;',
  'color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;line-height:1.6;outline:none;',
  'white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;cursor:text}',
  '.dsm-editor-body > div{min-height:1.6em}',
  '.dsm-editor-body:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:8px}',
  '.dsm-editor-body[data-dragging="true"]{box-shadow:inset 0 0 0 2px var(--dsw-alias-brand-primary);border-radius:8px}',
  '.dsm-editor-placeholder{position:absolute;top:4px;left:2px;right:2px;pointer-events:none;',
  'color:var(--dsw-alias-label-secondary);font-size:13.5px;line-height:1.6}',
  '.dsm-image-block{position:relative;display:flex;margin:6px 0;max-width:100%;',
  'border-radius:9px;background:var(--dsw-alias-bg-layer-2);padding:2px}',
  '.dsm-image-block img{display:block;max-width:100%;max-height:420px;border-radius:7px;',
  'object-fit:contain;border:1px solid var(--dsw-alias-border-l1)}',
  '.dsm-image-missing{align-items:center;justify-content:center;min-height:64px;padding:12px;',
  'border:1px dashed var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}',
  '@media (hover:none){.dsm-image-remove{opacity:.85}}',
  '.dsm-image-remove{position:absolute;top:8px;right:8px;display:flex;align-items:center;justify-content:center;',
  'width:24px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;',
  'background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;',
  'line-height:1;cursor:pointer;opacity:0;transition:opacity .12s}',
  '.dsm-image-block:hover .dsm-image-remove,.dsm-image-remove:focus-visible{opacity:1}',
  '.dsm-image-remove:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
  '.dsm-row-images{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;',
  'color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap}',
  '.dsm-row-labels{display:flex;flex-wrap:wrap;align-items:center;gap:3px;min-width:0}',
  '.dsm-label-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;height:18px;padding:0 6px;',
  'box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;',
  'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:10.5px;',
  'line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dsm-label-more{color:var(--dsw-alias-label-secondary);font-size:10.5px;flex:0 0 auto}',
  '.dsm-labels-bar{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:0 10px 6px;',
  'max-height:72px;overflow:auto}',
  '.dsm-label-filter{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;',
  'border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);',
  'font:inherit;font-size:11px;line-height:1.5;cursor:pointer;white-space:nowrap}',
  '.dsm-label-filter:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-label-filter[data-active="true"]{border-color:var(--dsw-alias-brand-primary);',
  'color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-label-filter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsm-label-filter-count{font-size:10px;font-variant-numeric:tabular-nums;opacity:.8}',
  '.dsm-label-filter-clear{font-size:11px;padding:2px 8px;border:1px solid transparent;border-radius:999px;',
  'background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;white-space:nowrap}',
  '.dsm-label-filter-clear:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-group{flex:0 0 auto}',
  '.dsm-group-head{display:flex;align-items:center;gap:5px;padding:8px 10px 3px;',
  'color:var(--dsw-alias-label-secondary);font-size:11px}',
  '.dsm-group-head-icon{display:flex;flex:0 0 auto;opacity:.75}',
  '.dsm-group-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsm-group-count{flex:0 0 auto;font-variant-numeric:tabular-nums;opacity:.8}',
  '.dsm-editor-actions{display:flex;align-items:center;gap:6px;padding:6px 10px;min-height:34px;box-sizing:border-box;',
  'border-top:1px solid var(--dsw-alias-border-l1)}',
  '.dsm-editor-count{color:var(--dsw-alias-label-secondary);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.dsm-editor-actions-spacer{flex:1 1 auto}',
  '.dsm-title{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}',
  '.dsm-title-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsm-toggle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;flex:0 0 auto;',
  'border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;',
  '-webkit-app-region:no-drag}',
  '.dsm-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-toggle[data-active="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
  '.dsm-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dsm-header-toggle{position:absolute;top:11px;right:62px;z-index:2}',
  '.dsm-drawer-layer{position:absolute;inset:0;pointer-events:none}',
  '.dsm-drawer{position:absolute;top:max(56px,var(--dsh-frame-overlay-top,12px));right:12px;bottom:12px;',
  'width:min(380px,calc(100vw - 24px));display:flex;flex-direction:column;box-sizing:border-box;',
  'pointer-events:auto;z-index:1;overflow:hidden;',
  'border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-menu);',
  'backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent)}',
  '.dsm-drawer-head{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:8px 10px;',
  'border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.dsm-drawer-icon{display:flex;align-items:center;color:var(--dsw-alias-label-secondary)}',
  '.dsm-drawer-title{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dsm-drawer-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
  '.dsm-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;',
  'clip:rect(0,0,0,0);white-space:nowrap;border:0}'
].join('');

// ---------------------------------------------------------------------
// Icons (own artwork; no Harness Client primitive imports)
// ---------------------------------------------------------------------

function IconBase(props: IconProps): React.ReactElement {
  var size = props.size === undefined ? 16 : props.size;
  var children = props.children;
  var rest: Record<string, unknown> = {};
  for (var key in props) {
    if (key !== 'size' && key !== 'children') rest[key] = props[key];
  }
  rest.width = size;
  rest.height = size;
  rest.viewBox = '0 0 24 24';
  rest.fill = 'none';
  rest.stroke = 'currentColor';
  rest.strokeWidth = 1.7;
  rest.strokeLinecap = 'round';
  rest.strokeLinejoin = 'round';
  rest['aria-hidden'] = 'true';
  rest.focusable = 'false';
  return h('svg', rest, children);
}

function IconNote(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M5.5 5.25A1.75 1.75 0 0 1 7.25 3.5h6.9L19 8.35v10.4a1.75 1.75 0 0 1-1.75 1.75h-10A1.75 1.75 0 0 1 5.5 18.75z' }),
    h('path', { d: 'M14 3.5v5h5' }),
    h('path', { d: 'M8.75 12.25h6.5' }),
    h('path', { d: 'M8.75 15.75h4.25' }));
}

function IconSearch(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('circle', { cx: 10.5, cy: 10.5, r: 6.25 }),
    h('path', { d: 'M15.25 15.25 20 20' }));
}

function IconPlus(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M12 5v14' }),
    h('path', { d: 'M5 12h14' }));
}

function IconCopy(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('rect', { x: 8, y: 8, width: 12, height: 12, rx: 2 }),
    h('path', { d: 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' }));
}

function IconCheck(props: IconProps): React.ReactElement {
  return h(IconBase, props, h('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }));
}

function IconBack(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M19 12H5' }),
    h('path', { d: 'M11 5l-7 7 7 7' }));
}

function IconX(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M6 6l12 12' }),
    h('path', { d: 'M18 6L6 18' }));
}

function IconUpload(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M12 16V4' }),
    h('path', { d: 'M7 9l5-5 5 5' }),
    h('path', { d: 'M4 16.5v1.75A1.75 1.75 0 0 0 5.75 20h12.5A1.75 1.75 0 0 0 20 18.25V16.5' }));
}

function IconDownload(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M12 4v12' }),
    h('path', { d: 'M7 11l5 5 5-5' }),
    h('path', { d: 'M4 16.5v1.75A1.75 1.75 0 0 0 5.75 20h12.5A1.75 1.75 0 0 0 20 18.25V16.5' }));
}

function IconImage(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2.2 }),
    h('circle', { cx: 8.5, cy: 9.5, r: 1.55 }),
    h('path', { d: 'M20.5 14.75l-4.55-4.55L7.4 18.75' }));
}

var STAR_PATH = 'M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.78l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z';

function IconStar(props: IconProps): React.ReactElement {
  return h(IconBase, props, h('path', { d: STAR_PATH }));
}

function IconStarFilled(props: IconProps): React.ReactElement {
  return h(IconBase, props, h('path', { d: STAR_PATH, fill: 'currentColor' }));
}

function IconTag(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M4 4.75A1.75 1.75 0 0 1 5.75 3h5.4c.46 0 .9.18 1.23.51l7.1 7.1a1.75 1.75 0 0 1 0 2.48l-6.14 6.14a1.75 1.75 0 0 1-2.48 0l-7.1-7.1A1.75 1.75 0 0 1 3 10.9V4.75z' }),
    h('circle', { cx: 8.4, cy: 8.4, r: 1.35 }));
}

function IconGroup(props: IconProps): React.ReactElement {
  return h(IconBase, props,
    h('path', { d: 'M4 6.5h4' }),
    h('path', { d: 'M4 12h4' }),
    h('path', { d: 'M4 17.5h4' }),
    h('path', { d: 'M11 6.5h9' }),
    h('path', { d: 'M11 12h9' }),
    h('path', { d: 'M11 17.5h9' }));
}

// ---------------------------------------------------------------------
// Guide artwork
//
// The right sidebar's Start cards draw their own artwork on a 36px canvas
// with fixed colors rather than `currentColor` (DSH's own folder, browser
// and terminal cards do the same). This memo mark keeps the plugin's page
// + brand-blue motif from icon.svg, so the card no longer falls back to
// the generic placeholder cube.
// ---------------------------------------------------------------------

var NOTE_PAGE_PATH = 'M12 5.5H21.5L26.5 10.5V28.3C26.5 29.5 25.5 30.5 24.3 30.5H12C10.8 30.5 9.5 29.5 9.5 28.3V7.7C9.5 6.5 10.8 5.5 12 5.5Z';

function GuideNoteArtwork(props: IconProps): React.ReactElement {
  var size = props.size === undefined ? 36 : props.size;
  var rest: Record<string, unknown> = {};
  for (var key in props) {
    if (key !== 'size') rest[key] = props[key];
  }
  rest.width = size;
  rest.height = size;
  rest.viewBox = '0 0 36 36';
  rest.fill = 'none';
  rest['aria-hidden'] = 'true';
  rest.focusable = 'false';
  return h('svg', rest,
    h('path', { d: NOTE_PAGE_PATH, fill: '#DCE5FF' }),
    h('path', { d: 'M21.5 5.5V10.5H26.5Z', fill: '#B7C7FF' }),
    h('path', {
      d: NOTE_PAGE_PATH,
      stroke: '#4D6BFE',
      strokeWidth: 2,
      strokeLinejoin: 'round'
    }),
    h('rect', { x: 13.6, y: 14.8, width: 8.4, height: 2.5, rx: 1.25, fill: '#4D6BFE' }),
    h('rect', { x: 13.6, y: 19.8, width: 5.6, height: 2.5, rx: 1.25, fill: '#5C79FF' }));
}

// ---------------------------------------------------------------------
// Notes store (plain module state; localStorage is the only persistence)
// ---------------------------------------------------------------------

function newNoteId(): string {
  try {
    var cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoObject !== undefined && typeof cryptoObject.randomUUID === 'function') {
      return cryptoObject.randomUUID();
    }
  } catch (error) {
    /* fall through to the timestamp id */
  }
  return 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function newImageId(): string {
  try {
    var cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoObject !== undefined && typeof cryptoObject.randomUUID === 'function') {
      return 'img-' + cryptoObject.randomUUID();
    }
  } catch (error) {
    /* fall through to the timestamp id */
  }
  return 'img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// A note is stored as plain text plus an ordered block list. Text blocks are
// the source of note.body (search, copy, export); image blocks reference an
// IndexedDB record and never contribute to body.
function textBlocksForBody(body: unknown): NoteBlock[] {
  var lines = (typeof body === 'string' ? body.replace(/\r\n?/g, '\n') : '').split('\n');
  var blocks: NoteBlock[] = [];
  for (var index = 0; index < lines.length; index += 1) blocks.push({ type: 'text', text: lines[index] });
  return blocks;
}

function contentText(content: NoteBlock[]): string {
  var parts: string[] = [];
  for (var index = 0; index < content.length; index += 1) {
    var block = content[index];
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n');
}

/** Truncate a block list to MAX_BODY characters of text without ever keeping a dangling image. */
function fitContent(content: NoteBlock[], max: number): FittedContent {
  var fitted: NoteBlock[] = [];
  var used = 0;
  var textCount = 0;
  for (var index = 0; index < content.length; index += 1) {
    var block = content[index];
    if (block.type === 'image') {
      if (used >= max) break;
      fitted.push(block);
      continue;
    }
    if (textCount > 0) {
      if (used + 1 > max) break;
      used += 1;
    }
    var room = max - used;
    if (block.text.length > room) {
      fitted.push({ type: 'text', text: block.text.slice(0, room) });
      used = max;
      break;
    }
    fitted.push(block);
    used += block.text.length;
    textCount += 1;
  }
  if (fitted.length === 0) fitted.push({ type: 'text', text: '' });
  return { content: fitted, body: contentText(fitted) };
}

function normalizeContent(content: unknown, body: unknown): FittedContent {
  var blocks: NoteBlock[] = [];
  if (Array.isArray(content)) {
    for (var index = 0; index < content.length; index += 1) {
      var block = content[index] as Record<string, unknown>;
      if (block === null || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        blocks.push({ type: 'text', text: block.text.replace(/\r\n?/g, '\n') });
      } else if (block.type === 'image' && typeof block.id === 'string' && block.id.length > 0) {
        blocks.push({ type: 'image', id: block.id.slice(0, 80) });
      }
    }
  }
  if (blocks.length === 0) {
    blocks = textBlocksForBody(typeof body === 'string' ? body.replace(/\r\n?/g, '\n') : '');
  }
  return fitContent(blocks, MAX_BODY);
}

function noteImageIds(note: unknown): string[] {
  if (note === null || typeof note !== 'object') return [];
  var value = note as Record<string, unknown>;
  if (!Array.isArray(value.content)) return [];
  var ids: string[] = [];
  for (var index = 0; index < value.content.length; index += 1) {
    var block = value.content[index] as Record<string, unknown>;
    if (block !== null && typeof block === 'object' && block.type === 'image') ids.push(block.id as string);
  }
  return ids;
}

function noteImageCount(note: unknown): number {
  return noteImageIds(note).length;
}

function imageCountLabel(t: Translator, count: number): string {
  return t(count === 1 ? 'image.count.one' : 'image.count.other', { count: count, max: MAX_IMAGES });
}

/**
 * Canonical label text: no leading `#`, no separators or control characters,
 * collapsed whitespace, bounded length. Returns '' when nothing usable
 * remains.
 */
function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  var text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.charAt(0) === '#' || text.charAt(0) === '＃') text = text.slice(1);
  text = text.replace(/[,，;；]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === '') return '';
  return text.slice(0, MAX_LABEL_LEN);
}

function normalizeLabels(list: unknown): string[] {
  var source = Array.isArray(list) ? list : [];
  var labels: string[] = [];
  var seen: Record<string, boolean> = {};
  for (var index = 0; index < source.length && labels.length < MAX_LABELS; index += 1) {
    var label = normalizeLabel(source[index]);
    if (label === '') continue;
    var key = label.toLocaleLowerCase();
    if (seen[key] === true) continue;
    seen[key] = true;
    labels.push(label);
  }
  return labels;
}

function noteLabels(note: unknown): string[] {
  if (note === null || typeof note !== 'object') return [];
  var value = note as Record<string, unknown>;
  if (!Array.isArray(value.labels)) return [];
  return value.labels as string[];
}

function noteHasLabel(note: unknown, label: unknown): boolean {
  var target = String(label).toLocaleLowerCase();
  var labels = noteLabels(note);
  for (var index = 0; index < labels.length; index += 1) {
    if (labels[index].toLocaleLowerCase() === target) return true;
  }
  return false;
}

function normalizeNote(input: unknown): Note | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  var value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || value.id.length === 0) return undefined;
  var id = value.id.slice(0, 80);
  var title = typeof value.title === 'string' ? value.title.slice(0, MAX_TITLE) : '';
  var rawBody = typeof value.body === 'string' ? value.body : '';
  var shaped = normalizeContent(value.content, rawBody);
  var created = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
  var updated = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : created;
  return {
    id: id,
    title: title,
    body: shaped.body,
    content: shaped.content,
    createdAt: created,
    updatedAt: updated,
    favorite: value.favorite === true,
    labels: normalizeLabels(value.labels)
  };
}

// ---------------------------------------------------------------------
// Image records (IndexedDB). Notes stay in localStorage; image payloads do
// not, because a handful of screenshots would exhaust the localStorage quota.
// ---------------------------------------------------------------------

function openImageDb(): Promise<IDBDatabase> {
  return new Promise(function (resolve, reject) {
    var indexed = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
    if (indexed === undefined) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    var request: IDBOpenDBRequest;
    try {
      request = indexed.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_DB_STORE)) db.createObjectStore(IMAGE_DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = function () {
      var db = request.result;
      db.onversionchange = function () {
        try {
          db.close();
        } catch (error) {
          /* ignore */
        }
      };
      resolve(db);
    };
    request.onerror = function () {
      reject(request.error === undefined || request.error === null ? new Error('Image store could not be opened') : request.error);
    };
    request.onblocked = function () {
      reject(new Error('Image store is blocked'));
    };
  });
}

function readImageRecords(db: IDBDatabase): Promise<unknown[]> {
  return new Promise(function (resolve, reject) {
    try {
      var transaction = db.transaction(IMAGE_DB_STORE, 'readonly');
      var request = transaction.objectStore(IMAGE_DB_STORE).getAll();
      request.onsuccess = function () {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = function () {
        reject(request.error === undefined || request.error === null ? new Error('Image store read failed') : request.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

function writeImageRecord(db: IDBDatabase, record: ImageRecord): Promise<void> {
  return new Promise(function (resolve, reject) {
    try {
      var transaction = db.transaction(IMAGE_DB_STORE, 'readwrite');
      transaction.objectStore(IMAGE_DB_STORE).put(record);
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onerror = function () {
        reject(transaction.error === undefined || transaction.error === null ? new Error('Image store write failed') : transaction.error);
      };
      transaction.onabort = function () {
        reject(transaction.error === undefined || transaction.error === null ? new Error('Image store write aborted') : transaction.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

function deleteImageRecords(db: IDBDatabase, ids: string[]): Promise<void> {
  return new Promise(function (resolve, reject) {
    try {
      var transaction = db.transaction(IMAGE_DB_STORE, 'readwrite');
      var store = transaction.objectStore(IMAGE_DB_STORE);
      for (var index = 0; index < ids.length; index += 1) store.delete(ids[index]);
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onerror = function () {
        reject(transaction.error === undefined || transaction.error === null ? new Error('Image store delete failed') : transaction.error);
      };
      transaction.onabort = function () {
        reject(transaction.error === undefined || transaction.error === null ? new Error('Image store delete aborted') : transaction.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeImageRecord(input: unknown): ImageRecord | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  var value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || value.id.length === 0) return undefined;
  if (typeof value.src !== 'string' || value.src.indexOf('data:image/') !== 0) return undefined;
  if (value.src.length > MAX_IMAGE_FILE_BYTES) return undefined;
  var width = typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 ? Math.round(value.width) : 0;
  var height = typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0 ? Math.round(value.height) : 0;
  var created = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
  return {
    id: value.id.slice(0, 80),
    src: value.src,
    width: width,
    height: height,
    size: value.src.length,
    createdAt: created
  };
}

var webpEncoderSupport: boolean | undefined;

function canEncodeWebp(): boolean {
  if (webpEncoderSupport !== undefined) return webpEncoderSupport;
  webpEncoderSupport = false;
  try {
    if (typeof document !== 'undefined') {
      var canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      webpEncoderSupport = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    }
  } catch (error) {
    webpEncoderSupport = false;
  }
  return webpEncoderSupport;
}

function loadImageFromFile(file: File): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise(function (resolve, reject) {
    var url: string;
    try {
      url = URL.createObjectURL(file);
    } catch (error) {
      reject(error);
      return;
    }
    var image = new Image();
    image.onload = function () {
      resolve({ image: image, url: url });
    };
    image.onerror = function () {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        /* ignore */
      }
      reject(new Error('Image could not be decoded'));
    };
    image.src = url;
  });
}

function decodeImageFile(file: File): Promise<ImageSource> {
  return Promise.resolve().then(function () {
    if (typeof createImageBitmap !== 'function') return loadImageFromFile(file);
    return createImageBitmap(file).then(function (bitmap) {
      return bitmap;
    }, function () {
      return loadImageFromFile(file);
    });
  });
}

function isElementSource(source: ImageSource): source is { image: HTMLImageElement; url: string } {
  return (source as { image?: unknown }).image !== undefined;
}

function imageSourceSize(source: ImageSource): { width: number; height: number } {
  if (isElementSource(source)) {
    var image = source.image;
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  return { width: source.width, height: source.height };
}

function imageSourceElement(source: ImageSource): CanvasImageSource {
  return isElementSource(source) ? source.image : source;
}

function closeImageSource(source: ImageSource): void {
  if (!isElementSource(source)) {
    try {
      source.close();
    } catch (error) {
      /* ignore */
    }
    return;
  }
  try {
    URL.revokeObjectURL(source.url);
  } catch (error) {
    /* ignore */
  }
}

/**
 * Downscale and re-encode a pasted image into a compact data URL.
 * Resolves to {ok:true, src, width, height, name} or {ok:false, reason}.
 */
function prepareImageFile(file: File): Promise<PrepareImageResult> {
  return Promise.resolve().then(function (): PrepareImageResult | Promise<PrepareImageResult> {
    if (file === null || typeof file !== 'object' || typeof file.type !== 'string' || file.type.indexOf('image/') !== 0) {
      return { ok: false, reason: 'unsupported' };
    }
    if (typeof file.size === 'number' && file.size > MAX_IMAGE_FILE_BYTES) return { ok: false, reason: 'tooLarge' };
    var encodedType = canEncodeWebp() ? 'image/webp' : 'image/jpeg';
    return decodeImageFile(file).then(function (source) {
      try {
        var size = imageSourceSize(source);
        if (!(size.width > 0) || !(size.height > 0)) return { ok: false, reason: 'unsupported' };
        var element = imageSourceElement(source);
        var attempts = [
          { dimension: MAX_IMAGE_DIMENSION, quality: IMAGE_QUALITY },
          { dimension: Math.round(MAX_IMAGE_DIMENSION * 0.75), quality: 0.72 },
          { dimension: Math.round(MAX_IMAGE_DIMENSION * 0.55), quality: 0.62 }
        ];
        var best;
        for (var index = 0; index < attempts.length; index += 1) {
          var attempt = attempts[index];
          var scale = Math.min(1, attempt.dimension / Math.max(size.width, size.height));
          var width = Math.max(1, Math.round(size.width * scale));
          var height = Math.max(1, Math.round(size.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var context = canvas.getContext('2d');
          if (context === null || context === undefined) continue;
          if (encodedType === 'image/jpeg') {
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
          }
          context.drawImage(element, 0, 0, width, height);
          var src = '';
          try {
            src = canvas.toDataURL(encodedType, attempt.quality);
          } catch (error) {
            src = '';
          }
          if (typeof src !== 'string' || src.indexOf('data:image/') !== 0) continue;
          best = { src: src, width: width, height: height };
          if (src.length <= MAX_IMAGE_DATA_BYTES) break;
        }
        if (best === undefined) return { ok: false, reason: 'unsupported' };
        return {
          ok: true,
          src: best.src,
          width: best.width,
          height: best.height,
          name: typeof file.name === 'string' ? file.name.slice(0, 80) : ''
        };
      } finally {
        closeImageSource(source);
      }
    }, function () {
      return { ok: false, reason: 'unsupported' };
    });
  });
}

function dataUrlToPngBlob(dataUrl: string): Promise<Blob | null> {
  return new Promise(function (resolve) {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      resolve(null);
      return;
    }
    var image = new Image();
    image.onload = function () {
      try {
        var width = image.naturalWidth || image.width;
        var height = image.naturalHeight || image.height;
        if (width <= 0 || height <= 0) {
          resolve(null);
          return;
        }
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var context = canvas.getContext('2d');
        if (context === null || context === undefined) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0);
        canvas.toBlob(function (blob) {
          resolve(blob === null || blob === undefined ? null : blob);
        }, 'image/png');
      } catch (error) {
        resolve(null);
      }
    };
    image.onerror = function () {
      resolve(null);
    };
    image.src = dataUrl;
  });
}

function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  return Promise.resolve().then(function () {
    if (typeof ClipboardItem === 'undefined' || typeof navigator === 'undefined') return false;
    if (navigator.clipboard === undefined || typeof navigator.clipboard.write !== 'function') return false;
    // Clipboard consumers expect image/png; stored memos are usually WebP.
    return dataUrlToPngBlob(dataUrl).then(function (blob) {
      if (blob === null) return false;
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
        return true;
      }, function () {
        return false;
      });
    });
  }).catch(function () {
    return false;
  });
}

function createNotesStore(): NotesStore {
  var notes: Note[] = [];
  var images: ImageMap = {};
  var imagesReady = false;
  var imagesAvailable = true;
  var saveFailed = false;
  var imageDb: IDBDatabase | null = null;
  var snapshot: NotesSnapshot = {
    notes: notes,
    images: images,
    imagesReady: imagesReady,
    imagesAvailable: imagesAvailable,
    saveFailed: saveFailed
  };
  var listeners = new Set<() => void>();
  var saveTimer: ReturnType<typeof setTimeout> | undefined;

  function emit(): void {
    snapshot = {
      notes: notes,
      images: images,
      imagesReady: imagesReady,
      imagesAvailable: imagesAvailable,
      saveFailed: saveFailed
    };
    listeners.forEach(function (listener) {
      try {
        listener();
      } catch (error) {
        console.error('[dsh-side-memo] notes listener failed', error);
      }
    });
  }

  function write(): void {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (typeof localStorage === 'undefined') {
      if (!saveFailed) {
        saveFailed = true;
        emit();
      }
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, notes: notes }));
      if (saveFailed) {
        saveFailed = false;
        emit();
      }
    } catch (error) {
      if (!saveFailed) {
        saveFailed = true;
        emit();
      }
    }
  }

  function schedule(): void {
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = undefined;
      write();
    }, SAVE_DELAY_MS);
  }

  function referencedImageIds(): Record<string, boolean> {
    var referenced: Record<string, boolean> = {};
    for (var index = 0; index < notes.length; index += 1) {
      var ids = noteImageIds(notes[index]);
      for (var at = 0; at < ids.length; at += 1) referenced[ids[at]] = true;
    }
    return referenced;
  }

  function imageBytes(): number {
    var total = 0;
    var keys = Object.keys(images);
    for (var index = 0; index < keys.length; index += 1) total += images[keys[index]].size;
    return total;
  }

  function sanitizeNoteImages(): void {
    var changed = false;
    var next = notes.map(function (note) {
      var ids = noteImageIds(note);
      var missing = false;
      for (var index = 0; index < ids.length; index += 1) {
        if (images[ids[index]] === undefined) {
          missing = true;
          break;
        }
      }
      if (!missing) return note;
      changed = true;
      var content: NoteBlock[] = note.content.filter(function (block) {
        return block.type !== 'image' || images[block.id] !== undefined;
      });
      if (content.length === 0) content = [{ type: 'text', text: '' }];
      return {
        id: note.id,
        title: note.title,
        body: note.body,
        content: content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        favorite: note.favorite,
        labels: normalizeLabels(note.labels)
      };
    });
    if (changed) {
      notes = next;
      schedule();
    }
  }

  /** Delete stored image records that no memo references anymore. */
  function collectOrphans(): Promise<void> {
    if (!imagesAvailable) return Promise.resolve();
    var referenced = referencedImageIds();
    var orphans = Object.keys(images).filter(function (id) {
      return referenced[id] !== true;
    });
    if (orphans.length === 0) return Promise.resolve();
    var db = imageDb;
    var deletion = db === null ? Promise.resolve() : deleteImageRecords(db, orphans);
    return deletion.then(function () {
      // Remove only the records this call actually deleted. Rebuilding the
      // map from the pre-await `referenced` snapshot could drop an image that
      // a concurrent addImage inserted while the delete was in flight.
      var next: ImageMap = {};
      var keys = Object.keys(images);
      for (var index = 0; index < keys.length; index += 1) {
        if (orphans.indexOf(keys[index]) < 0) next[keys[index]] = images[keys[index]];
      }
      images = next;
      emit();
    }, function () {
      // Leave the records for a later attempt; the in-memory budget still
      // counts them, so a stuck delete cannot silently lose image data.
    });
  }

  function persistImage(clean: ImageRecord): Promise<AddImageResult> {
    var db = imageDb;
    if (db === null) return Promise.resolve({ ok: false, reason: 'unavailable' });
    return writeImageRecord(db, clean).then(function (): AddImageResult {
      var next: ImageMap = {};
      var keys = Object.keys(images);
      for (var index = 0; index < keys.length; index += 1) next[keys[index]] = images[keys[index]];
      next[clean.id] = clean;
      images = next;
      emit();
      return { ok: true, record: clean };
    }, function () {
      return { ok: false, reason: 'quota' };
    });
  }

  function addImage(record: unknown): Promise<AddImageResult> {
    if (!imagesAvailable) return Promise.resolve({ ok: false, reason: 'unavailable' });
    var clean = normalizeImageRecord(record);
    if (clean === undefined) return Promise.resolve({ ok: false, reason: 'unsupported' });
    var image = clean;
    if (imageBytes() + image.size <= MAX_TOTAL_IMAGE_BYTES) return persistImage(image);
    return collectOrphans().then(function (): AddImageResult | Promise<AddImageResult> {
      if (imageBytes() + image.size > MAX_TOTAL_IMAGE_BYTES) return { ok: false, reason: 'budget' };
      return persistImage(image);
    });
  }

  function loadImages(): Promise<void> {
    return openImageDb().then(function (db) {
      imageDb = db;
      return readImageRecords(db);
    }).then(function (records) {
      var map: ImageMap = {};
      for (var index = 0; index < records.length; index += 1) {
        var record = normalizeImageRecord(records[index]);
        if (record !== undefined) map[record.id] = record;
      }
      images = map;
      sanitizeNoteImages();
      var referenced = referencedImageIds();
      var orphans = Object.keys(images).filter(function (id) {
        return referenced[id] !== true;
      });
      if (orphans.length === 0 || imageDb === null) return undefined;
      return deleteImageRecords(imageDb, orphans).then(function () {
        var next: ImageMap = {};
        var keys = Object.keys(images);
        for (var index = 0; index < keys.length; index += 1) {
          if (referenced[keys[index]] === true) next[keys[index]] = images[keys[index]];
        }
        images = next;
      }, function () {
        /* keep orphan records instead of risking a failed cleanup */
      });
    }).catch(function (error) {
      imagesAvailable = false;
      images = {};
      console.error('[dsh-side-memo] image store unavailable', error);
    }).then(function () {
      imagesReady = true;
      emit();
    });
  }

  try {
    if (typeof localStorage === 'undefined') {
      saveFailed = true;
    } else {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null && raw !== '') {
        var parsed = JSON.parse(raw) as { notes?: unknown } | null;
        var entries: unknown[] = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.notes) ? parsed.notes : [];
        notes = entries.map(normalizeNote).filter(function (note): note is Note {
          return note !== undefined;
        }).slice(0, MAX_NOTES);
      }
    }
  } catch (error) {
    saveFailed = true;
    notes = [];
  }

  emit();
  loadImages();

  return {
    subscribe: function (listener) {
      listeners.add(listener);
      return function () {
        listeners.delete(listener);
      };
    },
    getSnapshot: function () {
      return snapshot;
    },
    create: function () {
      if (notes.length >= MAX_NOTES) return undefined;
      var now = Date.now();
      var note: Note = {
        id: newNoteId(),
        title: '',
        body: '',
        content: [{ type: 'text', text: '' }],
        createdAt: now,
        updatedAt: now,
        favorite: false,
        labels: []
      };
      notes = [note].concat(notes);
      schedule();
      emit();
      return note;
    },
    update: function (id, patch) {
      var index = -1;
      for (var at = 0; at < notes.length; at += 1) {
        if (notes[at].id === id) {
          index = at;
          break;
        }
      }
      if (index < 0) return undefined;
      var current = notes[index];
      var shaped: FittedContent;
      if (patch.content !== undefined) {
        shaped = normalizeContent(patch.content, patch.body);
      } else if (patch.body !== undefined) {
        shaped = normalizeContent(undefined, patch.body);
      } else {
        shaped = { content: current.content, body: current.body };
      }
      // Only trim image references once the local cache has actually loaded:
      // before that (or after a failed image-store load) the cache is empty
      // and dropping the references would permanently delete the memos' images.
      if (imagesReady && imagesAvailable) {
        var keptContent: NoteBlock[] = [];
        for (var blockIndex = 0; blockIndex < shaped.content.length; blockIndex += 1) {
          var block = shaped.content[blockIndex];
          if (block.type === 'image' && images[block.id] === undefined) continue;
          keptContent.push(block);
        }
        if (keptContent.length !== shaped.content.length) {
          if (keptContent.length === 0) keptContent.push({ type: 'text', text: '' });
          shaped = { content: keptContent, body: contentText(keptContent) };
        }
      }
      var title = typeof patch.title === 'string' ? patch.title.slice(0, MAX_TITLE) : current.title;
      var next: Note = {
        id: current.id,
        title: title,
        body: shaped.body,
        content: shaped.content,
        createdAt: current.createdAt,
        updatedAt: Date.now(),
        favorite: typeof patch.favorite === 'boolean' ? patch.favorite : current.favorite === true,
        labels: patch.labels !== undefined ? normalizeLabels(patch.labels) : normalizeLabels(current.labels)
      };
      notes = notes.slice(0, index).concat([next], notes.slice(index + 1));
      schedule();
      emit();
      return next;
    },
    setFavorite: function (id, favorite) {
      var index = -1;
      for (var at = 0; at < notes.length; at += 1) {
        if (notes[at].id === id) {
          index = at;
          break;
        }
      }
      if (index < 0) return undefined;
      var current = notes[index];
      var next: Note = {
        id: current.id,
        title: current.title,
        body: current.body,
        content: current.content,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        favorite: favorite === true,
        labels: normalizeLabels(current.labels)
      };
      notes = notes.slice(0, index).concat([next], notes.slice(index + 1));
      schedule();
      emit();
      return next;
    },
    remove: function (id) {
      var next = notes.filter(function (note) {
        return note.id !== id;
      });
      if (next.length === notes.length) return false;
      notes = next;
      schedule();
      emit();
      collectOrphans();
      return true;
    },
    importMany: function (entries) {
      var now = Date.now();
      var remaining = MAX_NOTES - notes.length;
      var added: Note[] = [];
      var skipped = 0;
      var limit = 0;
      for (var index = 0; index < entries.length; index += 1) {
        var entry: ImportEntry = entries[index] === null || typeof entries[index] !== 'object' ? {} : entries[index];
        var title = typeof entry.title === 'string' ? entry.title.slice(0, MAX_TITLE) : '';
        var body = typeof entry.body === 'string' ? entry.body.replace(/\r\n?/g, '\n').slice(0, MAX_BODY) : '';
        if (title.trim() === '' && body.trim() === '') {
          skipped += 1;
          continue;
        }
        if (added.length >= remaining) {
          limit += 1;
          continue;
        }
        var created = typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : now;
        var updated = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : created;
        added.push({
          id: newNoteId(),
          title: title,
          body: body,
          content: textBlocksForBody(body),
          createdAt: created,
          updatedAt: updated,
          favorite: entry.favorite === true,
          labels: normalizeLabels(entry.labels)
        });
      }
      if (added.length > 0) {
        notes = added.concat(notes);
        schedule();
        emit();
      }
      return { added: added.length, skipped: skipped, limit: limit };
    },
    flush: function () {
      if (saveTimer !== undefined) write();
    },
    addImage: addImage,
    collectOrphans: collectOrphans,
    limits: { maxNotes: MAX_NOTES, maxTitle: MAX_TITLE, maxBody: MAX_BODY, maxImages: MAX_IMAGES }
  };
}

// ---------------------------------------------------------------------
// Rich editor DOM bridge: contenteditable tree <-> ordered content blocks.
// The DOM is the editing surface; the store only ever sees serialized blocks.
// ---------------------------------------------------------------------

var EDITOR_BLOCK_TAGS: Record<string, boolean> = { DIV: true, P: true, LI: true, H1: true, H2: true, H3: true, BLOCKQUOTE: true };

function readEditorState(root: HTMLElement): EditorState {
  var blocks: NoteBlock[] = [];
  var pendingText = '';
  var pendingHasContent = false;

  function flushPending(force: boolean): void {
    if (!pendingHasContent && !force) return;
    blocks.push({ type: 'text', text: pendingText });
    pendingText = '';
    pendingHasContent = false;
  }

  function pushImage(id: string): void {
    flushPending(false);
    blocks.push({ type: 'image', id: id });
  }

  function consumeInline(node: Node): void {
    if (node.nodeType === 3) {
      var value = (node.nodeValue as string).replace(/\u00a0/g, ' ');
      pendingText += value;
      if (value !== '') pendingHasContent = true;
      return;
    }
    if (node.nodeType !== 1) return;
    var element = node as Element;
    var tag = element.tagName.toUpperCase();
    if (tag === 'IMG') {
      var id = element.getAttribute('data-image-id');
      if (id !== null && id !== '') pushImage(id);
      return;
    }
    if (tag === 'BR') {
      pendingText += '\n';
      pendingHasContent = true;
      return;
    }
    if (tag === 'BUTTON') return;
    for (var index = 0; index < node.childNodes.length; index += 1) consumeInline(node.childNodes[index]);
  }

  function consumeBlock(block: HTMLElement): void {
    var placeholderId = typeof block.getAttribute === 'function' ? block.getAttribute('data-image-id') : null;
    if (placeholderId !== null && placeholderId !== '') {
      pushImage(placeholderId);
      return;
    }
    var hasImage = typeof block.querySelector === 'function' && block.querySelector('img[data-image-id]') !== null;
    if (!hasImage) {
      pendingText = '';
      pendingHasContent = false;
      consumeInline(block);
      var text = pendingText;
      pendingText = '';
      pendingHasContent = false;
      if (/^\n+$/.test(text)) text = '';
      blocks.push({ type: 'text', text: text });
      return;
    }
    pendingText = '';
    pendingHasContent = false;
    for (var index = 0; index < block.childNodes.length; index += 1) consumeInline(block.childNodes[index]);
    flushPending(false);
  }

  for (var index = 0; index < root.childNodes.length; index += 1) {
    var node = root.childNodes[index];
    var blockElement = node.nodeType === 1 ? (node as HTMLElement) : null;
    if (blockElement !== null && blockElement.tagName.toUpperCase() === 'BR') {
      // Browsers occasionally leave a bare <br> between block level lines;
      // it is a placeholder, not an extra blank line.
      if (pendingHasContent) consumeInline(node);
      continue;
    }
    if (blockElement !== null && EDITOR_BLOCK_TAGS[blockElement.tagName.toUpperCase()] === true) {
      flushPending(false);
      consumeBlock(blockElement);
    } else {
      consumeInline(node);
    }
  }
  flushPending(false);
  if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
  var length = contentText(blocks).length;
  var shaped = fitContent(blocks, MAX_BODY);
  return { content: shaped.content, body: shaped.body, length: length, truncated: length > MAX_BODY };
}

function readEditorContent(root: HTMLElement): NoteBlock[] {
  return readEditorState(root).content;
}

function fillTextBlock(container: HTMLElement, text: string): void {
  if (text === '') {
    container.appendChild(document.createElement('br'));
    return;
  }
  var lines = text.split('\n');
  for (var index = 0; index < lines.length; index += 1) {
    if (index > 0) container.appendChild(document.createElement('br'));
    if (lines[index] !== '') container.appendChild(document.createTextNode(lines[index]));
  }
}

function createImageBlockElement(record: ImageRecord, removeLabel: string, altLabel: string): HTMLElement {
  var block = document.createElement('div');
  block.className = 'dsm-image-block';
  block.setAttribute('contenteditable', 'false');
  var image = document.createElement('img');
  image.src = record.src;
  image.alt = typeof altLabel === 'string' ? altLabel : '';
  image.draggable = false;
  image.setAttribute('data-image-id', record.id);
  block.appendChild(image);
  var remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'dsm-image-remove';
  remove.setAttribute('data-image-remove', record.id);
  remove.setAttribute('aria-label', removeLabel);
  remove.setAttribute('title', removeLabel);
  remove.textContent = '\u00d7';
  block.appendChild(remove);
  return block;
}

function buildEditorDom(root: HTMLElement, note: { content: NoteBlock[] }, images: ImageMap, removeLabel: string, unavailableLabel: string, altLabel: string): void {
  root.textContent = '';
  var content = note.content;
  for (var index = 0; index < content.length; index += 1) {
    var block = content[index];
    if (block.type === 'image') {
      var record = images[block.id];
      if (record !== undefined) {
        root.appendChild(createImageBlockElement(record, removeLabel, altLabel));
        continue;
      }
      // Keep the reference alive even when its bytes cannot be read right
      // now, otherwise the next save would silently drop the image.
      var placeholder = document.createElement('div');
      placeholder.className = 'dsm-image-block dsm-image-missing';
      placeholder.setAttribute('contenteditable', 'false');
      placeholder.setAttribute('data-image-id', block.id);
      if (typeof unavailableLabel === 'string' && unavailableLabel !== '') placeholder.textContent = unavailableLabel;
      root.appendChild(placeholder);
      continue;
    }
    var element = document.createElement('div');
    fillTextBlock(element, block.text);
    root.appendChild(element);
  }
  if (root.childNodes.length === 0) {
    var empty = document.createElement('div');
    empty.appendChild(document.createElement('br'));
    root.appendChild(empty);
  }
}

function caretRangeIn(root: HTMLElement | null): Range | null {
  if (root === null) return null;
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null;
  var selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  var range = selection.getRangeAt(0);
  var container = range.startContainer;
  if (container !== root && !root.contains(container)) return null;
  return range;
}

function topBlockFor(root: HTMLElement, node: Node): HTMLElement | null {
  var current: Node | null = node;
  while (current !== null && current.parentNode !== null && current.parentNode !== root) current = current.parentNode;
  return current !== null && current.nodeType === 1 ? (current as HTMLElement) : null;
}

function insertImageIntoEditor(root: HTMLElement, record: ImageRecord, removeLabel: string, altLabel: string): void {
  var imageBlock = createImageBlockElement(record, removeLabel, altLabel);
  var tail = document.createElement('div');
  tail.appendChild(document.createElement('br'));
  var range = caretRangeIn(root);
  var blockElement = range === null ? null : topBlockFor(root, range.startContainer);
  if (blockElement === null || range === null) {
    root.appendChild(imageBlock);
    root.appendChild(tail);
  } else if (blockElement.getAttribute('contenteditable') === 'false' || blockElement.querySelector('img[data-image-id]') !== null) {
    if (blockElement.parentNode !== null) blockElement.parentNode.insertBefore(imageBlock, blockElement.nextSibling);
    if (imageBlock.parentNode !== null) imageBlock.parentNode.insertBefore(tail, imageBlock.nextSibling);
  } else {
    var trailing = document.createRange();
    trailing.selectNodeContents(blockElement);
    var fragment: DocumentFragment | null = null;
    try {
      trailing.setStart(range.startContainer, range.startOffset);
      fragment = trailing.extractContents();
    } catch (error) {
      fragment = null;
    }
    var leadingText = blockElement.textContent !== '' || blockElement.querySelector('img') !== null;
    var fragmentHasContent = fragment !== null && (fragment.textContent !== '' || fragment.querySelector('img') !== null);
    if (!leadingText && blockElement.parentNode !== null) {
      // Caret was at offset 0 of a non-empty line: extracting put the whole
      // line into `fragment`, so replace the now-empty block rather than
      // treating it as an empty block and silently discarding that text.
      blockElement.parentNode.replaceChild(imageBlock, blockElement);
      if (imageBlock.parentNode !== null) imageBlock.parentNode.insertBefore(tail, imageBlock.nextSibling);
    } else if (blockElement.parentNode !== null) {
      blockElement.parentNode.insertBefore(imageBlock, blockElement.nextSibling);
      if (imageBlock.parentNode !== null) imageBlock.parentNode.insertBefore(tail, imageBlock.nextSibling);
    } else {
      root.appendChild(imageBlock);
      root.appendChild(tail);
    }
    if (fragmentHasContent && fragment !== null) {
      var placeholder = tail.querySelector('br');
      while (fragment.firstChild !== null) {
        if (placeholder !== null) tail.insertBefore(fragment.firstChild, placeholder);
        else tail.appendChild(fragment.firstChild);
      }
      if (placeholder !== null && (tail.textContent !== '' || tail.querySelector('img') !== null)) tail.removeChild(placeholder);
    }
  }
  try {
    var caret = document.createRange();
    caret.setStart(tail, 0);
    caret.collapse(true);
    var selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      selection.addRange(caret);
    }
  } catch (error) {
    /* caret placement is best effort */
  }
  root.focus();
}

function moveCaretToPoint(root: HTMLElement | null, x: number, y: number): void {
  var range = null;
  try {
    if (document.caretRangeFromPoint !== undefined) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint !== undefined) {
      var position = document.caretPositionFromPoint(x, y);
      if (position !== null && position !== undefined) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
  } catch (error) {
    range = null;
  }
  if (range === null) return;
  if (root === null) return;
  var container = range.startContainer;
  if (container !== root && !root.contains(container)) return;
  try {
    var selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch (error) {
    /* ignore */
  }
}

// A safe React 18 external-store binding (the shipped React is 18.2).
var useSyncExternalStore = typeof React.useSyncExternalStore === 'function'
  ? React.useSyncExternalStore
  : function useLegacyStore<T>(subscribe: (listener: () => void) => () => void, getSnapshot: () => T): T {
    var state = React.useState(getSnapshot);
    React.useEffect(function () {
      var update = function () {
        state[1](getSnapshot());
      };
      update();
      return subscribe(update);
    }, [subscribe, getSnapshot]);
    return state[0];
  };

// ---------------------------------------------------------------------
// Panel surfaces: the session-scoped right-sidebar tab, plus a frame-level
// drawer used while no Session exists yet (the right sidebar only has a
// surface once a Session is on screen).
// ---------------------------------------------------------------------

/** Boolean store for the frame-level drawer, shared by the header toggle and the drawer. */
function createDrawerStore(): DrawerStore {
  var open = false;
  var listeners = new Set<() => void>();
  function emit() {
    listeners.forEach(function (listener) {
      try {
        listener();
      } catch (error) {
        console.error('[dsh-side-memo] drawer listener failed', error);
      }
    });
  }
  return {
    subscribe: function (listener) {
      listeners.add(listener);
      return function () {
        listeners.delete(listener);
      };
    },
    getSnapshot: function () {
      return open;
    },
    set: function (value) {
      var next = value === true;
      if (next === open) return;
      open = next;
      emit();
    },
    toggle: function () {
      open = !open;
      emit();
    }
  };
}

/**
 * Read the Session the right sidebar can act on. `ctx.sidebarRight.mounted`
 * is the observable of the on-screen Session — undefined while no Session is
 * selected, and defined for a blank/new Session whose surface the seats mint.
 */
function readMountedSession(right: DshSidebarRightService | undefined | null): string | undefined {
  try {
    if (right === undefined || right === null) return undefined;
    var store = right.mounted;
    if (store === undefined || store === null || typeof store.getSnapshot !== 'function') return undefined;
    return store.getSnapshot();
  } catch (error) {
    return undefined;
  }
}

/** Stable useSyncExternalStore binding over the live `ctx.sidebarRight.mounted`. */
function createMountedBinding(readRight: () => DshSidebarRightService | undefined): MountedBinding {
  function currentStore(): MountedSessionStore | undefined {
    try {
      var right = readRight();
      return right === undefined || right === null ? undefined : right.mounted;
    } catch (error) {
      return undefined;
    }
  }
  return {
    getSnapshot: function () {
      try {
        var store = currentStore();
        if (store === undefined || store === null || typeof store.getSnapshot !== 'function') return undefined;
        return store.getSnapshot();
      } catch (error) {
        return undefined;
      }
    },
    subscribe: function (listener) {
      var store = currentStore();
      if (store === undefined || store === null || typeof store.subscribe !== 'function') {
        return function () {};
      }
      try {
        return store.subscribe(listener);
      } catch (error) {
        return function () {};
      }
    }
  };
}

// ---------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------

function translateFor(props: { t?: Translator }): Translator {
  return typeof props.t === 'function' ? props.t : fallbackT;
}

function ageLabel(t: Translator, timestamp: number, now: number): string {
  var delta = Math.max(0, now - timestamp);
  if (delta < 60000) return t('time.now');
  var minutes = Math.floor(delta / 60000);
  if (minutes < 60) return t('time.minutes', { count: minutes });
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { count: hours });
  var days = Math.floor(hours / 24);
  if (days < 7) return t('time.days', { count: days });
  try {
    return new Date(timestamp).toISOString().slice(0, 10);
  } catch (error) {
    return '';
  }
}

function noteTitleText(t: Translator, note: Note): string {
  var title = note.title.trim();
  if (title !== '') return title;
  var lines = note.body.split('\n');
  for (var at = 0; at < lines.length; at += 1) {
    var line = lines[at].trim();
    if (line !== '') return line.slice(0, 80);
  }
  if (noteImageCount(note) > 0) return t('image.memo');
  return t('editor.untitled');
}

function noteSnippetText(t: Translator, note: Note): string {
  var lines = note.body.split('\n');
  var nonEmpty = [];
  for (var at = 0; at < lines.length; at += 1) {
    var line = lines[at].trim();
    if (line !== '') nonEmpty.push(line);
  }
  var base = '';
  var start = note.title.trim() === '' ? 1 : 0;
  if (nonEmpty.length > start) base = nonEmpty.slice(start).join(' ').slice(0, 160);
  var imageCount = noteImageCount(note);
  if (imageCount === 0) return base;
  var label = imageCountLabel(t, imageCount);
  return base === '' ? label : base + ' \u00b7 ' + label;
}

/** Favorites first, then most recently updated. */
function sortNotes(list: Note[]): Note[] {
  return list.slice().sort(function (left, right) {
    var leftFavorite = left.favorite === true ? 1 : 0;
    var rightFavorite = right.favorite === true ? 1 : 0;
    if (leftFavorite !== rightFavorite) return rightFavorite - leftFavorite;
    return right.updatedAt - left.updatedAt;
  });
}

function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(function () {
      return true;
    }, function () {
      return legacyCopy(text);
    });
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch (error) {
    return false;
  }
}

function copyNoteContent(note: Note, images: ImageMap): Promise<boolean> {
  var text = note.body.trim() === '' ? note.title : note.body;
  if (text.trim() !== '') return copyToClipboard(text);
  var ids = noteImageIds(note);
  if (ids.length > 0) {
    var record = images[ids[0]];
    if (record !== undefined) return copyImageToClipboard(record.src);
  }
  return Promise.resolve(false);
}

// ---------------------------------------------------------------------
// Dragging a memo into the chat composer
// ---------------------------------------------------------------------
//
// The chat composer belongs to the conversation plugin, so the memo list
// never touches its DOM: a dragged memo carries a private MIME payload, and
// the drop is handed to the composer's public InputActions face
// (captureInsertion + insertText), which turns it into one undoable text
// edit at the draft's caret. text/plain is included as well, so the same
// drag still works when the list is mounted where no composer actions are
// reachable (the pre-Session drawer) and the browser's native drop applies.

/** Text a memo drag carries: body first, then the title; empty means no drag. */
function memoDragText(note: Note | null | undefined): string {
  if (note === null || note === undefined) return '';
  var body = typeof note.body === 'string' ? note.body : '';
  if (body.trim() !== '') return body;
  var title = typeof note.title === 'string' ? note.title : '';
  return title.trim() !== '' ? title : '';
}

function memoDragPayload(note: Note | null | undefined): MemoDragPayload | null {
  var text = memoDragText(note);
  if (text === '') return null;
  var source = note === null || note === undefined ? ({} as Partial<Note>) : note;
  return {
    mime: MEMO_DRAG_MIME,
    text: text,
    json: JSON.stringify({
      v: MEMO_DRAG_VERSION,
      id: typeof source.id === 'string' ? source.id : '',
      title: typeof source.title === 'string' ? source.title : '',
      text: text
    })
  };
}

function fillMemoDragData(dataTransfer: DataTransfer | null | undefined, note: Note): MemoDragPayload | null {
  var payload = memoDragPayload(note);
  if (payload === null) return null;
  if (dataTransfer === null || dataTransfer === undefined || typeof dataTransfer.setData !== 'function') return payload;
  try {
    dataTransfer.setData(MEMO_DRAG_MIME, payload.json);
    dataTransfer.setData('text/plain', payload.text);
    dataTransfer.effectAllowed = 'copy';
  } catch (error) {
    /* A browser may restrict payload writes; text/plain is the fallback. */
  }
  return payload;
}

function readMemoDragPayload(dataTransfer: DataTransfer | null | undefined): DragPayload | null {
  if (dataTransfer === null || dataTransfer === undefined || typeof dataTransfer.getData !== 'function') return null;
  var raw = '';
  try {
    raw = dataTransfer.getData(MEMO_DRAG_MIME);
  } catch (error) {
    return null;
  }
  if (typeof raw !== 'string' || raw === '') return null;
  var data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    return null;
  }
  if (data === null || typeof data !== 'object' || data.v !== MEMO_DRAG_VERSION) return null;
  var text = typeof data.text === 'string' ? data.text : '';
  if (text === '') return null;
  return {
    id: typeof data.id === 'string' ? data.id : '',
    title: typeof data.title === 'string' ? data.title : '',
    text: text
  };
}

/** True when a drag carries our payload; `types` is readable before drop. */
function memoDragTypesInclude(dataTransfer: DataTransfer | null | undefined): boolean {
  if (dataTransfer === null || dataTransfer === undefined) return false;
  var types = dataTransfer.types;
  if (types === null || types === undefined) return false;
  if (typeof types.includes === 'function') return types.includes(MEMO_DRAG_MIME);
  if (typeof types.indexOf === 'function') return types.indexOf(MEMO_DRAG_MIME) >= 0;
  for (var index = 0; index < types.length; index += 1) {
    if (types[index] === MEMO_DRAG_MIME) return true;
  }
  return false;
}

/** The composer's editable root, when it accepts text right now. */
function editableComposerRoot(element: Element | null | undefined): HTMLElement | null {
  if (element === null || element === undefined) return null;
  var root = element as HTMLElement;
  if (root.isContentEditable === false) return null;
  var editable = typeof root.getAttribute === 'function' ? root.getAttribute('contenteditable') : null;
  if (editable === 'false') return null;
  return root;
}

/**
 * The chat composer a drop landed on: the editable root itself, or the one
 * inside the composer seat (dropping on the box's padding or buttons still
 * counts as dropping on the chat box).
 */
function composerEditorFor(target: EventTarget | null | undefined): HTMLElement | null {
  if (target === null || target === undefined) return null;
  var element = target as Element;
  if (typeof element.closest !== 'function') return null;
  var direct = editableComposerRoot(element.closest('[data-composer-input]'));
  if (direct !== null) return direct;
  var seat = element.closest('[data-composer-seat]');
  if (seat === null || seat === undefined || typeof seat.querySelectorAll !== 'function') return null;
  var roots = seat.querySelectorAll('[data-composer-input]');
  for (var index = 0; index < roots.length; index += 1) {
    var root = editableComposerRoot(roots[index]);
    if (root !== null) return root;
  }
  return null;
}

/** What a drop event means for the memo list: paste, or stay hands-off. */
function planMemoDrop(event: DragEvent | null | undefined): DropPlan {
  if (event === null || event === undefined) return { kind: 'ignore' };
  if (!memoDragTypesInclude(event.dataTransfer)) return { kind: 'ignore' };
  var editor = composerEditorFor(event.target);
  if (editor === null) return { kind: 'ignore' };
  var payload = readMemoDragPayload(event.dataTransfer);
  if (payload === null) return { kind: 'ignore' };
  return { kind: 'insert', editor: editor, payload: payload };
}

/**
 * Paste memo text through InputActions. Returns false when the composer
 * refused it (busy phase, stale draft revision, or the API is unavailable),
 * so the caller can tell the user instead of losing the memo silently.
 */
function insertMemoIntoComposer(inputActions: ComposerInputActions | null | undefined, text: string): boolean {
  if (inputActions === null || inputActions === undefined) return false;
  if (typeof inputActions.insertText !== 'function') return false;
  if (typeof inputActions.captureInsertion !== 'function') return false;
  var span;
  try {
    span = inputActions.captureInsertion();
  } catch (error) {
    return false;
  }
  if (span === null || span === undefined) return false;
  try {
    return inputActions.insertText(text, span) !== false;
  } catch (error) {
    return false;
  }
}

// ---------------------------------------------------------------------
// XLSX import / export (minimal self-contained OOXML reader and writer)
// ---------------------------------------------------------------------

var CRC_TABLE: number[] = (function buildCrcTable(): number[] {
  var table: number[] = new Array(256);
  for (var index = 0; index < 256; index += 1) {
    var value = index;
    for (var bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  var crc = 0xFFFFFFFF;
  for (var index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Build a store-only ZIP archive (OOXML parts are small enough). */
function zipStore(files: ZipFile[]): Uint8Array {
  var localParts: Uint8Array[] = [];
  var localOffsets: number[] = [];
  var cursor = 0;
  files.forEach(function (file) {
    var nameBytes = encodeText(file.name);
    var data = file.data;
    var local = new Uint8Array(30 + nameBytes.length + data.length);
    var view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0x21, true);
    view.setUint32(14, crc32(data), true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localOffsets.push(cursor);
    localParts.push(local);
    cursor += local.length;
  });
  var centralOffset = cursor;
  var centralParts: Uint8Array[] = [];
  files.forEach(function (file, index) {
    var nameBytes = encodeText(file.name);
    var data = file.data;
    var central = new Uint8Array(46 + nameBytes.length);
    var view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x21, true);
    view.setUint32(16, crc32(data), true);
    view.setUint32(20, data.length, true);
    view.setUint32(24, data.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, localOffsets[index], true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    cursor += central.length;
  });
  var centralSize = cursor - centralOffset;
  var end = new Uint8Array(22);
  var endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  var output = new Uint8Array(cursor + 22);
  var at = 0;
  localParts.concat(centralParts, [end]).forEach(function (part) {
    output.set(part, at);
    at += part.length;
  });
  return output;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length === 0) return new Uint8Array(0);
  if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined' || typeof Response === 'undefined') {
    throw new Error('deflate-raw is unavailable in this browser');
  }
  var source = new Uint8Array(bytes.length);
  source.set(bytes);
  var stream = new Blob([source]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  var buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Read the entries of a ZIP archive into a plain name -> bytes map. */
async function readZip(buffer: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  var bytes = new Uint8Array(buffer);
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var end = -1;
  var minimum = Math.max(0, bytes.length - 22 - 65535);
  for (var at = bytes.length - 22; at >= minimum; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive');
  var count = view.getUint16(end + 10, true);
  var centralSize = view.getUint32(end + 12, true);
  var centralOffset = view.getUint32(end + 16, true);
  if (count === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) throw new Error('zip64 is not supported');
  if (count > XLSX_MAX_ENTRIES) throw new Error('too many zip entries');
  if (centralOffset + centralSize > bytes.length) throw new Error('bad zip directory');
  var decoder = new TextDecoder('utf-8');
  var files: Record<string, Uint8Array> = {};
  var total = 0;
  var cursor = centralOffset;
  for (var index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('bad zip directory');
    var method = view.getUint16(cursor + 10, true);
    var compressedSize = view.getUint32(cursor + 20, true);
    var uncompressedSize = view.getUint32(cursor + 24, true);
    var nameLength = view.getUint16(cursor + 28, true);
    var extraLength = view.getUint16(cursor + 30, true);
    var commentLength = view.getUint16(cursor + 32, true);
    var localOffset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('bad zip directory');
    var name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.charAt(name.length - 1) === '/') continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad zip entry');
    var localNameLength = view.getUint16(localOffset + 26, true);
    var localExtraLength = view.getUint16(localOffset + 28, true);
    var dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > bytes.length) throw new Error('bad zip entry data');
    var raw = bytes.subarray(dataStart, dataStart + compressedSize);
    var data;
    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      data = await inflateRaw(raw);
    } else {
      throw new Error('unsupported zip compression');
    }
    if (uncompressedSize !== 0 && data.length !== uncompressedSize) throw new Error('bad zip entry size');
    total += data.length;
    if (total > XLSX_MAX_TOTAL_BYTES) throw new Error('zip content is too large');
    files[name] = data;
  }
  return files;
}

function xmlEscape(value: unknown): string {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlDecode(value: string): string {
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, function (match, hex) {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (error) {
        return '';
      }
    })
    .replace(/&#(\d+);/g, function (match, decimal) {
      try {
        return String.fromCodePoint(parseInt(decimal, 10));
      } catch (error) {
        return '';
      }
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function isoStamp(value: number): string {
  try {
    return new Date(value).toISOString();
  } catch (error) {
    return '';
  }
}

function xlsxCell(column: string, row: number, value: unknown, style: number): string {
  return '<c r="' + column + row + '" t="inlineStr" s="' + style + '"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
}

/** Serialize notes into the smallest valid .xlsx workbook Excel accepts. */
function buildXlsxNotes(notes: Note[]): Uint8Array {
  var rows = [];
  var headers = ['Title', 'Body', 'Favorite', 'Labels', 'Created', 'Updated', 'Images'];
  var headerCells = '';
  for (var headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
    headerCells += xlsxCell(String.fromCharCode(65 + headerIndex), 1, headers[headerIndex], 2);
  }
  rows.push('<row r="1">' + headerCells + '</row>');
  notes.forEach(function (note, index) {
    var row = index + 2;
    var cells = '';
    cells += xlsxCell('A', row, note.title, 1);
    cells += xlsxCell('B', row, note.body, 1);
    cells += xlsxCell('C', row, note.favorite === true ? 'TRUE' : 'FALSE', 1);
    cells += xlsxCell('D', row, noteLabels(note).join(', '), 1);
    cells += xlsxCell('E', row, isoStamp(note.createdAt), 1);
    cells += xlsxCell('F', row, isoStamp(note.updatedAt), 1);
    cells += xlsxCell('G', row, String(noteImageCount(note)), 1);
    rows.push('<row r="' + row + '">' + cells + '</row>');
  });
  var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<cols><col min="1" max="1" width="28" customWidth="1"/>'
    + '<col min="2" max="2" width="80" customWidth="1"/>'
    + '<col min="3" max="3" width="12" customWidth="1"/>'
    + '<col min="4" max="4" width="22" customWidth="1"/>'
    + '<col min="5" max="6" width="22" customWidth="1"/>'
    + '<col min="7" max="7" width="10" customWidth="1"/></cols>'
    + '<sheetData>' + rows.join('') + '</sheetData></worksheet>';
  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>';
  var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Notes" sheetId="1" r:id="rId1"/></sheets></workbook>';
  var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>';
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  var parts = [
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rootRels },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
    { name: 'xl/styles.xml', text: styles },
    { name: 'xl/worksheets/sheet1.xml', text: sheet }
  ];
  return zipStore(parts.map(function (part) {
    return { name: part.name, data: encodeText(part.text) };
  }));
}

function columnNumber(letters: string): number {
  var number = 0;
  for (var index = 0; index < letters.length; index += 1) {
    number = number * 26 + (letters.charCodeAt(index) - 64);
  }
  return number;
}

function collectTextRuns(xml: string): string {
  var text = '';
  var pattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  var match;
  while ((match = pattern.exec(xml)) !== null) text += xmlDecode(match[1]);
  return text;
}

function parseSharedStrings(xml: string): string[] {
  var values: string[] = [];
  if (!xml) return values;
  var pattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  var match;
  while ((match = pattern.exec(xml)) !== null) values.push(collectTextRuns(match[1]));
  return values;
}

function parseSheetRows(xml: string, sharedStrings: string[]): string[][] {
  var rows: Record<number, Record<number, string>> = {};
  var maxColumn = 0;
  var rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  var rowMatch;
  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    var rowNumberMatch = /\br="(\d+)"/.exec(rowMatch[1]);
    var rowNumber = rowNumberMatch ? parseInt(rowNumberMatch[1], 10) : Object.keys(rows).length + 1;
    var cells: Record<number, string> = {};
    var cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    var cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[2])) !== null) {
      var attributes = cellMatch[1];
      var inner = cellMatch[2] === undefined ? '' : cellMatch[2];
      var refMatch = /\br="([A-Z]+)\d+"/.exec(attributes);
      var column = refMatch ? columnNumber(refMatch[1]) : 1;
      var typeMatch = /\bt="([^"]+)"/.exec(attributes);
      var type = typeMatch ? typeMatch[1] : '';
      var value = '';
      if (type === 's') {
        var sharedMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        var sharedIndex = sharedMatch ? parseInt(xmlDecode(sharedMatch[1]), 10) : NaN;
        value = Number.isFinite(sharedIndex) && sharedStrings[sharedIndex] !== undefined ? sharedStrings[sharedIndex] : '';
      } else if (type === 'inlineStr') {
        value = collectTextRuns(inner);
      } else if (type === 'b') {
        var booleanMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        value = booleanMatch && xmlDecode(booleanMatch[1]) === '1' ? 'TRUE' : 'FALSE';
      } else {
        var valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        value = valueMatch ? xmlDecode(valueMatch[1]) : collectTextRuns(inner);
      }
      if (column > maxColumn) maxColumn = column;
      cells[column] = value;
    }
    rows[rowNumber] = cells;
  }
  var ordered = Object.keys(rows).map(Number).sort(function (left, right) {
    return left - right;
  });
  return ordered.map(function (rowNumber) {
    var row = rows[rowNumber];
    var values: string[] = [];
    for (var column = 1; column <= maxColumn; column += 1) {
      values.push(row[column] === undefined ? '' : row[column]);
    }
    return values;
  });
}

function importTimestamp(value: unknown, fallback: number): number {
  var text = String(value === undefined || value === null ? '' : value).trim();
  if (text === '') return fallback;
  if (/^\d+(\.\d+)?$/.test(text)) {
    var numeric = Number(text);
    if (Number.isFinite(numeric)) {
      if (numeric > 20000 && numeric < 90000) return Math.round((numeric - 25569) * 86400000);
      if (numeric > 1000000000000) return numeric;
      if (numeric > 1000000000) return numeric * 1000;
    }
  }
  var parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function importFavorite(value: unknown): boolean {
  var text = String(value === undefined || value === null ? '' : value)
    .trim()
    .toLocaleLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'y' ||
    text === '是' || text === '★' || text === '星标' || text === '收藏';
}

function parseLabelCell(value: unknown): string[] {
  var text = String(value === undefined || value === null ? '' : value);
  if (text === '') return [];
  return normalizeLabels(text.split(/[,，;；、]/));
}

function normalizedHeader(value: unknown): string {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_]+/g, '');
}

function stripXmlPrefixes(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
}

function headerColumn(headers: string[], aliases: string[]): number {
  for (var index = 0; index < aliases.length; index += 1) {
    var found = headers.indexOf(aliases[index]);
    if (found >= 0) return found;
  }
  return -1;
}

/** Parse an .xlsx workbook into note-shaped rows. */
async function parseXlsxNotes(buffer: ArrayBuffer): Promise<ImportedNote[]> {
  var files = await readZip(buffer);
  var sheetName = 'xl/worksheets/sheet1.xml';
  if (files[sheetName] === undefined) {
    var names = Object.keys(files);
    for (var index = 0; index < names.length; index += 1) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(names[index])) {
        sheetName = names[index];
        break;
      }
    }
  }
  if (files[sheetName] === undefined) throw new Error('no worksheet in this workbook');
  var sharedStrings = files['xl/sharedStrings.xml'] === undefined
    ? []
    : parseSharedStrings(stripXmlPrefixes(decodeText(files['xl/sharedStrings.xml'])));
  var table = parseSheetRows(stripXmlPrefixes(decodeText(files[sheetName])), sharedStrings);
  if (table.length === 0) return [];
  var headers = table[0].map(normalizedHeader);
  var mapping = {
    title: headerColumn(headers, ['title', 'subject', 'name', '标题', '便签标题', '名称']),
    body: headerColumn(headers, ['body', 'content', 'text', 'note', 'notes', '内容', '正文', '便签内容', '便签']),
    favorite: headerColumn(headers, ['favorite', 'favourite', 'starred', 'star', '收藏', '星标', '收藏状态']),
    labels: headerColumn(headers, ['labels', 'label', 'tags', 'tag', '标签', '标记']),
    created: headerColumn(headers, ['created', 'createdat', '创建时间', '创建', '创建于']),
    updated: headerColumn(headers, ['updated', 'updatedat', '更新时间', '更新', '更新于'])
  };
  var hasHeader = mapping.title >= 0 || mapping.body >= 0;
  var dataRows = hasHeader ? table.slice(1) : table;
  if (!hasHeader) {
    mapping.title = 0;
    mapping.body = 1;
    mapping.labels = -1;
    mapping.created = 2;
    mapping.updated = 3;
  }
  var now = Date.now();
  return dataRows.map(function (row) {
    var title = mapping.title >= 0 && row[mapping.title] !== undefined ? String(row[mapping.title]) : '';
    var body = mapping.body >= 0 && row[mapping.body] !== undefined ? String(row[mapping.body]) : '';
    var createdAt = importTimestamp(mapping.created >= 0 ? row[mapping.created] : '', now);
    var updatedAt = importTimestamp(mapping.updated >= 0 ? row[mapping.updated] : '', createdAt);
    return {
      title: title.trim(),
      body: body.replace(/\r\n?/g, '\n'),
      favorite: mapping.favorite >= 0 ? importFavorite(row[mapping.favorite]) : false,
      labels: mapping.labels >= 0 ? parseLabelCell(row[mapping.labels]) : [],
      createdAt: createdAt,
      updatedAt: updatedAt
    };
  });
}

// ---------------------------------------------------------------------
// Notes tab body
// ---------------------------------------------------------------------

function NotesBody(props: NotesBodyProps): React.ReactElement | null {
  var t = translateFor(props);
  var notes = props.notes;
  var renderSlot = typeof props.renderSlot === 'function' ? props.renderSlot : undefined;
  var snapshot = useSyncExternalStore(notes.subscribe, notes.getSnapshot, notes.getSnapshot);
  var limits = notes.limits;

  var queryState = React.useState('');
  var query = queryState[0];
  var setQuery = queryState[1];
  var editingState = React.useState<string | null>(null);
  var editingId = editingState[0];
  var setEditingId = editingState[1];
  var newIdState = React.useState<string | null>(null);
  var newId = newIdState[0];
  var setNewId = newIdState[1];
  var copiedState = React.useState<string | null>(null);
  var copiedId = copiedState[0];
  var setCopiedId = copiedState[1];
  var editorCopiedState = React.useState(false);
  var editorCopied = editorCopiedState[0];
  var setEditorCopied = editorCopiedState[1];
  var failedCopyState = React.useState(false);
  var failedCopy = failedCopyState[0];
  var setFailedCopy = failedCopyState[1];
  var armedState = React.useState(false);
  var deleteArmed = armedState[0];
  var setDeleteArmed = armedState[1];
  var announceState = React.useState('');
  var announce = announceState[0];
  var setAnnounce = announceState[1];
  var busyState = React.useState(false);
  var busy = busyState[0];
  var setBusy = busyState[1];
  var transferState = React.useState<{ tone: string; text: string } | null>(null);
  var transfer = transferState[0];
  var setTransfer = transferState[1];
  var fileInputRef = React.useRef<HTMLInputElement | null>(null);
  var imageInputRef = React.useRef<HTMLInputElement | null>(null);
  var editorRef = React.useRef<HTMLDivElement | null>(null);
  var titleInputRef = React.useRef<HTMLInputElement | null>(null);
  var builtEditorRef = React.useRef('');
  var dropHandlerRef = React.useRef<((event: DragEvent) => void) | null>(null);
  var composerHighlightRef = React.useRef<HTMLElement | null>(null);
  var draggingState = React.useState(false);
  var dragActive = draggingState[0];
  var setDragActive = draggingState[1];
  var rowDragState = React.useState<string | null>(null);
  var draggingId = rowDragState[0];
  var setDraggingId = rowDragState[1];
  var groupState = React.useState(false);
  var groupByLabels = groupState[0];
  var setGroupByLabels = groupState[1];
  var activeLabelsState = React.useState<string[]>([]);
  var activeLabels = activeLabelsState[0];
  var setActiveLabels = activeLabelsState[1];
  var labelDraftState = React.useState('');
  var labelDraft = labelDraftState[0];
  var setLabelDraft = labelDraftState[1];
  var labelNoticeState = React.useState('');
  var labelNotice = labelNoticeState[0];
  var setLabelNotice = labelNoticeState[1];

  var now = Date.now();
  var normalizedQuery = query.trim().toLocaleLowerCase();
  var labelFilterActive = activeLabels.length > 0;
  var filterActive = normalizedQuery !== '' || labelFilterActive;
  var visibleNotes = React.useMemo(function () {
    var list = snapshot.notes;
    if (normalizedQuery !== '') {
      var strippedQuery = normalizedQuery.charAt(0) === '#' ? normalizedQuery.slice(1) : '';
      list = list.filter(function (note) {
        var labels = noteLabels(note);
        var haystack = note.title + '\n' + note.body;
        if (labels.length > 0) {
          haystack += '\n' + labels.join(' ');
          for (var at = 0; at < labels.length; at += 1) haystack += '\n#' + labels[at];
        }
        if (noteImageCount(note) > 0) haystack += '\n' + t('image.memo');
        var lower = haystack.toLocaleLowerCase();
        if (lower.indexOf(normalizedQuery) >= 0) return true;
        return strippedQuery !== '' && lower.indexOf(strippedQuery) >= 0;
      });
    }
    if (activeLabels.length > 0) {
      list = list.filter(function (note) {
        for (var at = 0; at < activeLabels.length; at += 1) {
          if (!noteHasLabel(note, activeLabels[at])) return false;
        }
        return true;
      });
    }
    return sortNotes(list);
  }, [snapshot.notes, normalizedQuery, activeLabels, t]);

  // Every label in use across the (unfiltered) collection, with counts, for
  // the filter bar. Sorted by usage so the most useful chips come first.
  var allLabels = React.useMemo(function () {
    var counts: Record<string, number> = {};
    var spellings: Record<string, string> = {};
    for (var index = 0; index < snapshot.notes.length; index += 1) {
      var labels = noteLabels(snapshot.notes[index]);
      for (var at = 0; at < labels.length; at += 1) {
        var key = labels[at].toLocaleLowerCase();
        if (spellings[key] === undefined) spellings[key] = labels[at];
        counts[key] = (counts[key] === undefined ? 0 : counts[key]) + 1;
      }
    }
    return Object.keys(counts).map(function (key) {
      return { label: spellings[key], count: counts[key] };
    }).sort(function (left, right) {
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
  }, [snapshot.notes]);

  // Sections for the grouped view: one per label seen in the visible rows
  // (a memo with several labels appears under each of them), Untagged last.
  var labelGroups = React.useMemo(function () {
    if (!groupByLabels || visibleNotes.length === 0) return null;
    var order: string[] = [];
    var seen: Record<string, boolean> = {};
    for (var index = 0; index < visibleNotes.length; index += 1) {
      var labels = noteLabels(visibleNotes[index]);
      for (var at = 0; at < labels.length; at += 1) {
        var key = labels[at].toLocaleLowerCase();
        if (seen[key] === true) continue;
        seen[key] = true;
        order.push(labels[at]);
      }
    }
    order.sort(function (left, right) {
      return left.localeCompare(right);
    });
    var groups: { key: string; label: string; untagged: boolean; notes: Note[] }[] = [];
    for (var position = 0; position < order.length; position += 1) {
      var label = order[position];
      groups.push({
        key: 'label:' + label.toLocaleLowerCase(),
        label: label,
        untagged: false,
        notes: visibleNotes.filter(function (note) {
          return noteHasLabel(note, label);
        })
      });
    }
    var untagged = visibleNotes.filter(function (note) {
      return noteLabels(note).length === 0;
    });
    if (untagged.length > 0) {
      groups.push({ key: 'untagged', label: '', untagged: true, notes: untagged });
    }
    return groups;
  }, [groupByLabels, visibleNotes]);

  function toggleLabelFilter(label: string): void {
    var target = String(label).toLocaleLowerCase();
    setActiveLabels(function (current) {
      var next = [];
      var removed = false;
      for (var index = 0; index < current.length; index += 1) {
        if (current[index].toLocaleLowerCase() === target) removed = true;
        else next.push(current[index]);
      }
      if (!removed) next.push(label);
      return next;
    });
  }

  function isLabelActive(label: string): boolean {
    var target = String(label).toLocaleLowerCase();
    for (var index = 0; index < activeLabels.length; index += 1) {
      if (activeLabels[index].toLocaleLowerCase() === target) return true;
    }
    return false;
  }

  function showLabelNotice(text: string): void {
    setLabelNotice(text);
    setAnnounce(text);
  }

  // Resolve the open memo from the store rather than from the render-time
  // `editing` snapshot: a single interaction can issue several updates
  // (blur-commit followed by a chip removal, a multi-part draft) and each
  // one must start from the labels the previous one just wrote.
  function currentNote() {
    if (editing === undefined) return undefined;
    var list = notes.getSnapshot().notes;
    for (var index = 0; index < list.length; index += 1) {
      if (list[index].id === editing.id) return list[index];
    }
    return undefined;
  }

  function commitLabelDraft(): void {
    if (editing === undefined) return;
    var draft = labelDraft.trim();
    setLabelDraft('');
    if (draft === '') return;
    var note = currentNote();
    if (note === undefined) return;
    var existing = noteLabels(note);
    var added: string[] = [];
    var notice = '';
    var parts = draft.split(/[,，;；]/);
    for (var index = 0; index < parts.length; index += 1) {
      var label = normalizeLabel(parts[index]);
      if (label === '') continue;
      if (existing.length + added.length >= MAX_LABELS) {
        notice = t('labels.limit', { max: MAX_LABELS });
        break;
      }
      var duplicate = false;
      for (var at = 0; at < existing.length; at += 1) {
        if (existing[at].toLocaleLowerCase() === label.toLocaleLowerCase()) duplicate = true;
      }
      for (var other = 0; other < added.length; other += 1) {
        if (added[other].toLocaleLowerCase() === label.toLocaleLowerCase()) duplicate = true;
      }
      if (duplicate) {
        if (notice === '') notice = t('labels.duplicate', { label: label });
        continue;
      }
      added.push(label);
    }
    if (added.length > 0) {
      notes.update(note.id, { labels: existing.concat(added) });
      setAnnounce(t('labels.added', { label: added[added.length - 1] }));
    }
    if (notice !== '') showLabelNotice(notice);
  }

  function addLabel(raw: string): void {
    var note = currentNote();
    if (note === undefined) return;
    var label = normalizeLabel(raw);
    if (label === '') return;
    var labels = noteLabels(note);
    if (labels.length >= MAX_LABELS) {
      showLabelNotice(t('labels.limit', { max: MAX_LABELS }));
      return;
    }
    if (noteHasLabel(note, label)) {
      showLabelNotice(t('labels.duplicate', { label: label }));
      return;
    }
    notes.update(note.id, { labels: labels.concat([label]) });
    setAnnounce(t('labels.added', { label: label }));
  }

  function removeLabel(label: string): void {
    var note = currentNote();
    if (note === undefined) return;
    var labels = noteLabels(note);
    var next = [];
    for (var index = 0; index < labels.length; index += 1) {
      if (labels[index].toLocaleLowerCase() !== String(label).toLocaleLowerCase()) next.push(labels[index]);
    }
    if (next.length === labels.length) return;
    notes.update(note.id, { labels: next });
    setLabelNotice('');
    setAnnounce(t('labels.removed', { label: label }));
  }

  function handleLabelKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent !== undefined && event.nativeEvent.isComposing === true) return;
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      event.stopPropagation();
      commitLabelDraft();
      return;
    }
    if (event.key === 'Backspace' && labelDraft === '') {
      var labels = noteLabels(editing);
      if (labels.length > 0) {
        event.preventDefault();
        removeLabel(labels[labels.length - 1]);
      }
      return;
    }
    if (event.key === 'Escape') {
      // First Escape clears a half-typed label; with nothing pending it
      // bubbles to the editor, which closes as usual.
      if (labelDraft !== '') {
        event.stopPropagation();
        setLabelDraft('');
      }
      setLabelNotice('');
    }
  }

  var editing: Note | undefined;
  if (editingId !== null) {
    for (var at = 0; at < snapshot.notes.length; at += 1) {
      if (snapshot.notes[at].id === editingId) {
        editing = snapshot.notes[at];
        break;
      }
    }
  }

  React.useEffect(function () {
    if (editingId !== null && editing === undefined) {
      setEditingId(null);
      setNewId(null);
      setDeleteArmed(false);
    }
  }, [editingId, editing, setEditingId, setNewId, setDeleteArmed]);

  React.useEffect(function () {
    if (copiedId === null) return undefined;
    var timer = setTimeout(function () {
      setCopiedId(null);
    }, COPY_FEEDBACK_MS);
    return function () {
      clearTimeout(timer);
    };
  }, [copiedId, setCopiedId]);

  React.useEffect(function () {
    if (!editorCopied) return undefined;
    var timer = setTimeout(function () {
      setEditorCopied(false);
    }, COPY_FEEDBACK_MS);
    return function () {
      clearTimeout(timer);
    };
  }, [editorCopied, setEditorCopied]);

  React.useEffect(function () {
    if (!failedCopy) return undefined;
    var timer = setTimeout(function () {
      setFailedCopy(false);
    }, COPY_FAILED_MS);
    return function () {
      clearTimeout(timer);
    };
  }, [failedCopy, setFailedCopy]);

  React.useEffect(function () {
    if (!deleteArmed) return undefined;
    var timer = setTimeout(function () {
      setDeleteArmed(false);
    }, DELETE_ARM_MS);
    return function () {
      clearTimeout(timer);
    };
  }, [deleteArmed, setDeleteArmed]);

  React.useEffect(function () {
    var root = editorRef.current;
    if (root === null || editing === undefined) {
      if (editing === undefined) builtEditorRef.current = '';
      return;
    }
    var key = editing.id + ':' + (snapshot.imagesReady ? '1' : '0');
    if (builtEditorRef.current === key) return;
    builtEditorRef.current = key;
    buildEditorDom(root, editing, snapshot.images, t('image.remove'), t('image.unavailable'), t('image.memo'));
  }, [editing === undefined ? null : editing.id, snapshot.imagesReady]);

  // Label editing state belongs to the open memo, never to the previous one.
  React.useEffect(function () {
    setLabelDraft('');
    setLabelNotice('');
  }, [editing === undefined ? null : editing.id]);

  // Editing a memo always lands the caret in its title: when one is opened
  // and when the editor's New button switches to a fresh memo. The title
  // input stays mounted across memo switches, so autoFocus alone is not
  // enough for the redirect.
  React.useEffect(function () {
    if (editing === undefined) return;
    focusTitleInput();
  }, [editing === undefined ? null : editing.id]);

  React.useEffect(function () {
    if (labelNotice === '') return undefined;
    var timer = setTimeout(function () {
      setLabelNotice('');
    }, COPY_FAILED_MS);
    return function () {
      clearTimeout(timer);
    };
  }, [labelNotice]);

  // Drop filter chips whose label no longer exists (all notes carrying it
  // were deleted or relabelled), otherwise the list would stay filtered by
  // a chip the bar no longer shows.
  React.useEffect(function () {
    if (activeLabels.length === 0) return;
    var known: Record<string, boolean> = {};
    for (var index = 0; index < allLabels.length; index += 1) known[allLabels[index].label.toLocaleLowerCase()] = true;
    var kept = activeLabels.filter(function (label) {
      return known[label.toLocaleLowerCase()] === true;
    });
    if (kept.length !== activeLabels.length) setActiveLabels(kept);
  }, [allLabels, activeLabels, setActiveLabels]);

  // The group toggle is disabled once no labels exist; leaving grouping on
  // would strand the list in a grouped view that cannot be switched off.
  React.useEffect(function () {
    if (groupByLabels && allLabels.length === 0) setGroupByLabels(false);
  }, [groupByLabels, allLabels]);

  React.useEffect(function () {
    if (!dragActive) return undefined;
    var reset = function () {
      setDragActive(false);
    };
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return function () {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, [dragActive, setDragActive]);

  // The memo list may live in a tab whose chat composer belongs to another
  // plugin, so the window-level handlers below act only on our own drag
  // payload and only when the drop lands on the chat composer.
  React.useEffect(function () {
    dropHandlerRef.current = function (event) {
      var plan = planMemoDrop(event);
      if (plan.kind !== 'insert') return;
      var inputActions = props.inputActions;
      // Without composer actions (the pre-Session drawer) leave the drop to
      // the browser: the same drag also carries text/plain.
      if (inputActions === null || inputActions === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      var pasted = insertMemoIntoComposer(inputActions, plan.payload.text);
      if (pasted) {
        showTransfer('success', t('drag.pasted'));
        setAnnounce(t('drag.pasted'));
      } else {
        showTransfer('error', t('drag.pasteFailed'));
        setAnnounce(t('drag.pasteFailed'));
      }
    };
  });

  React.useEffect(function () {
    var clearHighlight = function () {
      var element = composerHighlightRef.current;
      composerHighlightRef.current = null;
      if (element !== null && element !== undefined && element.classList !== undefined) {
        element.classList.remove('dsm-composer-drop');
      }
    };
    var handleDragOver = function (event: DragEvent): void {
      if (!memoDragTypesInclude(event.dataTransfer)) return;
      var editor = composerEditorFor(event.target);
      if (editor === null) {
        clearHighlight();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
        try {
          event.dataTransfer.dropEffect = 'copy';
        } catch (error) {
          /* some engines keep dropEffect read-only */
        }
      }
      if (composerHighlightRef.current !== editor) {
        clearHighlight();
        composerHighlightRef.current = editor;
        if (editor.classList !== undefined) editor.classList.add('dsm-composer-drop');
      }
    };
    var handleDrop = function (event: DragEvent): void {
      clearHighlight();
      setDraggingId(null);
      if (dropHandlerRef.current !== null) dropHandlerRef.current(event);
    };
    var handleDragEnd = function () {
      clearHighlight();
      setDraggingId(null);
    };
    window.addEventListener('dragover', handleDragOver, true);
    window.addEventListener('drop', handleDrop, true);
    window.addEventListener('dragend', handleDragEnd, true);
    return function () {
      window.removeEventListener('dragover', handleDragOver, true);
      window.removeEventListener('drop', handleDrop, true);
      window.removeEventListener('dragend', handleDragEnd, true);
      clearHighlight();
    };
  }, [setDraggingId]);

  var atLimit = snapshot.notes.length >= limits.maxNotes;

  function reportCopy(id: string | null, ok: boolean): void {
    if (ok) {
      setCopiedId(id);
      setAnnounce(t('copied'));
    } else {
      setFailedCopy(true);
      setAnnounce(t('copy.failed'));
    }
  }

  function copyNote(note: Note): void {
    if (note.body.trim() === '' && note.title.trim() === '' && noteImageCount(note) === 0) return;
    var id = note.id;
    copyNoteContent(note, snapshot.images).then(function (ok) {
      reportCopy(id, ok);
    });
  }

  function copyEditing(): void {
    if (editing === undefined) return;
    if (editing.body.trim() === '' && editing.title.trim() === '' && noteImageCount(editing) === 0) return;
    copyNoteContent(editing, snapshot.images).then(function (ok) {
      if (ok) {
        setEditorCopied(true);
        setAnnounce(t('copied'));
      } else {
        setFailedCopy(true);
        setAnnounce(t('copy.failed'));
      }
    });
  }

  function toggleFavorite(note: Note | undefined): void {
    if (note === undefined) return;
    var next = notes.setFavorite(note.id, note.favorite !== true);
    if (next !== undefined) {
      setAnnounce(next.favorite === true ? t('favorite.pinned') : t('favorite.unpinned'));
    }
  }

  function handleCreate(): void {
    var note = notes.create();
    if (note === undefined) return;
    setTransfer(null);
    setQuery('');
    setCopiedId(null);
    setEditorCopied(false);
    setDeleteArmed(false);
    setNewId(note.id);
    setEditingId(note.id);
  }

  // The editor's New button redirects into a fresh memo. When the open memo
  // is already the blank draft this button created, reuse it instead of
  // stacking another empty memo; either way the caret goes to the title.
  function handleNewMemo(): void {
    if (editing === undefined) return;
    if (editing.id === newId && editing.title.trim() === '' && editing.body.trim() === '' && noteImageCount(editing) === 0) {
      focusTitleInput();
      return;
    }
    handleCreate();
  }

  function focusTitleInput(): void {
    var input = titleInputRef.current;
    if (input === null) return;
    try {
      input.focus();
    } catch (error) {
      /* focusing is best effort */
    }
  }

  function openNote(id: string): void {
    setTransfer(null);
    setCopiedId(null);
    setEditorCopied(false);
    setDeleteArmed(false);
    setNewId(null);
    setEditingId(id);
  }

  function closeEditor(): void {
    if (editing !== undefined && newId !== null && editing.id === newId && editing.title.trim() === '' && editing.body.trim() === '' && noteImageCount(editing) === 0) {
      notes.remove(editing.id);
    }
    notes.flush();
    notes.collectOrphans();
    setTransfer(null);
    setEditingId(null);
    setNewId(null);
    setDeleteArmed(false);
  }

  function handleDelete(): void {
    if (editing === undefined) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    notes.remove(editing.id);
    notes.flush();
    setEditingId(null);
    setNewId(null);
    setDeleteArmed(false);
  }

  function updateEditing(field: string, value: string): void {
    if (editing === undefined) return;
    if (field === 'title') {
      notes.update(editing.id, { title: value });
      return;
    }
    notes.update(editing.id, { body: value });
  }

  function updateContent(content: NoteBlock[]): void {
    if (editing === undefined) return;
    notes.update(editing.id, { content: content });
  }

  function moveCaretToEnd(root: HTMLElement | null): void {
    if (root === null) return;
    try {
      var range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      var selection = window.getSelection();
      if (selection !== null) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (error) {
      /* caret placement is best effort */
    }
  }

  function syncEditor(): void {
    var root = editorRef.current;
    if (root === null) return;
    var state = readEditorState(root);
    if (state.truncated && editing !== undefined) {
      // IME input and execCommand insertions cannot be cancelled through
      // beforeinput, so clip the DOM back to the stored limit instead of
      // letting it diverge from what gets saved.
      buildEditorDom(root, { content: state.content }, snapshot.images, t('image.remove'), t('image.unavailable'), t('image.memo'));
      moveCaretToEnd(root);
      setAnnounce(t('editor.limit', { max: MAX_BODY }));
    }
    updateContent(state.content);
  }

  function currentImageCount(): number {
    var root = editorRef.current;
    if (root !== null) return root.querySelectorAll('img[data-image-id]').length;
    return noteImageCount(editing);
  }

  function clipboardImageFiles(data: DataTransfer | React.ClipboardEvent<HTMLDivElement>['clipboardData'] | null | undefined): File[] {
    var files: File[] = [];
    if (data === undefined || data === null) return files;
    var items = data.items;
    if (items !== undefined && items !== null && items.length !== undefined) {
      for (var index = 0; index < items.length; index += 1) {
        var item = items[index];
        if (item.kind === 'file' && typeof item.type === 'string' && item.type.indexOf('image/') === 0) {
          var file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
          if (file !== null) files.push(file);
        }
      }
    }
    if (files.length === 0 && data.files !== undefined && data.files !== null) {
      for (var at = 0; at < data.files.length; at += 1) {
        var entry = data.files[at];
        if (typeof entry.type === 'string' && entry.type.indexOf('image/') === 0) files.push(entry);
      }
    }
    return files;
  }

  async function insertImageFiles(files: File[], range: Range | null): Promise<void> {
    if (files.length === 0) return;
    if (!snapshot.imagesReady) {
      showTransfer('info', t('image.loading'));
      return;
    }
    if (!snapshot.imagesAvailable) {
      showTransfer('error', t('image.disabled'));
      return;
    }
    var added = 0;
    for (var index = 0; index < files.length; index += 1) {
      if (currentImageCount() >= limits.maxImages) {
        showTransfer('info', t('image.limit', { max: limits.maxImages }));
        break;
      }
      var prepared = await prepareImageFile(files[index]);
      if (!prepared.ok) {
        showTransfer('error', t(prepared.reason === 'tooLarge' ? 'image.tooLarge' : 'image.unsupported', { max: Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024)) }));
        continue;
      }
      var record = {
        id: newImageId(),
        src: prepared.src,
        width: prepared.width,
        height: prepared.height,
        size: prepared.src.length,
        createdAt: Date.now()
      };
      var stored = await notes.addImage(record);
      if (!stored.ok) {
        showTransfer('error', t(stored.reason === 'budget' ? 'image.budget' : 'image.saveFailed'));
        continue;
      }
      var root = editorRef.current;
      if (root === null) {
        notes.collectOrphans();
        continue;
      }
      if (range !== null) {
        try {
          var selection = window.getSelection();
          if (selection !== null) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } catch (error) {
          /* keep the current caret when the saved range is stale */
        }
      }
      insertImageIntoEditor(root, stored.record, t('image.remove'), t('image.memo'));
      range = caretRangeIn(root);
      syncEditor();
      added += 1;
    }
    if (added > 0) setAnnounce(t('image.added'));
  }

  function insertPlainText(text: string): void {
    try {
      document.execCommand('insertText', false, text);
      return;
    } catch (error) {
      /* fall through to a manual range insertion */
    }
    var selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    var pasted = selection.getRangeAt(0);
    pasted.deleteContents();
    pasted.insertNode(document.createTextNode(text));
    pasted.collapse(false);
  }

  function handleEditorPaste(event: React.ClipboardEvent<HTMLDivElement>): void {
    var data = event.clipboardData;
    var files = clipboardImageFiles(data);
    var text = '';
    try {
      text = data === undefined || data === null ? '' : data.getData('text/plain');
    } catch (error) {
      text = '';
    }
    if (files.length > 0) {
      event.preventDefault();
      var range: Range | null = null;
      try {
        var selection = window.getSelection();
        if (caretRangeIn(editorRef.current) !== null && selection !== null) range = selection.getRangeAt(0).cloneRange();
      } catch (error) {
        range = null;
      }
      insertImageFiles(files, range).then(function () {
        if (text !== '') {
          insertPlainText(text);
          syncEditor();
        }
      });
      return;
    }
    event.preventDefault();
    if (text === '') return;
    insertPlainText(text);
    syncEditor();
  }

  function handleEditorDragOver(event: React.DragEvent<HTMLDivElement>): void {
    var types = event.dataTransfer === undefined || event.dataTransfer === null ? [] : event.dataTransfer.types;
    var hasFiles = false;
    if (types !== undefined && types !== null) {
      for (var index = 0; index < types.length; index += 1) {
        if (types[index] === 'Files') hasFiles = true;
      }
    }
    if (!hasFiles) return;
    event.preventDefault();
    if (event.dataTransfer !== undefined && event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    if (!dragActive) setDragActive(true);
  }

  function handleEditorDragLeave(): void {
    if (dragActive) setDragActive(false);
  }

  function handleEditorDrop(event: React.DragEvent<HTMLDivElement>): void {
    setDragActive(false);
    var files = clipboardImageFiles(event.dataTransfer);
    if (files.length > 0) {
      event.preventDefault();
      var range: Range | null = null;
      if (event.nativeEvent !== undefined) {
        moveCaretToPoint(editorRef.current, event.nativeEvent.clientX, event.nativeEvent.clientY);
        range = caretRangeIn(editorRef.current);
      }
      insertImageFiles(files, range);
      return;
    }
    var text = '';
    try {
      text = event.dataTransfer === undefined || event.dataTransfer === null ? '' : event.dataTransfer.getData('text/plain');
    } catch (error) {
      text = '';
    }
    event.preventDefault();
    if (text === '') return;
    document.execCommand('insertText', false, text);
    syncEditor();
  }

  function handleEditorClick(event: React.MouseEvent<HTMLDivElement>): void {
    var target = event.target as Element;
    if (target === null || target === undefined || typeof target.closest !== 'function') return;
    var remove = target.closest('[data-image-remove]');
    if (remove === null) return;
    event.preventDefault();
    var block = typeof remove.closest === 'function' ? remove.closest('.dsm-image-block') : null;
    if (block !== null && block.parentNode !== null) block.parentNode.removeChild(block);
    var root = editorRef.current;
    if (root !== null && root.childNodes.length === 0) {
      var empty = document.createElement('div');
      empty.appendChild(document.createElement('br'));
      root.appendChild(empty);
    }
    syncEditor();
    setAnnounce(t('image.removed'));
  }

  function handleEditorBeforeInput(event: React.FormEvent<HTMLDivElement> & { inputType?: string; data?: string | null }): void {
    var type = event.inputType;
    if (typeof type !== 'string' || type.indexOf('insert') !== 0 || type === 'insertCompositionText') return;
    var root = editorRef.current;
    if (root === null) return;
    var selection = window.getSelection();
    var selected = selection !== null && selection.rangeCount > 0 ? selection.toString().length : 0;
    var incoming = typeof event.data === 'string' ? event.data.length : 0;
    var current = readEditorState(root).length;
    if (current - selected + incoming > MAX_BODY) {
      event.preventDefault();
      showTransfer('info', t('editor.limit', { max: MAX_BODY }));
    }
  }

  function handleImageClick(): void {
    var input = imageInputRef.current;
    if (input !== null && input !== undefined && typeof input.click === 'function') input.click();
  }

  function handleImageFileInput(event: React.ChangeEvent<HTMLInputElement>): void {
    var input = event.target;
    var files: File[] = [];
    if (input !== null && input !== undefined && input.files !== undefined && input.files !== null) {
      for (var index = 0; index < input.files.length; index += 1) files.push(input.files[index]);
    }
    if (input !== null && input !== undefined) input.value = '';
    insertImageFiles(files, null);
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement> & { isComposing?: boolean }): void {
    var composing = event.isComposing === true || (event.nativeEvent !== undefined && event.nativeEvent.isComposing === true);
    if (event.key === 'Escape' && !composing) {
      event.preventDefault();
      closeEditor();
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      setQuery('');
    }
  }

  function showTransfer(tone: string, text: string): void {
    setTransfer({ tone: tone, text: text });
  }

  function handleImportClick(): void {
    var input = fileInputRef.current;
    if (input !== null && input !== undefined && typeof input.click === 'function') input.click();
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    var input: HTMLInputElement | null = event.target;
    var picked = input !== null && input.files !== null ? input.files : null;
    var file = picked !== null && picked.length > 0 ? picked[0] : undefined;
    if (input !== null) input.value = '';
    if (file === undefined) return;
    if (typeof file.size === 'number' && file.size > XLSX_MAX_FILE_BYTES) {
      showTransfer('error', t('xlsx.tooLarge'));
      return;
    }
    setBusy(true);
    try {
      var buffer = await file.arrayBuffer();
      var entries = await parseXlsxNotes(buffer);
      var result = notes.importMany(entries);
      if (result.added === 0 && result.limit > 0) showTransfer('info', t('limit.reached', { max: limits.maxNotes }));
      else if (result.added === 0) showTransfer('info', t('xlsx.importEmpty'));
      else if (result.limit > 0) showTransfer('info', t('xlsx.importedLimited', { added: result.added, limit: result.limit }));
      else if (result.skipped > 0) showTransfer('success', t('xlsx.importedSkipped', { added: result.added, skipped: result.skipped }));
      else showTransfer('success', t('xlsx.imported', { added: result.added }));
      setAnnounce(result.added > 0 ? t('xlsx.imported', { added: result.added }) : t('xlsx.importEmpty'));
    } catch (error) {
      console.error('[dsh-side-memo] xlsx import failed', error);
      showTransfer('error', t('xlsx.importFailed'));
    } finally {
      setBusy(false);
    }
  }

  function handleExport(): void {
    if (busy) return;
    try {
      if (snapshot.notes.length === 0) {
        showTransfer('info', t('xlsx.exportEmpty'));
        return;
      }
      var sorted = sortNotes(snapshot.notes);
      var bytes = buildXlsxNotes(sorted);
      var blob = new Blob([bytes as unknown as BlobPart], { type: XLSX_MIME });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'side-memo-' + new Date().toISOString().slice(0, 10) + '.xlsx';
      anchor.rel = 'noopener';
      if (typeof anchor.click === 'function') anchor.click();
      setTimeout(function () {
        try {
          URL.revokeObjectURL(url);
        } catch (error) {
          /* the download has already started */
        }
      }, 4000);
      showTransfer('success', t('xlsx.exported', { count: sorted.length }));
      setAnnounce(t('xlsx.exported', { count: sorted.length }));
    } catch (error) {
      console.error('[dsh-side-memo] xlsx export failed', error);
      showTransfer('error', t('xlsx.exportFailed'));
    }
  }

  var notices = [];
  if (snapshot.saveFailed) {
    notices.push(h('p', { className: 'dsm-notice', key: 'storage' }, t('storage.failed')));
  }
  if (failedCopy) {
    notices.push(h('p', { className: 'dsm-notice', key: 'copy' }, t('copy.failed')));
  }
  if (transfer !== null) {
    notices.push(h('p', { className: 'dsm-notice', key: 'transfer', 'data-tone': transfer.tone }, transfer.text));
  }

  if (editing !== undefined && !snapshot.imagesAvailable) {
    notices.push(h('p', { className: 'dsm-notice', key: 'images', 'data-tone': 'error' }, t('image.disabled')));
  }

  var liveRegion = h('span', { className: 'dsm-sr-only', role: 'status', 'aria-live': 'polite' }, announce);

  if (editing !== undefined) {
    var slotActions = renderSlot === undefined
      ? null
      : renderSlot('sidebar.right.tab.notes.actions', { noteId: editing.id });
    var imageCount = noteImageCount(editing);
    var showPlaceholder = editing.body === '' && imageCount === 0;
    return h('div', { className: 'dsm-root', 'data-side-memo': 'editor', onKeyDown: handleEditorKeyDown },
      h('div', { className: 'dsm-editor-head' },
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn',
          title: t('editor.back'),
          'aria-label': t('editor.back'),
          onClick: closeEditor
        }, h(IconBack, { size: 16 })),
        h('span', { className: 'dsm-editor-meta', title: new Date(editing.updatedAt).toLocaleString() },
          ageLabel(t, editing.updatedAt, now)),
        h('button', {
          type: 'button',
          className: 'dsm-btn dsm-new-memo',
          'data-side-memo-new': 'true',
          disabled: atLimit,
          title: atLimit ? t('limit.hint', { max: limits.maxNotes }) : t('editor.new'),
          'aria-label': atLimit ? t('limit.hint', { max: limits.maxNotes }) : t('editor.new'),
          onClick: handleNewMemo
        }, h(IconPlus, { size: 14 }), h('span', null, t('new'))),
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn',
          'data-favorite': editing.favorite === true ? 'true' : 'false',
          'aria-pressed': editing.favorite === true,
          title: editing.favorite === true ? t('favorite.remove') : t('favorite.add'),
          'aria-label': editing.favorite === true ? t('favorite.remove') : t('favorite.add'),
          onClick: function () {
            toggleFavorite(editing);
          }
        }, editing.favorite === true ? h(IconStarFilled, { size: 16 }) : h(IconStar, { size: 16 })),
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn',
          'data-copied': editorCopied ? 'true' : 'false',
          title: t('copy'),
          'aria-label': t('copy'),
          onClick: copyEditing
        }, editorCopied ? h(IconCheck, { size: 16 }) : h(IconCopy, { size: 16 })),
        h('button', {
          type: 'button',
          className: deleteArmed ? 'dsm-btn dsm-danger-armed' : 'dsm-btn',
          onClick: handleDelete
        }, deleteArmed ? t('delete.confirm') : t('delete'))
      ),
      notices,
      h('input', {
        className: 'dsm-editor-title',
        type: 'text',
        ref: titleInputRef,
        value: editing.title,
        maxLength: limits.maxTitle,
        placeholder: t('editor.titlePlaceholder'),
        'aria-label': t('editor.titlePlaceholder'),
        autoFocus: true,
        onChange: function (event) {
          updateEditing('title', event.target.value);
        }
      }),
      h('div', { className: 'dsm-labels-editor' },
        noteLabels(editing).map(function (label) {
          return h('span', {
            className: 'dsm-label-chip',
            key: 'label:' + label.toLocaleLowerCase(),
            'data-label': label
          },
            h('span', { className: 'dsm-label-chip-text' }, '#' + label),
            h('button', {
              type: 'button',
              className: 'dsm-label-remove',
              'data-label': label,
              'data-label-remove': label,
              title: t('labels.remove', { label: label }),
              'aria-label': t('labels.remove', { label: label }),
              onClick: function (event: React.MouseEvent<HTMLButtonElement>) {
                event.stopPropagation();
                removeLabel(label);
              }
            }, h(IconX, { size: 9 })));
        }),
        h('input', {
          className: 'dsm-label-input',
          type: 'text',
          value: labelDraft,
          placeholder: t('labels.placeholder'),
          'aria-label': t('labels.add'),
          onChange: function (event) {
            setLabelDraft(event.target.value);
          },
          onKeyDown: handleLabelKeyDown,
          onBlur: function () {
            commitLabelDraft();
          }
        })
      ),
      labelNotice === '' ? null : h('p', { className: 'dsm-notice dsm-label-notice' }, labelNotice),
      h('div', { className: 'dsm-editor-wrap' },
        showPlaceholder
          ? h('div', { className: 'dsm-editor-placeholder', 'aria-hidden': 'true' }, t('editor.bodyPlaceholder'))
          : null,
        h('div', {
          className: 'dsm-editor-body',
          ref: editorRef,
          contentEditable: snapshot.imagesReady,
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('editor.bodyPlaceholder'),
          spellCheck: true,
          'data-dragging': dragActive ? 'true' : 'false',
          suppressContentEditableWarning: true,
          onInput: syncEditor,
          onBeforeInput: handleEditorBeforeInput,
          onPaste: handleEditorPaste,
          onDrop: handleEditorDrop,
          onDragOver: handleEditorDragOver,
          onDragLeave: handleEditorDragLeave,
          onClick: handleEditorClick
        })
      ),
      h('input', {
        key: 'image-file',
        type: 'file',
        accept: 'image/*',
        multiple: true,
        ref: imageInputRef,
        style: { display: 'none' },
        tabIndex: -1,
        'aria-hidden': 'true',
        onChange: handleImageFileInput
      }),
      h('div', { className: 'dsm-editor-actions' },
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn',
          disabled: !snapshot.imagesReady || !snapshot.imagesAvailable || imageCount >= limits.maxImages,
          title: snapshot.imagesAvailable ? t('image.add') : t('image.disabled'),
          'aria-label': !snapshot.imagesAvailable
            ? t('image.disabled')
            : imageCount >= limits.maxImages ? t('image.limit', { max: limits.maxImages }) : t('image.add'),
          onClick: handleImageClick
        }, h(IconImage, { size: 16 })),
        h('span', { className: 'dsm-editor-count' },
          t('editor.chars', { count: editing.body.length }),
          imageCount > 0 ? ' \u00b7 ' + imageCountLabel(t, imageCount) : ''
        ),
        h('span', { className: 'dsm-editor-actions-spacer' }),
        slotActions
      ),
      liveRegion
    );
  }

  function noteRow(note: Note): React.ReactElement {
    var title = noteTitleText(t, note);
    var snippet = noteSnippetText(t, note);
    var imageTotal = noteImageCount(note);
    var copied = copiedId === note.id;
    var favorite = note.favorite === true;
    var labels = noteLabels(note);
    var dragText = memoDragText(note);
    var draggable = dragText !== '';
    return h('li', {
      className: 'dsm-row',
      key: note.id,
      'data-favorite': favorite ? 'true' : 'false',
      'data-dragging': draggingId === note.id ? 'true' : undefined,
      draggable: draggable,
      onDragStart: function (event: React.DragEvent<HTMLLIElement>) {
        if (!draggable) {
          event.preventDefault();
          return;
        }
        fillMemoDragData(event.dataTransfer, note);
        setDraggingId(note.id);
      }
    },
      h('button', {
        type: 'button',
        className: 'dsm-row-main',
        title: title,
        onClick: function () {
          openNote(note.id);
        }
      },
        h('span', { className: 'dsm-row-title' },
          h('span', { className: 'dsm-row-title-text' }, title),
          imageTotal > 0
            ? h('span', { className: 'dsm-row-images', title: imageCountLabel(t, imageTotal), 'aria-label': imageCountLabel(t, imageTotal) },
              h(IconImage, { size: 11 }),
              String(imageTotal))
            : null,
          h('span', { className: 'dsm-row-time' }, ageLabel(t, note.updatedAt, now))
        ),
        labels.length === 0 ? null : h('span', { className: 'dsm-row-labels' },
          labels.slice(0, 3).map(function (label) {
            return h('span', {
              className: 'dsm-label-chip',
              key: 'rowlabel:' + label.toLocaleLowerCase(),
              'data-label': label
            }, '#' + label);
          }),
          labels.length > 3
            ? h('span', { className: 'dsm-label-more' }, '+' + String(labels.length - 3))
            : null
        ),
        snippet === '' ? null : h('span', { className: 'dsm-row-snippet' }, snippet)
      ),
      h('button', {
        type: 'button',
        className: 'dsm-icon-btn dsm-row-star',
        'data-favorite': favorite ? 'true' : 'false',
        'aria-pressed': favorite,
        title: favorite ? t('favorite.remove') : t('favorite.add'),
        'aria-label': favorite ? t('favorite.remove') : t('favorite.add'),
        onClick: function () {
          toggleFavorite(note);
        }
      }, favorite ? h(IconStarFilled, { size: 16 }) : h(IconStar, { size: 16 })),
      h('button', {
        type: 'button',
        className: 'dsm-icon-btn dsm-row-copy',
        'data-copied': copied ? 'true' : 'false',
        title: copied ? t('copied') : t('copy'),
        'aria-label': copied ? t('copied') : t('copy'),
        onClick: function () {
          copyNote(note);
        }
      }, copied ? h(IconCheck, { size: 16 }) : h(IconCopy, { size: 16 }))
    );
  }

  var rows = visibleNotes.map(noteRow);

  var emptyState = visibleNotes.length === 0
    ? h('div', { className: 'dsm-empty' },
      h(IconNote, { size: 28, className: 'dsm-empty-icon' }),
      h('div', { className: 'dsm-empty-title' },
        labelFilterActive
          ? t('labels.emptyFiltered')
          : normalizedQuery === '' ? t('empty.title') : t('search.empty', { query: query.trim() })),
      filterActive ? null : h('div', { className: 'dsm-empty-body' }, t('empty.body'))
    )
    : null;

  // Grouped view repeats a memo under each of its labels; Untagged comes last.
  var listContent = emptyState !== null
    ? emptyState
    : labelGroups === null
      ? h('ul', { className: 'dsm-list' }, rows)
      : labelGroups.map(function (group) {
        return h('div', {
          className: 'dsm-group',
          key: group.key,
          'data-label': group.untagged ? undefined : group.label,
          'data-untagged': group.untagged ? 'true' : undefined
        },
          h('div', { className: 'dsm-group-head' },
            h('span', { className: 'dsm-group-head-icon' }, h(IconTag, { size: 12 })),
            h('span', { className: 'dsm-group-title' }, group.untagged ? t('labels.untagged') : '#' + group.label),
            h('span', { className: 'dsm-group-count' }, String(group.notes.length))
          ),
          h('ul', { className: 'dsm-list' }, group.notes.map(noteRow))
        );
      });

  var countLabel;
  if (filterActive) {
    countLabel = t('count.filtered', { visible: visibleNotes.length, total: snapshot.notes.length });
  } else {
    countLabel = snapshot.notes.length === 1
      ? t('count.one')
      : t('count.other', { count: snapshot.notes.length });
  }

  return h('div', { className: 'dsm-root', 'data-side-memo': 'list' },
    h('div', { className: 'dsm-toolbar' },
      h('div', { className: 'dsm-search' },
        h('span', { className: 'dsm-search-icon' }, h(IconSearch, { size: 14 })),
        h('input', {
          type: 'search',
          value: query,
          placeholder: t('search.placeholder'),
          'aria-label': t('search.placeholder'),
          onChange: function (event) {
            setQuery(event.target.value);
          },
          onKeyDown: handleSearchKeyDown
        }),
        query === ''
          ? null
          : h('button', {
            type: 'button',
            className: 'dsm-search-clear',
            title: t('search.clear'),
            'aria-label': t('search.clear'),
            onClick: function () {
              setQuery('');
            }
          }, h(IconX, { size: 12 }))
      ),
      h('div', { className: 'dsm-toolbar-actions' },
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn',
          disabled: busy,
          title: t('import'),
          'aria-label': t('import'),
          onClick: handleImportClick
        }, h(IconUpload, { size: 16 })),
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn',
          disabled: busy,
          title: t('export'),
          'aria-label': t('export'),
          onClick: handleExport
        }, h(IconDownload, { size: 16 })),
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn dsm-group-toggle',
          disabled: allLabels.length === 0,
          'aria-pressed': groupByLabels,
          'data-active': groupByLabels ? 'true' : 'false',
          title: groupByLabels ? t('labels.ungroup') : t('labels.group'),
          'aria-label': groupByLabels ? t('labels.ungroup') : t('labels.group'),
          onClick: function () {
            setGroupByLabels(!groupByLabels);
          }
        }, h(IconGroup, { size: 16 })),
        h('button', {
          type: 'button',
          className: 'dsm-btn',
          disabled: atLimit || busy,
          title: atLimit ? t('limit.hint', { max: limits.maxNotes }) : t('new'),
          onClick: handleCreate
        }, h(IconPlus, { size: 14 }), h('span', null, t('new')))
      )
    ),
    h('input', {
      key: 'xlsx-file',
      type: 'file',
      accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ref: fileInputRef,
      style: { display: 'none' },
      tabIndex: -1,
      'aria-hidden': 'true',
      onChange: handleImportFile
    }),
    notices,
    allLabels.length === 0 ? null : h('div', {
      className: 'dsm-labels-bar',
      role: 'group',
      'aria-label': t('labels.filter')
    },
      allLabels.map(function (entry) {
        var active = isLabelActive(entry.label);
        return h('button', {
          type: 'button',
          className: 'dsm-label-filter',
          key: 'filter:' + entry.label.toLocaleLowerCase(),
          'data-label': entry.label,
          'aria-pressed': active,
          'data-active': active ? 'true' : 'false',
          title: '#' + entry.label,
          onClick: function () {
            toggleLabelFilter(entry.label);
          }
        },
          h('span', null, '#' + entry.label),
          h('span', { className: 'dsm-label-filter-count' }, String(entry.count)));
      }),
      labelFilterActive
        ? h('button', {
          type: 'button',
          className: 'dsm-label-filter-clear',
          onClick: function () {
            setActiveLabels([]);
          }
        }, t('labels.all'))
        : null
    ),
    h('div', { className: 'dsm-list-scroll' }, listContent),
    h('div', { className: 'dsm-foot' },
      h('span', null, countLabel),
      visibleNotes.length === 0 || props.inputActions === undefined
        ? null
        : h('span', { className: 'dsm-foot-hint', title: t('drag.hint') }, t('drag.hint')),
      atLimit ? h('span', { title: t('limit.hint', { max: limits.maxNotes }) }, t('limit.reached', { max: limits.maxNotes })) : null
    ),
    liveRegion
  );
}

// ---------------------------------------------------------------------
// Chip title and header toggle
// ---------------------------------------------------------------------

function NotesTitle(props: NotesTitleProps): React.ReactElement | null {
  var tabInfo = props.useTabInfo();
  var title = tabInfo.tab.title;
  return h('span', { className: 'dsm-title' },
    h(IconNote, { size: 16 }),
    h('span', { className: 'dsm-title-label' }, title));
}

function NotesToggle(props: NotesToggleProps): React.ReactElement | null {
  var t = translateFor(props);
  var toggle = props.toggle;
  var label = t('toggle.label');
  return h('button', {
    type: 'button',
    className: 'dsm-toggle',
    title: label,
    'aria-label': t('toggle.aria'),
    onClick: function () {
      if (typeof toggle === 'function') toggle();
    }
  }, h(IconNote, { size: 16 }));
}

/**
 * The header toggle for the phases without the normal Session chrome.
 *
 * The resident conversation header always draws its leading seat — including
 * the new-Session (hero) screen and the state before any Session exists —
 * while the Session header's right-side utilities (and its corner, owned by
 * the right sidebar's expand control) are only drawn once the Session has
 * real content. This seat is therefore the mount point for those phases; the
 * button itself is positioned at the header's far right, left of the right
 * sidebar's expand control, by measuring the live header geometry so it
 * follows column resizes and the sidebar's expanded state.
 */
function NotesHeroToggle(props: NotesHeroToggleProps): React.ReactElement | null {
  var t = translateFor(props);
  var binding = props.mountedBinding;
  var drawer = props.drawer;
  var mounted = useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getSnapshot);
  var blank = props.useSessions(function (snapshot) {
    if (mounted === undefined) return true;
    if (snapshot === undefined || snapshot.byId === undefined) return undefined;
    var summary = snapshot.byId[mounted];
    return summary === undefined ? undefined : summary.blank === true;
  });
  var drawerOpen = useSyncExternalStore(drawer.subscribe, drawer.getSnapshot, drawer.getSnapshot);
  var buttonRef = React.useRef<HTMLButtonElement | null>(null);
  // Show while there is no on-screen Session and while the Session is blank;
  // hide once it carries real content, where the utilities entry renders the
  // same toggle in its normal right-side place.
  var hero = mounted === undefined || blank === true;
  React.useLayoutEffect(function () {
    if (!hero) return undefined;
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    function place() {
      var node = buttonRef.current;
      if (node === null || node === undefined || node.isConnected !== true) return;
      var root = node.offsetParent;
      if (root === null || root === undefined) return;
      var rootRect = root.getBoundingClientRect();
      var header = typeof node.closest === 'function' ? node.closest('header') : null;
      var headerRect = header === null ? null : header.getBoundingClientRect();
      var corner = typeof root.querySelector === 'function' ? root.querySelector('[data-conversation-header-corner]') : null;
      var cornerRect = corner === null || corner === undefined ? null : corner.getBoundingClientRect();
      var top;
      var left;
      if (cornerRect !== null && cornerRect.width > 0) {
        top = cornerRect.top + (cornerRect.height - 28) / 2;
        left = cornerRect.left - 6 - 28;
      } else if (headerRect !== null && headerRect.width > 0) {
        var row = header === null ? null : header.children.length > 1 ? header.children[1] : null;
        var rowRect = row === null ? headerRect : row.getBoundingClientRect();
        top = rowRect.height >= 28 ? rowRect.top + (rowRect.height - 28) / 2 : headerRect.top + 11;
        left = headerRect.right - 28 - 6 - 28;
      } else {
        top = rootRect.top + 11;
        left = rootRect.right - 28 - 6 - 28;
      }
      node.style.right = 'auto';
      node.style.top = Math.round(top - rootRect.top) + 'px';
      node.style.left = Math.round(left - rootRect.left) + 'px';
    }
    place();
    var observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(place);
      var rootNode = buttonRef.current === null || buttonRef.current === undefined ? null : buttonRef.current.offsetParent;
      if (rootNode !== null && rootNode !== undefined) observer.observe(rootNode);
      var headerNode = buttonRef.current === null || buttonRef.current === undefined || typeof buttonRef.current.closest !== 'function'
        ? null
        : buttonRef.current.closest('header');
      if (headerNode !== null) observer.observe(headerNode);
      var cornerNode = rootNode === null || rootNode === undefined || typeof rootNode.querySelector !== 'function'
        ? null
        : rootNode.querySelector('[data-conversation-header-corner]');
      if (cornerNode !== null) observer.observe(cornerNode);
    }
    window.addEventListener('resize', place);
    return function () {
      if (observer !== null) observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [hero, mounted]);
  if (!hero) return null;
  var label = t('toggle.label');
  return h('button', {
    ref: buttonRef,
    type: 'button',
    className: 'dsm-toggle dsm-header-toggle',
    'data-side-memo-toggle': 'header-right',
    'data-active': drawerOpen ? 'true' : 'false',
    title: label,
    'aria-label': t('toggle.aria'),
    onClick: function () {
      if (typeof props.toggle === 'function') props.toggle();
    }
  }, h(IconNote, { size: 16 }));
}

/**
 * Frame-level notes drawer. The right sidebar is Session-scoped (its
 * commands throw without an on-screen Session), so this is how the notes
 * stay usable on the screen before the first Session is established. It is
 * rendered in the click-through `shell.overlay` layer and opts back into
 * pointer events on the panel itself.
 */
function NotesDrawer(props: NotesDrawerProps): React.ReactElement | null {
  var t = translateFor(props);
  var drawer = props.drawer;
  var open = useSyncExternalStore(drawer.subscribe, drawer.getSnapshot, drawer.getSnapshot);

  React.useEffect(function () {
    if (!open || typeof document === 'undefined') return undefined;
    var onKeyDown = function (event: KeyboardEvent): void {
      if (event.key === 'Escape' && !event.defaultPrevented) drawer.set(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return function () {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, drawer]);

  if (!open) return null;
  var label = t('type.label');
  return h('div', { className: 'dsm-drawer-layer', style: { pointerEvents: 'none' } },
    h('aside', {
      className: 'dsm-drawer',
      role: 'complementary',
      'aria-label': label,
      'data-side-memo': 'drawer'
    },
      h('div', { className: 'dsm-drawer-head' },
        h('span', { className: 'dsm-drawer-icon' }, h(IconNote, { size: 16 })),
        h('span', { className: 'dsm-drawer-title' }, label),
        h('button', {
          type: 'button',
          className: 'dsm-icon-btn',
          title: t('drawer.close'),
          'aria-label': t('drawer.close'),
          onClick: function () {
            drawer.set(false);
          }
        }, h(IconX, { size: 16 }))
      ),
      h('div', { className: 'dsm-drawer-body' },
        h(NotesBody, { t: t, notes: props.notes })
      )
    )
  );
}

// ---------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------

function injectStyles(): (() => void) | undefined {
  if (typeof document === 'undefined') return undefined;
  var selector = 'style[data-plugin="' + PKG + '"]';
  var existing = document.querySelector(selector);
  if (existing !== null) existing.remove();
  var style = document.createElement('style');
  style.dataset.plugin = PKG;
  style.textContent = STYLE;
  document.head.appendChild(style);
  return function () {
    style.remove();
  };
}

var inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'];

function apply(ctx: DshClientContext): void {
  fallbackT = ctx.locale.bind(NS);
  var notes = createNotesStore();
  var drawer = createDrawerStore();
  var mountedBinding = createMountedBinding(function () {
    return ctx.sidebarRight;
  });
  // Retry chains must not outlive this plugin generation (HMR replaces it).
  var disposed = false;

  ctx.effect(function () {
    disposed = false;
    return function () {
      disposed = true;
    };
  }, 'side-memo: lifetime');

  ctx.effect(function () {
    return ctx.locale.register(NS, { zh: zh, en: en });
  }, 'side-memo: locale');

  ctx.effect(injectStyles, 'side-memo: styles');

  ctx.effect(function () {
    return ctx.sidebarRightTabs.register({
      id: PKG,
      kind: KIND,
      priority: 'extension',
      title: function () {
        return fallbackT('type.label');
      },
      guide: [{
        id: 'notes',
        order: 30,
        title: function () {
          return fallbackT('guide.title');
        },
        description: function () {
          return fallbackT('guide.description');
        },
        icon: GuideNoteArtwork
      }]
    });
  }, 'side-memo: tab type');

  ctx.effect(function () {
    return ctx.slots.inject('sidebar.right.pane.tab.title', function () {
      return ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: PKG
      }, NotesTitle);
    });
  }, 'side-memo: tab title');

  /**
   * Run a right-sidebar command, retrying on the frame clock. The sidebar
   * only accepts commands once the on-screen Session's store has been
   * adopted by its seats, which can trail the Session selection by a frame
   * or two after a new Session starts.
   */
  function retrySidebarCommand(command: () => void, description: string): void {
    var attempts = 0;
    function attempt() {
      if (disposed) return;
      attempts += 1;
      try {
        command();
        return;
      } catch (error) {
        if (disposed) return;
        if (attempts < 24) {
          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(attempt);
          } else {
            setTimeout(attempt, 50);
          }
          return;
        }
        console.error('[dsh-side-memo] ' + description, error);
      }
    }
    attempt();
  }

  function openSidebarNotes(): void {
    retrySidebarCommand(function () {
      ctx.sidebarRight.openTab(KIND);
    }, 'could not open the notes tab in the right sidebar');
  }

  function toggleNotes(): void {
    var mounted = readMountedSession(ctx.sidebarRight);
    if (mounted === undefined) {
      drawer.toggle();
      return;
    }
    retrySidebarCommand(function () {
      var right = ctx.sidebarRight;
      var active = right.active();
      if (right.isExpanded() && active !== undefined && active.kind === KIND) {
        right.toggleExpanded();
        return;
      }
      right.openTab(KIND);
    }, 'could not toggle the notes panel in the right sidebar');
    drawer.set(false);
  }

  ctx.effect(function () {
    return ctx.slots.inject('conversation.session.header.utilities', function () {
      return ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'side-memo-toggle',
        order: 30,
        locale: NS,
        inject: function () {
          return { toggle: toggleNotes };
        }
      }, NotesToggle);
    });
  }, 'side-memo: header toggle');

  // The resident header's leading seat is the one place that exists before a
  // Session and while the new-Session (blank) chrome is up, so the toggle is
  // there exactly for those phases; once the Session is established the
  // utilities entry above takes over on the right side.
  ctx.effect(function () {
    return ctx.slots.inject('conversation.header.leading', function () {
      return ctx.slots.register({
        name: 'conversation.header.leading',
        locale: NS,
        inject: function () {
          return {
            toggle: toggleNotes,
            drawer: drawer,
            mountedBinding: mountedBinding
          };
        }
      }, NotesHeroToggle);
    });
  }, 'side-memo: header-leading toggle');

  // Frame-level drawer for the screen before the first Session exists.
  ctx.effect(function () {
    return ctx.slots.inject('shell.overlay', function () {
      return ctx.slots.register({
        name: 'shell.overlay',
        id: 'side-memo.drawer',
        order: 40,
        locale: NS,
        inject: function () {
          return { notes: notes, drawer: drawer };
        }
      }, NotesDrawer);
    });
  }, 'side-memo: drawer');

  // Carry the notes surface across Session establishment: if the drawer is
  // what the user opened, close it and hand the notes to the right sidebar
  // as soon as that sidebar can act on the arriving Session.
  ctx.effect(function () {
    var store: DshSidebarRightService['mounted'];
    try {
      store = ctx.sidebarRight === undefined || ctx.sidebarRight === null ? undefined : ctx.sidebarRight.mounted;
    } catch (error) {
      store = undefined;
    }
    if (store === undefined || store === null || typeof store.subscribe !== 'function') return undefined;
    var activeStore = store;
    var previous = activeStore.getSnapshot();
    var unsubscribe = activeStore.subscribe(function () {
      var current = activeStore.getSnapshot();
      if (previous === undefined && current !== undefined && drawer.getSnapshot()) {
        drawer.set(false);
        openSidebarNotes();
      }
      previous = current;
    });
    return unsubscribe;
  }, 'side-memo: drawer handoff');

  ctx.effect(function () {
    return ctx.slots.inject('sidebar.right.pane.tab', function () {
      return ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: PKG,
        locale: NS,
        // Slot inject is a factory called as inject(bindingKey, actions).
        inject: function () {
          return { notes: notes };
        },
        children: {
          'sidebar.right.tab.notes.actions': {
            kind: 'list',
            scope: 'session'
          }
        }
      }, NotesBody);
    });
  }, 'side-memo: tab body');

  ctx.effect(function () {
    if (typeof window === 'undefined') return undefined;
    var flush = function () {
      notes.flush();
    };
    window.addEventListener('pagehide', flush);
    return function () {
      window.removeEventListener('pagehide', flush);
      notes.flush();
    };
  }, 'side-memo: persistence');
}

// Test hook for the local browser harness (test/e2e): plain-data helpers
// only, and only when the harness page opts in before loading this file.
if (typeof window !== 'undefined' && window.__dsmTestHooks === true) {
  window.__dsmTest = {
    dict: { zh: zh, en: en },
    readEditorContent: readEditorContent,
    buildEditorDom: buildEditorDom,
    insertImageIntoEditor: insertImageIntoEditor,
    normalizeContent: normalizeContent,
    normalizeNote: normalizeNote,
    fitContent: fitContent,
    noteTitleText: noteTitleText,
    noteSnippetText: noteSnippetText,
    noteImageCount: noteImageCount,
    prepareImageFile: prepareImageFile,
    createNotesStore: createNotesStore,
    memoDragText: memoDragText,
    memoDragPayload: memoDragPayload,
    fillMemoDragData: fillMemoDragData,
    readMemoDragPayload: readMemoDragPayload,
    memoDragTypesInclude: memoDragTypesInclude,
    composerEditorFor: composerEditorFor,
    planMemoDrop: planMemoDrop,
    insertMemoIntoComposer: insertMemoIntoComposer,
    // Limits and small pure helpers used by the Node unit suite (test/unit).
    constants: {
      MAX_NOTES: MAX_NOTES,
      MAX_TITLE: MAX_TITLE,
      MAX_BODY: MAX_BODY,
      MAX_LABELS: MAX_LABELS,
      MAX_LABEL_LEN: MAX_LABEL_LEN,
      MAX_IMAGES: MAX_IMAGES,
      MAX_IMAGE_DIMENSION: MAX_IMAGE_DIMENSION,
      MAX_IMAGE_FILE_BYTES: MAX_IMAGE_FILE_BYTES,
      MAX_IMAGE_DATA_BYTES: MAX_IMAGE_DATA_BYTES,
      MAX_TOTAL_IMAGE_BYTES: MAX_TOTAL_IMAGE_BYTES,
      IMAGE_QUALITY: IMAGE_QUALITY,
      SAVE_DELAY_MS: SAVE_DELAY_MS,
      XLSX_MAX_FILE_BYTES: XLSX_MAX_FILE_BYTES,
      XLSX_MAX_TOTAL_BYTES: XLSX_MAX_TOTAL_BYTES,
      XLSX_MAX_ENTRIES: XLSX_MAX_ENTRIES,
      MEMO_DRAG_MIME: MEMO_DRAG_MIME,
      MEMO_DRAG_VERSION: MEMO_DRAG_VERSION,
      STORAGE_KEY: STORAGE_KEY,
      KIND: KIND
    },
    normalizeLabel: normalizeLabel,
    normalizeLabels: normalizeLabels,
    noteLabels: noteLabels,
    noteHasLabel: noteHasLabel,
    imageCountLabel: imageCountLabel,
    textBlocksForBody: textBlocksForBody,
    contentText: contentText,
    noteImageIds: noteImageIds,
    normalizeImageRecord: normalizeImageRecord,
    sortNotes: sortNotes,
    ageLabel: ageLabel,
    crc32: crc32,
    encodeText: encodeText,
    decodeText: decodeText,
    zipStore: zipStore,
    xmlEscape: xmlEscape,
    xmlDecode: xmlDecode,
    xlsxCell: xlsxCell,
    buildXlsxNotes: buildXlsxNotes,
    columnNumber: columnNumber,
    collectTextRuns: collectTextRuns,
    parseSharedStrings: parseSharedStrings,
    parseSheetRows: parseSheetRows,
    importTimestamp: importTimestamp,
    importFavorite: importFavorite,
    parseLabelCell: parseLabelCell,
    normalizedHeader: normalizedHeader,
    stripXmlPrefixes: stripXmlPrefixes
  };
}

export { inject, apply };
