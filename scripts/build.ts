import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
spawnSync("pnpm -F noname... build", {
	shell: true,
	stdio: "inherit",
});

spawnSync("pnpm -F ./packages/extension/** build", {
	shell: true,
	stdio: "inherit",
});

console.log("合并打包结果");
await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist", { recursive: true });
await Promise.all([
	fs.cp("apps/core/dist", "dist", { recursive: true }),
	fs.cp("apps/core/audio", "dist/audio", { recursive: true }),
	fs.cp("apps/core/image", "dist/image", { recursive: true }),
	fs.cp("apps/core/extension", "dist/extension", { recursive: true }),
	fs.cp("docs", "dist/docs", { recursive: true }),
	fs.cp(".nomedia", "dist/.nomedia"),
	fs.cp("LICENSE", "dist/LICENSE"),
	fs.cp("README.md", "dist/README.md")
]);

// 以构建时间戳为 Service Worker 缓存版本号：每次发版全新缓存 + 清理旧缓存，
// 避免客户端出现“部分资源新版、部分资源旧版”的不一致
const swPath = "dist/sw.js";
const swContent = await fs.readFile(swPath, "utf8");
const buildId = Date.now().toString(36);
await fs.writeFile(swPath, swContent.replaceAll('"__SW_BUILD_ID__"', JSON.stringify(buildId)));
console.log(`Service Worker 缓存版本: ${buildId}`);
