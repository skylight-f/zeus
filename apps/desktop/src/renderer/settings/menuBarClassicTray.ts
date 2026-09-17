import type { CodexOfficialRateWindow, UsageProviderSummary } from '@zeus/shared';

/** 浮窗和状态栏共用额度过滤，Spark 不占用经典圆环的位置。 */
export function menuBarRateLimitWindows(provider: UsageProviderSummary): CodexOfficialRateWindow[] {
  return provider.rateLimitWindows.filter((window) => provider.providerId !== 'codex' || !/spark/i.test(`${window.limitId ?? ''} ${window.limitName ?? ''}`));
}

const logoUrl = new URL('../../../assets/icon.png', import.meta.url).href;
let logoPromise: Promise<HTMLImageElement> | undefined;

/** 经典模式使用 18px Logo 和 20px 数字环，以双倍像素绘制菜单栏资源。 */
export async function renderClassicTray(provider: UsageProviderSummary | null, unavailable: boolean, language: 'zh-CN' | 'en-US') {
  logoPromise ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const logo = new Image();
    logo.onload = () => resolve(logo);
    logo.onerror = () => {
      logoPromise = undefined;
      reject(new Error('状态栏 Logo 加载失败'));
    };
    logo.src = logoUrl;
  });
  const logo = await logoPromise;
  const windows = provider ? menuBarRateLimitWindows(provider) : [];
  // 优先展示同一额度池的短、长周期，避免把两个模型误读为两个周期。
  const first = windows.find((window) => window.kind === 'primary') ?? windows[0];
  const pool = first ? windows.filter((window) => (window.limitId || window.limitName) === (first.limitId || first.limitName)) : [];
  const slots: Array<CodexOfficialRateWindow | undefined> = pool.length ? [...pool].sort((a, b) => a.kind.localeCompare(b.kind)).slice(0, 2) : [undefined, undefined];
  const available = !unavailable && provider?.officialState === 'available' && !provider.stale;
  const width = 22 + slots.length * 23;
  const draw = (dark: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = 44;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法绘制状态栏额度');
    context.scale(2, 2);
    context.drawImage(logo, 2, 2, 18, 18);
    slots.forEach((window, index) => {
      const value = available && window && Number.isFinite(window.remainingPercent) ? Math.max(0, Math.min(100, window.remainingPercent)) : null;
      const x = 22 + index * 23 + 11;
      const radius = 9.25;
      context.lineWidth = 1.5;
      context.strokeStyle = dark ? 'rgb(255 255 255 / 10%)' : 'rgb(0 0 0 / 10%)';
      context.beginPath();
      context.arc(x, 11, radius, 0, 2 * Math.PI);
      context.stroke();
      if (value !== null && value > 0) {
        const start = window?.kind === 'secondary' ? [218, 163, 250] : [123, 160, 255];
        const end = window?.kind === 'secondary' ? [139, 109, 255] : [40, 102, 247];
        const progress = value / 100;
        const count = Math.max(12, Math.ceil(progress * 72));
        // AgentDesk 剩余额度从十二点逆时针展开，按弧长插值渐变。
        context.lineCap = 'butt';
        for (let segment = 0; segment < count; segment += 1) {
          const fraction = (segment + 1) / count;
          context.strokeStyle = `rgb(${start.map((channel, i) => Math.round(channel + (end[i]! - channel) * fraction)).join(' ')})`;
          context.beginPath();
          context.arc(x, 11, radius, -Math.PI / 2 - (segment / count) * progress * 2 * Math.PI, -Math.PI / 2 - fraction * progress * 2 * Math.PI, true);
          context.stroke();
        }
        for (const [fraction, color] of [
          [0, start],
          [progress, end],
        ] as const) {
          const angle = -Math.PI / 2 - fraction * 2 * Math.PI;
          context.fillStyle = `rgb(${color.join(' ')})`;
          context.beginPath();
          context.arc(x + Math.cos(angle) * radius, 11 + Math.sin(angle) * radius, 0.75, 0, 2 * Math.PI);
          context.fill();
        }
      }
      context.fillStyle = dark ? `rgb(255 255 255 / ${value === null ? 26 : 94}%)` : `rgb(0 0 0 / ${value === null ? 26 : 94}%)`;
      context.font = 'bold 8.6px -apple-system, BlinkMacSystemFont, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(value === null ? '—' : String(Math.round(value)), x, 11.5);
    });
    return canvas.toDataURL('image/png');
  };
  const zh = language === 'zh-CN';
  const summary = slots
    .map((window) => {
      const period = window?.windowDurationMins ? `${window.windowDurationMins / 60}${zh ? ' 小时' : ' hours'}` : window?.kind === 'secondary' ? (zh ? '长期' : 'Long term') : zh ? '短期' : 'Short term';
      const value = available && window && Number.isFinite(window.remainingPercent) ? `${Math.round(Math.max(0, Math.min(100, window.remainingPercent)))}%` : '—';
      return `${period}: ${value}`;
    })
    .join(' · ');
  return { dataUrl: draw(false), darkDataUrl: draw(true), tooltip: `${provider?.name ?? 'Codex'} · ${zh ? '额度剩余' : 'Quota remaining'} · ${summary}` };
}
