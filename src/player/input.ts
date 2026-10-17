import type { Camera } from '../render/camera';
import { SLOT_COUNT } from '../ui/hotbar';

export interface ControlFrame {
  /** +1 toward the top of the screen. */
  forward: number;
  /** +1 toward the right of the screen. */
  strafe: number;
  jump: boolean;
  /** Hotbar index when a number key was pressed since the last read, else null. */
  slot: number | null;
  /** Hotbar steps from the wheel. Positive selects a higher slot. */
  wheel: number;
  breakBlock: boolean;
  placeBlock: boolean;
  pointerX: number;
  pointerY: number;
  pointerInside: boolean;
}

const DRAG_THRESHOLD = 4;

/** Number row and numpad. 1–9 are slots 0–8. 0 is the last slot. */
export function slotIndexFromCode(code: string): number | null {
  const prefixed = code.startsWith('Digit') ? code.slice(5) : code.startsWith('Numpad') ? code.slice(6) : '';
  if (prefixed.length !== 1) return null;
  const n = Number(prefixed);
  if (!Number.isInteger(n)) return null;
  if (n >= 1 && n <= 9) return n - 1;
  if (n === 0) return SLOT_COUNT - 1;
  return null;
}

function pointerPos(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Keyboard, pointer, and wheel. WASD walks; drag looks around; a click that
 * does not drag breaks or places. The wheel cycles the hotbar, and Ctrl+wheel
 * still zooms.
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
): { read(): ControlFrame; dispose(): void } {
  const down = new Set<string>();
  let slot: number | null = null;
  let wheel = 0;
  let wheelAccum = 0;
  let breakBlock = false;
  let placeBlock = false;
  let pointerX = 0;
  let pointerY = 0;
  let pointerInside = false;

  let dragButton = -1;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;
  let rightPending = false;
  let rightX = 0;
  let rightY = 0;

  const onKeyDown = (event: KeyboardEvent): void => {
    down.add(event.code);
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    const digit = slotIndexFromCode(event.code);
    if (digit !== null) slot = digit;
    if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
      camera.zoomAt(camera.screenW / 2, camera.screenH / 2, 1 / 1.12);
    } else if (event.code === 'Equal' || event.code === 'NumpadAdd') {
      camera.zoomAt(camera.screenW / 2, camera.screenH / 2, 1.12);
    }
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    down.delete(event.code);
  };
  const onBlur = (): void => {
    down.clear();
    dragButton = -1;
    rightPending = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const p = pointerPos(canvas, event);
    pointerX = p.x;
    pointerY = p.y;
    pointerInside = true;
    if (event.button === 2) {
      rightPending = true;
      rightX = p.x;
      rightY = p.y;
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    dragButton = event.button;
    dragMoved = false;
    startX = lastX = p.x;
    startY = lastY = p.y;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const p = pointerPos(canvas, event);
    pointerX = p.x;
    pointerY = p.y;
    pointerInside = true;
    if (dragButton < 0) return;
    if (Math.hypot(p.x - startX, p.y - startY) > DRAG_THRESHOLD) dragMoved = true;
    if (!dragMoved) return;
    camera.drag(p.x - lastX, p.y - lastY);
    lastX = p.x;
    lastY = p.y;
  };

  const onPointerUp = (event: PointerEvent): void => {
    const p = pointerPos(canvas, event);
    pointerX = p.x;
    pointerY = p.y;
    if (event.button === 0 && dragButton === 0) {
      if (!dragMoved) breakBlock = true;
      dragButton = -1;
    } else if (event.button === 1 && dragButton === 1) {
      dragButton = -1;
    } else if (event.button === 2 && rightPending) {
      if (Math.hypot(p.x - rightX, p.y - rightY) <= DRAG_THRESHOLD) placeBlock = true;
      rightPending = false;
    }
  };

  const onPointerCancel = (): void => {
    dragButton = -1;
    rightPending = false;
  };

  const onLeave = (): void => {
    if (dragButton < 0 && !rightPending) pointerInside = false;
  };

  const onContext = (event: Event): void => {
    event.preventDefault();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const p = pointerPos(canvas, event);
    pointerX = p.x;
    pointerY = p.y;
    pointerInside = true;
    const dy =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * 400
          : event.deltaY;
    if (event.ctrlKey) {
      camera.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
      return;
    }
    if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(event.deltaY) >= 40) {
      const steps =
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? Math.sign(dy)
          : Math.sign(dy) * Math.max(1, Math.round(Math.abs(event.deltaY)));
      if (steps !== 0) wheel += steps;
      wheelAccum = 0;
      return;
    }
    wheelAccum += dy;
    if (Math.abs(wheelAccum) >= 40) {
      wheel += Math.sign(wheelAccum);
      wheelAccum = 0;
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const read = (): ControlFrame => {
    let forward = 0;
    let strafe = 0;
    if (down.has('KeyW') || down.has('ArrowUp')) forward += 1;
    if (down.has('KeyS') || down.has('ArrowDown')) forward -= 1;
    if (down.has('KeyD') || down.has('ArrowRight')) strafe += 1;
    if (down.has('KeyA') || down.has('ArrowLeft')) strafe -= 1;
    const frame: ControlFrame = {
      forward,
      strafe,
      jump: down.has('Space'),
      slot,
      wheel,
      breakBlock,
      placeBlock,
      pointerX,
      pointerY,
      pointerInside,
    };
    slot = null;
    wheel = 0;
    breakBlock = false;
    placeBlock = false;
    return frame;
  };

  const dispose = (): void => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('contextmenu', onContext);
    canvas.removeEventListener('wheel', onWheel);
  };

  return { read, dispose };
}
