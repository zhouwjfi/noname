/// <reference types="vite/client" />
(async function () {
	if ("serviceWorker" in navigator) {
		try {
			const registrations = await navigator.serviceWorker.getRegistrations();
			for (const registration of registrations) {
				if (registration.active?.scriptURL?.includes("service-worker.js")) {
					await registration.unregister();
				}
			}
		} catch (e) {
			// ignore
		}
	}
})();
