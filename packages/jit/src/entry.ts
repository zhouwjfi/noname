/// <reference types="vite/client" />
(async function () {
	if ("serviceWorker" in navigator) {
		try {
			const registrations = await navigator.serviceWorker.getRegistrations();
			for (const registration of registrations) {
				await registration.unregister();
			}
		} catch (e) {
			// ignore
		}
	}
})();
