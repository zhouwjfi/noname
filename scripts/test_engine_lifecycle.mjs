/**
 * 模块一：核心引擎启动、生命周期与异常捕获测试
 *
 * - 引导无错性：console.error / 未捕获异常 / JS 对话框(alert) 均为 0
 * - 看门狗安全：Web 模式不得误弹“游戏未正常载入”重置弹窗
 * - 初始化状态：lib/game/ui/get/_status 完整、根容器样式锁定
 * - PWA/ServiceWorker：注册无报错，二次加载命中缓存
 */

import { launchChrome } from "./lib/browser.mjs";
import { Suite, assert, assertEquals, waitFor } from "./lib/harness.mjs";
import { bootGame, bridge, consoleErrors, consoleWarnings, BASE_URL } from "./lib/helpers.mjs";

const suite = new Suite("模块一：核心引擎启动与生命周期");

suite.test("引导全程零错误（console.error/异常/alert 均为 0）", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, { mobile: false });
		// 再静置 3 秒观察异步错误
		await new Promise(r => setTimeout(r, 3000));
		const errors = [
			...consoleErrors(page),
			...page.exceptions.map(e => `[exception] ${e.text}`),
			...page.jsDialogs.map(d => `[${d.type}] ${d.message.slice(0, 120)}`),
		];
		assert(errors.length === 0, `引导期间存在错误:\n${errors.slice(0, 10).join("\n")}`);
		await page.close();
	} finally {
		await browser.close();
	}
});

suite.test("看门狗安全：无重置弹窗、Web 模式不设 resetGameTimeout", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, { mobile: true, width: 412, height: 915 });
		await new Promise(r => setTimeout(r, 2000));
		const resetDialogs = page.jsDialogs.filter(d => d.message.includes("未正常载入"));
		assert(resetDialogs.length === 0, `出现误判重置弹窗: ${resetDialogs.map(d => d.message).join("; ")}`);
		const hasWatchdog = await page.evaluate(`typeof window.resetGameTimeout`);
		assertEquals(hasWatchdog, "undefined", "Web 环境不应设置加载看门狗");
		// 在游戏已启动的状态下直接调用 lib.init.reset，也不应弹确认框
		const dialogCountBefore = page.jsDialogs.length;
		await bridge(page, `lib.init.reset()`);
		await new Promise(r => setTimeout(r, 800));
		assert(page.jsDialogs.length === dialogCountBefore, "游戏进行中调用 lib.init.reset 弹出了重置确认框");
		await page.close();
	} finally {
		await browser.close();
	}
});

suite.test("初始化状态校验：引擎对象完整、根容器样式锁定", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, { mobile: true, width: 412, height: 915 });
		const state = await bridge(page, `({
			libReady: !!lib && !!lib.config && !!lib.translate,
			gameReady: !!game && typeof game.loop === 'function',
			uiReady: !!ui && !!ui.arena && !!ui.window,
			getReady: !!get && typeof get.translation === 'function',
			statusReady: !!_status,
			arenaInDoc: !!document.getElementById('arena'),
			bodyPosition: getComputedStyle(document.body).position,
			bodyOverflow: getComputedStyle(document.body).overflow,
			htmlOverflow: getComputedStyle(document.documentElement).overflow,
			overscrollBody: getComputedStyle(document.body).overscrollBehavior,
			noPageScroll: window.scrollX === 0 && window.scrollY === 0,
			touchActionCss: getComputedStyle(document.documentElement).overscrollBehaviorY,
		})`);
		assert(state.libReady, "lib 未初始化完整");
		assert(state.gameReady, "game 未初始化完整");
		assert(state.uiReady, "ui 未初始化完整（arena/window 缺失）");
		assert(state.getReady, "get 未初始化完整");
		assert(state.statusReady, "_status 未初始化");
		assert(state.arenaInDoc, "#arena 未挂载");
		assertEquals(state.bodyPosition, "fixed", "body 未锁定为 fixed 定位");
		assertEquals(state.bodyOverflow, "hidden", "body 未锁定 overflow:hidden");
		assertEquals(state.htmlOverflow, "hidden", "html 未锁定 overflow:hidden");
		assertEquals(state.overscrollBody, "none", "body overscroll-behavior 应为 none（禁下拉刷新）");
		assert(state.noPageScroll, "页面出现滚动位移");
		await page.close();
	} finally {
		await browser.close();
	}
});

suite.test("PWA/ServiceWorker：注册成功、二次加载命中缓存且无冲突", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, { mobile: false });
		// SW 在 window.load 后注册，等待其激活
		const swInfo = await waitFor(
			async () =>
				await page.evaluate(`(async function(){
					const reg = await navigator.serviceWorker.getRegistration();
					if (!reg || !reg.active) return null;
					return {
						scope: reg.scope,
						state: reg.active.state,
						scriptURL: reg.active.scriptURL,
					};
				})()`),
			{ timeout: 20000, interval: 500, label: "ServiceWorker 注册激活" }
		);
		assert(swInfo.state === "activated", `SW 状态异常: ${swInfo.state}`);
		assert(swInfo.scriptURL.endsWith("sw.js"), `SW 脚本地址异常: ${swInfo.scriptURL}`);

		// 二次加载：页面受 SW 控制，且静态资源命中缓存
		const firstLoadErrors = consoleErrors(page).length;
		assert(firstLoadErrors === 0, `首次加载存在错误: ${consoleErrors(page).join("; ")}`);
		await page.close();

		const page2 = await browser.newPage();
		await page2.enable();
		await page2.setViewport(1920, 1080, { mobile: false });
		await page2.navigate(`${BASE_URL}/index.html?test=1`);
		await waitFor(
			async () => await page2.evaluate(`!!(navigator.serviceWorker.controller)`),
			{ timeout: 20000, interval: 500, label: "二次加载受 SW 控制" }
		);
		const cacheProbe = await page2.evaluate(`(async function(){
			const cacheNames = await caches.keys();
			const nonameCaches = cacheNames.filter(n => n.startsWith('noname-pwa'));
			if (!nonameCaches.length) return { nonameCaches, cachedAssets: 0, cacheCount: nonameCaches.length };
			// 只应存在一个版本缓存（版本切换时旧缓存被清除）
			const cache = await caches.open(nonameCaches[0]);
			const keys = await cache.keys();
			return {
				nonameCaches,
				cacheCount: nonameCaches.length,
				cachedAssets: keys.length,
				hasIndex: keys.some(k => k.url.includes('index.html')),
			};
		})()`);
		assertEquals(cacheProbe.cacheCount, 1, `应只保留一个版本缓存，实际: ${cacheProbe.nonameCaches.join(", ")}`);
		assert((cacheProbe.cachedAssets || 0) >= 5, `缓存资源数异常: ${cacheProbe.cachedAssets}`);
		assert(cacheProbe.hasIndex, "缓存中缺少 index.html");

		await waitFor(
			async () =>
				await page2.evaluate(
					`(function(){ const b = window.__noname_test__; return !!b && !document.getElementById('boot-loader'); })()`
				),
			{ timeout: 60000, interval: 500, label: "二次加载（SW 缓存命中）引导完成" }
		);
		const secondLoadErrors = [
			...consoleErrors(page2),
			...page2.exceptions.map(e => `[exception] ${e.text}`),
		];
		assert(secondLoadErrors.length === 0, `二次加载存在错误:\n${secondLoadErrors.slice(0, 8).join("\n")}`);
		await page2.close();
	} finally {
		await browser.close();
	}
});

const results = await suite.run();
process.exitCode = results.every(r => r.ok) ? 0 : 1;
