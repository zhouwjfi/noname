import { lib, game, get, _status, ui, ai } from "noname";
import { boot } from "@/init/index.js";
import { userAgentLowerCase, device } from "@/util/index.js";
import { loadBuildInfo } from "@/util/meta.js";
import "core-js-bundle";
// 保证打包时存在(importmap)
import "vue/dist/vue.esm-browser.prod.js";

(async () => {
	try {
		// 端到端自动化测试桥：仅在显式携带 ?test=1 查询参数时暴露引擎内部对象，
		// 正常用户访问不受影响（dev 模式本身也暴露同等内容，无额外安全面）。
		// 可选 &hall=<ws-url> 覆盖联机大厅地址，供联机模块对接本地测试服务。
		const testParams = new URLSearchParams(location.search);
		if (testParams.get("test") === "1") {
			// @ts-expect-error 测试专用全局桥
			window.__noname_test__ = { lib, game, get, _status, ui, ai };
			const hallOverride = testParams.get("hall");
			if (hallOverride && /^wss?:\/\//.test(hallOverride)) {
				lib.hallURL = hallOverride;
			}
			// offline=1：本地单机测试场景，跳过联机大厅自动连接
			// @ts-expect-error 测试标记
			window.__noname_test_offline__ = testParams.get("offline") === "1";
		}
		// @ts-ignore
		window.__markModulesLoaded?.();
		// @ts-ignore
		window.setBootProgress?.(50, "核心引擎加载完毕，正在初始化...", "准备运行时环境");

		lib.device = device;

		// 预加载脚本
		const preloadPath = "/preload.js";
		let preloadModule;
		if (typeof window.require === "function") {
			preloadModule = await import(/* @vite-ignore */ preloadPath).catch(() => import("./init/node.js"));
		} else {
			const isCordovaLike = typeof window.cordova !== "undefined" || typeof window.NonameAndroidBridge !== "undefined" || typeof window.noname_shijianInterfaces !== "undefined";
			if (import.meta.env.DEV || typeof lib.device == "undefined" || !isCordovaLike) {
				preloadModule = await import("./init/browser.js");
			} else {
				preloadModule = await import(/* @vite-ignore */ preloadPath).catch(() => import("./init/cordova.js"));
			}
		}
		const preload = preloadModule?.default;
		if (typeof preload === "function") {
			await preload({ lib, game, get, _status, ui, ai });
		}
		lib.buildInfo = await loadBuildInfo(url => lib.init.promises.json(url));

		localStorage.setItem("gplv3_noname_alerted", String(true));

		await boot();
	} catch (e) {
		console.error(e);
		// @ts-ignore
		window.setBootProgress?.(window.__bootProgressPct || 0, "加载异常", "网络异常或部分组件加载失败");
		alert(`《无名杀》加载内容失败
浏览器UA信息: 
${userAgentLowerCase}
错误信息: 
${e instanceof Error ? e.stack : String(e)}
若您不理解该信息，请依次检查：
1. 游戏文件是否完整（重新下载完整包）
2. 客户端是否需要更新
3. 浏览器是否需要更新
4. 若您直接打开index.html进行游戏，请改为运行文件夹内的noname-server.exe
5. 若以上步骤均无法解决问题，请及时向开发组反馈`);
	}
})();
