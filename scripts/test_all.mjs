#!/usr/bin/env node
/**
 * 无名杀全系统端到端自动化测试 —— 综合启动器
 *
 * 一键运行全部 5 个测试模块并输出总报表：
 *   1. test_engine_lifecycle.mjs    核心引擎启动、生命周期与异常捕获
 *   2. test_viewport_stability.mjs  移动端/多端视口防抖与手势交互
 *   3. test_gameplay_modes.mjs      核心游戏模式与出牌流程（AI 自动推演）
 *   4. test_multiplayer_network.mjs 联机大厅、WebSocket 通信与语音
 *   5. test_assets_integrity.mjs    武将/卡牌/翻译键/多媒体资源完整性
 *
 * 用法：node scripts/test_all.mjs [--only 模块名片段,模块名片段] [--keep]
 *   --only  仅运行名称包含指定片段的模块（逗号分隔）
 *   --keep  测试失败时保留并输出诊断截图路径（默认自动清理临时数据）
 *
 * 环境变量：
 *   NONAME_BASE_URL  客户端地址（默认 http://127.0.0.1:8089）
 *   NONAME_SERVER_WS 联机服务地址（默认 ws://127.0.0.1:8082）
 *   CHROME_BIN       指定 Chromium/Chrome 可执行文件
 */

import { spawn } from "node:child_process";
import { argv, exit } from "node:process";

const MODULES = [
	["test_engine_lifecycle.mjs", "模块一：核心引擎启动与生命周期"],
	["test_viewport_stability.mjs", "模块二：多端视口防抖与手势"],
	["test_gameplay_modes.mjs", "模块三：游戏玩法与出牌流程"],
	["test_multiplayer_network.mjs", "模块四：联机大厅与网络协议"],
	["test_assets_integrity.mjs", "模块五：资源完整性"],
];

const args = argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx !== -1 ? (args[onlyIdx + 1] || "").split(",").map(s => s.trim()).filter(Boolean) : null;

const modules = only ? MODULES.filter(([, label]) => only.some(f => label.includes(f) || f === "all")) : MODULES;
if (modules.length === 0) {
	console.error(`--only 未匹配到任何模块，可用模块: ${MODULES.map(m => m[1]).join(" / ")}`);
	exit(2);
}

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   无名杀全系统端到端自动化测试套件                     ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log(`待运行模块: ${modules.length}/${MODULES.length}`);
console.log(`开始时间: ${new Date().toLocaleString()}\n`);

const overall = [];
const suiteStart = Date.now();

for (const [file, label] of modules) {
	console.log(`\n▶ 启动 ${label} (${file})`);
	const start = Date.now();
	const result = await new Promise(resolve => {
		const child = spawn(process.execPath, [new URL(`./${file}`, import.meta.url).pathname], {
			stdio: "inherit",
			env: { ...process.env },
		});
		child.on("exit", code => resolve({ code, ms: Date.now() - start }));
		child.on("error", err => {
			console.error(`启动失败: ${err.message}`);
			resolve({ code: 1, ms: Date.now() - start });
		});
	});
	const ok = result.code === 0;
	overall.push({ label, ok, code: result.code, ms: result.ms });
	console.log(`${ok ? "✅" : "❌"} ${label} ${ok ? "PASS" : `FAIL(exit=${result.code})`} — 耗时 ${(result.ms / 1000).toFixed(1)}s`);
}

console.log("\n════════════════ test_all.mjs 总报表 ════════════════");
let passCount = 0;
for (const r of overall) {
	console.log(`${r.ok ? "✅ PASS" : "❌ FAIL"}  ${r.label} (${(r.ms / 1000).toFixed(1)}s)`);
	if (r.ok) passCount++;
}
console.log("──────────────────────────────────────────");
console.log(`模块: ${passCount}/${overall.length} 通过，总耗时 ${((Date.now() - suiteStart) / 1000).toFixed(1)}s`);
console.log(passCount === overall.length ? "🎉 全部模块 PASS" : "⚠️ 存在失败模块");
exit(passCount === overall.length ? 0 : 1);
