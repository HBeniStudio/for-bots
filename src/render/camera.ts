import { isoToWorld, worldToIso, type IsoPoint } from './iso';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

export class Camera {
  /** World point kept under the center of the screen. */
  focusX = 8;
  focusY = 0;
  focusZ = 8;
  /**
   * Look offset added on top of the follow target. Drag and zoom write it so
   * a later `follow` does not snap the grabbed view back onto the player.
   */
  lookX = 0;
  lookZ = 0;
  zoom = 0.8;
  screenW = 1;
  screenH = 1;

  resize(width: number, height: number): void {
    this.screenW = Math.max(1, width);
    this.screenH = Math.max(1, height);
  }

  /** Center the view on a world point, keeping the current look offset. */
  follow(x: number, y: number, z: number): void {
    this.focusX = x + this.lookX;
    this.focusY = y;
    this.focusZ = z + this.lookZ;
  }

  worldToScreen(x: number, y: number, z: number): IsoPoint {
    const p = worldToIso(x, y, z);
    const o = worldToIso(this.focusX, this.focusY, this.focusZ);
    return {
      x: (p.x - o.x) * this.zoom + this.screenW / 2,
      y: (p.y - o.y) * this.zoom + this.screenH / 2,
    };
  }

  /** Inverse of {@link worldToScreen} at a fixed world height. */
  screenToWorld(sx: number, sy: number, y: number): { x: number; z: number } {
    const o = worldToIso(this.focusX, this.focusY, this.focusZ);
    const ix = (sx - this.screenW / 2) / this.zoom + o.x;
    const iy = (sy - this.screenH / 2) / this.zoom + o.y;
    return isoToWorld(ix, iy, y);
  }

  /**
   * Grab-pan. `(dx, dy)` is the pointer movement in CSS pixels; the world
   * point under the pointer stays under the pointer.
   */
  drag(dx: number, dy: number): void {
    const prevX = this.focusX;
    const prevZ = this.focusZ;
    const next = this.screenToWorld(this.screenW / 2 - dx, this.screenH / 2 - dy, this.focusY);
    this.focusX = next.x;
    this.focusZ = next.z;
    this.lookX += this.focusX - prevX;
    this.lookZ += this.focusZ - prevZ;
  }

  /**
   * Keyboard pan in screen space. `forward` is +1 toward the top of the screen
   * (W / ArrowUp); `strafe` is +1 toward the right (D / ArrowRight).
   */
  panPixels(forward: number, strafe: number, pixels: number): void {
    if (pixels === 0 || (forward === 0 && strafe === 0)) return;
    this.drag(strafe * pixels, -forward * pixels);
  }

  /** Multiply zoom by `factor`, keeping the world point under `(sx, sy)` fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const before = this.screenToWorld(sx, sy, 0);
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (next === this.zoom) return;
    const prevX = this.focusX;
    const prevZ = this.focusZ;
    this.zoom = next;
    const after = this.screenToWorld(sx, sy, 0);
    this.focusX += before.x - after.x;
    this.focusZ += before.z - after.z;
    this.lookX += this.focusX - prevX;
    this.lookZ += this.focusZ - prevZ;
  }
}
