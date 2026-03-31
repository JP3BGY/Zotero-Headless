import figures from 'figures';

// Platform-aware bullet: ⏺ on macOS (better vertical alignment), ● on Linux/Windows
export const BULLET = process.platform === 'darwin' ? '⏺' : '●';

// Status indicators (cross-platform via figures package)
export const TICK = figures.tick;           // ✔
export const CROSS = figures.cross;         // ✘
export const WARNING = figures.warning;     // ⚠
export const INFO = figures.info;           // ℹ
export const CIRCLE = figures.circle;       // ◯
export const ELLIPSIS = figures.ellipsis;   // …

// Prompt & list
export const POINTER = figures.pointer;           // ❯
export const POINTER_SMALL = figures.pointerSmall; // ›

// Collapse/expand indicators
export const TRIANGLE_RIGHT = figures.triangleRightSmall;  // ▸
export const TRIANGLE_DOWN = figures.triangleDownSmall;     // ▾

// Scroll indicators
export const TRIANGLE_UP_LARGE = figures.triangleUp;       // ▲
export const TRIANGLE_DOWN_LARGE = figures.triangleDown;    // ▼

// Divider
export const LINE = figures.line;                // ─
export const LINE_VERTICAL = figures.lineVertical; // │

// Separator
export const BULLET_OPERATOR = '∙';
