'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Folder, Plus } from 'lucide-react';
import styles from './library-view.module.css';

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

/** True when keystrokes belong to a text field, so shortcuts must not take them. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** Moves focus between menu items with the arrow, Home and End keys. Leaves text inputs alone. */
export function handleMenuNavigation(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
  if (isTextEntry(event.target)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
  if (items.length === 0) return;
  event.preventDefault();
  const current = items.indexOf(event.target as HTMLElement);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else next = current <= 0 ? items.length - 1 : current - 1;
  items[next]?.focus();
}

export function focusFirstMenuItem(container: HTMLElement | null): void {
  container?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
}

/** Calls onDismiss when a pointer goes down outside the container while the menu is open. */
export function useDismissible(open: boolean, containerRef: RefObject<HTMLElement | null>, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, containerRef, onDismiss]);
}

export interface FolderMenuItemsProps {
  folders: readonly string[];
  /** Folder of the recording: a name, null for none, or undefined when several recordings differ. */
  current: string | null | undefined;
  onPick: (folder: string | null) => void;
  onCreate: (name: string) => void;
}

/** Items for choosing a folder. The caller provides the role="menu" container. */
export function FolderMenuItems({ folders, current, onPick, onCreate }: FolderMenuItemsProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const newButtonRef = useRef<HTMLButtonElement>(null);

  const cancelCreate = () => {
    setCreating(false);
    setDraft('');
    newButtonRef.current?.focus();
  };

  const submitCreate = () => {
    const name = draft.trim();
    if (!name) return;
    cancelCreate();
    onCreate(name);
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className={styles.menuItem}
        aria-current={current === null ? 'true' : undefined}
        onClick={() => onPick(null)}
      >
        <span className={styles.menuItemLabel}>Không thư mục</span>
      </button>
      {folders.map((folder) => (
        <button
          key={folder}
          type="button"
          role="menuitem"
          className={styles.menuItem}
          aria-current={current === folder ? 'true' : undefined}
          onClick={() => onPick(folder)}
        >
          <Folder size={14} aria-hidden="true" />
          <span className={styles.menuItemLabel}>{folder}</span>
        </button>
      ))}
      <button
        ref={newButtonRef}
        type="button"
        role="menuitem"
        className={styles.menuItem}
        aria-expanded={creating}
        onClick={() => setCreating(true)}
      >
        <Plus size={14} aria-hidden="true" />
        <span className={styles.menuItemLabel}>Tạo thư mục mới</span>
      </button>
      {creating ? (
        <form
          className={styles.newFolderForm}
          onSubmit={(event) => {
            event.preventDefault();
            submitCreate();
          }}
        >
          <input
            type="text"
            className={styles.newFolderInput}
            aria-label="Tên thư mục mới"
            placeholder="Tên thư mục"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // Stop here so Escape only closes this input, not the whole menu.
                event.stopPropagation();
                cancelCreate();
              }
            }}
          />
          <button type="submit" className={styles.menuSubmit} disabled={!draft.trim()}>
            Tạo
          </button>
        </form>
      ) : null}
    </>
  );
}
