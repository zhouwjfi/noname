import { lib, game, get, _status, ui, ai } from "noname";
import { boot } from "@/init/index.js";
import { userAgentLowerCase, device } from "@/util/index.js";
import { loadBuildInfo } from "@/util/meta.js";
import "core-js-bundle";
// 保证打包时存在(importmap)
import "vue/dist/vue.esm-browser.prod.js";

(async () => {
	try {
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
