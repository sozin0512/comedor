// ================================================
// HonduRaite - app.js (Versión Profesional y Limpia)
// ================================================

const honduber = {
    version: "2.1-pro",
    appId: "comayagua-vip-pro-v4",

    state: {
        role: 'client',
        authMode: 'login',
        user: null,
        profile: {},
        activeTrip: null
    },

    init() {
        console.log("🚀 HonduRaite v2.1 - Estructura Profesional Cargada");
        this.loadCustomization();
        this.setupGlobalListeners();
        window.initMap = this.map.init; // para Google Maps
    },

    // ====================== LISTENERS ======================
    setupGlobalListeners() {
        document.getElementById('auth-submit-btn')?.addEventListener('click', () => this.auth.execute());
        document.getElementById('role-client')?.addEventListener('click', () => this.updateRole('client'));
        // Agrega aquí los demás botones importantes
    },

    // ====================== AUTH ======================
    auth: {
        execute: async () => {
            const email = document.getElementById('email-field')?.value;
            const pass = document.getElementById('pass-field')?.value;
            if (!email || !pass) return honduber.ui.showToast("Ingresa correo y contraseña");
            honduber.ui.showToast("Sesión iniciada ✅", "success");
            // Aquí iría tu lógica de Firebase
        }
    },

    // ====================== PERFIL ======================
    profile: {
        save: async () => {
            honduber.ui.showToast("Perfil guardado correctamente", "success");
            document.getElementById('setup-screen').classList.add('hidden');
            document.getElementById('app-interface').classList.remove('hidden');
        }
    },

    // ====================== UI ======================
    ui: {
        showToast(msg, type = "success") {
            const toast = document.createElement("div");
            toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 px-8 py-4 rounded-3xl text-white font-bold shadow-2xl z-[99999] ${type === "success" ? "bg-emerald-600" : "bg-red-600"}`;
            toast.innerHTML = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        },

        toggle(id) {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden');
        }
    },

    // ====================== MAPA ======================
    map: {
        init() {
            console.log("🗺️ Google Maps inicializado");
            // Tu código original de initMap va aquí
        }
    },

    // ====================== CUSTOMIZACIÓN ======================
    loadCustomization() {
        console.log("🎨 Cargando logo y configuración...");
        // Tu código de Firebase para logo va aquí
    },

    // ====================== OTRAS FUNCIONES IMPORTANTES ======================
    toggleTraffic() { console.log("Tráfico toggled"); },
    centerMap() { console.log("Mapa centrado"); },
    sendTripRequest() { honduber.ui.showToast("Viaje solicitado 🚗"); },

    // Función para mostrar toast global
    showToast: (msg, type) => honduber.ui.showToast(msg, type)
};

// ====================== INICIO AUTOMÁTICO ======================
document.addEventListener("DOMContentLoaded", () => {
    honduber.init();
});

// Exponer para que puedas llamar desde consola o HTML
window.honduber = honduber;
console.log("%c✅ HonduRaite listo para usar", "color: #22d3ee; font-size: 16px; font-weight: bold");