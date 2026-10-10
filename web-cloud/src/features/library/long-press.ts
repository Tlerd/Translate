/**
 * Framework-free long-press detector for touch and pen input.
 *
 * start() arms a timer at the press point. move() cancels the press once the pointer
 * leaves the tolerance circle. end() cancels the press and reports whether it already fired,
 * so the caller can swallow the click that the browser sends after a long press.
 */

export interface LongPressOptions {
  /** How long the pointer must stay down before the press fires. */
  delayMs?: number;
  /** Movement beyond this distance (px) from the press point cancels the press. */
  moveTolerancePx?: number;
  onLongPress: () => void;
}

export interface LongPressController {
  start(x: number, y: number): void;
  move(x: number, y: number): void;
  /** Cancels any pending press. Returns true when the press had already fired. */
  end(): boolean;
}

export function createLongPress({
  delayMs = 450,
  moveTolerancePx = 10,
  onLongPress,
}: LongPressOptions): LongPressController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let originX = 0;
  let originY = 0;
  let fired = false;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    start(x, y) {
      clearTimer();
      fired = false;
      originX = x;
      originY = y;
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        onLongPress();
      }, delayMs);
    },
    move(x, y) {
      if (timer === null) return;
      if (Math.hypot(x - originX, y - originY) > moveTolerancePx) clearTimer();
    },
    end() {
      clearTimer();
      const result = fired;
      fired = false;
      return result;
    },
  };
}
