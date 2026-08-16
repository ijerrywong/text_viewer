/**
 * core/parse/html/degrade.js - 脚本降级可见化
 *
 * ⚠️ 纯函数模块：不依赖任何 wx API
 *
 * C22/C23：AI 生成的 HTML 常含 JS 库（Chart.js/ECharts/Mermaid/reveal.js），
 * 小程序不执行脚本，直接消毒后只留空白。
 * 本模块在消毒前检测这些库，生成可见的降级卡片/代码块。
 *
 * 降级规则：
 * - Chart.js / ECharts / D3 → 占位卡片 + "图表无法显示" + 保留邻近文本
 * - Mermaid → 等宽代码块 + 复制按钮
 * - reveal.js / impress.js → 每个 <section> 渲染为竖排卡片
 * - KaTeX / MathJax → 等宽代码块
 * 总原则：降级必须可见，不留空白
 */

/**
 * 检测 HTML 中的脚本库模式，生成降级信息
 * @param {string} html - 原始 HTML（消毒前）
 * @returns {{ hasChart: boolean, hasEcharts: boolean, hasMermaid: boolean, hasReveal: boolean, hasMath: boolean, chartCanvases: Array, mermaidDivs: Array, revealSections: Array }}
 */
function detectScripts(html) {
  if (!html) return { hasChart: false, hasEcharts: false, hasMermaid: false, hasReveal: false, hasMath: false, chartCanvases: [], mermaidDivs: [], revealSections: [] };

  var lower = html.toLowerCase();
  var info = {
    hasChart: false,
    hasEcharts: false,
    hasMermaid: false,
    hasReveal: false,
    hasMath: false,
    chartCanvases: [],
    mermaidDivs: [],
    revealSections: []
  };

  // Chart.js 检测
  if (/chart\.js|chartjs|new\s+Chart\s*\(/i.test(html)) {
    info.hasChart = true;
    // 找 <canvas> 标签
    var canvasRegex = /<canvas\b[^>]*>/gi;
    var canvasMatch;
    while ((canvasMatch = canvasRegex.exec(html)) !== null) {
      info.chartCanvases.push(canvasMatch[0]);
    }
  }

  // ECharts 检测
  if (/echarts|\.setOption\s*\(/i.test(html)) {
    info.hasEcharts = true;
    // 找 echarts 容器
    var echartsRegex = /<div\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:chart|echarts|container)[^"']*["'][^>]*>/gi;
    var echartsMatch;
    while ((echartsMatch = echartsRegex.exec(html)) !== null) {
      info.chartCanvases.push(echartsMatch[0]);
    }
  }

  // Mermaid 检测
  if (/class\s*=\s*["']mermaid["']/i.test(html) || /mermaid\.js|mermaid\.render/i.test(html)) {
    info.hasMermaid = true;
    // 找 mermaid div
    var mermaidRegex = /<div\b[^>]*class\s*=\s*["'][^"']*mermaid[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    var mermaidMatch;
    while ((mermaidMatch = mermaidRegex.exec(html)) !== null) {
      info.mermaidDivs.push(mermaidMatch[1].trim());
    }
  }

  // reveal.js 检测
  if (/reveal\.js|impress\.js|class\s*=\s*["']reveal["']/i.test(html)) {
    info.hasReveal = true;
    // 找 section 标签
    var sectionRegex = /<section\b[^>]*>([\s\S]*?)<\/section>/gi;
    var sectionMatch;
    while ((sectionMatch = sectionRegex.exec(html)) !== null) {
      var sectionContent = sectionMatch[1].trim();
      if (sectionContent) {
        info.revealSections.push(sectionContent);
      }
    }
  }

  // Math 检测
  if (/katex|mathjax|\\\(|\\\[|mathml/i.test(html)) {
    info.hasMath = true;
  }

  return info;
}

/**
 * 生成降级 IR 块
 * @param {Object} scriptInfo - detectScripts 的返回值
 * @param {Function} idGen - ID 生成器
 * @returns {Array} IR 块数组
 */
function generateDegradeBlocks(scriptInfo, idGen) {
  var blocks = [];

  if (!scriptInfo) return blocks;

  // Chart.js / ECharts 降级卡片
  if (scriptInfo.hasChart || scriptInfo.hasEcharts) {
    var chartLib = scriptInfo.hasChart ? 'Chart.js' : 'ECharts';
    blocks.push({
      type: 'scriptDegrade',
      degradeType: 'chart',
      title: chartLib + ' 图表',
      message: '此文档包含 ' + chartLib + ' 图表，小程序无法执行 JavaScript，图表无法显示。',
      hint: '建议在浏览器中打开原文件查看完整图表。',
      id: idGen()
    });
  }

  // Mermaid 降级为代码块
  if (scriptInfo.hasMermaid && scriptInfo.mermaidDivs.length > 0) {
    for (var i = 0; i < scriptInfo.mermaidDivs.length; i++) {
      var mermaidText = scriptInfo.mermaidDivs[i];
      // 清理 HTML 标签
      mermaidText = mermaidText.replace(/<[^>]+>/g, '').trim();
      if (mermaidText) {
        blocks.push({
          type: 'code',
          lang: 'mermaid',
          text: mermaidText,
          raw: mermaidText,
          longHint: false,
          id: idGen()
        });
      }
    }
  }

  // reveal.js 降级为竖排卡片
  if (scriptInfo.hasReveal && scriptInfo.revealSections.length > 0) {
    for (var s = 0; s < scriptInfo.revealSections.length; s++) {
      var sectionHtml = scriptInfo.revealSections[s];
      // 提取纯文本
      var sectionText = sectionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (sectionText) {
        blocks.push({
          type: 'scriptDegrade',
          degradeType: 'slide',
          title: '幻灯片 ' + (s + 1),
          message: sectionText,
          hint: '此内容来自 reveal.js 幻灯片，已转为竖排卡片。',
          slideIndex: s + 1,
          id: idGen()
        });
      }
    }
  }

  // Math 降级
  if (scriptInfo.hasMath) {
    blocks.push({
      type: 'scriptDegrade',
      degradeType: 'math',
      title: '数学公式',
      message: '此文档包含数学公式，小程序无法渲染 KaTeX/MathJax。',
      hint: '公式将以源码形式显示。建议在浏览器中查看。',
      id: idGen()
    });
  }

  return blocks;
}

module.exports = {
  detectScripts: detectScripts,
  generateDegradeBlocks: generateDegradeBlocks
};
