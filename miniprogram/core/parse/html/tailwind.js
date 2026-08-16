/**
 * core/parse/html/tailwind.js - Tailwind CSS 类名规则生成器
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 *
 * C17 P0：AI 生成 HTML 最高频失败模式——引用 cdn.tailwindcss.com 只写类名，
 * 小程序里脚本不执行、域名不通，样式全部归零。
 *
 * 本模块用正则模式匹配类名 → 生成 CSS 声明，而非穷举查表。
 * 覆盖 Tailwind v3 常用工具类（~90% 使用场景），目标 ~20KB。
 *
 * 用法：
 *   var css = expandClass('bg-blue-500');  // → { 'background-color': '#3b82f6' }
 *   var css = expandClass('p-4');           // → { 'padding': '16px' }
 *   var all = expandClasses('bg-blue-500 p-4 flex');  // → 合并后的 style 对象
 */

// ─── 颜色表（Tailwind v3 调色板子集） ───

var COLORS = {
  // slate
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b',
  'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b',
  'slate-900': '#0f172a', 'slate-950': '#020617',
  // gray
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280',
  'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937',
  'gray-900': '#111827', 'gray-950': '#030712',
  // zinc
  'zinc-50': '#fafafa', 'zinc-100': '#f4f4f5', 'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8', 'zinc-400': '#a1a1aa', 'zinc-500': '#71717a',
  'zinc-600': '#52525b', 'zinc-700': '#3f3f46', 'zinc-800': '#27272a',
  'zinc-900': '#18181b', 'zinc-950': '#09090b',
  // neutral
  'neutral-50': '#fafafa', 'neutral-100': '#f5f5f5', 'neutral-200': '#e5e5e5',
  'neutral-300': '#d4d4d4', 'neutral-400': '#a3a3a3', 'neutral-500': '#737373',
  'neutral-600': '#525252', 'neutral-700': '#404040', 'neutral-800': '#262626',
  'neutral-900': '#171717', 'neutral-950': '#0a0a0a',
  // stone
  'stone-50': '#fafaf9', 'stone-100': '#f5f5f4', 'stone-200': '#e7e5e4',
  'stone-300': '#d6d3d1', 'stone-400': '#a8a29e', 'stone-500': '#78716c',
  'stone-600': '#57534e', 'stone-700': '#44403c', 'stone-800': '#292524',
  'stone-900': '#1c1917', 'stone-950': '#0c0a09',
  // red
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca',
  'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444',
  'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b',
  'red-900': '#7f1d1d', 'red-950': '#450a0a',
  // orange
  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-200': '#fed7aa',
  'orange-300': '#fdba74', 'orange-400': '#fb923c', 'orange-500': '#f97316',
  'orange-600': '#ea580c', 'orange-700': '#c2410c', 'orange-800': '#9a3412',
  'orange-900': '#7c2d12', 'orange-950': '#431407',
  // amber
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a',
  'amber-300': '#fcd34d', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b',
  'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e',
  'amber-900': '#78350f', 'amber-950': '#451a03',
  // yellow
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a',
  'yellow-300': '#fde047', 'yellow-400': '#facc15', 'yellow-500': '#eab308',
  'yellow-600': '#ca8a04', 'yellow-700': '#a16207', 'yellow-800': '#854d0e',
  'yellow-900': '#713f12', 'yellow-950': '#422006',
  // lime
  'lime-50': '#f7fee7', 'lime-100': '#ecfccb', 'lime-200': '#d9f99d',
  'lime-300': '#bef264', 'lime-400': '#a3e635', 'lime-500': '#84cc16',
  'lime-600': '#65a30d', 'lime-700': '#4d7c0f', 'lime-800': '#3f6212',
  'lime-900': '#365314', 'lime-950': '#1a2e05',
  // green
  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-200': '#bbf7d0',
  'green-300': '#86efac', 'green-400': '#4ade80', 'green-500': '#22c55e',
  'green-600': '#16a34a', 'green-700': '#15803d', 'green-800': '#166534',
  'green-900': '#14532d', 'green-950': '#052e16',
  // emerald
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0',
  'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981',
  'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46',
  'emerald-900': '#064e3b', 'emerald-950': '#022c22',
  // teal
  'teal-50': '#f0fdfa', 'teal-100': '#ccfbf1', 'teal-200': '#99f6e4',
  'teal-300': '#5eead4', 'teal-400': '#2dd4bf', 'teal-500': '#14b8a6',
  'teal-600': '#0d9488', 'teal-700': '#0f766e', 'teal-800': '#115e59',
  'teal-900': '#134e4a', 'teal-950': '#042f2e',
  // cyan
  'cyan-50': '#ecfeff', 'cyan-100': '#cffafe', 'cyan-200': '#a5f3fc',
  'cyan-300': '#67e8f9', 'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4',
  'cyan-600': '#0891b2', 'cyan-700': '#0e7490', 'cyan-800': '#155e75',
  'cyan-900': '#164e63', 'cyan-950': '#083344',
  // sky
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-200': '#bae6fd',
  'sky-300': '#7dd3fc', 'sky-400': '#38bdf8', 'sky-500': '#0ea5e9',
  'sky-600': '#0284c7', 'sky-700': '#0369a1', 'sky-800': '#075985',
  'sky-900': '#0c4a6e', 'sky-950': '#082f49',
  // blue
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe',
  'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6',
  'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af',
  'blue-900': '#1e3a8a', 'blue-950': '#172554',
  // indigo
  'indigo-50': '#eef2ff', 'indigo-100': '#e0e7ff', 'indigo-200': '#c7d2fe',
  'indigo-300': '#a5b4fc', 'indigo-400': '#818cf8', 'indigo-500': '#6366f1',
  'indigo-600': '#4f46e5', 'indigo-700': '#4338ca', 'indigo-800': '#3730a3',
  'indigo-900': '#312e81', 'indigo-950': '#1e1b4b',
  // violet
  'violet-50': '#f5f3ff', 'violet-100': '#ede9fe', 'violet-200': '#ddd6fe',
  'violet-300': '#c4b5fd', 'violet-400': '#a78bfa', 'violet-500': '#8b5cf6',
  'violet-600': '#7c3aed', 'violet-700': '#6d28d9', 'violet-800': '#5b21b6',
  'violet-900': '#4c1d95', 'violet-950': '#2e1065',
  // purple
  'purple-50': '#faf5ff', 'purple-100': '#f3e8ff', 'purple-200': '#e9d5ff',
  'purple-300': '#d8b4fe', 'purple-400': '#c084fc', 'purple-500': '#a855f7',
  'purple-600': '#9333ea', 'purple-700': '#7e22ce', 'purple-800': '#6b21a8',
  'purple-900': '#581c87', 'purple-950': '#3b0764',
  // fuchsia
  'fuchsia-50': '#fdf4ff', 'fuchsia-100': '#fae8ff', 'fuchsia-200': '#f5d0fe',
  'fuchsia-300': '#f0abfc', 'fuchsia-400': '#e879f9', 'fuchsia-500': '#d946ef',
  'fuchsia-600': '#c026d3', 'fuchsia-700': '#a21caf', 'fuchsia-800': '#86198f',
  'fuchsia-900': '#701a75', 'fuchsia-950': '#4a044e',
  // pink
  'pink-50': '#fdf2f8', 'pink-100': '#fce7f3', 'pink-200': '#fbcfe8',
  'pink-300': '#f9a8d4', 'pink-400': '#f472b6', 'pink-500': '#ec4899',
  'pink-600': '#db2777', 'pink-700': '#be185d', 'pink-800': '#9d174d',
  'pink-900': '#831843', 'pink-950': '#500724',
  // rose
  'rose-50': '#fff1f2', 'rose-100': '#ffe4e6', 'rose-200': '#fecdd3',
  'rose-300': '#fda4af', 'rose-400': '#fb7185', 'rose-500': '#f43f5e',
  'rose-600': '#e11d48', 'rose-700': '#be123c', 'rose-800': '#9f1239',
  'rose-900': '#881337', 'rose-950': '#4c0519'
};

// 特殊颜色值
var SPECIAL_COLORS = {
  'white': '#ffffff',
  'black': '#000000',
  'transparent': 'transparent',
  'current': 'currentColor',
  'inherit': 'inherit'
};

// ─── 间距值映射 ───
// Tailwind spacing scale: 0, px, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96
var SPACING = {
  '0': '0px', 'px': '1px', '0.5': '2px', '1': '4px', '1.5': '6px',
  '2': '8px', '2.5': '10px', '3': '12px', '3.5': '14px', '4': '16px',
  '5': '20px', '6': '24px', '7': '28px', '8': '32px', '9': '36px',
  '10': '40px', '11': '44px', '12': '48px', '14': '56px', '16': '64px',
  '20': '80px', '24': '96px', '28': '112px', '32': '128px', '36': '144px',
  '40': '160px', '44': '176px', '48': '192px', '52': '208px', '56': '224px',
  '60': '240px', '64': '256px', '72': '288px', '80': '320px', '96': '384px'
};

// ─── 字号映射 ───
var FONT_SIZES = {
  'xs': '12px', 'sm': '14px', 'base': '16px', 'lg': '18px',
  'xl': '20px', '2xl': '24px', '3xl': '30px', '4xl': '36px',
  '5xl': '48px', '6xl': '60px', '7xl': '72px', '8xl': '96px', '9xl': '128px'
};

// ─── 圆角映射 ───
var BORDER_RADII = {
  'none': '0px', 'sm': '2px', '': '4px', 'md': '6px', 'lg': '8px',
  'xl': '12px', '2xl': '16px', '3xl': '24px', 'full': '9999px'
};

// ─── 阴影映射 ───
var SHADOWS = {
  'sm': '0 1px 2px 0 rgba(0,0,0,0.05)',
  '': '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px 0 rgba(0,0,0,0.06)',
  'md': '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
  'lg': '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
  'xl': '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
  '2xl': '0 25px 50px -12px rgba(0,0,0,0.25)',
  'inner': 'inset 0 2px 4px 0 rgba(0,0,0,0.05)',
  'none': 'none'
};

// ─── 字重映射 ───
var FONT_WEIGHTS = {
  'thin': '100', 'extralight': '200', 'light': '300',
  'normal': '400', 'medium': '500', 'semibold': '600',
  'bold': '700', 'extrabold': '800', 'black': '900'
};

// ─── 行高映射 ───
var LINE_HEIGHTS = {
  'none': '1', 'tight': '1.25', 'snug': '1.375',
  'normal': '1.5', 'relaxed': '1.625', 'loose': '2',
  '3': '.75rem', '4': '1rem', '5': '1.25rem', '6': '1.5rem',
  '7': '1.75rem', '8': '2rem', '9': '2.25rem', '10': '2.5rem'
};

// ─── 辅助函数 ───

function getColor(name) {
  if (SPECIAL_COLORS[name]) return SPECIAL_COLORS[name];
  if (COLORS[name]) return COLORS[name];
  return null;
}

function getSpacing(val) {
  if (SPACING[val] !== undefined) return SPACING[val];
  // 任意值 [100px]
  var bracketMatch = val.match(/^\[(.+)\]$/);
  if (bracketMatch) return bracketMatch[1];
  return null;
}

// 检测是否为数字（含小数）
function isNumeric(s) {
  return /^\d+(\.\d+)?$/.test(s);
}

// ─── 类名匹配器 ───

/**
 * 展开 Tailwind 类名 → CSS 声明对象
 * @param {string} cls - 单个 Tailwind 类名
 * @returns {Object|null} CSS 声明对象，如 { 'background-color': '#3b82f6' }
 */
function expandClass(cls) {
  if (!cls) return null;
  cls = cls.trim();
  if (!cls) return null;

  var style = {};

  // ─── Display ───
  if (cls === 'block') { style['display'] = 'block'; return style; }
  if (cls === 'inline-block') { style['display'] = 'inline-block'; return style; }
  if (cls === 'inline') { style['display'] = 'inline'; return style; }
  if (cls === 'hidden') { style['display'] = 'none'; return style; }
  if (cls === 'flex') { style['display'] = 'flex'; return style; }
  if (cls === 'inline-flex') { style['display'] = 'inline-flex'; return style; }
  if (cls === 'grid') { style['display'] = 'grid'; return style; }
  if (cls === 'inline-grid') { style['display'] = 'inline-grid'; return style; }
  if (cls === 'contents') { style['display'] = 'contents'; return style; }
  if (cls === 'table') { style['display'] = 'table'; return style; }

  // ─── Flexbox ───
  if (cls === 'flex-row') { style['flex-direction'] = 'row'; return style; }
  if (cls === 'flex-row-reverse') { style['flex-direction'] = 'row-reverse'; return style; }
  if (cls === 'flex-col') { style['flex-direction'] = 'column'; return style; }
  if (cls === 'flex-col-reverse') { style['flex-direction'] = 'column-reverse'; return style; }
  if (cls === 'flex-wrap') { style['flex-wrap'] = 'wrap'; return style; }
  if (cls === 'flex-nowrap') { style['flex-wrap'] = 'nowrap'; return style; }
  if (cls === 'flex-wrap-reverse') { style['flex-wrap'] = 'wrap-reverse'; return style; }
  if (cls === 'flex-1') { style['flex'] = '1 1 0%'; return style; }
  if (cls === 'flex-auto') { style['flex'] = '1 1 auto'; return style; }
  if (cls === 'flex-initial') { style['flex'] = '0 1 auto'; return style; }
  if (cls === 'flex-none') { style['flex'] = 'none'; return style; }
  if (cls === 'flex-grow') { style['flex-grow'] = '1'; return style; }
  if (cls === 'flex-grow-0') { style['flex-grow'] = '0'; return style; }
  if (cls === 'flex-shrink') { style['flex-shrink'] = '1'; return style; }
  if (cls === 'flex-shrink-0') { style['flex-shrink'] = '0'; return style; }

  // justify-content
  if (cls === 'justify-start') { style['justify-content'] = 'flex-start'; return style; }
  if (cls === 'justify-end') { style['justify-content'] = 'flex-end'; return style; }
  if (cls === 'justify-center') { style['justify-content'] = 'center'; return style; }
  if (cls === 'justify-between') { style['justify-content'] = 'space-between'; return style; }
  if (cls === 'justify-around') { style['justify-content'] = 'space-around'; return style; }
  if (cls === 'justify-evenly') { style['justify-content'] = 'space-evenly'; return style; }

  // align-items
  if (cls === 'items-start') { style['align-items'] = 'flex-start'; return style; }
  if (cls === 'items-end') { style['align-items'] = 'flex-end'; return style; }
  if (cls === 'items-center') { style['align-items'] = 'center'; return style; }
  if (cls === 'items-baseline') { style['align-items'] = 'baseline'; return style; }
  if (cls === 'items-stretch') { style['align-items'] = 'stretch'; return style; }
  if (cls === 'self-auto') { style['align-self'] = 'auto'; return style; }
  if (cls === 'self-start') { style['align-self'] = 'flex-start'; return style; }
  if (cls === 'self-end') { style['align-self'] = 'flex-end'; return style; }
  if (cls === 'self-center') { style['align-self'] = 'center'; return style; }

  // ─── Grid ───
  var gridColsMatch = cls.match(/^grid-cols-(\d+)$/);
  if (gridColsMatch) { style['grid-template-columns'] = 'repeat(' + gridColsMatch[1] + ', minmax(0, 1fr))'; return style; }
  var gridRowsMatch = cls.match(/^grid-rows-(\d+)$/);
  if (gridRowsMatch) { style['grid-template-rows'] = 'repeat(' + gridRowsMatch[1] + ', minmax(0, 1fr))'; return style; }
  var colSpanMatch = cls.match(/^col-span-(\d+)$/);
  if (colSpanMatch) { style['grid-column'] = 'span ' + colSpanMatch[1] + ' / span ' + colSpanMatch[1]; return style; }
  if (cls === 'col-span-full') { style['grid-column'] = '1 / -1'; return style; }

  // gap
  var gapMatch = cls.match(/^gap-(.+)$/);
  if (gapMatch) { var gv = getSpacing(gapMatch[1]); if (gv) { style['gap'] = gv; return style; } }
  var gapXMatch = cls.match(/^gap-x-(.+)$/);
  if (gapXMatch) { var gxv = getSpacing(gapXMatch[1]); if (gxv) { style['column-gap'] = gxv; return style; } }
  var gapYMatch = cls.match(/^gap-y-(.+)$/);
  if (gapYMatch) { var gyv = getSpacing(gapYMatch[1]); if (gyv) { style['row-gap'] = gyv; return style; } }

  // ─── Padding ───
  var pMatch = cls.match(/^p-(.+)$/);
  if (pMatch) { var pv = getSpacing(pMatch[1]); if (pv) { style['padding'] = pv; return style; } }
  var pxMatch = cls.match(/^px-(.+)$/);
  if (pxMatch) { var pxv = getSpacing(pxMatch[1]); if (pxv) { style['padding-left'] = pxv; style['padding-right'] = pxv; return style; } }
  var pyMatch = cls.match(/^py-(.+)$/);
  if (pyMatch) { var pyv = getSpacing(pyMatch[1]); if (pyv) { style['padding-top'] = pyv; style['padding-bottom'] = pyv; return style; } }
  var ptMatch = cls.match(/^pt-(.+)$/);
  if (ptMatch) { var ptv = getSpacing(ptMatch[1]); if (ptv) { style['padding-top'] = ptv; return style; } }
  var prMatch = cls.match(/^pr-(.+)$/);
  if (prMatch) { var prv = getSpacing(prMatch[1]); if (prv) { style['padding-right'] = prv; return style; } }
  var pbMatch = cls.match(/^pb-(.+)$/);
  if (pbMatch) { var pbv = getSpacing(pbMatch[1]); if (pbv) { style['padding-bottom'] = pbv; return style; } }
  var plMatch = cls.match(/^pl-(.+)$/);
  if (plMatch) { var plv = getSpacing(plMatch[1]); if (plv) { style['padding-left'] = plv; return style; } }

  // ─── Margin ───
  var mMatch = cls.match(/^m-(.+)$/);
  if (mMatch) { var mv = getSpacing(mMatch[1]); if (mv) { style['margin'] = mv; return style; } }
  if (cls === 'm-auto') { style['margin'] = 'auto'; return style; }
  var mxMatch = cls.match(/^mx-(.+)$/);
  if (mxMatch) { var mxv = getSpacing(mxMatch[1]); if (mxv) { style['margin-left'] = mxv; style['margin-right'] = mxv; return style; } }
  if (cls === 'mx-auto') { style['margin-left'] = 'auto'; style['margin-right'] = 'auto'; return style; }
  var myMatch = cls.match(/^my-(.+)$/);
  if (myMatch) { var myv = getSpacing(myMatch[1]); if (myv) { style['margin-top'] = myv; style['margin-bottom'] = myv; return style; } }
  var mtMatch = cls.match(/^mt-(.+)$/);
  if (mtMatch) { var mtv = getSpacing(mtMatch[1]); if (mtv) { style['margin-top'] = mtv; return style; } }
  var mrMatch = cls.match(/^mr-(.+)$/);
  if (mrMatch) { var mrv = getSpacing(mrMatch[1]); if (mrv) { style['margin-right'] = mrv; return style; } }
  var mbMatch = cls.match(/^mb-(.+)$/);
  if (mbMatch) { var mbv = getSpacing(mbMatch[1]); if (mbv) { style['margin-bottom'] = mbv; return style; } }
  var mlMatch = cls.match(/^ml-(.+)$/);
  if (mlMatch) { var mlv = getSpacing(mlMatch[1]); if (mlv) { style['margin-left'] = mlv; return style; } }

  // ─── Width / Height ───
  if (cls === 'w-full') { style['width'] = '100%'; return style; }
  if (cls === 'w-auto') { style['width'] = 'auto'; return style; }
  if (cls === 'w-screen') { style['width'] = '100vw'; return style; }
  if (cls === 'w-fit') { style['width'] = 'fit-content'; return style; }
  var wMatch = cls.match(/^w-(.+)$/);
  if (wMatch) { var wv = getSpacing(wMatch[1]); if (wv) { style['width'] = wv; return style; }
    var wfrac = wMatch[1].match(/^(\d)\/(\d+)$/); if (wfrac) { style['width'] = (parseInt(wfrac[1])/parseInt(wfrac[2])*100) + '%'; return style; } }
  if (cls === 'h-full') { style['height'] = '100%'; return style; }
  if (cls === 'h-auto') { style['height'] = 'auto'; return style; }
  if (cls === 'h-screen') { style['height'] = '100vh'; return style; }
  var hMatch = cls.match(/^h-(.+)$/);
  if (hMatch) { var hv = getSpacing(hMatch[1]); if (hv) { style['height'] = hv; return style; } }
  if (cls === 'max-w-full') { style['max-width'] = '100%'; return style; }
  var maxWMatch = cls.match(/^max-w-(.+)$/);
  if (maxWMatch) {
    var maxWMap = { 'none': 'none', 'xs': '320px', 'sm': '384px', 'md': '448px', 'lg': '512px', 'xl': '576px', '2xl': '672px', '3xl': '768px', '4xl': '896px', '5xl': '1024px', '6xl': '1152px', '7xl': '1280px', 'full': '100%', 'min': 'min-content', 'max': 'max-content', 'fit': 'fit-content' };
    if (maxWMap[maxWMatch[1]]) { style['max-width'] = maxWMap[maxWMatch[1]]; return style; }
  }

  // ─── Colors ───
  // bg-*
  var bgMatch = cls.match(/^bg-(.+)$/);
  if (bgMatch) {
    var bgVal = bgMatch[1];
    var bgC = getColor(bgVal);
    if (bgC) { style['background-color'] = bgC; return style; }
    // bg-opacity-*
    var bgOpMatch = bgVal.match(/^opacity-(\d+)$/);
    if (bgOpMatch) return null; // handled separately
    // bg-gradient-to-r etc.
    if (bgVal.indexOf('gradient') === 0) { style['background-image'] = 'linear-gradient(to right, var(--tw-gradient-stops))'; return style; }
  }

  // text-* (color)
  var textMatch = cls.match(/^text-(.+)$/);
  if (textMatch) {
    var textVal = textMatch[1];
    // 先检查是否为颜色
    var textC = getColor(textVal);
    if (textC) { style['color'] = textC; return style; }
    // 检查是否为字号
    if (FONT_SIZES[textVal]) { style['font-size'] = FONT_SIZES[textVal]; return style; }
    // text-sm/base/lg 等
    var textOpMatch = textVal.match(/^opacity-(\d+)$/);
    if (textOpMatch) return null;
  }

  // border-* (color)
  var borderMatch = cls.match(/^border-(.+)$/);
  if (borderMatch) {
    var bVal = borderMatch[1];
    if (bVal === '0') { style['border-width'] = '0'; return style; }
    if (bVal === 't' || bVal === 'r' || bVal === 'b' || bVal === 'l') return null; // border-t etc. need width
    // 检查颜色
    var bC = getColor(bVal);
    if (bC) { style['border-color'] = bC; return style; }
    // border-2, border-4, border-8
    if (bVal === '2') { style['border-width'] = '2px'; return style; }
    if (bVal === '4') { style['border-width'] = '4px'; return style; }
    if (bVal === '8') { style['border-width'] = '8px'; return style; }
    if (bVal === '') { style['border-width'] = '1px'; return style; }
  }
  if (cls === 'border') { style['border-width'] = '1px'; return style; }
  if (cls === 'border-t') { style['border-top-width'] = '1px'; return style; }
  if (cls === 'border-r') { style['border-right-width'] = '1px'; return style; }
  if (cls === 'border-b') { style['border-bottom-width'] = '1px'; return style; }
  if (cls === 'border-l') { style['border-left-width'] = '1px'; return style; }

  // ─── Typography ───
  // font-weight: font-bold, font-medium, font-light etc.
  if (cls.indexOf('font-') === 0) {
    var weightKey = cls.slice(5); // remove 'font-'
    if (FONT_WEIGHTS[weightKey]) { style['font-weight'] = FONT_WEIGHTS[weightKey]; return style; }
    // font-{family}
    if (weightKey === 'sans') { style['font-family'] = 'system-ui, -apple-system, sans-serif'; return style; }
    if (weightKey === 'serif') { style['font-family'] = 'Georgia, Cambria, serif'; return style; }
    if (weightKey === 'mono') { style['font-family'] = 'ui-monospace, SFMono-Regular, monospace'; return style; }
  }

  if (cls === 'italic') { style['font-style'] = 'italic'; return style; }
  if (cls === 'not-italic') { style['font-style'] = 'normal'; return style; }
  if (cls === 'underline') { style['text-decoration'] = 'underline'; return style; }
  if (cls === 'line-through') { style['text-decoration'] = 'line-through'; return style; }
  if (cls === 'no-underline') { style['text-decoration'] = 'none'; return style; }

  if (cls === 'text-left') { style['text-align'] = 'left'; return style; }
  if (cls === 'text-center') { style['text-align'] = 'center'; return style; }
  if (cls === 'text-right') { style['text-align'] = 'right'; return style; }
  if (cls === 'text-justify') { style['text-align'] = 'justify'; return style; }

  if (LINE_HEIGHTS[cls.replace('leading-', '')] !== undefined && cls.indexOf('leading-') === 0) {
    style['line-height'] = LINE_HEIGHTS[cls.replace('leading-', '')]; return style;
  }

  if (cls === 'tracking-tighter') { style['letter-spacing'] = '-0.05em'; return style; }
  if (cls === 'tracking-tight') { style['letter-spacing'] = '-0.025em'; return style; }
  if (cls === 'tracking-normal') { style['letter-spacing'] = '0em'; return style; }
  if (cls === 'tracking-wide') { style['letter-spacing'] = '0.025em'; return style; }
  if (cls === 'tracking-wider') { style['letter-spacing'] = '0.05em'; return style; }
  if (cls === 'tracking-widest') { style['letter-spacing'] = '0.1em'; return style; }

  // text-overflow
  if (cls === 'truncate') { style['overflow'] = 'hidden'; style['text-overflow'] = 'ellipsis'; style['white-space'] = 'nowrap'; return style; }
  if (cls === 'text-ellipsis') { style['text-overflow'] = 'ellipsis'; return style; }
  if (cls === 'text-clip') { style['text-overflow'] = 'clip'; return style; }

  // ─── Border Radius ───
  if (cls === 'rounded-none') { style['border-radius'] = '0px'; return style; }
  if (cls === 'rounded-sm') { style['border-radius'] = '2px'; return style; }
  if (cls === 'rounded') { style['border-radius'] = '4px'; return style; }
  if (cls === 'rounded-md') { style['border-radius'] = '6px'; return style; }
  if (cls === 'rounded-lg') { style['border-radius'] = '8px'; return style; }
  if (cls === 'rounded-xl') { style['border-radius'] = '12px'; return style; }
  if (cls === 'rounded-2xl') { style['border-radius'] = '16px'; return style; }
  if (cls === 'rounded-3xl') { style['border-radius'] = '24px'; return style; }
  if (cls === 'rounded-full') { style['border-radius'] = '9999px'; return style; }

  // ─── Shadow ───
  if (cls === 'shadow-sm' || cls === 'shadow' || cls === 'shadow-md' || cls === 'shadow-lg' || cls === 'shadow-xl' || cls === 'shadow-2xl' || cls === 'shadow-inner' || cls === 'shadow-none') {
    var shadowKey = cls.replace('shadow-', '');
    if (cls === 'shadow') shadowKey = '';
    if (SHADOWS[shadowKey] !== undefined) { style['box-shadow'] = SHADOWS[shadowKey]; return style; }
  }

  // ─── Opacity ───
  var opacityMatch = cls.match(/^opacity-(\d+)$/);
  if (opacityMatch) { style['opacity'] = (parseInt(opacityMatch[1]) / 100).toString(); return style; }

  // ─── Position ───
  if (cls === 'static') { style['position'] = 'static'; return style; }
  if (cls === 'relative') { style['position'] = 'relative'; return style; }
  if (cls === 'absolute') { style['position'] = 'absolute'; return style; }
  if (cls === 'fixed') { style['position'] = 'fixed'; return style; }
  if (cls === 'sticky') { style['position'] = 'sticky'; return style; }

  // inset
  var insetMatch = cls.match(/^(top|right|bottom|left|inset)-(0|auto|full)$/);
  if (insetMatch) {
    var posProp = insetMatch[1] === 'inset' ? 'inset' : insetMatch[1];
    var posVal = insetMatch[2] === '0' ? '0' : insetMatch[2] === 'auto' ? 'auto' : '100%';
    style[posProp] = posVal; return style;
  }
  var insetNumMatch = cls.match(/^(top|right|bottom|left|inset)-(.+)$/);
  if (insetNumMatch) {
    var iv = getSpacing(insetNumMatch[2]);
    if (iv) { style[insetNumMatch[1]] = iv; return style; }
  }

  // ─── Overflow ───
  if (cls === 'overflow-hidden') { style['overflow'] = 'hidden'; return style; }
  if (cls === 'overflow-auto') { style['overflow'] = 'auto'; return style; }
  if (cls === 'overflow-visible') { style['overflow'] = 'visible'; return style; }
  if (cls === 'overflow-scroll') { style['overflow'] = 'scroll'; return style; }
  if (cls === 'overflow-x-auto') { style['overflow-x'] = 'auto'; return style; }
  if (cls === 'overflow-y-auto') { style['overflow-y'] = 'auto'; return style; }
  if (cls === 'overflow-x-hidden') { style['overflow-x'] = 'hidden'; return style; }
  if (cls === 'overflow-y-hidden') { style['overflow-y'] = 'hidden'; return style; }
  if (cls === 'overflow-x-scroll') { style['overflow-x'] = 'scroll'; return style; }
  if (cls === 'overflow-y-scroll') { style['overflow-y'] = 'scroll'; return style; }

  // ─── Z-index ───
  var zMatch = cls.match(/^z-(\d+)$/);
  if (zMatch) { style['z-index'] = zMatch[1]; return style; }
  if (cls === 'z-auto') { style['z-index'] = 'auto'; return style; }

  // ─── Cursor ───
  if (cls === 'cursor-pointer') { style['cursor'] = 'pointer'; return style; }
  if (cls === 'cursor-default') { style['cursor'] = 'default'; return style; }
  if (cls === 'cursor-not-allowed') { style['cursor'] = 'not-allowed'; return style; }

  // ─── Transition ───
  if (cls === 'transition') { style['transition-property'] = 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter'; style['transition-timing-function'] = 'cubic-bezier(0.4, 0, 0.2, 1)'; style['transition-duration'] = '150ms'; return style; }
  if (cls === 'transition-all') { style['transition-property'] = 'all'; style['transition-timing-function'] = 'cubic-bezier(0.4, 0, 0.2, 1)'; style['transition-duration'] = '150ms'; return style; }
  var durMatch = cls.match(/^duration-(\d+)$/);
  if (durMatch) { style['transition-duration'] = durMatch[1] + 'ms'; return style; }

  // ─── Object fit ───
  if (cls === 'object-contain') { style['object-fit'] = 'contain'; return style; }
  if (cls === 'object-cover') { style['object-fit'] = 'cover'; return style; }
  if (cls === 'object-fill') { style['object-fit'] = 'fill'; return style; }
  if (cls === 'object-none') { style['object-fit'] = 'none'; return style; }

  // ─── Aspect ratio ───
  if (cls === 'aspect-auto') { style['aspect-ratio'] = 'auto'; return style; }
  if (cls === 'aspect-square') { style['aspect-ratio'] = '1 / 1'; return style; }
  if (cls === 'aspect-video') { style['aspect-ratio'] = '16 / 9'; return style; }

  // ─── List ───
  if (cls === 'list-none') { style['list-style-type'] = 'none'; return style; }
  if (cls === 'list-disc') { style['list-style-type'] = 'disc'; return style; }
  if (cls === 'list-decimal') { style['list-style-type'] = 'decimal'; return style; }
  if (cls === 'list-inside') { style['list-style-position'] = 'inside'; return style; }
  if (cls === 'list-outside') { style['list-style-position'] = 'outside'; return style; }

  // ─── Whitespace ───
  if (cls === 'whitespace-normal') { style['white-space'] = 'normal'; return style; }
  if (cls === 'whitespace-nowrap') { style['white-space'] = 'nowrap'; return style; }
  if (cls === 'whitespace-pre') { style['white-space'] = 'pre'; return style; }
  if (cls === 'whitespace-pre-line') { style['white-space'] = 'pre-line'; return style; }
  if (cls === 'whitespace-pre-wrap') { style['white-space'] = 'pre-wrap'; return style; }
  if (cls === 'break-normal') { style['word-break'] = 'normal'; style['overflow-wrap'] = 'normal'; return style; }
  if (cls === 'break-words') { style['overflow-wrap'] = 'break-word'; return style; }
  if (cls === 'break-all') { style['word-break'] = 'break-all'; return style; }

  // 任意值 [property:value]
  var bracketMatch = cls.match(/^\[([a-z-]+):(.+)\]$/);
  if (bracketMatch) { style[bracketMatch[1]] = bracketMatch[2]; return style; }

  // 未识别
  return null;
}

/**
 * 展开多个 Tailwind 类名 → 合并后的 CSS 声明对象
 * @param {string} classStr - 空格分隔的类名字符串
 * @returns {Object} 合并后的 style 对象
 */
function expandClasses(classStr) {
  if (!classStr) return {};
  var classes = classStr.split(/\s+/).filter(function(c) { return c; });
  var result = {};
  for (var i = 0; i < classes.length; i++) {
    var css = expandClass(classes[i]);
    if (css) {
      for (var key in css) {
        if (css.hasOwnProperty(key)) {
          result[key] = css[key];
        }
      }
    }
  }
  return result;
}

/**
 * 检测 HTML 是否使用了 Tailwind（是否引用了 cdn.tailwindcss.com）
 * @param {string} html - HTML 文本
 * @returns {boolean}
 */
function hasTailwind(html) {
  if (!html) return false;
  return /cdn\.tailwindcss\.com|<script[^>]+tailwind/i.test(html);
}

module.exports = {
  expandClass: expandClass,
  expandClasses: expandClasses,
  hasTailwind: hasTailwind,
  COLORS: COLORS,
  SPACING: SPACING,
  FONT_SIZES: FONT_SIZES
};
