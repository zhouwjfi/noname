/**
 * 模块八：全屏/通知栏视口状态机测试
 *
 * - 系统性退出全屏（下拉通知栏触发 fullscreenchange）：不立即重排、挂起恢复、
 *   下一次用户手势触发恢复请求（恢复失败则回退接受新尺寸）
 * - 用户主动退出全屏：立即接受新尺寸并重排
 * - 持久化规则：适度幅度（≤100px 且 ≤15%）的尺寸变化持续 5 秒才接受为新基准，
 *   瞬态遮挡（通知栏压缩）仍然零重排
 */

import { Suite, assert, waitFor } from "./lib/harness.mjs";
import { launchChrome } from "./lib/browser.mjs";
import { bootGame, bridge, UA_MOBILE_ANDROID } from "./lib/helpers.mjs";

const suite = new Suite("模块八：全屏与通知栏视口状态机");

// 稳定器基准（稳定器接受/锁定的尺寸）与 body 实际渲染尺寸（重排证据）
const SNAPSHOT = `(function(){
	const s = ui._stableSizes && ui._stableSizes.portrait;
	return { stableW: s && s.width, stableH: s && s.height, bodyW: document.body.offsetWidth, bodyH: document.body.offsetHeight };
})()`;

suite.test("系统性退出全屏：零重排 + 挂起 + 手势解除挂起", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, {
			mobile: true,
			width: 412,
			height: 915,
			ua: UA_MOBILE_ANDROID,
			offline: true,
		});
		// 等待菜单收尾动画结束，建立稳定器基准
		await new Promise(r => setTimeout(r, 3000));
		const before = await bridge(page, SNAPSHOT);
		assert(before.stableH === 915, `基准未建立: ${JSON.stringify(before)}`);

		// 模拟"处于API全屏中系统突然退出"（下拉通知栏）：置用户意图后派发 fullscreenchange
		await bridge(page, `(function(){ window._nonameUserWantsFullscreen = true; document.dispatchEvent(new Event("fullscreenchange")); return true; })()`);
		const pending = await bridge(page, `window._nonameFullscreenRestorePending === true`);
		assert(pending, "系统性退出全屏未挂起恢复");

		// 通知栏压缩（视口缩小80px）：挂起期间必须保持画面静止
		await page.setViewport(412, 835, { mobile: true, ua: UA_MOBILE_ANDROID });
		await new Promise(r => setTimeout(r, 900));
		const duringShade = await bridge(page, SNAPSHOT);
		assert(
			duringShade.bodyW === before.bodyW && duringShade.bodyH === before.bodyH,
			`挂起期间发生了重排: ${before.bodyW}×${before.bodyH} → ${duringShade.bodyW}×${duringShade.bodyH}`
		);
		assert(duringShade.stableH === 915, `挂起期间基准被改动: ${duringShade.stableH}`);

		// 用户手势（keydown 监听器同样生效）→ 触发恢复请求，挂起解除
		await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))`);
		await waitFor(async () => await bridge(page, `!window._nonameFullscreenRestorePending`), {
			timeout: 3000,
			interval: 100,
			label: "手势后挂起解除",
		});
		page.close();
	} finally {
		await browser.close();
	}
});

suite.test("用户主动退出全屏：立即接受新尺寸并重排", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, {
			mobile: true,
			width: 412,
			height: 915,
			ua: UA_MOBILE_ANDROID,
			offline: true,
		});
		await new Promise(r => setTimeout(r, 3000));

		// 用户通过按钮退出全屏：click.fullscreen 先清 _nonameUserWantsFullscreen 再触发 fullscreenchange
		await bridge(page, `(function(){ window._nonameUserWantsFullscreen = false; delete window._nonameFullscreenRestorePending; document.dispatchEvent(new Event("fullscreenchange")); return true; })()`);
		const pending = await bridge(page, `window._nonameFullscreenRestorePending === true`);
		assert(!pending, "用户主动退出不应挂起恢复");

		// 视口缩小：非挂起状态且 _viewportModeChanged 置位 → 立即接受新尺寸
		await page.setViewport(412, 835, { mobile: true, ua: UA_MOBILE_ANDROID });
		await waitFor(
			async () => (await bridge(page, SNAPSHOT)).stableH === 835,
			{ timeout: 5000, interval: 200, label: "用户退出全屏后重排接受新尺寸" }
		);
		page.close();
	} finally {
		await browser.close();
	}
});

suite.test("持久化规则：适度尺寸变化持续5秒被接受，瞬态遮挡仍零重排", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, {
			mobile: true,
			width: 412,
			height: 915,
			ua: UA_MOBILE_ANDROID,
			offline: true,
		});
		await new Promise(r => setTimeout(r, 3000));
		const baseline = await bridge(page, SNAPSHOT);
		assert(baseline.stableH === 915, `基准未建立: ${JSON.stringify(baseline)}`);

		// 瞬态压缩（0.9秒内恢复）：必须零重排
		await page.setViewport(412, 835, { mobile: true, ua: UA_MOBILE_ANDROID });
		await new Promise(r => setTimeout(r, 900));
		let now = await bridge(page, SNAPSHOT);
		assert(now.bodyH === baseline.bodyH && now.stableH === 915, `瞬态压缩触发了重排: ${JSON.stringify(now)}`);
		await page.setViewport(412, 915, { mobile: true, ua: UA_MOBILE_ANDROID });
		await new Promise(r => setTimeout(r, 600));

		// 持续压缩（>5秒）：应被接受为新基准
		await page.setViewport(412, 835, { mobile: true, ua: UA_MOBILE_ANDROID });
		await waitFor(
			async () => (await bridge(page, SNAPSHOT)).stableH === 835,
			{ timeout: 10000, interval: 300, label: "持续压缩5秒后被接受" }
		);

		// 恢复原高度（持续>5秒）：应被接受回原基准
		await page.setViewport(412, 915, { mobile: true, ua: UA_MOBILE_ANDROID });
		await waitFor(
			async () => (await bridge(page, SNAPSHOT)).stableH === 915,
			{ timeout: 10000, interval: 300, label: "高度恢复5秒后被接受" }
		);
		page.close();
	} finally {
		await browser.close();
	}
});

const results = await suite.run();
process.exitCode = results.every(r => r.ok) ? 0 : 1;
