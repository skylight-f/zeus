import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';

interface NativeMenuBarAppearance {
  showPopover: (handle: Buffer, tooltip: string) => boolean;
  hidePopover: (handle: Buffer) => void;
  applyTray: (light: Buffer, dark: Buffer, tooltip: string) => boolean;
}

let native: NativeMenuBarAppearance | undefined;
function appearance(): NativeMenuBarAppearance {
  native ??= createRequire(import.meta.url)(fileURLToPath(new URL('../native/ZeusMenuBarAppearance.node', import.meta.url))) as NativeMenuBarAppearance;
  return native;
}

/** 使用原生弹窗提供玻璃、箭头和屏幕边缘定位，Electron 保留自己的内容宿主。 */
export function showMenuBarPopover(window: BrowserWindow, tooltip: string): void {
  if (!appearance().showPopover(window.getNativeWindowHandle(), tooltip)) throw new Error('菜单栏原生弹窗未能打开');
}

export function hideMenuBarPopover(window: BrowserWindow): void {
  native?.hidePopover(window.getNativeWindowHandle());
}

/** 根据状态按钮实际背景适配文字，保留蓝紫进度色。 */
export function applyMenuBarTray(light: Buffer, dark: Buffer, tooltip: string): void {
  if (!appearance().applyTray(light, dark, tooltip)) throw new Error('未找到本应用的菜单栏状态按钮');
}
