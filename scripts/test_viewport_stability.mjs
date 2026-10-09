/**
 * 模块二：移动端/多端视口防抖与手势交互专项测试
 *
 * - 分辨率矩阵：手机竖屏/横屏、平板、桌面宽屏
 * - 阶梯式通知栏压缩：30/50/80px 渐进拉出与收起，坐标零偏移、零过渡动画
 * - 顶部边界下划手势：无页面级滚动位移
 * - 物理屏幕旋转：正确触发重排并适配，无残留动画
 */

import { launchChrome } from "./lib/browser.mjs";
import { Suite, assert, assertEquals, assertAlmostEqual, waitFor } from "./lib/harness.mjs";
import {
	bootGame,
	bridge,
	viewportSnapshot,
	diffSnapshot,
	installTransitionCounter,
	resetTransitionCounter,
	readTransitionRuns,
	startLocalMode,
	UA_MOBILE_ANDROID,
	UA_DESKTOP,
	BASE_URL,
} from "./lib/helpers.mjs";

const suite = new Suite("模块二：多端视口防抖与手势");

/** 分辨率矩阵：[宽, 高, 是否移动端] */
const RESOLUTIONS = [
	[393, 852, true, "iPhone 15 竖屏"],
	[412, 915, true, "Pixel 8 竖屏"],
	[915, 412, true, "Pixel 8 横屏"],
	[852, 393, true, "iPhone 15 横屏"],
	[820, 1180, true, "iPad Air 竖屏"],
	[1920, 1080, false, "桌面宽屏"],
];

/**
 * 在指定分辨率下执行阶梯式通知栏压缩测试（返回失败描述或 null）
 */
async function notificationBarScenario(browser, width, height, mobile, label) {
	const page = await bootGame(browser, {
		mobile,
		width,
		height,
		ua: mobile ? UA_MOBILE_ANDROID : UA_DESKTOP,
	});
	try {
		const EXTRA = ["#arena .player", "#system"];
		// 引导完成后仍有菜单淡入等收尾动画，静置待其彻底结束再采样基准
		await new Promise(r => setTimeout(r, 3000));
		await installTransitionCounter(page);
		const baseline = await viewportSnapshot(page, EXTRA);
		// 重置过渡计数：排除引导期固有动画（菜单淡入等），只统计视口操作引发的过渡
		await resetTransitionCounter(page);

		// 阶梯式压缩：通知栏渐进式拉出 30/50/80px
		for (const shrink of [30, 50, 80]) {
			await page.setViewport(width, height - shrink, { mobile, ua: mobile ? UA_MOBILE_ANDROID : UA_DESKTOP });
			await new Promise(r => setTimeout(r, 350));
		}
		// 模拟通知栏抖动收放（真实设备下拉过程中的高频抖动）
		await page.setViewport(width, height - 60, { mobile, ua: mobile ? UA_MOBILE_ANDROID : UA_DESKTOP });
		await new Promise(r => setTimeout(r, 150));
		await page.setViewport(width, height - 90, { mobile, ua: mobile ? UA_MOBILE_ANDROID : UA_DESKTOP });
		await new Promise(r => setTimeout(r, 150));
		// 收起恢复
		await page.setViewport(width, height, { mobile, ua: mobile ? UA_MOBILE_ANDROID : UA_DESKTOP });
		// 等待超过重排防抖窗口（500ms）+ 余量，验证无二次重排
		await new Promise(r => setTimeout(r, 1400));

		const after = await viewportSnapshot(page, EXTRA);
		const diffs = diffSnapshot(baseline, after);
		const { runs, targets } = await readTransitionRuns(page);

		if (diffs.length > 0) {
			return `${label}: 通知栏压缩过程中坐标偏移 → ${diffs.slice(0, 6).join("; ")}`;
		}
		if (runs > 0) {
			return `${label}: 通知栏压缩触发了 ${runs} 次过渡动画 → ${targets.join(", ")}`;
		}
		return null;
	} finally {
		await page.close();
	}
}

// ── 分辨率矩阵：阶梯式通知栏压缩 ──
for (const [width, height, mobile, label] of RESOLUTIONS) {
	suite.test(`[分辨率矩阵] ${label} (${width}×${height}) 通知栏压缩零抖动`, async () => {
		const browser = await launchChrome();
		try {
			const failure = await notificationBarScenario(browser, width, height, mobile, label);
			assert(failure === null, failure || "未知失败");
		} finally {
			await browser.close();
		}
	});
}

suite.test("顶部边界下划手势：无页面滚动位移、骨架零位移", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, { mobile: true, width: 412, height: 915 });
		await installTransitionCounter(page);
		const baseline = await viewportSnapshot(page, ["#arena .player", "#system"]);
		await resetTransitionCounter(page);
		// Y=0~20 热区下拉手势（通知栏手势路径），从左侧边缘起手避开可点击控件
		await page.swipe(30, 8, 30, 150, { steps: 10 });
		await new Promise(r => setTimeout(r, 200));
		await page.swipe(60, 12, 60, 220, { steps: 12 });
		await new Promise(r => setTimeout(r, 600));

		const after = await viewportSnapshot(page, ["#arena .player", "#system"]);
		const diffs = diffSnapshot(baseline, after);
		assert(diffs.length === 0, `下拉手势导致位移: ${diffs.join("; ")}`);
		assert(after.scrollX === 0 && after.scrollY === 0, `页面出现滚动: (${after.scrollX}, ${after.scrollY})`);
		// 下拉手势不得引起骨架/座位几何动画（菜单按钮自身的点击反馈不在此列）
		const { targets } = await readTransitionRuns(page);
		const geometryTargets = targets.filter(
			t => /(transform|left|top|width|height)\b/.test(t) && !/dialog|menu|button/i.test(t)
		);
		assert(geometryTargets.length === 0, `下拉手势触发几何过渡: ${geometryTargets.join(", ")}`);
		await page.close();
	} finally {
		await browser.close();
	}
});

suite.test("物理屏幕旋转：竖屏→横屏正确重排自适应", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, { mobile: true, width: 412, height: 915 });
		await installTransitionCounter(page);
		// 在 ui.updatex 上包装计数器
		await page.evaluate(`(function(){
			const { ui } = window.__noname_test__;
			window.__relayoutCount = 0;
			const orig = ui.updatex;
			ui.updatex = function() { window.__relayoutCount++; return orig.apply(this, arguments); };
		})()`);
		const before = await viewportSnapshot(page);

		// 竖屏 → 横屏
		await page.setViewport(915, 412, { mobile: true, ua: UA_MOBILE_ANDROID });
		await waitFor(
			async () => await page.evaluate(`window.__relayoutCount > 0`),
			{ timeout: 8000, interval: 300, label: "旋转触发重排(updatex)" }
		);
		const landscape = await viewportSnapshot(page);
		assertAlmostEqual(landscape.body.w, 915, 2, "横屏后 body 宽度应自适应为 915");
		assert(landscape.body.w > landscape.body.h, "横屏布局方向错误");

		// 横屏 → 竖屏（旋转回来）
		await page.setViewport(412, 915, { mobile: true, ua: UA_MOBILE_ANDROID });
		await new Promise(r => setTimeout(r, 1500));
		const portrait = await viewportSnapshot(page);
		assertAlmostEqual(portrait.body.w, 412, 2, "转回竖屏后 body 宽度应恢复 412");
		assertAlmostEqual(portrait.body.h, before.body.h, 2, "转回竖屏后 body 高度应恢复");

		// 布局完成后静置：无残留进行中过渡
		await new Promise(r => setTimeout(r, 800));
		const inFlight = await page.evaluate(`(function(){
			// transitionrun 在旋转重排时会合法触发（座位移动动画），此处检测的是
			// 静置期是否仍有新的过渡被启动（残留动画会持续产生新的 transitionrun）
			window.__transitionRuns = 0;
			window.__transitionTargets = [];
			return new Promise(resolve => setTimeout(() => resolve(window.__transitionRuns), 900));
		})()`);
		assertEquals(inFlight, 0, "旋转布局完成后仍有残留过渡动画被启动");
		await page.close();
	} finally {
		await browser.close();
	}
});

suite.test("游戏进行中（局内有武将）通知栏压缩：武将座位零位移", async () => {
	const browser = await launchChrome();
	try {
		const page = await bootGame(browser, { mobile: true, width: 412, height: 915 });
		// 进入单挑模式快速开局（2 人局，起速最快）
		await startLocalMode(page, "single", { timeout: 120000 });
		// 开启托管让对局流动（模拟真实游玩状态）
		await bridge(page, `ui.click.auto()`);
		await new Promise(r => setTimeout(r, 1000));
		await installTransitionCounter(page);
		const baseline = await viewportSnapshot(page, [
			"#arena .player[data-position='0']",
			"#arena .player[data-position='1']",
			"#system",
		]);
		await resetTransitionCounter(page);

		for (const shrink of [30, 50, 80]) {
			await page.setViewport(412, 915 - shrink, { mobile: true, ua: UA_MOBILE_ANDROID });
			await new Promise(r => setTimeout(r, 300));
		}
		await page.setViewport(412, 915, { mobile: true, ua: UA_MOBILE_ANDROID });
		await new Promise(r => setTimeout(r, 1400));

		const after = await viewportSnapshot(page, [
			"#arena .player[data-position='0']",
			"#arena .player[data-position='1']",
			"#system",
		]);
		const diffs = diffSnapshot(baseline, after);
		// 武将座位容器与骨架必须静止（卡牌飞行动画属游戏行为，不在校验范围）
		const seatDiffs = diffs.filter(d => d.includes("player") || d.includes("body") || d.includes("arena") || d.includes("scroll"));
		assert(seatDiffs.length === 0, `局内通知栏压缩导致座位/骨架位移: ${seatDiffs.join("; ")}`);
		// 视口变化不得触发座位容器的几何过渡（AI 出牌动画针对卡牌/控件，不针对座位）
		const { targets } = await readTransitionRuns(page);
		const seatGeom = targets.filter(
			t => /player/i.test(t) && /(transform|left|top|width|height)\b/.test(t) && !/card|mark|judge|equip/i.test(t)
		);
		assert(seatGeom.length === 0, `局内通知栏压缩触发座位几何过渡: ${seatGeom.join(", ")}`);
		await page.close();
	} finally {
		await browser.close();
	}
});

const results = await suite.run();
process.exitCode = results.every(r => r.ok) ? 0 : 1;
