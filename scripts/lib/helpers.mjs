/**
 * 无名杀端到端测试辅助：游戏引导、引擎桥访问、对话框自动应答、
 * 视口快照对比、控制台错误收集等
 */

import { waitFor } from "./harness.mjs";

export const BASE_URL = process.env.NONAME_BASE_URL || "http://127.0.0.1:8089";
export const SERVER_WS = process.env.NONAME_SERVER_WS || "ws://127.0.0.1:8082";

export const UA_MOBILE_ANDROID =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36";
export const UA_DESKTOP =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/**
 * 打开游戏页面并等待引导完成（boot-loader 移除 + 测试桥就绪）
 * offline=true 时跳过联机大厅自动连接（单机确定性测试）
 */
export async function bootGame(browser, { mobile = false, width = 1920, height = 1080, query = "", offline = true, timeout = 60000 } = {}) {
	const page = await browser.newPage();
	await page.enable();
	await page.setViewport(width, height, {
		mobile,
		deviceScaleFactor: mobile ? 2 : 1,
		ua: mobile ? UA_MOBILE_ANDROID : UA_DESKTOP,
	});
	const params = ["test=1"];
	if (offline) params.push("offline=1");
	if (query) params.push(query);
	const url = `${BASE_URL}/index.html?${params.join("&")}`;
	await page.navigate(url);
	await waitFor(
		async () =>
			await page.evaluate(`(function(){
				const bridge = window.__noname_test__;
				if (!bridge) return false;
				// boot-loader 移除代表引导完成
				if (document.getElementById('boot-loader')) return false;
				if (!bridge.lib || !bridge.ui) return false;
				return true;
			})()`),
		{ timeout, interval: 500, label: `游戏引导完成(${url})` }
	);
	return page;
}

/**
 * 通过测试桥执行引擎表达式（自动带上 __noname_test__ 前缀）
 * expr 直接访问 bridge 上的 lib/game/ui/get/_status/ai
 */
export async function bridge(page, expr) {
	return await page.evaluate(`(function(){
		const { lib, game, get, _status, ui, ai } = window.__noname_test__;
		return (${expr});
	})()`);
}

/**
 * 收集页面控制台错误/警告（排除白名单）
 */
export function consoleErrors(page, { since = 0 } = {}) {
	return page.consoleEntries
		.filter(e => e.ts >= since && (e.type === "error" || e.type === "assert"))
		.map(e => `[${e.type}] ${e.text}`);
}

export function consoleWarnings(page, { since = 0 } = {}) {
	return page.consoleEntries
		.filter(e => e.ts >= since && e.type === "warning")
		.map(e => `[warning] ${e.text}`);
}

/**
 * 视口几何快照：body/#window/#arena 及指定元素列表的 getBoundingClientRect + 滚动偏移
 */
export async function viewportSnapshot(page, extraSelectors = []) {
	return await page.evaluate(`(function(){
		const rect = el => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height };
		};
		const out = {
			body: rect(document.body),
			win: rect(document.getElementById('window')),
			arena: rect(document.getElementById('arena')),
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			innerW: window.innerWidth,
			innerH: window.innerHeight,
			vvOffsetTop: window.visualViewport ? window.visualViewport.offsetTop : null,
			vvHeight: window.visualViewport ? window.visualViewport.height : null,
			extra: {}
		};
		${JSON.stringify(extraSelectors)}.forEach((sel, i) => {
			try {
				const el = document.querySelector(sel);
				out.extra[sel] = el ? rect(el) : null;
			} catch (e) { out.extra[sel] = null; }
		});
		return out;
	})()`);
}

/**
 * 比较两次视口快照，返回差异描述数组（空数组 = 完全静止）
 */
export function diffSnapshot(before, after, { tolerance = 0.6, keys = ["body", "win", "arena"] } = {}) {
	const diffs = [];
	if (Math.abs(before.scrollX - after.scrollX) > 0.5) diffs.push(`scrollX: ${before.scrollX} → ${after.scrollX}`);
	if (Math.abs(before.scrollY - after.scrollY) > 0.5) diffs.push(`scrollY: ${before.scrollY} → ${after.scrollY}`);
	for (const key of keys) {
		const b = before[key];
		const a = after[key];
		if (!b || !a) {
			if (b !== a) diffs.push(`${key}: ${b} → ${a}`);
			continue;
		}
		for (const dim of ["x", "y", "w", "h"]) {
			if (Math.abs(b[dim] - a[dim]) > tolerance) {
				diffs.push(`${key}.${dim}: ${b[dim].toFixed(2)} → ${a[dim].toFixed(2)}`);
			}
		}
	}
	for (const sel in before.extra) {
		const b = before.extra[sel];
		const a = after.extra?.[sel];
		if (!b || !a) continue; // 游戏进行中元素可能合法消失
		for (const dim of ["x", "y", "w", "h"]) {
			if (Math.abs(b[dim] - a[dim]) > tolerance) {
				diffs.push(`extra[${sel}].${dim}: ${b[dim].toFixed(2)} → ${a[dim].toFixed(2)}`);
			}
		}
	}
	return diffs;
}

/**
 * 在页面内安装 transitionrun 侦测器（视口抖动检测核心）：
 * 任何元素因视口事件启动 CSS 过渡都会计数
 */
export async function installTransitionCounter(page) {
	await page.evaluate(`(function(){
		if (window.__transitionCounterInstalled) return;
		window.__transitionCounterInstalled = true;
		window.__transitionRuns = 0;
		window.__transitionTargets = [];
		const record = e => {
			window.__transitionRuns++;
			const el = e.target;
			if (window.__transitionTargets.length < 12) {
				window.__transitionTargets.push((el.id || el.className || el.tagName).toString().slice(0, 60) + ':' + e.propertyName);
			}
		};
		window.addEventListener('transitionrun', record, true);
	})()`);
}

export async function readTransitionRuns(page) {
	return await page.evaluate(`({runs: window.__transitionRuns || 0, targets: (window.__transitionTargets || []).slice(0, 8)})`);
}

/**
 * 重置过渡计数器（在基准快照之后、视口操作之前调用，
 * 排除引导期固有动画的干扰）
 */
export async function resetTransitionCounter(page) {
	await page.evaluate(`(function(){
		window.__transitionRuns = 0;
		window.__transitionTargets = [];
	})()`);
}

/**
 * 对话框自动应答器：模拟快速玩家点击选将/配置/叫分等按钮
 * 优先级：确定类文本 > 模式特定文本 > 第一个可见 .button > 最后一个可见控件
 */
export async function installAutoAnswer(page) {
	await page.evaluate(`(function(){
		if (window.__autoAnswerTimer) return;
		const PRIORITY_TEXTS = ['确定', '开始', '叫地主', '抢地主', '明置', '继续', '好的', 'OK'];
		const visible = el => {
			if (!el || !el.isConnected) return false;
			const cs = getComputedStyle(el);
			if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
			const r = el.getBoundingClientRect();
			return r.width > 4 && r.height > 4;
		};
		// 触屏模式下按钮监听 touchend 而非 click，需同时派发两种事件
		const activate = el => {
			try {
				if (window.__noname_test__ && window.__noname_test__.lib.config.touchscreen && typeof TouchEvent === 'function') {
					const r = el.getBoundingClientRect();
					const touch = new Touch({ identifier: Date.now() % 100000, target: el, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
					for (const type of ['touchstart', 'touchend']) {
						el.dispatchEvent(new TouchEvent(type, {
							touches: type === 'touchend' ? [] : [touch],
							changedTouches: [touch],
							targetTouches: [touch],
							bubbles: true, cancelable: true,
						}));
					}
				}
			} catch (e) { /* Touch 构造失败时退回 click */ }
			el.click();
		};
		const clickAnswer = () => {
			try {
				// 0) 强制选择类对话框：每次点击一个「未选中的可选按钮」，
				//    选满所需数量后引擎自动确认（支持 chooseButton(true, N) 多选）
				const selectable = Array.from(document.querySelectorAll('.dialog:not(.hidden) .button.selectable:not(.selected)'))
					.filter(visible);
				if (selectable.length) { activate(selectable[0]); return; }
				// 1) 优先点击带高优先级文本的可见控件（确定/叫地主等）
				const controls = Array.from(document.querySelectorAll('#control > .control, .controls > .control, #window .control'))
					.filter(visible);
				for (const text of PRIORITY_TEXTS) {
					const c = controls.find(el => (el.textContent || '').trim().includes(text));
					if (c) { activate(c); return; }
				}
				// 2) 对话框中的普通按钮（武将卡等）
				const buttons = Array.from(document.querySelectorAll('.dialog:not(.hidden) .button, .dialog .button'))
					.filter(visible);
				if (buttons.length) { activate(buttons[0]); return; }
				// 3) 剩余可见控件取最后一个（通常是确认位）
				if (controls.length) { activate(controls[controls.length - 1]); return; }
			} catch (e) { /* 静默 */ }
		};
		window.__autoAnswerTimer = setInterval(clickAnswer, 300);
	})()`);
}

export async function stopAutoAnswer(page) {
	await page.evaluate(`(function(){
		if (window.__autoAnswerTimer) { clearInterval(window.__autoAnswerTimer); window.__autoAnswerTimer = null; }
	})()`);
}

/**
 * 从联机大厅切换到本地模式并等待开局：
 * 引导默认进入联机模式（_status.connectMode = true），
 * 直接 switchMode 会走"联机建房"分支，必须先清除联机状态并清理大厅 UI。
 */
export async function startLocalMode(page, mode, { timeout = 120000 } = {}) {
	await installAutoAnswer(page);
	await page.evaluate(`(function(){
		const { _status, game } = window.__noname_test__;
		_status.connectMode = false;
		game.online = false;
		if (game.ws) { game.ws._nocallback = true; try { game.ws.close(); } catch (e) {} }
		if (typeof game.clearConnect === 'function') game.clearConnect();
		game.switchMode(${JSON.stringify(mode)});
	})()`);
	await waitFor(
		async () =>
			await bridge(
				page,
				`( !!_status.gameStarted && game.players && game.players.length >= 2 && game.players.every(p => p.node && p.node.handcards1) )`
			),
		{ timeout, interval: 800, label: `${mode} 模式开局` }
	);
}

/**
 * 等待游戏真正进入可玩状态（me 有手牌或已进入回合循环）
 */
export async function waitGamePlayable(page, { timeout = 60000 } = {}) {
	await waitFor(
		async () =>
			await bridge(
				page,
				`(game.me && game.me.node.handcards1 && (game.me.node.handcards1.childElementCount > 0 || game.me.node.handcards2.childElementCount > 0))`
			),
		{ timeout, interval: 700, label: "手牌分发完成" }
	);
}

/**
 * 统计玩家回合进度：包装 game.createEvent 统计 'phase' 事件
 * （phaseLoop 事件内部自循环不会重复调用 game.phaseLoop，必须按 phase 事件计数）
 */
export async function installTurnCounter(page) {
	await page.evaluate(`(function(){
		if (window.__turnCounterInstalled) return;
		window.__turnCounterInstalled = true;
		const { game } = window.__noname_test__;
		window.__turnCount = 0;
		const orig = game.createEvent;
		game.createEvent = function(name) {
			if (name === 'phase') window.__turnCount++;
			return orig.apply(this, arguments);
		};
	})()`);
}
