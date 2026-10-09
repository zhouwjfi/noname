// 缓存版本号：构建脚本（scripts/build.ts）会在产物 dist/sw.js 中将占位字符串
// 替换为当次构建的时间戳，保证每次发版都安全切换到全新缓存，避免新旧资源混用
const CACHE_NAME = "noname-pwa-v25-" + "__SW_BUILD_ID__";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./image/pwa/icon-192.png",
  "./image/pwa/icon-512.png",
  "./image/pwa/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn("PWA precache partial failure:", err);
      });
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          // 仅保留当前版本的缓存；旧版本缓存（含上次构建的全部资源）整体清除，
          // 确保新版 Service Worker 接管后不会出现“部分旧资源命中缓存、部分新资源来自网络”的不一致
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  // 页面主动请求立即更新（如在设置中检查更新）
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // 仅处理同源 HTTP/HTTPS GET 请求，严格忽略跨域请求、WebSocket 及非GET请求
  if (request.method !== "GET" || !url.protocol.startsWith("http") || url.origin !== self.location.origin) {
    return;
  }

  // 导航请求（HTML 页面）：网络优先，断网回退缓存
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then(cached => cached || caches.match("./index.html"));
        })
    );
    return;
  }

  // 带 HTTP 缓存指令的资源按其指令处理，交给 HTTP 缓存层
  if (url.pathname.startsWith("/noname/") || url.searchParams.has("v") || url.searchParams.has("t")) {
    return;
  }

  // 静态资源：stale-while-revalidate
  // 先返回缓存保证秒开，同时在后台刷新缓存；下次加载即为最新版，
  // 既保证离线可用，又避免非哈希资源（sw.js 之外的图片等）永久停留在旧版本
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cachedResponse = await cache.match(request);
      const fetchAndCache = fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
            const responseToCache = networkResponse.clone();
            cache.put(request, responseToCache);
          }
          return networkResponse;
        })
        .catch(() => undefined);

      if (cachedResponse) {
        // 后台静默刷新，不阻塞当前响应
        event.waitUntil(fetchAndCache);
        return cachedResponse;
      }

      const networkResponse = await fetchAndCache;
      if (networkResponse) {
        return networkResponse;
      }
      // 离线且无缓存：返回空响应避免控制台报错
      return new Response("", { status: 504, statusText: "Offline" });
    })
  );
});
