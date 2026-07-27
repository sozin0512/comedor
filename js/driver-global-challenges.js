/**
 * Copa HonduRaite — retos globales para conductores
 * Modo principal: competencia TODOS VS TODOS (ranking nacional en vivo + premios por puesto).
 * Opcional: copa por ciudad (equipos) y metas personales (tiers).
 *
 * Restricción: solo conductores aprobados/verificados entran al ranking, suman viajes
 * y reclaman premios. El ranking público sigue visible para todos los logueados.
 */
import {
    collection, addDoc, getDocs, getDoc, updateDoc, doc, setDoc,
    serverTimestamp, query, where, onSnapshot, orderBy, limit, arrayUnion, Timestamp, increment
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { APP_CONFIG } from './config.js';

let dbRef = null;
let appIdRef = null;
let getCurrentUser = () => null;
let getSenderName = () => 'Supervisor';
let getDriverProfile = () => null;

const COPA_DRIVER_VERIFY_MSG =
    'Solo conductores aprobados pueden participar en la Copa. Completá la aprobación de tu cuenta y vehículos.';

/**
 * Conductor apto para competir/cobrar: aprobado (o legacy con vehículo aprobado),
 * no pending/suspended/rejected ni restringido.
 */
function isDriverApprovedForCopa(profile) {
    if (!profile) return false;
    if (profile.accountRestricted === true) return false;
    const status = profile.approvalStatus;
    if (status === 'suspended' || status === 'rejected' || status === 'pending') return false;
    if (status === 'approved') return true;
    if (profile.verified === true) return true;
    // Legado: sin status explícito pero con al menos un vehículo aprobado
    if (status == null || status === '') {
        const vehicles = Array.isArray(profile.vehicles) ? profile.vehicles : [];
        return vehicles.some((v) => v?.approvalStatus === 'approved');
    }
    return false;
}

function canCompeteInDriverCopa(profile) {
    return isDriverApprovedForCopa(profile);
}

function requireVerifiedForDriverCopa(profile, opts = {}) {
    if (canCompeteInDriverCopa(profile)) return true;
    if (opts.toast !== false) {
        window.showToast?.(COPA_DRIVER_VERIFY_MSG, 'warning');
    }
    return false;
}

function driverVerifyCtaBannerHtml() {
    return `
        <div class="copa-status copa-status--warn copa-verify-banner" role="status">
            <p><i class="fas fa-id-card"></i> <b>Solo conductores aprobados</b> entran al ranking, suman viajes y reclaman premios.</p>
            <p class="copa-float-time" style="margin:0.35rem 0 0">Si tu cuenta o vehículos están pendientes, contactá a supervisión.</p>
        </div>
    `;
}

let challengesUnsub = null;
let entryUnsubs = [];
let publicChallengesUnsub = null;
let expiryTimer = null;

/** Challenges cache for public ranking (passengers + everyone) */
let publicCachedChallenges = [];

const MINIMIZED_KEY = 'honduber_copa_min';
/** Cierre con ✕ solo para esta sesión (como promos de pasajeros). Al re-login vuelve a salir. */
const STRIP_DISMISS_KEY = 'honduber_copa_strip_dismissed';
const DISMISSED_KEY = 'honduber_copa_dismiss';
/** Ranking público de la Copa en vista pasajero (#public-copa-strip). */
const PUBLIC_STRIP_DISMISS_KEY = 'honduber_public_copa_strip_dismissed';

const DURATION_PRESETS = {
    /** Sin reloj: la competencia sigue hasta que se cumpla la meta (o staff cierre). */
    unlimited: { ms: 0, label: 'Sin límite — hasta que se cumpla', unlimited: true },
    '6h': { ms: 6 * 60 * 60 * 1000, label: '6 horas' },
    '1d': { ms: 24 * 60 * 60 * 1000, label: '1 día' },
    '3d': { ms: 3 * 24 * 60 * 60 * 1000, label: '3 días' },
    '7d': { ms: 7 * 24 * 60 * 60 * 1000, label: '1 semana' },
    '14d': { ms: 14 * 24 * 60 * 60 * 1000, label: '2 semanas' },
    '30d': { ms: 30 * 24 * 60 * 60 * 1000, label: '1 mes' },
    '60d': { ms: 60 * 24 * 60 * 60 * 1000, label: '2 meses' },
    '90d': { ms: 90 * 24 * 60 * 60 * 1000, label: '3 meses' }
};

/** Por defecto: sin reloj, hasta que se cumpla la meta. */
const DEFAULT_DURATION = 'unlimited';
const DEFAULT_GOAL_TRIPS = 1000;

/** Default economics (Honduras / HonduRaite) */
const DEFAULT_AVG_TRIP_FARE = 80;
const DEFAULT_MIN_MARGIN_PCT = 30;
const DEFAULT_EST_DRIVERS = 40;

const KIND_META = {
    copa: { label: 'Todos vs Todos', icon: 'fa-trophy', emoji: '🏆' },
    feriado: { label: 'Reto de la Nación', icon: 'fa-flag', emoji: '🇭🇳' },
    pico: { label: 'Pico del Día', icon: 'fa-bolt', emoji: '⚡' },
    calidad: { label: 'Buen Catracho', icon: 'fa-heart', emoji: '💚' },
    mega: { label: 'Meta de la Nación', icon: 'fa-mountain', emoji: '⛰️' }
};

/** ranking = todos vs todos (premios por puesto). tiers = metas personales. both = ambos. */
const COMPETE_MODES = {
    ranking: { label: 'Todos vs todos (ranking)', hint: 'Compiten todos. Premios al 1°, 2°, 3°…' },
    tiers: { label: 'Solo metas personales', hint: 'Cada quien cobra al llegar a Bronce/Plata/Oro' },
    both: { label: 'Ranking + metas personales', hint: 'Compiten por puesto y también por tiers' }
};

const DEFAULT_PODIUM = [
    { place: 1, label: '1er lugar', rewardAmountLps: 1500, reward: 'L. 1500 — Campeón' },
    { place: 2, label: '2do lugar', rewardAmountLps: 800, reward: 'L. 800 — Subcampeón' },
    { place: 3, label: '3er lugar', rewardAmountLps: 400, reward: 'L. 400 — Podio' }
];

const LAUNCH_PRESETS = {
    todos_vs_todos: {
        kind: 'copa',
        title: 'Copa HonduRaite — Todos vs Todos',
        description: 'Sin reloj: compiten todos hasta que alguien cumpla la meta de viajes. Ranking en vivo y público.',
        durationPreset: 'unlimited',
        goalTrips: 1000,
        competeMode: 'ranking',
        cityCupEnabled: false,
        qualityEnabled: false,
        minRatingToClaim: 0,
        publicRanking: true,
        minTripsToRank: 1,
        avgTripsPerDriver: 25,
        podiumPrizes: [
            { place: 1, label: '1er lugar', rewardAmountLps: 1500, reward: 'L. 1500 — Campeón nacional' },
            { place: 2, label: '2do lugar', rewardAmountLps: 800, reward: 'L. 800 — Subcampeón' },
            { place: 3, label: '3er lugar', rewardAmountLps: 400, reward: 'L. 400 — Podio de bronce' }
        ],
        tiers: []
    },
    copa_meta: {
        kind: 'copa',
        title: 'Copa nacional — Hasta que se cumpla',
        description: 'Todos vs todos sin tiempo límite. Cuando el líder llega a la meta, se cierra y se paga el podio.',
        durationPreset: 'unlimited',
        goalTrips: 500,
        competeMode: 'ranking',
        cityCupEnabled: false,
        qualityEnabled: true,
        minRatingToClaim: 4.5,
        publicRanking: true,
        minTripsToRank: 1,
        avgTripsPerDriver: 40,
        podiumPrizes: [
            { place: 1, label: '1er lugar', rewardAmountLps: 2000, reward: 'L. 2000' },
            { place: 2, label: '2do lugar', rewardAmountLps: 1000, reward: 'L. 1000' },
            { place: 3, label: '3er lugar', rewardAmountLps: 500, reward: 'L. 500' }
        ],
        tiers: []
    },
    meta_1000: {
        kind: 'mega',
        title: 'Carrera a 1000 — Todos vs Todos',
        description: 'Sin reloj. El primero en llegar a 1000 viajes dispara el cierre y fija el podio. Compiten todos.',
        durationPreset: 'unlimited',
        goalTrips: 1000,
        competeMode: 'ranking',
        cityCupEnabled: false,
        qualityEnabled: true,
        minRatingToClaim: 4.5,
        publicRanking: true,
        minTripsToRank: 1,
        avgTripsPerDriver: 200,
        podiumPrizes: [
            { place: 1, label: '1er lugar', rewardAmountLps: 5000, reward: 'L. 5000 — Leyenda' },
            { place: 2, label: '2do lugar', rewardAmountLps: 2500, reward: 'L. 2500' },
            { place: 3, label: '3er lugar', rewardAmountLps: 1200, reward: 'L. 1200' }
        ],
        tiers: []
    },
    pico_libre: {
        kind: 'pico',
        title: 'Pico libre — Hasta la meta',
        description: 'Todos vs todos sin reloj. Corre hasta que alguien cumpla la meta corta.',
        durationPreset: 'unlimited',
        goalTrips: 50,
        competeMode: 'ranking',
        cityCupEnabled: false,
        qualityEnabled: false,
        minRatingToClaim: 0,
        publicRanking: true,
        minTripsToRank: 1,
        avgTripsPerDriver: 15,
        podiumPrizes: [
            { place: 1, label: '1er lugar', rewardAmountLps: 500, reward: 'L. 500' },
            { place: 2, label: '2do lugar', rewardAmountLps: 250, reward: 'L. 250' },
            { place: 3, label: '3er lugar', rewardAmountLps: 100, reward: 'L. 100' }
        ],
        tiers: []
    },
    buen_catracho: {
        kind: 'calidad',
        title: 'El Buen Catracho — Ranking',
        description: 'Sin reloj. Compiten todos hasta la meta. Rating alto para calificar al podio.',
        durationPreset: 'unlimited',
        goalTrips: 200,
        competeMode: 'ranking',
        cityCupEnabled: false,
        qualityEnabled: true,
        minRatingToClaim: 4.8,
        publicRanking: true,
        minTripsToRank: 1,
        avgTripsPerDriver: 40,
        podiumPrizes: [
            { place: 1, label: '1er lugar', rewardAmountLps: 800, reward: 'L. 800' },
            { place: 2, label: '2do lugar', rewardAmountLps: 400, reward: 'L. 400' },
            { place: 3, label: '3er lugar', rewardAmountLps: 200, reward: 'L. 200' }
        ],
        tiers: []
    },
    independencia: {
        kind: 'feriado',
        title: 'Reto Independencia — Todos vs Todos',
        description: 'Sin reloj. Competencia nacional hasta que se cumpla la meta. Ranking abierto a todo el país.',
        durationPreset: 'unlimited',
        goalTrips: 300,
        competeMode: 'ranking',
        cityCupEnabled: false,
        qualityEnabled: true,
        minRatingToClaim: 4.5,
        publicRanking: true,
        minTripsToRank: 1,
        avgTripsPerDriver: 30,
        podiumPrizes: [
            { place: 1, label: '1er lugar', rewardAmountLps: 1200, reward: 'L. 1200' },
            { place: 2, label: '2do lugar', rewardAmountLps: 600, reward: 'L. 600' },
            { place: 3, label: '3er lugar', rewardAmountLps: 300, reward: 'L. 300' }
        ],
        tiers: []
    },
    /** Opcional: solo metas personales (no es la competencia principal) */
    metas_personales: {
        kind: 'copa',
        title: 'Metas personales (sin ranking de puestos)',
        description: 'Cada conductor avanza a su ritmo por Bronce/Plata/Oro. Sin reloj: hasta que se cumplan las metas o se cierre.',
        durationPreset: 'unlimited',
        goalTrips: 0,
        competeMode: 'tiers',
        cityCupEnabled: false,
        qualityEnabled: true,
        minRatingToClaim: 4.5,
        publicRanking: true,
        podiumPrizes: [],
        tiers: [
            { id: 'bronce', label: 'Bronce', targetTrips: 10, rewardAmountLps: 50, reward: 'L. 50 de bono', badge: 'Escudo Bronce' },
            { id: 'plata', label: 'Plata', targetTrips: 20, rewardAmountLps: 150, reward: 'L. 150 de bono', badge: 'Escudo Plata' },
            { id: 'oro', label: 'Oro', targetTrips: 35, rewardAmountLps: 350, reward: 'L. 350 + Hall de la Fama', badge: 'Escudo de Oro' }
        ]
    }
};

// ─── helpers ───────────────────────────────────────────────────────────────

function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function challengesCol() {
    return collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_global_challenges');
}

function challengeDocRef(id) {
    return doc(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_global_challenges', id);
}

function entryDocRef(challengeId, driverUid) {
    return doc(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_global_challenges', challengeId, 'entries', driverUid);
}

function entriesCol(challengeId) {
    return collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'driver_global_challenges', challengeId, 'entries');
}

/** Extrae monto en lempiras de texto tipo "L. 350 de bono" o "2000". */
function parseRewardAmountLps(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value * 100) / 100);
    const s = String(value || '').replace(/,/g, '');
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return fallback;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : fallback;
}

function formatLps(n) {
    const v = Number(n) || 0;
    return `L. ${v.toLocaleString('es-HN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getDefaultCommissionPercent() {
    const fromWindow = parseFloat(window.appCommissionPercent);
    if (Number.isFinite(fromWindow) && fromWindow > 0) return fromWindow;
    const cfg = parseFloat(APP_CONFIG?.commissionPercent);
    return Number.isFinite(cfg) && cfg > 0 ? cfg : 25;
}

function normalizeTiers(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map((t, i) => {
            const id = String(t.id || ['bronce', 'plata', 'oro'][i] || `tier_${i}`).toLowerCase();
            const targetTrips = Math.min(9999, Math.max(1, parseInt(t.targetTrips, 10) || 1));
            const rewardAmountLps = parseRewardAmountLps(
                t.rewardAmountLps != null ? t.rewardAmountLps : t.reward,
                0
            );
            const rewardText = String(t.reward || (rewardAmountLps > 0 ? `${formatLps(rewardAmountLps)} de bono` : '')).slice(0, 200);
            return {
                id,
                label: String(t.label || id).slice(0, 40),
                targetTrips,
                rewardAmountLps,
                reward: rewardText || formatLps(rewardAmountLps),
                badge: String(t.badge || t.label || id).slice(0, 60)
            };
        })
        .sort((a, b) => a.targetTrips - b.targetTrips);
}

function normalizePodium(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map((p, i) => {
            const place = Math.min(50, Math.max(1, parseInt(p.place, 10) || (i + 1)));
            const rewardAmountLps = parseRewardAmountLps(p.rewardAmountLps != null ? p.rewardAmountLps : p.reward, 0);
            return {
                place,
                label: String(p.label || `${place}° lugar`).slice(0, 40),
                rewardAmountLps,
                reward: String(p.reward || (rewardAmountLps > 0 ? formatLps(rewardAmountLps) : '')).slice(0, 200)
            };
        })
        .filter((p) => p.rewardAmountLps > 0)
        .sort((a, b) => a.place - b.place);
}

function getCompeteMode(ch) {
    const m = ch?.competeMode;
    if (m === 'ranking' || m === 'tiers' || m === 'both') return m;
    // legacy: if had tiers only
    if (Array.isArray(ch?.podiumPrizes) && ch.podiumPrizes.length) return 'ranking';
    if (Array.isArray(ch?.tiers) && ch.tiers.length) return 'tiers';
    return 'ranking';
}

function isRankingMode(ch) {
    const m = getCompeteMode(ch);
    return m === 'ranking' || m === 'both';
}

function isTiersMode(ch) {
    const m = getCompeteMode(ch);
    return m === 'tiers' || m === 'both';
}

/**
 * Rentabilidad:
 * - ranking (todos vs todos): bote fijo del podio vs comisión de la flota en el periodo
 * - tiers: premio por conductor que llega a meta (peor caso)
 */
function analyzeChallengeProfitability({
    tiers = [],
    podiumPrizes = [],
    competeMode = 'ranking',
    avgTripFare = DEFAULT_AVG_TRIP_FARE,
    commissionPercent = getDefaultCommissionPercent(),
    estimatedDrivers = DEFAULT_EST_DRIVERS,
    minMarginPercent = DEFAULT_MIN_MARGIN_PCT,
    avgTripsPerDriver = 25
}) {
    const normalized = normalizeTiers(tiers);
    const podium = normalizePodium(podiumPrizes);
    const fare = Math.max(1, parseFloat(avgTripFare) || DEFAULT_AVG_TRIP_FARE);
    const commPct = Math.min(100, Math.max(1, parseFloat(commissionPercent) || getDefaultCommissionPercent()));
    const drivers = Math.min(5000, Math.max(1, parseInt(estimatedDrivers, 10) || DEFAULT_EST_DRIVERS));
    const minMargin = Math.min(90, Math.max(0, parseFloat(minMarginPercent) || DEFAULT_MIN_MARGIN_PCT));
    const tripsPerDriver = Math.max(1, parseInt(avgTripsPerDriver, 10) || 25);
    const commissionPerTrip = fare * (commPct / 100);
    const mode = competeMode || 'ranking';

    let ok = true;
    const blockers = [];
    const tierRows = [];
    let totalRewardPerDriver = 0;
    let maxTrips = tripsPerDriver;
    let worstCasePayout = 0;
    let worstCaseCommission = drivers * tripsPerDriver * commissionPerTrip;
    let prizePool = 0;

    if (mode === 'ranking' || mode === 'both') {
        prizePool = podium.reduce((s, p) => s + (p.rewardAmountLps || 0), 0);
        worstCasePayout += prizePool; // fixed — only top places win

        if (!podium.length) {
            ok = false;
            blockers.push('Todos vs todos: definí premios del podio (1°, 2°, 3°…) en L.');
        }
        if (prizePool > 0 && worstCaseCommission > 0) {
            const rankingProfit = worstCaseCommission - prizePool;
            const rankingMargin = (rankingProfit / worstCaseCommission) * 100;
            if (rankingMargin < minMargin) {
                ok = false;
                blockers.push(
                    `Podio (bote fijo ${formatLps(prizePool)}): con ~${drivers} cond. × ${tripsPerDriver} viajes ` +
                    `la comisión est. es ${formatLps(worstCaseCommission)} → margen ${rankingMargin.toFixed(1)}% < ${minMargin}%. ` +
                    `Bajá el bote o subí viajes/conductores estimados.`
                );
            }
        }
    }

    if (mode === 'tiers' || mode === 'both') {
        let cumulativeReward = 0;
        normalized.forEach((t) => {
            cumulativeReward += t.rewardAmountLps || 0;
            const commissionEarned = t.targetTrips * commissionPerTrip;
            const unitProfit = commissionEarned - cumulativeReward;
            const unitMargin = commissionEarned > 0 ? (unitProfit / commissionEarned) * 100 : -100;
            const tierOk = t.rewardAmountLps > 0 && commissionEarned > 0 && unitProfit > 0 && unitMargin >= minMargin;
            if (!tierOk) {
                ok = false;
                if (t.rewardAmountLps <= 0) {
                    blockers.push(`${t.label}: poné premio en L.`);
                } else if (unitProfit <= 0) {
                    blockers.push(
                        `${t.label}: comisión est. ${formatLps(commissionEarned)} < premios acum. ${formatLps(cumulativeReward)}.`
                    );
                } else {
                    blockers.push(`${t.label}: margen ${unitMargin.toFixed(1)}% < ${minMargin}%.`);
                }
            }
            tierRows.push({
                id: t.id,
                label: t.label,
                targetTrips: t.targetTrips,
                rewardAmountLps: t.rewardAmountLps,
                cumulativeReward,
                commissionEarned,
                unitProfit,
                unitMargin,
                ok: tierOk
            });
        });
        totalRewardPerDriver = normalized.reduce((s, t) => s + (t.rewardAmountLps || 0), 0);
        maxTrips = Math.max(maxTrips, ...normalized.map((t) => t.targetTrips), 1);
        const tiersPayout = drivers * totalRewardPerDriver;
        const tiersCommission = drivers * maxTrips * commissionPerTrip;
        worstCasePayout += tiersPayout;
        // For both modes, commission uses the higher of ranking fleet estimate and tier max
        worstCaseCommission = Math.max(worstCaseCommission, tiersCommission);

        if (!normalized.length && mode === 'tiers') {
            ok = false;
            blockers.push('Modo metas: definí al menos un tier.');
        }
    }

    const fleetProfit = worstCaseCommission - worstCasePayout;
    const fleetMargin = worstCaseCommission > 0 ? (fleetProfit / worstCaseCommission) * 100 : -100;

    if (worstCaseCommission > 0 && fleetMargin < minMargin && ok) {
        // already blocked above for ranking; double-check combined
        ok = false;
        blockers.push(
            `Total: comisión est. ${formatLps(worstCaseCommission)} vs premios ${formatLps(worstCasePayout)} ` +
            `(margen ${fleetMargin.toFixed(1)}% < ${minMargin}%).`
        );
    }

    const modeLabel = mode === 'ranking'
        ? 'Todos vs todos'
        : mode === 'tiers'
            ? 'Metas personales'
            : 'Ranking + metas';

    return {
        ok,
        blockers,
        competeMode: mode,
        fare,
        commissionPercent: commPct,
        commissionPerTrip,
        estimatedDrivers: drivers,
        minMarginPercent: minMargin,
        avgTripsPerDriver: tripsPerDriver,
        maxTrips,
        totalRewardPerDriver,
        prizePool,
        worstCaseCommission,
        worstCasePayout,
        fleetProfit,
        fleetMargin,
        tierRows,
        podium,
        summary: ok
            ? `Rentable ✓ · ${modeLabel} · margen ~${fleetMargin.toFixed(0)}% · bote podio ${formatLps(prizePool)}`
            : `No rentable ✗ · no se puede publicar`
    };
}

function readEconomicsFromForm() {
    return {
        avgTripFare: parseFloat(document.getElementById('copa-avg-fare')?.value) || DEFAULT_AVG_TRIP_FARE,
        commissionPercent: parseFloat(document.getElementById('copa-commission')?.value) || getDefaultCommissionPercent(),
        estimatedDrivers: parseInt(document.getElementById('copa-est-drivers')?.value, 10) || DEFAULT_EST_DRIVERS,
        minMarginPercent: parseFloat(document.getElementById('copa-min-margin')?.value) || DEFAULT_MIN_MARGIN_PCT,
        avgTripsPerDriver: parseInt(document.getElementById('copa-avg-trips')?.value, 10) || 25
    };
}

function readCompeteModeFromForm() {
    return document.getElementById('copa-compete-mode')?.value || 'ranking';
}

function readPodiumFromForm() {
    return normalizePodium([1, 2, 3].map((place) => {
        const amount = parseFloat(document.getElementById(`copa-podium-${place}-amount`)?.value);
        const note = document.getElementById(`copa-podium-${place}-label`)?.value?.trim() || '';
        return {
            place,
            label: note || `${place}° lugar`,
            rewardAmountLps: Number.isFinite(amount) ? amount : 0,
            reward: note || (Number.isFinite(amount) ? formatLps(amount) : '')
        };
    }));
}

function readTiersFromForm() {
    const mode = readCompeteModeFromForm();
    if (mode === 'ranking') return [];
    return normalizeTiers(['bronce', 'plata', 'oro'].map((id) => {
        const trips = parseInt(document.getElementById(`copa-tier-${id}-trips`)?.value, 10) || 0;
        const amount = parseFloat(document.getElementById(`copa-tier-${id}-amount`)?.value);
        const note = document.getElementById(`copa-tier-${id}-reward`)?.value?.trim() || '';
        const rewardAmountLps = Number.isFinite(amount) ? amount : parseRewardAmountLps(note, 0);
        const label = id === 'bronce' ? 'Bronce' : id === 'plata' ? 'Plata' : 'Oro';
        return {
            id,
            label,
            targetTrips: trips || 1,
            rewardAmountLps,
            reward: note || (rewardAmountLps > 0 ? `${formatLps(rewardAmountLps)} de bono` : ''),
            badge: id === 'bronce' ? 'Escudo Bronce' : id === 'plata' ? 'Escudo Plata' : 'Escudo de Oro'
        };
    })).filter((t) => t.rewardAmountLps > 0 || t.targetTrips > 1);
}

function syncCopaFormModeUI() {
    const mode = readCompeteModeFromForm();
    const podiumBlock = document.getElementById('copa-podium-block');
    const tiersBlock = document.getElementById('copa-tiers-block');
    if (podiumBlock) podiumBlock.style.display = (mode === 'ranking' || mode === 'both') ? '' : 'none';
    if (tiersBlock) tiersBlock.style.display = (mode === 'tiers' || mode === 'both') ? '' : 'none';
    window.refreshCopaProfitability?.();
}

function renderProfitabilityPanel(analysis) {
    if (!analysis) return '';
    const cls = analysis.ok ? 'copa-profit copa-profit--ok' : 'copa-profit copa-profit--bad';
    const podium = analysis.podium || [];
    const podiumHtml = podium.length
        ? `<p class="copa-profit-sub"><b>Bote podio (fijo):</b> ${podium.map((p) => `${p.place}° ${formatLps(p.rewardAmountLps)}`).join(' · ')} = <b>${formatLps(analysis.prizePool || 0)}</b></p>`
        : '';

    const rows = (analysis.tierRows || []).map((r) => `
        <tr class="${r.ok ? '' : 'copa-profit-row--bad'}">
            <td>${escHtml(r.label)}</td>
            <td>${r.targetTrips}</td>
            <td>${formatLps(r.rewardAmountLps)}</td>
            <td>${formatLps(r.commissionEarned)}</td>
            <td>${formatLps(r.unitProfit)}</td>
            <td>${r.unitMargin.toFixed(0)}%</td>
        </tr>
    `).join('');

    const table = rows
        ? `<div class="copa-profit-table-wrap">
                <table class="copa-profit-table">
                    <thead>
                        <tr>
                            <th>Tier</th><th>Viajes</th><th>Premio</th><th>Comisión est.</th><th>Utilidad</th><th>Margen</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`
        : '';

    return `
        <div id="copa-profit-panel" class="${cls}">
            <p class="copa-profit-title">
                <i class="fas ${analysis.ok ? 'fa-check-circle' : 'fa-ban'}"></i>
                ${escHtml(analysis.summary)}
            </p>
            <p class="copa-profit-sub">
                Tarifa prom. ${formatLps(analysis.fare)} · Comisión ${analysis.commissionPercent}%
                (${formatLps(analysis.commissionPerTrip)}/viaje) · ${analysis.estimatedDrivers} cond.
                × ~${analysis.avgTripsPerDriver || 25} viajes · margen mín. ${analysis.minMarginPercent}%
            </p>
            ${podiumHtml}
            ${table}
            <p class="copa-profit-fleet">
                Estimado: comisión ${formatLps(analysis.worstCaseCommission)}
                − premios ${formatLps(analysis.worstCasePayout)}
                = <b>${formatLps(analysis.fleetProfit)}</b>
                (${analysis.fleetMargin.toFixed(0)}% margen)
            </p>
            ${analysis.blockers.length
                ? `<ul class="copa-profit-blockers">${analysis.blockers.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>`
                : '<p class="copa-profit-ok-msg">Podés publicar: el reto deja margen suficiente a la empresa.</p>'}
        </div>
    `;
}

/** Rank cache for live competition UI */
const rankCache = {}; // challengeId -> { rank, total, leaderName, leaderProgress, entriesTop }

function computeRankFromEntries(entries, driverUid, minTrips = 0) {
    const sorted = [...entries].sort((a, b) => {
        const pb = (b.points || b.progress || 0) - (a.points || a.progress || 0);
        if (pb !== 0) return pb;
        return String(a.driverUid || a.id).localeCompare(String(b.driverUid || b.id));
    });
    const min = Math.max(0, parseInt(minTrips, 10) || 0);
    const qualified = sorted.filter((e) => (parseInt(e.progress, 10) || 0) >= min);
    const list = min > 0 ? qualified : sorted;
    const idx = list.findIndex((e) => e.driverUid === driverUid || e.id === driverUid);
    const me = sorted.find((e) => e.driverUid === driverUid || e.id === driverUid);
    const leader = sorted[0];
    return {
        rank: idx >= 0 ? idx + 1 : null,
        total: list.length || sorted.length,
        totalAll: sorted.length,
        myProgress: parseInt(me?.progress, 10) || 0,
        leaderName: leader?.driverName || '—',
        leaderProgress: parseInt(leader?.progress, 10) || 0,
        gapToLeader: leader && me
            ? Math.max(0, (parseInt(leader.progress, 10) || 0) - (parseInt(me.progress, 10) || 0))
            : null,
        top: sorted.slice(0, 10)
    };
}

async function refreshRankForChallenge(challengeId, driverUid, minTrips = 0) {
    if (!challengeId || !driverUid) return null;
    try {
        const entries = await loadEntriesForChallenge(challengeId, 150);
        const info = computeRankFromEntries(entries, driverUid, minTrips);
        rankCache[challengeId] = { ...info, at: Date.now() };
        return rankCache[challengeId];
    } catch (e) {
        console.warn('refreshRankForChallenge:', e);
        return rankCache[challengeId] || null;
    }
}

function isUnlimitedDuration(ch) {
    if (!ch) return false;
    if (ch.noTimeLimit === true || ch.unlimited === true) return true;
    if (ch.durationPreset === 'unlimited') return true;
    const preset = DURATION_PRESETS[ch.durationPreset];
    if (preset?.unlimited) return true;
    // Sin expires y sin durationMs → se trata como sin reloj
    if (!ch.expiresAt && !ch.expiresAtMs && !(ch.durationMs > 0)) return true;
    return false;
}

function getGoalTrips(ch) {
    const n = parseInt(ch?.goalTrips, 10);
    if (Number.isFinite(n) && n > 0) return Math.min(9999, n);
    return 0;
}

function getExpiresAtMs(ch) {
    if (!ch || isUnlimitedDuration(ch)) return null;
    if (typeof ch.expiresAtMs === 'number' && ch.expiresAtMs > 0) return ch.expiresAtMs;
    const exp = ch.expiresAt;
    if (exp) {
        if (typeof exp.toDate === 'function') return exp.toDate().getTime();
        if (exp.seconds) return exp.seconds * 1000;
    }
    return null;
}

function isChallengeActive(ch) {
    if (!ch || ch.status !== 'active') return false;
    if (!isUnlimitedDuration(ch)) {
        const exp = getExpiresAtMs(ch);
        if (exp && Date.now() >= exp) return false;
    }
    const start = typeof ch.startsAtMs === 'number' ? ch.startsAtMs : 0;
    if (start && Date.now() < start) return false;
    return true;
}

function formatTimeRemaining(ch) {
    const goal = getGoalTrips(ch);
    if (isUnlimitedDuration(ch)) {
        return goal > 0
            ? `Sin reloj · hasta ${goal} viajes`
            : 'Sin reloj · hasta que se cumpla';
    }
    const expMs = getExpiresAtMs(ch);
    if (!expMs) {
        return goal > 0 ? `Hasta ${goal} viajes` : 'En curso';
    }
    const diff = expMs - Date.now();
    if (diff <= 0) return 'Tiempo agotado';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min restante${mins === 1 ? '' : 's'}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h restante${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    const timeTxt = `${days} día${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}`;
    return goal > 0 ? `${timeTxt} · meta ${goal}` : timeTxt;
}

function formatGoalProgressLine(ch, leaderProgress = 0) {
    const goal = getGoalTrips(ch);
    if (!goal) return isUnlimitedDuration(ch) ? 'Abierta hasta que se cumpla / cierre staff' : '';
    const left = Math.max(0, goal - (parseInt(leaderProgress, 10) || 0));
    if (left <= 0) return `Meta ${goal} alcanzada — cerrando podio`;
    return `Meta: ${goal} viajes · al líder le faltan ${left}`;
}

function formatChallengeDate(ts) {
    if (!ts) return '—';
    let d = null;
    if (typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else if (typeof ts === 'number') d = new Date(ts);
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' });
}

function resolveCityFromProfile(profile, trip) {
    const cityId = trip?.serviceZoneId
        || profile?.serviceZoneId
        || profile?.cityId
        || window.activeServiceZoneId
        || 'sin-ciudad';
    const cityName = trip?.serviceZoneName
        || profile?.serviceZoneName
        || profile?.cityName
        || (typeof window.getZoneById === 'function' ? window.getZoneById(cityId)?.name : null)
        || cityId;
    return { cityId: String(cityId), cityName: String(cityName || cityId) };
}

function highestTierReached(tiers, progress) {
    let best = null;
    for (const t of tiers) {
        if (progress >= t.targetTrips) best = t;
    }
    return best;
}

function nextTier(tiers, progress) {
    return tiers.find((t) => progress < t.targetTrips) || null;
}

function tierClaimKey(entry, tierId) {
    const map = entry?.tiersClaimed || {};
    return !!map[tierId];
}

function tierPaidKey(entry, tierId) {
    const map = entry?.rewardPaidTiers || {};
    return !!map[tierId];
}

function avgRating(entry) {
    const n = parseInt(entry?.ratingCount, 10) || 0;
    const sum = parseFloat(entry?.ratingSum) || 0;
    if (n <= 0) return null;
    return Math.round((sum / n) * 10) / 10;
}

function qualityBlocksClaim(ch, entry) {
    if (!ch?.qualityEnabled) return false;
    const min = parseFloat(ch.minRatingToClaim) || 0;
    if (min <= 0) return false;
    const n = parseInt(entry?.ratingCount, 10) || 0;
    if (n < 1) return false; // sin ratings aún: no bloquear
    const avg = avgRating(entry);
    return avg != null && avg < min;
}

function isMinimized(challengeId) {
    try {
        return localStorage.getItem(`${MINIMIZED_KEY}_${challengeId}`) === '1';
    } catch (_) {
        return false;
    }
}

function setMinimized(challengeId, minimized) {
    try {
        if (minimized) localStorage.setItem(`${MINIMIZED_KEY}_${challengeId}`, '1');
        else localStorage.removeItem(`${MINIMIZED_KEY}_${challengeId}`);
    } catch (_) {}
}

function isStripDismissedThisSession() {
    try {
        return sessionStorage.getItem(STRIP_DISMISS_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function setStripDismissedThisSession(dismissed) {
    try {
        if (dismissed) sessionStorage.setItem(STRIP_DISMISS_KEY, '1');
        else sessionStorage.removeItem(STRIP_DISMISS_KEY);
    } catch (_) {}
}

function isDismissed(challengeId) {
    try {
        return sessionStorage.getItem(`${DISMISSED_KEY}_${challengeId}`) === '1';
    } catch (_) {
        return false;
    }
}

function setDismissed(challengeId, dismissed) {
    try {
        if (dismissed) sessionStorage.setItem(`${DISMISSED_KEY}_${challengeId}`, '1');
        else sessionStorage.removeItem(`${DISMISSED_KEY}_${challengeId}`);
        // Limpiar legado localStorage (persistía entre sesiones)
        localStorage.removeItem(`${DISMISSED_KEY}_${challengeId}`);
    } catch (_) {}
}

function isPublicCopaStripDismissedThisSession() {
    try {
        return sessionStorage.getItem(PUBLIC_STRIP_DISMISS_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function setPublicCopaStripDismissedThisSession(dismissed) {
    try {
        if (dismissed) sessionStorage.setItem(PUBLIC_STRIP_DISMISS_KEY, '1');
        else sessionStorage.removeItem(PUBLIC_STRIP_DISMISS_KEY);
    } catch (_) {}
}

function dismissPublicCopaStripOnScreen() {
    const already = isPublicCopaStripDismissedThisSession();
    setPublicCopaStripDismissedThisSession(true);
    const el = document.getElementById('public-copa-strip');
    if (el) {
        el.classList.add('hidden');
        el.innerHTML = '';
    }
    if (!already) {
        window.showToast?.('Ranking oculto. Volverá al iniciar sesión de nuevo.', 'info');
    }
}

/** Al iniciar sesión: la ✕ se olvida y la Copa vuelve a mostrarse (igual que promos pasajeros). */
function resetCopaSessionDismiss() {
    try {
        sessionStorage.removeItem(STRIP_DISMISS_KEY);
        sessionStorage.removeItem(PUBLIC_STRIP_DISMISS_KEY);
        const toRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(`${DISMISSED_KEY}_`)) toRemove.push(k);
        }
        toRemove.forEach((k) => sessionStorage.removeItem(k));
        // legado
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(`${DISMISSED_KEY}_`)) localStorage.removeItem(k);
        }
    } catch (_) {}
}

function restoreCopaOnScreen(challengeId) {
    setStripDismissedThisSession(false);
    if (challengeId) {
        setDismissed(challengeId, false);
        setMinimized(challengeId, false);
    }
}

/** Quita cualquier rastro viejo de copa dentro del panel central */
function purgeDriverCopaFromPanel() {
    try {
        document.getElementById('driver-copa-strip')?.remove();
        document.querySelectorAll('#control-panel .copa-chip, #control-panel .copa-strip-bar, #driver-view .copa-chip, #driver-view .copa-strip-bar').forEach((el) => {
            el.remove();
        });
        document.getElementById('driver-copa-dismiss-fab')?.remove();
    } catch (_) {}
}

/**
 * Strip en el mapa — clon de promos pasajero:
 * [grip arrastrable] [chips copa] [✕]
 * Nunca en el panel central.
 */
function ensureDriverCopaBadge() {
    purgeDriverCopaFromPanel();

    // Preferir body (como promos) para que fixed funcione bien en web
    const host = document.body;
    let el = document.getElementById('driver-copa-map-strip');

    if (el && el.parentElement !== host) {
        host.appendChild(el);
    }

    if (!el) {
        el = document.createElement('div');
        el.id = 'driver-copa-map-strip';
        el.setAttribute('aria-label', 'Copa Conductores');
        host.appendChild(el);
    }

    // Misma estructura que #passenger-promo-strip
    el.className = 'passenger-promo-strip driver-copa-promo-strip';
    if (!el.querySelector('[data-copa-close]')) {
        el.innerHTML = `
            <button type="button" class="passenger-promo-drag-handle" data-copa-map-drag-handle
                    title="Arrastra para mover" aria-label="Mover copa">
                <i class="fas fa-grip-vertical pointer-events-none"></i>
            </button>
            <div class="passenger-promo-track" data-copa-track data-no-drag></div>
            <button type="button" class="passenger-promo-close" data-copa-close data-no-drag
                    title="Ocultar copa" aria-label="Ocultar copa">
                <i class="fas fa-times pointer-events-none"></i>
            </button>
        `;
        // HTML nuevo: permitir re-bind de arrastre (initFloatingPanels pudo correr antes)
        el.dataset.copaMapDragBound = '';
    }

    bindDriverCopaCloseButton(el);
    window.bindFloatingDriverCopaMapStrip?.();

    return el;
}

/**
 * Cierre ✕ del strip: un solo camino de acción.
 * pointerup (móvil) + click (teclado/accesibilidad); dismiss es idempotente
 * para no mostrar dos toasts si ambos eventos disparan.
 */
function bindDriverCopaCloseButton(strip) {
    const closeBtn = strip?.querySelector?.('[data-copa-close]');
    if (!closeBtn || closeBtn.dataset.copaCloseBound === '1') return;
    closeBtn.dataset.copaCloseBound = '1';

    const onClose = (e) => {
        if (e.type === 'pointerup' && e.pointerType === 'mouse' && e.button !== 0) return;
        // Si el pointerup ya cerró, el click posterior no debe re-disparar lógica extra
        e.preventDefault();
        e.stopPropagation();
        try { e.stopImmediatePropagation?.(); } catch (_) {}
        dismissAllDriverCopaOnScreen();
    };

    closeBtn.addEventListener('pointerup', onClose, { capture: true });
    closeBtn.addEventListener('click', onClose);
}

function setDriverCopaBadgeVisible(el, show) {
    if (!el) return;
    if (show) {
        el.classList.remove('hidden');
        el.style.setProperty('display', 'flex', 'important');
        el.style.visibility = 'visible';
        el.style.pointerEvents = 'auto';
        el.setAttribute('aria-hidden', 'false');
    } else {
        el.classList.add('hidden');
        el.style.setProperty('display', 'none', 'important');
        el.style.visibility = 'hidden';
        el.setAttribute('aria-hidden', 'true');
    }
}

function dismissAllDriverCopaOnScreen() {
    // Idempotente: click + pointerup (o doble tap) no deben spamear toast
    const alreadyHidden = isStripDismissedThisSession();
    setStripDismissedThisSession(true);
    cachedChallenges.forEach((c) => setDismissed(c.id, true));
    const el = document.getElementById('driver-copa-map-strip');
    if (el) {
        el.classList.add('hidden');
        setDriverCopaBadgeVisible(el, false);
    }
    purgeDriverCopaFromPanel();
    document.getElementById('driver-copa-active')?.classList.add('hidden');
    const layer = document.getElementById('driver-copa-active');
    if (layer) layer.innerHTML = '';
    if (!alreadyHidden) {
        window.showToast?.('Oculto por ahora. Volverá a salir al iniciar sesión de nuevo.', 'info');
    }
}

// Disponible apenas carga el módulo
if (typeof window !== 'undefined') {
    window.dismissAllDriverCopa = () => dismissAllDriverCopaOnScreen();
    window.dismissCopaFloat = () => dismissAllDriverCopaOnScreen();
}

function floatActionsHtml(challengeId, { minimized = false } = {}) {
    return `
        <div class="copa-float-actions" data-no-drag>
            ${minimized ? '' : `
            <button type="button" class="copa-min-btn" data-no-drag
                onclick="event.stopPropagation(); window.toggleCopaMinimized('${challengeId}', true)" title="Minimizar" aria-label="Minimizar">
                <i class="fas fa-minus"></i>
            </button>`}
            <button type="button" class="copa-close-btn" data-no-drag
                onclick="event.stopPropagation(); window.dismissAllDriverCopa?.()" title="Ocultar" aria-label="Ocultar copa">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
}

// ─── cache ─────────────────────────────────────────────────────────────────

let cachedChallenges = [];
const cachedEntries = {}; // challengeId -> entry

function refreshDriverCopaUI() {
    const user = getCurrentUser();
    purgeDriverCopaFromPanel();

    if (!user || window.userProfile?.role !== 'driver') {
        document.getElementById('driver-copa-active')?.classList.add('hidden');
        const badge = document.getElementById('driver-copa-map-strip');
        if (badge) badge.classList.add('hidden');
        return;
    }
    // En viaje activo: no tapar mapa / navegación
    if (document.body.classList.contains('trip-active')) {
        document.getElementById('driver-copa-active')?.classList.add('hidden');
        const activeLayer = document.getElementById('driver-copa-active');
        if (activeLayer) activeLayer.innerHTML = '';
        const badge = document.getElementById('driver-copa-map-strip');
        if (badge) {
            badge.classList.add('hidden');
            setDriverCopaBadgeVisible(badge, false);
        }
        return;
    }
    // ✕ de esta sesión: ocultar todo hasta re-login o menú Copa
    if (isStripDismissedThisSession()) {
        document.getElementById('driver-copa-active')?.classList.add('hidden');
        const activeLayer = document.getElementById('driver-copa-active');
        if (activeLayer) activeLayer.innerHTML = '';
        const badge = document.getElementById('driver-copa-map-strip');
        if (badge) badge.classList.add('hidden');
        return;
    }
    const active = cachedChallenges.filter((c) =>
        isChallengeActive(c)
        || (c.status === 'closed' && isRankingMode(c) && (
            cachedEntries[c.id]?.podiumEligible
            || cachedEntries[c.id]?.finalRank
            || (Array.isArray(c.finalPodium) && c.finalPodium.some((w) => w.driverUid === user.uid))
        ))
    );
    const onScreen = active.filter((c) => !isDismissed(c.id));
    // Sin tarjetones flotantes ni panel: solo badge en el mapa
    renderDriverCopaPanels(onScreen);
    const stripList = (active.filter(isChallengeActive).length ? active.filter(isChallengeActive) : active)
        .filter((c) => !isDismissed(c.id));
    renderDriverCopaStrip(stripList);
}

// ─── Firestore ops ─────────────────────────────────────────────────────────

async function ensureEntry(challengeId, driverUid, profile, trip = null) {
    const ref = entryDocRef(challengeId, driverUid);
    try {
        const snap = await getDoc(ref);
        if (snap.exists()) return { id: snap.id, ...snap.data() };
    } catch (e) {
        console.warn('ensureEntry read:', e);
        // seguir e intentar crear; si también falla devolvemos stub local
    }

    // Solo conductores aprobados entran al ranking
    if (!canCompeteInDriverCopa(profile)) {
        const { cityId, cityName } = resolveCityFromProfile(profile, trip);
        return {
            id: driverUid,
            driverUid,
            driverName: profile?.name || 'Conductor',
            cityId,
            cityName,
            progress: 0,
            points: 0,
            countedTripIds: [],
            tiersClaimed: {},
            rewardPaidTiers: {},
            ratingSum: 0,
            ratingCount: 0,
            _localOnly: true,
            _needsVerification: true
        };
    }

    const { cityId, cityName } = resolveCityFromProfile(profile, trip);
    const data = {
        driverUid,
        driverName: profile?.name || 'Conductor',
        cityId,
        cityName,
        progress: 0,
        points: 0,
        countedTripIds: [],
        tiersClaimed: {},
        rewardPaidTiers: {},
        ratingSum: 0,
        ratingCount: 0,
        identityVerified: true,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    try {
        await setDoc(ref, data);
        return { id: driverUid, ...data };
    } catch (e) {
        console.warn('ensureEntry write:', e);
        // Stub local para no romper el UI si faltan rules desplegadas
        return { id: driverUid, ...data, _localOnly: true };
    }
}

async function loadEntriesForChallenge(challengeId, max = 120) {
    const list = [];
    try {
        const snap = await getDocs(query(entriesCol(challengeId), orderBy('points', 'desc'), limit(max)));
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    } catch (e1) {
        console.warn('loadEntries orderBy points:', e1?.code || e1);
        try {
            const snap2 = await getDocs(query(entriesCol(challengeId), limit(max)));
            snap2.forEach((d) => list.push({ id: d.id, ...d.data() }));
        } catch (e2) {
            console.warn('loadEntries plain:', e2?.code || e2);
            // Último intento: collection group no; devolver vacío y dejar que el modal muestre aviso
            const err = e2 || e1;
            err._copaEntriesDenied = true;
            throw err;
        }
    }
    list.sort((a, b) => (b.points || b.progress || 0) - (a.points || a.progress || 0));
    return list;
}

function buildCityCup(entries) {
    const map = {};
    entries.forEach((e) => {
        const id = e.cityId || 'sin-ciudad';
        if (!map[id]) {
            map[id] = {
                cityId: id,
                cityName: e.cityName || id,
                trips: 0,
                drivers: 0
            };
        }
        map[id].trips += parseInt(e.progress, 10) || 0;
        map[id].drivers += 1;
    });
    return Object.values(map).sort((a, b) => b.trips - a.trips);
}

// ─── Driver UI ─────────────────────────────────────────────────────────────

function renderTierPills(tiers, progress, entry) {
    return tiers.map((t) => {
        const reached = progress >= t.targetTrips;
        const claimed = tierClaimKey(entry, t.id);
        const paid = tierPaidKey(entry, t.id);
        let cls = 'copa-tier-pill';
        if (paid) cls += ' copa-tier-pill--paid';
        else if (claimed) cls += ' copa-tier-pill--claimed';
        else if (reached) cls += ' copa-tier-pill--ready';
        else cls += ' copa-tier-pill--locked';
        return `<span class="${cls}" title="${escHtml(t.reward)}">${escHtml(t.label)} ${t.targetTrips}</span>`;
    }).join('');
}

function renderProgressBar(progress, target) {
    const pct = Math.min(100, Math.round((progress / Math.max(1, target)) * 100));
    return `
        <div class="copa-progress">
            <div class="copa-progress-head">
                <span>Viajes en la Copa</span>
                <span>${progress}/${target}</span>
            </div>
            <div class="copa-progress-track">
                <div class="copa-progress-fill" style="width:${pct}%"></div>
            </div>
        </div>
    `;
}

function buildDriverCopaChipHtml(ch, verified) {
    const entry = cachedEntries[ch.id] || { progress: 0 };
    const progress = parseInt(entry.progress, 10) || 0;
    const rk = rankCache[ch.id];
    const ranking = isRankingMode(ch);
    let meta;
    if (!verified) {
        meta = `Solo aprobados · ${formatTimeRemaining(ch)}`;
    } else if (ranking && rk?.rank) {
        meta = `#${rk.rank} de ${rk.total} · ${progress} viajes · ${formatTimeRemaining(ch)}`;
    } else if (ranking) {
        meta = `Todos vs todos · ${progress} viajes · ${formatTimeRemaining(ch)}`;
    } else {
        const tiers = normalizeTiers(ch.tiers);
        const next = nextTier(tiers, progress);
        const target = next?.targetTrips || tiers[tiers.length - 1]?.targetTrips || 1;
        meta = `${progress}/${target} · ${formatTimeRemaining(ch)}`;
    }
    const rankShort = !verified
        ? 'ID'
        : ranking && rk?.rank
            ? `#${rk.rank}`
            : 'LIVE';
    const rankCls = !verified
        ? 'copa-chip-rank copa-chip-rank--live'
        : ranking && rk?.rank
            ? 'copa-chip-rank'
            : 'copa-chip-rank copa-chip-rank--live';
    const shortTitle = String(ch.title || 'Copa').slice(0, 22);
    return `
        <button type="button" class="copa-chip" onclick="window.openDriverCopaModal('${ch.id}')" title="${escHtml(ch.title)} · ${escHtml(meta)}">
            <span class="copa-chip-pulse" aria-hidden="true"></span>
            <span class="copa-chip-ico" aria-hidden="true"><i class="fas fa-trophy"></i></span>
            <span class="copa-chip-body">
                <span class="copa-chip-label">${escHtml(shortTitle)}</span>
                <span class="${rankCls}">${escHtml(rankShort)}</span>
                <span class="copa-chip-sep" aria-hidden="true">·</span>
                <span class="copa-chip-meta">${verified ? `${progress} viajes` : 'Aprobación'}</span>
            </span>
        </button>`;
}

function renderDriverCopaStrip(challenges) {
    purgeDriverCopaFromPanel();

    if (!challenges.length) {
        const existing = document.getElementById('driver-copa-map-strip');
        if (existing) setDriverCopaBadgeVisible(existing, false);
        return;
    }

    const strip = ensureDriverCopaBadge();
    const verified = canCompeteInDriverCopa(getDriverProfile() || window.userProfile);
    const track = strip.querySelector('[data-copa-track], .passenger-promo-track');
    const chips = challenges.map((ch) => buildDriverCopaChipHtml(ch, verified)).join('');
    if (track) track.innerHTML = chips;

    strip.dataset.activeChallengeId = challenges[0]?.id || '';
    setDriverCopaBadgeVisible(strip, true);
    // Re-asegurar drag (por si el strip se creó antes de initFloatingPanels)
    window.bindFloatingDriverCopaMapStrip?.();
}

function renderActiveCopaWidget(ch, entry) {
    const tiers = normalizeTiers(ch.tiers);
    const progress = parseInt(entry?.progress, 10) || 0;
    const ranking = isRankingMode(ch);
    const tiersOn = isTiersMode(ch);
    const next = nextTier(tiers, progress);
    const best = highestTierReached(tiers, progress);
    const target = next?.targetTrips || best?.targetTrips || tiers[0]?.targetTrips || Math.max(progress + 5, 10);
    const kind = KIND_META[ch.kind] || KIND_META.copa;
    const minimized = isMinimized(ch.id);
    const rk = rankCache[ch.id];
    const podium = normalizePodium(ch.podiumPrizes);
    const profile = getDriverProfile() || window.userProfile;
    const verified = canCompeteInDriverCopa(profile);
    const needsVerify = !verified || entry?._needsVerification === true;

    if (minimized) {
        const pill = needsVerify
            ? 'Aprobación'
            : ranking && rk?.rank
                ? `#${rk.rank} · ${progress}`
                : `${progress}${tiersOn && target ? `/${target}` : ''}`;
        return `
            <div class="copa-float copa-float--min" data-copa-id="${ch.id}" data-copa-expand="1" title="${escHtml(ch.title)} · Toca para ver">
                <div class="copa-min-row">
                    <div class="copa-min-pill" role="presentation">
                        <span class="copa-chip-pulse" aria-hidden="true" style="margin-right:0.15rem"></span>
                        <i class="fas fa-trophy" style="color:#b45309;font-size:0.65rem"></i>
                        <span>${escHtml(String(ch.title || 'Copa').slice(0, 14))}</span>
                        <span class="copa-min-pill-stat">${escHtml(pill)}</span>
                    </div>
                    <button type="button" class="copa-close-btn copa-close-btn--lg" data-no-drag
                        onclick="event.stopPropagation(); window.dismissAllDriverCopa?.()" title="Ocultar" aria-label="Ocultar copa">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    }

    if (needsVerify) {
        const podiumLine = podium.length
            ? `<p class="copa-podium-line">Premios: ${podium.map((p) => `${p.place}° ${formatLps(p.rewardAmountLps)}`).join(' · ')}</p>`
            : '';
        return `
            <div class="copa-float" data-copa-id="${ch.id}">
                <div class="copa-float-head">
                    <p class="copa-float-kicker"><i class="fas ${kind.icon}"></i> Solo aprobados</p>
                    ${floatActionsHtml(ch.id)}
                </div>
                <p class="copa-float-title">${escHtml(ch.title)}</p>
                <p class="copa-float-time"><i class="fas fa-clock"></i> ${escHtml(formatTimeRemaining(ch))}</p>
                <p class="copa-compete-tag"><i class="fas fa-users"></i> Competencia nacional · solo conductores aprobados</p>
                ${podiumLine}
                ${driverVerifyCtaBannerHtml()}
                <button type="button" class="copa-open-btn" data-no-drag onclick="window.openDriverCopaModal('${ch.id}')">
                    Ver ranking público
                </button>
            </div>
        `;
    }

    let rankHtml = '';
    if (ranking) {
        const placeLine = rk?.rank
            ? `<p class="copa-rank-big">Vas <b>#${rk.rank}</b> de ${rk.total}</p>`
            : `<p class="copa-rank-big">Todos vs todos · sumá viajes</p>`;
        const gap = rk?.gapToLeader > 0
            ? `<p class="copa-float-time">Te faltan <b>${rk.gapToLeader}</b> viajes para alcanzar a ${escHtml(rk.leaderName)}</p>`
            : rk?.rank === 1
                ? `<p class="copa-status copa-status--paid"><i class="fas fa-crown"></i> ¡Vas primero! Defendé tu puesto</p>`
                : '';
        const podiumLine = podium.length
            ? `<p class="copa-podium-line">Premios: ${podium.map((p) => `${p.place}° ${formatLps(p.rewardAmountLps)}`).join(' · ')}</p>`
            : '';
        const goalLine = formatGoalProgressLine(ch, Math.max(progress, rk?.leaderProgress || 0));
        rankHtml = `
            <p class="copa-compete-tag"><i class="fas fa-users"></i> Competencia nacional · todos vs todos</p>
            ${placeLine}
            <p class="copa-float-time"><i class="fas fa-route"></i> Tus viajes: <b>${progress}</b>${rk?.leaderProgress != null ? ` · Líder: ${rk.leaderProgress}` : ''}</p>
            ${goalLine ? `<p class="copa-float-time"><i class="fas fa-flag-checkered"></i> ${escHtml(goalLine)}</p>` : ''}
            ${gap}
            ${podiumLine}
        `;
    }

    let claimHtml = '';
    if (tiersOn) {
        const readyTiers = tiers.filter((t) => progress >= t.targetTrips && !tierClaimKey(entry, t.id));
        if (readyTiers.length) {
            const blocked = qualityBlocksClaim(ch, entry);
            if (blocked) {
                claimHtml = `<p class="copa-status copa-status--warn"><i class="fas fa-star"></i> Rating mínimo ${ch.minRatingToClaim} para reclamar (tu avg: ${avgRating(entry) ?? '—'})</p>`;
            } else {
                const t = readyTiers[readyTiers.length - 1];
                claimHtml = `
                    <button type="button" class="copa-claim-btn" data-no-drag
                        onclick="window.claimCopaTier('${ch.id}', '${t.id}')">
                        <i class="fas fa-gift"></i> Reclamar ${escHtml(t.label)} — ${escHtml(t.reward)}
                    </button>
                `;
            }
        } else if (best && tierClaimKey(entry, best.id) && !tierPaidKey(entry, best.id)) {
            claimHtml = `<p class="copa-status copa-status--wait"><i class="fas fa-hourglass-half"></i> Premio de meta reclamado — esperando pago</p>`;
        }
    }

    if (ranking && !isChallengeActive(ch) && rk?.rank && podium.some((p) => p.place === rk.rank)) {
        const prize = podium.find((p) => p.place === rk.rank);
        if (entry?.podiumClaimed) {
            claimHtml += entry?.podiumPaid
                ? `<p class="copa-status copa-status--paid"><i class="fas fa-check-circle"></i> Premio de puesto pagado</p>`
                : `<p class="copa-status copa-status--wait"><i class="fas fa-hourglass-half"></i> Podio reclamado — esperando pago</p>`;
        } else if (prize) {
            claimHtml += `
                <button type="button" class="copa-claim-btn" data-no-drag
                    onclick="window.claimCopaPodium('${ch.id}')">
                    <i class="fas fa-medal"></i> Reclamar ${escHtml(prize.label)} — ${formatLps(prize.rewardAmountLps)}
                </button>
            `;
        }
    } else if (ranking && isChallengeActive(ch)) {
        claimHtml += `<p class="copa-status copa-status--wait"><i class="fas fa-flag-checkered"></i> Al cerrar el reto se pagan los puestos del podio</p>`;
    }

    return `
        <div class="copa-float" data-copa-id="${ch.id}">
            <div class="copa-float-head">
                <p class="copa-float-kicker"><i class="fas ${kind.icon}"></i> ${ranking ? 'Todos vs todos' : escHtml(kind.label)}</p>
                ${floatActionsHtml(ch.id)}
            </div>
            <p class="copa-float-title">${escHtml(ch.title)}</p>
            <p class="copa-float-time"><i class="fas fa-clock"></i> ${escHtml(formatTimeRemaining(ch))}</p>
            ${rankHtml}
            ${tiersOn ? `${renderProgressBar(progress, target)}<div class="copa-tier-row">${renderTierPills(tiers, progress, entry || {})}</div>` : ''}
            ${claimHtml}
            <button type="button" class="copa-open-btn" data-no-drag onclick="window.openDriverCopaModal('${ch.id}')">
                Ver ranking en vivo
            </button>
        </div>
    `;
}

function renderDriverCopaPanels(challenges) {
    const activeEl = document.getElementById('driver-copa-active');
    if (!activeEl) return;

    // No tarjetones grandes en el mapa: la barrita del mapa es la UI principal
    // (tocá el chip → modal ranking). Evita basura visual con el panel abierto o cerrado.
    activeEl.classList.add('hidden');
    activeEl.innerHTML = '';
    void challenges;
}

/**
 * @param {string} challengeId
 * @param {{ publicView?: boolean }} [opts]
 */
async function openDriverCopaModal(challengeId, opts = {}) {
    const publicView = !!opts.publicView
        || window.userProfile?.role === 'client'
        || window.userProfile?.role === 'supervisor'
        || window.userProfile?.role === 'admin'
        || (window.userProfile?.role && window.userProfile.role !== 'driver');

    const isDriver = window.userProfile?.role === 'driver';
    const showDriverProgress = isDriver && !opts.forcePublic;

    const ch = cachedChallenges.find((c) => c.id === challengeId)
        || publicCachedChallenges.find((c) => c.id === challengeId)
        || (await getDoc(challengeDocRef(challengeId)).then((s) => s.exists() ? { id: s.id, ...s.data() } : null));
    if (!ch) return window.showToast?.('Reto no encontrado.');

    let modal = document.getElementById('copa-driver-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'copa-driver-modal';
        modal.className = 'copa-modal-overlay hidden';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="copa-modal" role="dialog" aria-modal="true" aria-label="Copa HonduRaite">
            <div class="copa-modal-head">
                <div>
                    <p class="copa-modal-kicker">🇭🇳 Copa HonduRaite · Ranking público</p>
                    <h2 class="copa-modal-title">${escHtml(ch.title)}</h2>
                </div>
                <button type="button" class="copa-modal-close" onclick="window.closeDriverCopaModal()" aria-label="Cerrar">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="copa-modal-body" id="copa-modal-body">
                <p class="copa-modal-loading"><i class="fas fa-spinner fa-spin"></i> Cargando ranking…</p>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');
    modal.onclick = (e) => {
        if (e.target === modal) window.closeDriverCopaModal?.();
    };

    try {
        const user = getCurrentUser();
        const profile = getDriverProfile() || window.userProfile;
        const driverVerified = !showDriverProgress || canCompeteInDriverCopa(profile);
        if (showDriverProgress && user && isChallengeActive(ch) && driverVerified) {
            try {
                const ent = await ensureEntry(ch.id, user.uid, profile);
                if (ent && !ent._localOnly) cachedEntries[ch.id] = ent;
            } catch (_) {}
        }

        let entries = [];
        let entriesError = null;
        try {
            entries = await loadEntriesForChallenge(ch.id, 120);
        } catch (le) {
            entriesError = le;
            entries = [];
        }

        const myEntry = showDriverProgress
            ? (entries.find((e) => e.driverUid === user?.uid || e.id === user?.uid)
                || (driverVerified ? cachedEntries[ch.id] : null)
                || { progress: 0, _needsVerification: !driverVerified })
            : null;
        const tiers = normalizeTiers(ch.tiers);
        const progress = parseInt(myEntry?.progress, 10) || 0;
        const cityCup = ch.cityCupEnabled === true ? buildCityCup(entries) : [];
        const kind = KIND_META[ch.kind] || KIND_META.copa;
        const myRank = showDriverProgress && driverVerified
            ? entries.findIndex((e) => e.driverUid === user?.uid || e.id === user?.uid) + 1
            : 0;

        const body = document.getElementById('copa-modal-body');
        if (!body) return;

        const verifyBanner = showDriverProgress && !driverVerified
            ? `<div class="copa-perm-banner copa-verify-modal-banner">
                <p><i class="fas fa-id-card"></i> Solo conductores <b>aprobados</b> entran al ranking, suman viajes y reclaman premios.</p>
                <p class="copa-perm-banner-sub">Podés ver el ranking público. Para competir, tu cuenta y vehículos deben estar aprobados por supervisión.</p>
              </div>`
            : '';

        const permBanner = entriesError
            ? `<div class="copa-perm-banner">
                <p><i class="fas fa-exclamation-triangle"></i> No se pudo cargar el ranking (permisos de Firestore).</p>
                <p class="copa-perm-banner-sub">Hay que desplegar las reglas: <code>firebase deploy --only firestore:rules</code></p>
              </div>`
            : '';

        let cityHtml = '';
        if (cityCup.length) {
            cityHtml = `
                <section class="copa-section">
                    <h3 class="copa-section-title"><i class="fas fa-map-marker-alt"></i> Copa por ciudad</h3>
                    <div class="copa-city-list">
                        ${cityCup.slice(0, 15).map((c, i) => `
                            <div class="copa-city-row ${myEntry && c.cityId === myEntry.cityId ? 'copa-city-row--me' : ''}">
                                <span class="copa-rank">#${i + 1}</span>
                                <span class="copa-city-name">${escHtml(c.cityName)}</span>
                                <span class="copa-city-stat">${c.trips} viajes · ${c.drivers} cond.</span>
                            </div>
                        `).join('')}
                    </div>
                </section>
            `;
        }

        let progressHtml = '';
        if (showDriverProgress && driverVerified) {
            progressHtml = `
            <section class="copa-section">
                <h3 class="copa-section-title"><i class="fas fa-user"></i> Tu progreso</h3>
                ${myRank > 0 ? `<p class="copa-rank-big">Vas <b>#${myRank}</b></p>` : ''}
                ${renderProgressBar(progress, nextTier(tiers, progress)?.targetTrips || tiers[tiers.length - 1]?.targetTrips || Math.max(progress + 5, 10))}
                <div class="copa-tier-cards">
                    ${tiers.map((t) => {
                        const ok = progress >= t.targetTrips;
                        const claimed = tierClaimKey(myEntry, t.id);
                        const paid = tierPaidKey(myEntry, t.id);
                        let st = ok ? (paid ? 'Pagado' : claimed ? 'Reclamado' : 'Listo') : `${progress}/${t.targetTrips}`;
                        return `
                            <div class="copa-tier-card ${ok ? 'copa-tier-card--ok' : ''}">
                                <p class="copa-tier-card-label">${escHtml(t.label)}</p>
                                <p class="copa-tier-card-target">${t.targetTrips} viajes</p>
                                <p class="copa-tier-card-reward">${escHtml(t.reward)}</p>
                                <p class="copa-tier-card-st">${escHtml(st)}</p>
                            </div>
                        `;
                    }).join('')}
                </div>
                ${ch.qualityEnabled && ch.minRatingToClaim > 0
                    ? `<p class="copa-quality-note"><i class="fas fa-star"></i> Rating mín. ${ch.minRatingToClaim} para reclamar${avgRating(myEntry) != null ? ` · tu avg ${avgRating(myEntry)}` : ''}</p>`
                    : ''}
            </section>`;
        } else if (showDriverProgress && !driverVerified) {
            progressHtml = '';
        } else {
            progressHtml = `
            <section class="copa-section">
                <h3 class="copa-section-title"><i class="fas fa-gift"></i> Metas del reto</h3>
                <div class="copa-tier-cards">
                    ${tiers.map((t) => `
                        <div class="copa-tier-card">
                            <p class="copa-tier-card-label">${escHtml(t.label)}</p>
                            <p class="copa-tier-card-target">${t.targetTrips} viajes</p>
                            <p class="copa-tier-card-reward">${escHtml(t.reward)}</p>
                        </div>
                    `).join('')}
                </div>
                <p class="copa-public-note"><i class="fas fa-eye"></i> Ranking abierto: pasajeros y conductores pueden ver quién va ganando.</p>
            </section>`;
        }

        body.innerHTML = `
            ${permBanner}
            ${verifyBanner}
            <p class="copa-modal-desc">${escHtml(ch.description || '')}</p>
            ${(() => {
                const podium = normalizePodium(ch.podiumPrizes);
                const ranking = isRankingMode(ch);
                const podiumBanner = ranking && podium.length
                    ? `<div class="copa-podium-banner">
                        <p class="copa-section-title" style="margin:0 0 0.35rem"><i class="fas fa-users"></i> Todos vs todos</p>
                        <p class="copa-modal-desc" style="margin:0">Compiten todos los conductores del país. Gana quien más viajes complete.</p>
                        <div class="copa-podium-prizes">${podium.map((p) =>
                            `<span class="copa-podium-chip">${p.place}° · ${formatLps(p.rewardAmountLps)}</span>`
                        ).join('')}</div>
                      </div>`
                    : '';
                return `
            <p class="copa-modal-meta">
                <i class="fas ${kind.icon}"></i> ${ranking ? 'Competencia nacional' : escHtml(kind.label)}
                · <i class="fas fa-clock"></i> ${escHtml(formatTimeRemaining(ch) || 'En curso')}
                ${myRank ? ` · Tu puesto #${myRank}` : ''}
                · <i class="fas fa-users"></i> ${entries.length} compitiendo
            </p>
            ${podiumBanner}
            ${progressHtml}
            ${cityHtml}
            <section class="copa-section">
                <h3 class="copa-section-title"><i class="fas fa-medal"></i> Ranking en vivo — top 25</h3>
                <p class="copa-public-note" style="margin-top:0">Orden por viajes completados. ${ranking ? 'El podio se paga al cerrar el reto.' : ''}</p>
                <div class="copa-lb-list">
                    ${entries.slice(0, 25).map((e, i) => {
                        const isMe = showDriverProgress && (e.driverUid === user?.uid || e.id === user?.uid);
                        const p = parseInt(e.progress, 10) || 0;
                        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                        return `
                            <div class="copa-lb-row ${isMe ? 'copa-lb-row--me' : ''} ${i < 3 ? 'copa-lb-row--podium' : ''}">
                                <span class="copa-rank">${medal}</span>
                                <span class="copa-lb-name">${escHtml(e.driverName || 'Conductor')}${isMe ? ' (vos)' : ''}</span>
                                <span class="copa-lb-city">${escHtml(e.cityName || '')}</span>
                                <span class="copa-lb-pts">${p}</span>
                            </div>
                        `;
                    }).join('') || (entriesError
                        ? '<p class="copa-empty">Sin datos de ranking por permisos. Desplegá firestore.rules y recargá.</p>'
                        : '<p class="copa-empty">Aún nadie suma. ¡El primero en completar un viaje abre el ranking!</p>')}
                </div>
            </section>`;
            })()}
        `;
    } catch (e) {
        console.error('openDriverCopaModal:', e);
        const body = document.getElementById('copa-modal-body');
        const msg = String(e?.code || e?.message || e || '');
        const isPerm = /permission|insufficient|Missing or insufficient/i.test(msg);
        if (body) {
            body.innerHTML = isPerm
                ? `<div class="copa-perm-banner" style="margin:1rem">
                    <p><i class="fas fa-lock"></i> Faltan permisos de Firestore para la Copa.</p>
                    <p class="copa-perm-banner-sub">En la carpeta del proyecto ejecutá:<br><code>firebase deploy --only firestore:rules</code><br>y después recargá la app.</p>
                   </div>`
                : `<p class="text-red-500 font-bold p-4">Error al cargar: ${escHtml(e.message || msg)}</p>`;
        }
    }
}

async function openPublicCopaRanking(challengeId = null) {
    try {
        // Si abren desde menú tras la ✕, volver a mostrar el chip del mapa
        setPublicCopaStripDismissedThisSession(false);
        let list = publicCachedChallenges.filter(isChallengeActive);
        if (!list.length) {
            const snap = await getDocs(query(challengesCol(), where('status', '==', 'active'), limit(20)));
            list = [];
            snap.forEach((d) => {
                const ch = { id: d.id, ...d.data() };
                if (isChallengeActive(ch) && ch.publicRanking !== false) list.push(ch);
            });
            publicCachedChallenges = list;
        }
        list = list.filter((c) => c.publicRanking !== false);
        if (!list.length) {
            return window.showToast?.(
                'No hay ranking público activo por ahora. Pronto habrá una Copa HonduRaite.',
                'info'
            );
        }
        const id = challengeId || list[0].id;
        renderPublicCopaStrip();
        await openDriverCopaModal(id, { publicView: true, forcePublic: window.userProfile?.role !== 'driver' });
    } catch (e) {
        console.error('openPublicCopaRanking:', e);
        window.showToast?.('No se pudo abrir el ranking.', 'warning');
    }
}

function renderPublicCopaStrip() {
    const el = document.getElementById('public-copa-strip');
    if (!el) return;

    // Conductores usan su propia barrita de copa
    if (window.userProfile?.role === 'driver') {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }

    const active = publicCachedChallenges.filter((c) => isChallengeActive(c) && c.publicRanking !== false);
    if (!active.length) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }

    // ✕ de esta sesión (vista pasajero)
    if (isPublicCopaStripDismissedThisSession()) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }

    const first = active[0];
    if (!first) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    const shortTitle = String(first.title || 'Copa HonduRaite')
        .replace(/Copa HonduRaite\s*[—–-]?\s*/i, '')
        .replace(/Todos vs Todos/i, 'Todos vs todos')
        .trim() || 'Ranking';
    el.classList.remove('hidden');
    // Misma idea que promos: [chip] [✕] — la X es un botón hermano, no dentro del chip
    el.innerHTML = `
        <div class="copa-chip-wrap public-copa-strip-inner">
            <button type="button" class="copa-chip copa-chip--map" data-public-copa-open
                    title="${escHtml(first.title)}">
                <span class="copa-chip-pulse" aria-hidden="true"></span>
                <span class="copa-chip-ico" aria-hidden="true"><i class="fas fa-trophy"></i></span>
                <span class="copa-chip-body">
                    <span class="copa-chip-label">Copa</span>
                    <span class="copa-chip-rank copa-chip-rank--live">LIVE</span>
                    <span class="copa-chip-sep" aria-hidden="true">·</span>
                    <span class="copa-chip-meta">${escHtml(shortTitle.slice(0, 22))}</span>
                </span>
                <i class="fas fa-chevron-right copa-chip-chevron" aria-hidden="true"></i>
            </button>
            <button type="button" class="copa-chip-close passenger-promo-close public-copa-close"
                    data-public-copa-close title="Ocultar ranking" aria-label="Ocultar ranking de la Copa">
                <i class="fas fa-times pointer-events-none"></i>
            </button>
        </div>
    `;

    el.querySelector('[data-public-copa-open]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.openPublicCopaRanking?.(first.id);
    });

    const closeBtn = el.querySelector('[data-public-copa-close]');
    if (closeBtn) {
        const onClose = (e) => {
            if (e.type === 'pointerup' && e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation?.(); } catch (_) {}
            dismissPublicCopaStripOnScreen();
        };
        closeBtn.addEventListener('pointerup', onClose, { capture: true });
        closeBtn.addEventListener('click', onClose);
    }
}

function closeDriverCopaModal() {
    const modal = document.getElementById('copa-driver-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.innerHTML = '';
    }
}

// ─── Staff UI ──────────────────────────────────────────────────────────────

function renderDurationOptions(selected = DEFAULT_DURATION) {
    return Object.entries(DURATION_PRESETS).map(([id, p]) =>
        `<option value="${id}"${id === selected ? ' selected' : ''}>${p.label}</option>`
    ).join('');
}

function syncCopaDurationUI() {
    const dur = document.getElementById('copa-duration')?.value || DEFAULT_DURATION;
    const unlimited = dur === 'unlimited' || !!DURATION_PRESETS[dur]?.unlimited;
    const goalWrap = document.getElementById('copa-goal-wrap');
    const hint = document.getElementById('copa-duration-hint');
    if (goalWrap) goalWrap.style.display = unlimited ? '' : '';
    // Meta siempre útil; con reloj es opcional de cierre anticipado
    if (hint) {
        hint.innerHTML = unlimited
            ? 'Por defecto <b>sin reloj</b>: la pelea sigue hasta que alguien cumpla la meta de viajes (o la cierres vos).'
            : 'Hay reloj opcional. Si también ponés meta de viajes, gana quien la cumpla primero (cierra antes del tiempo).';
    }
}

function challengeStatusLabel(ch) {
    if (!isChallengeActive(ch) && ch.status === 'active') return { text: 'Vencido', variant: 'red' };
    if (ch.status === 'active') return { text: 'Activo', variant: 'emerald' };
    if (ch.status === 'closed') return { text: 'Cerrado', variant: 'blue' };
    return { text: 'Cancelado', variant: 'muted' };
}

function renderStaffChallengeCard(ch, entries = []) {
    const U = window.OpsUi;
    if (!U) return '';
    const st = challengeStatusLabel(ch);
    const tiers = normalizeTiers(ch.tiers);
    const podium = normalizePodium(ch.podiumPrizes);
    const ranking = isRankingMode(ch);
    const sorted = [...entries].sort((a, b) => (b.progress || 0) - (a.progress || 0));
    const awaitingPay = entries.filter((e) => {
        const claimed = e.tiersClaimed || {};
        const paid = e.rewardPaidTiers || {};
        const tierPay = Object.keys(claimed).some((k) => claimed[k] && !paid[k]);
        const podiumPay = e.podiumClaimed && !e.podiumPaid;
        return tierPay || podiumPay;
    });
    const cityCup = ch.cityCupEnabled ? buildCityCup(entries) : [];
    const kind = KIND_META[ch.kind] || KIND_META.copa;
    const modeLabel = COMPETE_MODES[getCompeteMode(ch)]?.label || 'Competencia';

    let payRows = '';
    awaitingPay.forEach((e) => {
        const claimed = e.tiersClaimed || {};
        const paid = e.rewardPaidTiers || {};
        Object.keys(claimed).filter((k) => claimed[k] && !paid[k]).forEach((tid) => {
            const tier = tiers.find((t) => t.id === tid);
            payRows += `
                <div class="ops-objective-response-row">
                    <div class="min-w-0 flex-1">
                        <p class="ops-objective-response-name">${escHtml(e.driverName || 'Conductor')}</p>
                        <p class="ops-objective-response-progress">Meta ${escHtml(tier?.label || tid)} · ${escHtml(tier?.reward || '')}</p>
                    </div>
                    ${U.badge('Por pagar', 'amber')}
                    ${U.btn('Marcar pagada', `window.markCopaRewardPaid('${ch.id}', '${e.driverUid || e.id}', '${tid}')`, { variant: 'emerald', icon: 'fa-hand-holding-usd' })}
                </div>
            `;
        });
        if (e.podiumClaimed && !e.podiumPaid) {
            payRows += `
                <div class="ops-objective-response-row">
                    <div class="min-w-0 flex-1">
                        <p class="ops-objective-response-name">${escHtml(e.driverName || 'Conductor')}</p>
                        <p class="ops-objective-response-progress">Podio #${e.finalRank || '?'} · ${formatLps(e.podiumRewardLps || 0)} · ${parseInt(e.progress, 10) || 0} viajes</p>
                    </div>
                    ${U.badge('Podio por pagar', 'amber')}
                    ${U.btn('Marcar pagada', `window.markCopaPodiumPaid('${ch.id}', '${e.driverUid || e.id}')`, { variant: 'emerald', icon: 'fa-hand-holding-usd' })}
                </div>
            `;
        }
    });

    // Live top 5 for ranking competitions
    let topHtml = '';
    if (ranking && sorted.length) {
        topHtml = `<div class="ops-objective-responses" style="margin-top:0.5rem">
            <p class="ops-objective-meta" style="margin-bottom:0.35rem"><b>Top en vivo (todos vs todos)</b></p>
            ${sorted.slice(0, 5).map((e, i) => `
                <div class="ops-objective-response-row">
                    <div class="min-w-0 flex-1">
                        <p class="ops-objective-response-name">#${i + 1} ${escHtml(e.driverName || 'Conductor')}</p>
                        <p class="ops-objective-response-progress">${parseInt(e.progress, 10) || 0} viajes · ${escHtml(e.cityName || '')}</p>
                    </div>
                </div>
            `).join('')}
        </div>`;
    }

    let actions = '';
    if (ch.status === 'active' && isChallengeActive(ch)) {
        actions = `
            <div class="ops-trip-actions">
                ${U.btn('Reconfigurar', `window.openReconfigureDriverCopa('${ch.id}')`, { variant: 'primary', icon: 'fa-sliders-h' })}
                ${U.btn('Cerrar y fijar podio', `window.closeGlobalChallenge('${ch.id}')`, { variant: 'ghost', icon: 'fa-flag-checkered' })}
                ${U.btn('Cancelar', `window.cancelGlobalChallenge('${ch.id}')`, { variant: 'ghost', icon: 'fa-ban' })}
            </div>
        `;
    }

    const topCities = cityCup.slice(0, 5).map((c, i) =>
        `#${i + 1} ${escHtml(c.cityName)} (${c.trips})`
    ).join(' · ');

    return U.card(`
        <div class="ops-objective-card-head">
            <div class="min-w-0 flex-1">
                <p class="ops-objective-title">${escHtml(kind.emoji)} ${escHtml(ch.title)}</p>
                <p class="ops-objective-meta">${escHtml(modeLabel)} · ${entries.length} compitiendo · ${
                    isUnlimitedDuration(ch)
                        ? (getGoalTrips(ch) > 0 ? `sin reloj · meta ${getGoalTrips(ch)} viajes` : 'sin reloj · hasta que se cumpla')
                        : `vence ${formatChallengeDate(ch.expiresAt || ch.expiresAtMs)}`
                }</p>
                ${getGoalTrips(ch) > 0 && sorted[0]
                    ? `<p class="ops-objective-meta">Progreso meta: líder ${parseInt(sorted[0].progress, 10) || 0}/${getGoalTrips(ch)}</p>`
                    : ''}
                ${podium.length
                    ? `<p class="ops-objective-meta">Podio: ${podium.map((p) => `${p.place}° ${formatLps(p.rewardAmountLps)}`).join(' · ')}</p>`
                    : ''}
                ${tiers.length
                    ? `<p class="ops-objective-meta">Metas extra: ${tiers.map((t) => `${t.label} ${t.targetTrips}→${formatLps(t.rewardAmountLps || 0)}`).join(' · ')}</p>`
                    : ''}
                ${ch.economics
                    ? `<p class="ops-objective-meta">Rentabilidad: margen ~${Number(ch.economics.fleetMargin || 0).toFixed(0)}% · bote ${formatLps(ch.economics.prizePool || 0)} · ${ch.publicRanking !== false ? 'público' : 'privado'}</p>`
                    : ''}
                ${topCities ? `<p class="ops-objective-drivers">Ciudades (extra): ${topCities}</p>` : ''}
                ${awaitingPay.length ? `<p class="ops-objective-reward"><i class="fas fa-gift"></i> ${awaitingPay.length} premio(s) por pagar</p>` : ''}
            </div>
            ${U.badge(st.text, st.variant)}
        </div>
        ${topHtml}
        ${payRows ? `<div class="ops-objective-responses">${payRows}</div>` : ''}
        ${actions}
    `, 'objective');
}

function renderSupervisorCopaPage(challenges, entriesMap) {
    const U = window.OpsUi;
    if (!U) return '<p class="p-6">OpsUi no disponible</p>';

    const active = challenges.filter((c) => isChallengeActive(c));
    const history = challenges.filter((c) => !isChallengeActive(c));
    let awaitingPay = 0;
    active.forEach((ch) => {
        (entriesMap[ch.id] || []).forEach((e) => {
            const claimed = e.tiersClaimed || {};
            const paid = e.rewardPaidTiers || {};
            if (Object.keys(claimed).some((k) => claimed[k] && !paid[k])) awaitingPay++;
        });
    });

    let body = U.hero(
        'Copa HonduRaite',
        'Todos vs todos · sin reloj por defecto · cierra cuando se cumple la meta. Ciudad es opcional.',
        U.kpiRow([
            { value: active.length, label: 'Activos', variant: 'emerald' },
            { value: awaitingPay, label: 'Por pagar', variant: 'amber' },
            { value: history.length, label: 'Historial', variant: 'default' }
        ])
    );

    body += U.section({
        title: 'Lanzar reto rápido',
        subtitle: 'Por defecto: todos los conductores compiten entre sí por el podio',
        icon: 'fa-rocket',
        variant: 'emerald',
        body: `
            <div class="copa-preset-grid">
                ${Object.entries(LAUNCH_PRESETS).map(([id, p]) => {
                    const k = KIND_META[p.kind] || KIND_META.copa;
                    const mode = p.competeMode || 'ranking';
                    const sub = mode === 'ranking'
                        ? `Todos vs todos · podio ${ (p.podiumPrizes || []).map((x) => x.rewardAmountLps).join('/') }`
                        : `Metas · ${(p.tiers || []).map((t) => t.targetTrips).join('/')}`;
                    return `
                        <button type="button" class="copa-preset-btn" onclick="window.applyCopaPreset('${id}')">
                            <span class="copa-preset-emoji">${k.emoji}</span>
                            <span class="copa-preset-title">${escHtml(p.title)}</span>
                            <span class="copa-preset-sub">${escHtml(DURATION_PRESETS[p.durationPreset]?.label || '')} · ${escHtml(sub)}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `
    });

    const defaultComm = getDefaultCommissionPercent();
    const initialAnalysis = analyzeChallengeProfitability({
        competeMode: 'ranking',
        podiumPrizes: DEFAULT_PODIUM,
        tiers: [],
        avgTripFare: DEFAULT_AVG_TRIP_FARE,
        commissionPercent: defaultComm,
        estimatedDrivers: DEFAULT_EST_DRIVERS,
        minMarginPercent: DEFAULT_MIN_MARGIN_PCT,
        avgTripsPerDriver: 25
    });

    body += U.section({
        title: 'Crear competencia',
        subtitle: 'Todos vs todos = ranking nacional. Solo conductores aprobados entran, suman viajes y reclaman. Premios fijos al 1°, 2°, 3°.',
        icon: 'fa-trophy',
        variant: 'emerald',
        body: U.formPanel('', '', `
            ${U.fieldLabel('Modo de competencia')}
            <select id="copa-compete-mode" class="ops-input" onchange="window.syncCopaFormModeUI?.()">
                <option value="ranking" selected>Todos vs todos (ranking + podio)</option>
                <option value="both">Ranking + metas personales</option>
                <option value="tiers">Solo metas personales (sin podio)</option>
            </select>
            <p class="ops-toolbar-hint">Solo conductores con cuenta aprobada compiten. El ranking público se puede ver sin estar aprobado. Gana quien más viajes haga.</p>

            ${U.fieldLabel('Tipo / skin')}
            <select id="copa-kind" class="ops-input">
                <option value="copa">Copa HonduRaite</option>
                <option value="mega">Meta / temporada larga</option>
                <option value="feriado">Feriado de la Nación</option>
                <option value="pico">Pico del Día</option>
                <option value="calidad">Buen Catracho</option>
            </select>
            ${U.fieldLabel('Título')}
            <input type="text" id="copa-title" class="ops-input" maxlength="120" placeholder="Ej: Copa HonduRaite — Todos vs Todos" value="Copa HonduRaite — Todos vs Todos">
            ${U.fieldLabel('Descripción')}
            <textarea id="copa-desc" class="ops-input" rows="2" maxlength="500" placeholder="Compiten todos. Ranking en vivo. Gana el que más viajes complete.">Competencia nacional: todos los conductores contra todos. Ranking en vivo y público.</textarea>
            ${U.fieldLabel('Tiempo')}
            <select id="copa-duration" class="ops-input" onchange="window.syncCopaDurationUI?.()">
                ${renderDurationOptions(DEFAULT_DURATION)}
            </select>
            <p class="ops-toolbar-hint" id="copa-duration-hint">Por defecto <b>sin reloj</b>: la pelea sigue hasta que alguien cumpla la meta de viajes (o la cierres vos).</p>
            <div id="copa-goal-wrap">
                ${U.fieldLabel('Meta de viajes (cierra la competencia al cumplirse)')}
                <input type="number" id="copa-goal-trips" class="ops-input" min="1" max="9999" value="${DEFAULT_GOAL_TRIPS}" placeholder="Ej: 1000">
                <p class="ops-toolbar-hint">Cuando <b>cualquier</b> conductor llega a esta cantidad, se cierra el ranking y se fija el podio.</p>
            </div>

            <p class="ops-toolbar-hint" style="margin:0.75rem 0 0.35rem">Economía (valida si el bote es rentable)</p>
            <div class="copa-econ-grid">
                <div>
                    ${U.fieldLabel('Tarifa promedio viaje (L.)')}
                    <input type="number" id="copa-avg-fare" class="ops-input" min="10" max="5000" step="1" value="${DEFAULT_AVG_TRIP_FARE}" oninput="window.refreshCopaProfitability?.()">
                </div>
                <div>
                    ${U.fieldLabel('Comisión app (%)')}
                    <input type="number" id="copa-commission" class="ops-input" min="1" max="50" step="0.5" value="${defaultComm}" oninput="window.refreshCopaProfitability?.()">
                </div>
                <div>
                    ${U.fieldLabel('Conductores estimados')}
                    <input type="number" id="copa-est-drivers" class="ops-input" min="1" max="5000" value="${DEFAULT_EST_DRIVERS}" oninput="window.refreshCopaProfitability?.()">
                </div>
                <div>
                    ${U.fieldLabel('Viajes prom. por conductor')}
                    <input type="number" id="copa-avg-trips" class="ops-input" min="1" max="9999" value="25" oninput="window.refreshCopaProfitability?.()">
                </div>
                <div>
                    ${U.fieldLabel('Margen mínimo (%)')}
                    <input type="number" id="copa-min-margin" class="ops-input" min="0" max="80" step="1" value="${DEFAULT_MIN_MARGIN_PCT}" oninput="window.refreshCopaProfitability?.()">
                </div>
                <div>
                    ${U.fieldLabel('Mín. viajes para aparecer en ranking')}
                    <input type="number" id="copa-min-trips-rank" class="ops-input" min="0" max="999" value="1" title="1 = desde el primer viaje. 0 = todos.">
                    <p class="ops-toolbar-hint" style="margin:0.2rem 0 0">Usa <b>1</b> (o 0) para que el podio cuente desde el primer viaje. No borra puntos ya sumados.</p>
                </div>
            </div>

            <div id="copa-podium-block">
                <p class="ops-toolbar-hint" style="margin:0.75rem 0 0.35rem"><b>Premios del podio (todos vs todos)</b> — bote fijo, solo top 3</p>
                ${[1, 2, 3].map((place) => `
                    <div class="copa-tier-form-row copa-tier-form-row--4">
                        <span class="copa-tier-form-label">${place}°</span>
                        <input type="number" id="copa-podium-${place}-amount" class="ops-input" min="0" max="999999" value="${[1500, 800, 400][place - 1]}" placeholder="L." oninput="window.refreshCopaProfitability?.()">
                        <input type="text" id="copa-podium-${place}-label" class="ops-input" maxlength="80" value="${place === 1 ? '1er lugar — Campeón' : place === 2 ? '2do lugar' : '3er lugar'}" placeholder="Etiqueta" style="grid-column: span 2">
                    </div>
                `).join('')}
            </div>

            <div id="copa-tiers-block" style="display:none">
                <p class="ops-toolbar-hint" style="margin:0.75rem 0 0.35rem">Metas personales (opcional) · viajes · premio L.</p>
                ${['bronce', 'plata', 'oro'].map((id, i) => `
                    <div class="copa-tier-form-row copa-tier-form-row--4">
                        <span class="copa-tier-form-label">${id}</span>
                        <input type="number" id="copa-tier-${id}-trips" class="ops-input" min="1" max="9999" value="${[10, 20, 35][i]}" placeholder="Viajes" oninput="window.refreshCopaProfitability?.()">
                        <input type="number" id="copa-tier-${id}-amount" class="ops-input" min="0" max="999999" step="1" value="${[50, 150, 350][i]}" placeholder="L." oninput="window.refreshCopaProfitability?.()">
                        <input type="text" id="copa-tier-${id}-reward" class="ops-input" maxlength="200" value="${['L. 50', 'L. 150', 'L. 350'][i]}" placeholder="Texto">
                    </div>
                `).join('')}
            </div>

            <div id="copa-profit-host">${renderProfitabilityPanel(initialAnalysis)}</div>

            <label class="copa-check-label">
                <input type="checkbox" id="copa-city-cup"> Copa por ciudad <b>(aparte)</b> — ranking de ciudades, no reemplaza todos vs todos
            </label>
            <label class="copa-check-label">
                <input type="checkbox" id="copa-public-ranking" checked> Ranking público (pasajeros y todos lo ven)
            </label>
            <label class="copa-check-label">
                <input type="checkbox" id="copa-quality"> Exigir rating mínimo (podio / metas)
            </label>
            <div class="copa-quality-row">
                ${U.fieldLabel('Rating mínimo')}
                <input type="number" id="copa-min-rating" class="ops-input" min="0" max="5" step="0.1" value="4.5">
            </div>
            <div class="ops-form-actions">
                ${U.btn('Analizar rentabilidad', 'window.refreshCopaProfitability()', { variant: 'ghost', icon: 'fa-calculator' })}
                ${U.btn('Publicar competencia', 'window.createGlobalChallenge(this)', { variant: 'emerald', icon: 'fa-flag', full: true })}
            </div>
            <p class="ops-toolbar-hint" style="margin-top:0.5rem">Si sale rojo, no publica. En todos vs todos el bote del podio es fijo (solo pagan 1°, 2°, 3°).</p>
        `)
    });

    body += U.section({
        title: 'Retos activos',
        icon: 'fa-flag-checkered',
        badge: active.length,
        variant: 'emerald',
        body: active.length
            ? active.map((c) => renderStaffChallengeCard(c, entriesMap[c.id] || [])).join('')
            : U.empty('fa-trophy', 'Sin retos globales', 'Lanzá una Copa para motivar a toda la flota.')
    });

    if (history.length) {
        body += U.section({
            title: 'Historial',
            icon: 'fa-history',
            badge: history.length,
            variant: 'muted',
            collapsible: true,
            open: false,
            body: history.map((c) => renderStaffChallengeCard(c, entriesMap[c.id] || [])).join('')
        });
    }

    return U.page(body);
}

// ─── Cierre / meta cumplida ────────────────────────────────────────────────

/**
 * Cierra la competencia y fija podio.
 * @param {string} challengeId
 * @param {{ reason?: string, silent?: boolean }} [opts]
 */
async function finalizeChallengePodium(challengeId, opts = {}) {
    const reason = opts.reason || 'closed';
    const chSnap = await getDoc(challengeDocRef(challengeId));
    if (!chSnap.exists()) return null;
    const ch = { id: challengeId, ...chSnap.data() };
    if (ch.status !== 'active') return ch; // ya cerrada

    const entries = await loadEntriesForChallenge(challengeId, 200);
    const podium = normalizePodium(ch.podiumPrizes);
    const minTrips = parseInt(ch.minTripsToRank, 10) || 0;
    const sorted = [...entries].sort((a, b) => (b.progress || 0) - (a.progress || 0));
    const finalPodium = [];

    if (isRankingMode(ch) && podium.length) {
        let place = 0;
        for (const e of sorted) {
            const prog = parseInt(e.progress, 10) || 0;
            if (minTrips > 0 && prog < minTrips) continue;
            if (ch.qualityEnabled && qualityBlocksClaim(ch, e)) continue;
            if (e.identityVerified === false) continue;
            place += 1;
            const prize = podium.find((p) => p.place === place);
            if (!prize) break;
            const uid = e.driverUid || e.id;
            finalPodium.push({
                place,
                driverUid: uid,
                driverName: e.driverName || 'Conductor',
                progress: prog,
                rewardAmountLps: prize.rewardAmountLps,
                reward: prize.reward || formatLps(prize.rewardAmountLps)
            });
            await updateDoc(entryDocRef(challengeId, uid), {
                finalRank: place,
                podiumRewardLps: prize.rewardAmountLps,
                podiumEligible: true,
                updatedAt: serverTimestamp()
            }).catch(() => {});
        }
    }

    await updateDoc(challengeDocRef(challengeId), {
        status: 'closed',
        closedAt: serverTimestamp(),
        closedReason: reason,
        finalPodium,
        updatedAt: serverTimestamp()
    });

    for (const w of finalPodium) {
        try {
            const newRef = doc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'));
            await setDoc(newRef, {
                targetRole: 'driver',
                targetUserId: String(w.driverUid),
                targetUserName: w.driverName,
                personal: true,
                threadId: newRef.id,
                message: reason === 'goal_reached'
                    ? `🏁 ¡Se cumplió la meta en «${ch.title || 'la Copa'}»! Quedaste #${w.place}. Premio: ${w.reward}. Reclamalo en la app.`
                    : `🥇 ¡Quedaste #${w.place} en «${ch.title || 'la Copa'}»! Premio: ${w.reward}. Reclamalo en la app.`,
                sentBy: getCurrentUser()?.uid || 'system',
                sentByName: getSenderName() || 'HonduRaite',
                createdAt: serverTimestamp(),
                createdAtMs: Date.now()
            });
        } catch (_) {}
    }

    try {
        await addDoc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'), {
            targetRole: 'driver',
            message: reason === 'goal_reached'
                ? `🏁 Meta cumplida en «${ch.title}». Ranking cerrado. Podio: ${finalPodium.map((w) => `#${w.place} ${w.driverName}`).join(', ') || '—'}`
                : `🏁 «${ch.title}» cerrada. Podio fijado.`,
            sentBy: getCurrentUser()?.uid || 'system',
            sentByName: getSenderName() || 'HonduRaite',
            createdAt: serverTimestamp(),
            createdAtMs: Date.now(),
            copaClosedAlert: true
        });
    } catch (_) {}

    return { ...ch, status: 'closed', finalPodium, closedReason: reason };
}

// ─── Progress on trip complete ─────────────────────────────────────────────

async function incrementCopaOnTripComplete(driverId, tripId, tripMeta = {}) {
    if (!dbRef || !appIdRef || !driverId || !tripId) return;

    try {
        const snap = await getDocs(query(
            challengesCol(),
            where('status', '==', 'active'),
            limit(20)
        ));

        const active = [];
        snap.forEach((d) => {
            const data = { id: d.id, ...d.data() };
            if (isChallengeActive(data)) active.push(data);
        });
        if (!active.length) return;

        let profile = null;
        if (driverId === getCurrentUser()?.uid) {
            profile = getDriverProfile() || window.userProfile;
        } else {
            try {
                const uSnap = await getDoc(doc(dbRef, 'artifacts', appIdRef, 'public', 'data', 'users', driverId));
                if (uSnap.exists()) profile = uSnap.data();
            } catch (_) {}
        }

        // Solo conductores aprobados suman viajes al ranking
        if (!canCompeteInDriverCopa(profile)) {
            if (driverId === getCurrentUser()?.uid && !window.__dcopaVerifyTripToastShown) {
                window.__dcopaVerifyTripToastShown = true;
                window.showToast?.(COPA_DRIVER_VERIFY_MSG, 'warning');
            }
            return;
        }

        for (const ch of active) {
            const entry = await ensureEntry(ch.id, driverId, profile, tripMeta);
            if (entry?._needsVerification) continue;
            // Si el create falló (rules/offline), reintentar setDoc+merge; no descartar por _localOnly si está verificado
            const counted = Array.isArray(entry.countedTripIds) ? entry.countedTripIds : [];
            if (counted.includes(tripId)) continue;

            const tierMax = normalizeTiers(ch.tiers).length
                ? Math.max(...normalizeTiers(ch.tiers).map((t) => t.targetTrips), 1)
                : 0;
            // Ranking todos-vs-todos: contamos sin techo bajo (hasta 9999)
            const softCap = isRankingMode(ch) ? 9999 : Math.max(tierMax * 3, 1);
            const progress = parseInt(entry.progress, 10) || 0;
            if (progress >= softCap) continue;

            const { cityId, cityName } = resolveCityFromProfile(profile, tripMeta);
            const newProgress = progress + 1;
            const patch = {
                progress: newProgress,
                points: newProgress,
                countedTripIds: arrayUnion(tripId),
                cityId: entry.cityId || cityId,
                cityName: entry.cityName || cityName,
                driverName: entry.driverName || profile?.name || 'Conductor',
                driverUid: driverId,
                identityVerified: true,
                updatedAt: serverTimestamp()
            };

            // Optional: attach rating if trip already has client rating
            const tripRating = parseFloat(tripMeta.clientRating || tripMeta.ratingByClient || tripMeta.rating);
            if (Number.isFinite(tripRating) && tripRating > 0) {
                patch.ratingSum = increment(tripRating);
                patch.ratingCount = increment(1);
            }

            const ref = entryDocRef(ch.id, driverId);
            try {
                await updateDoc(ref, patch);
            } catch (updErr) {
                // Doc no existía (create falló antes): crear con setDoc merge
                try {
                    await setDoc(ref, {
                        driverUid: driverId,
                        driverName: patch.driverName,
                        cityId: patch.cityId,
                        cityName: patch.cityName,
                        progress: newProgress,
                        points: newProgress,
                        countedTripIds: [tripId],
                        tiersClaimed: {},
                        rewardPaidTiers: {},
                        ratingSum: 0,
                        ratingCount: 0,
                        identityVerified: true,
                        joinedAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                } catch (setErr) {
                    console.warn('incrementCopa write:', setErr?.code || setErr);
                    continue;
                }
            }

            // Sin reloj: al cumplir la meta de viajes se cierra y se fija el podio
            const goal = getGoalTrips(ch);
            if (goal > 0 && newProgress >= goal && isChallengeActive(ch)) {
                try {
                    await finalizeChallengePodium(ch.id, { reason: 'goal_reached' });
                    if (driverId === getCurrentUser()?.uid) {
                        window.showToast?.(
                            `🏁 ¡Meta de ${goal} viajes cumplida en «${ch.title}»! Ranking cerrado y podio fijado.`,
                            'success'
                        );
                    }
                } catch (closeErr) {
                    console.warn('auto-close goal:', closeErr);
                }
            }

            if (driverId === getCurrentUser()?.uid) {
                cachedEntries[ch.id] = {
                    ...entry,
                    ...patch,
                    progress: newProgress,
                    points: newProgress,
                    countedTripIds: [...counted, tripId]
                };
                if (isRankingMode(ch) && !(goal > 0 && newProgress >= goal)) {
                    refreshRankForChallenge(ch.id, driverId, ch.minTripsToRank || 0).then((rk) => {
                        if (rk?.rank) {
                            const goalLeft = goal > 0 ? Math.max(0, goal - newProgress) : null;
                            const goalBit = goalLeft != null
                                ? (goalLeft === 0 ? ' · ¡meta!' : ` · faltan ${goalLeft} a la meta`)
                                : '';
                            window.showToast?.(
                                `🏆 Todos vs todos: vas #${rk.rank} con ${newProgress} viajes${rk.gapToLeader > 0 ? ` (te faltan ${rk.gapToLeader} al líder)` : ' · ¡vas primero!'}${goalBit}`,
                                'success'
                            );
                        }
                        refreshDriverCopaUI();
                    });
                } else if (!isRankingMode(ch)) {
                    const tiers = normalizeTiers(ch.tiers);
                    const best = highestTierReached(tiers, newProgress);
                    const prevBest = highestTierReached(tiers, progress);
                    if (best && (!prevBest || best.id !== prevBest.id)) {
                        window.showToast?.(
                            `🏆 ¡${best.label} desbloqueado en ${ch.title}! Reclamá tu premio en la Copa.`,
                            'success'
                        );
                    }
                    refreshDriverCopaUI();
                } else {
                    refreshDriverCopaUI();
                }
            }
        }
    } catch (e) {
        console.warn('incrementCopaOnTripComplete:', e);
    }
}

/** Cuando el pasajero califica, sumar rating al entry activo (calidad). */
async function applyCopaRatingFromTrip(driverId, rating) {
    if (!dbRef || !appIdRef || !driverId) return;
    const r = parseFloat(rating);
    if (!Number.isFinite(r) || r <= 0) return;

    try {
        const snap = await getDocs(query(challengesCol(), where('status', '==', 'active'), limit(20)));
        const updates = [];
        snap.forEach((d) => {
            const ch = { id: d.id, ...d.data() };
            if (!isChallengeActive(ch) || !ch.qualityEnabled) return;
            updates.push(updateDoc(entryDocRef(ch.id, driverId), {
                ratingSum: increment(r),
                ratingCount: increment(1),
                updatedAt: serverTimestamp()
            }).catch(() => {}));
        });
        await Promise.all(updates);
    } catch (e) {
        console.warn('applyCopaRatingFromTrip:', e);
    }
}

// ─── Listeners ─────────────────────────────────────────────────────────────

function stopEntryListeners() {
    entryUnsubs.forEach((u) => {
        try { u(); } catch (_) {}
    });
    entryUnsubs = [];
}

function bindEntryListeners(challenges, driverUid) {
    stopEntryListeners();
    if (!driverUid) return;
    challenges.filter(isChallengeActive).forEach((ch) => {
        const unsub = onSnapshot(
            entryDocRef(ch.id, driverUid),
            (snap) => {
                if (snap.exists()) {
                    cachedEntries[ch.id] = { id: snap.id, ...snap.data() };
                }
                refreshDriverCopaUI();
            },
            (err) => console.warn('copaEntryListener:', ch.id, err)
        );
        entryUnsubs.push(unsub);
    });
}

async function reloadDriverCopaState() {
    const user = getCurrentUser();
    if (!user || window.userProfile?.role !== 'driver') {
        refreshDriverCopaUI();
        return;
    }

    try {
        const snap = await getDocs(query(
            challengesCol(),
            where('status', '==', 'active'),
            limit(20)
        ));
        cachedChallenges = [];
        snap.forEach((d) => cachedChallenges.push({ id: d.id, ...d.data() }));
        cachedChallenges = cachedChallenges.filter(isChallengeActive);

        // Podio cerrado: seguir mostrando si el conductor puede reclamar
        try {
            const closedSnap = await getDocs(query(
                challengesCol(),
                where('status', '==', 'closed'),
                limit(15)
            ));
            closedSnap.forEach((d) => {
                const ch = { id: d.id, ...d.data() };
                const onPodium = Array.isArray(ch.finalPodium)
                    && ch.finalPodium.some((w) => w.driverUid === user.uid);
                if (onPodium && !cachedChallenges.some((c) => c.id === ch.id)) {
                    cachedChallenges.push(ch);
                }
            });
        } catch (_) {}

        const profile = getDriverProfile() || window.userProfile;
        const verified = canCompeteInDriverCopa(profile);
        await Promise.all(cachedChallenges.map(async (ch) => {
            try {
                if (ch.status === 'active') {
                    const entry = await ensureEntry(ch.id, user.uid, profile);
                    cachedEntries[ch.id] = entry;
                } else {
                    const es = await getDoc(entryDocRef(ch.id, user.uid));
                    if (es.exists()) cachedEntries[ch.id] = { id: es.id, ...es.data() };
                    else if (!verified) {
                        cachedEntries[ch.id] = { progress: 0, _needsVerification: true, _localOnly: true };
                    }
                }
            } catch (e) {
                console.warn('ensureEntry copa:', e);
            }
        }));

        bindEntryListeners(cachedChallenges.filter((c) => c.status === 'active' && cachedEntries[c.id] && !cachedEntries[c.id]._localOnly), user.uid);
        if (verified) {
            await Promise.all(cachedChallenges.filter(isRankingMode).map((ch) =>
                refreshRankForChallenge(ch.id, user.uid, ch.minTripsToRank || 0)
            ));
        }
        refreshDriverCopaUI();
    } catch (e) {
        console.warn('reloadDriverCopaState:', e);
    }
}

// ─── Init + window API ─────────────────────────────────────────────────────

export function initDriverGlobalChallenges({
    db,
    appId,
    getCurrentUser: getUser,
    getSenderDisplayName,
    getDriverProfile: getProfile
}) {
    dbRef = db;
    appIdRef = appId;
    getCurrentUser = getUser || (() => null);
    getSenderName = getSenderDisplayName || (() => 'Supervisor');
    getDriverProfile = getProfile || (() => window.userProfile || null);

    window.syncCopaFormModeUI = syncCopaFormModeUI;
    window.syncCopaDurationUI = syncCopaDurationUI;

    window.refreshCopaProfitability = () => {
        const host = document.getElementById('copa-profit-host');
        if (!host) return null;
        const competeMode = readCompeteModeFromForm();
        const tiers = readTiersFromForm();
        const podiumPrizes = readPodiumFromForm();
        const econ = readEconomicsFromForm();
        const analysis = analyzeChallengeProfitability({
            competeMode,
            tiers,
            podiumPrizes,
            ...econ
        });
        host.innerHTML = renderProfitabilityPanel(analysis);
        const publishBtn = document.querySelector('[onclick*="createGlobalChallenge"]');
        if (publishBtn) {
            publishBtn.disabled = !analysis.ok;
            publishBtn.classList.toggle('opacity-50', !analysis.ok);
            publishBtn.title = analysis.ok
                ? 'Publicar competencia rentable'
                : 'Bloqueado: no es rentable. Ajustá el bote del podio o estimaciones.';
        }
        return analysis;
    };

    window.applyCopaPreset = (presetId) => {
        const p = LAUNCH_PRESETS[presetId];
        if (!p) return;
        const modeEl = document.getElementById('copa-compete-mode');
        const kindEl = document.getElementById('copa-kind');
        const titleEl = document.getElementById('copa-title');
        const descEl = document.getElementById('copa-desc');
        const durEl = document.getElementById('copa-duration');
        const cityEl = document.getElementById('copa-city-cup');
        const qualEl = document.getElementById('copa-quality');
        const minEl = document.getElementById('copa-min-rating');
        const pubEl = document.getElementById('copa-public-ranking');
        const avgTripsEl = document.getElementById('copa-avg-trips');
        const minRankEl = document.getElementById('copa-min-trips-rank');
        if (modeEl) modeEl.value = p.competeMode || 'ranking';
        if (kindEl) kindEl.value = p.kind;
        if (titleEl) titleEl.value = p.title;
        if (descEl) descEl.value = p.description;
        if (durEl) durEl.value = p.durationPreset;
        if (cityEl) cityEl.checked = !!p.cityCupEnabled;
        if (qualEl) qualEl.checked = !!p.qualityEnabled;
        if (minEl) minEl.value = p.minRatingToClaim || 0;
        if (pubEl) pubEl.checked = p.publicRanking !== false;
        if (avgTripsEl && p.avgTripsPerDriver) avgTripsEl.value = p.avgTripsPerDriver;
        if (minRankEl && p.minTripsToRank != null) minRankEl.value = p.minTripsToRank;
        const goalEl = document.getElementById('copa-goal-trips');
        if (goalEl) goalEl.value = p.goalTrips != null ? p.goalTrips : DEFAULT_GOAL_TRIPS;

        (p.podiumPrizes || DEFAULT_PODIUM).forEach((pr) => {
            const amount = document.getElementById(`copa-podium-${pr.place}-amount`);
            const label = document.getElementById(`copa-podium-${pr.place}-label`);
            if (amount) amount.value = pr.rewardAmountLps;
            if (label) label.value = pr.label || pr.reward || `${pr.place}° lugar`;
        });
        if (!(p.podiumPrizes || []).length) {
            [1, 2, 3].forEach((place) => {
                const amount = document.getElementById(`copa-podium-${place}-amount`);
                if (amount) amount.value = 0;
            });
        }

        (p.tiers || []).forEach((t) => {
            const trips = document.getElementById(`copa-tier-${t.id}-trips`);
            const amount = document.getElementById(`copa-tier-${t.id}-amount`);
            const reward = document.getElementById(`copa-tier-${t.id}-reward`);
            if (trips) trips.value = t.targetTrips;
            if (amount) amount.value = t.rewardAmountLps != null ? t.rewardAmountLps : parseRewardAmountLps(t.reward, 0);
            if (reward) reward.value = t.reward || '';
        });
        window.syncCopaFormModeUI?.();
        window.showToast?.(`Plantilla «${p.title}» cargada. Revisá rentabilidad y publicá.`, 'success');
    };

    window.loadSupervisorCopa = async () => {
        const adminOpen = !document.getElementById('admin-panel')?.classList.contains('hidden');
        const container = adminOpen
            ? document.getElementById('admin-users-list')
            : (document.getElementById('supervisor-pending-list') || document.getElementById('admin-users-list'));
        if (!container) return;

        if (adminOpen) window.setAdminNavActive?.('copa');
        else window.setSupervisorNavActive?.('copa');
        container.innerHTML = window.OPS_LOADING_HTML || '<div class="ops-loading"><p>Cargando Copa…</p></div>';

        try {
            const snap = await getDocs(query(challengesCol(), orderBy('createdAt', 'desc'), limit(40)));
            let challenges = [];
            snap.forEach((d) => challenges.push({ id: d.id, ...d.data() }));
            if (!challenges.length) {
                const snap2 = await getDocs(query(challengesCol(), limit(40)));
                snap2.forEach((d) => challenges.push({ id: d.id, ...d.data() }));
            }

            const entriesMap = {};
            await Promise.all(challenges.slice(0, 15).map(async (ch) => {
                try {
                    entriesMap[ch.id] = await loadEntriesForChallenge(ch.id, 80);
                } catch (_) {
                    entriesMap[ch.id] = [];
                }
            }));

            container.innerHTML = renderSupervisorCopaPage(challenges, entriesMap);
            setTimeout(() => {
                window.syncCopaDurationUI?.();
                window.syncCopaFormModeUI?.();
                window.refreshCopaProfitability?.();
            }, 30);
        } catch (e) {
            console.error('loadSupervisorCopa:', e);
            container.innerHTML = `<p class="text-red-500 text-center font-bold p-6">Error al cargar Copa: ${escHtml(e.message)}</p>`;
        }
    };

    window.loadAdminCopa = window.loadSupervisorCopa;

    window.createGlobalChallenge = async (btn) => {
        const user = getCurrentUser();
        if (!user) return window.showToast?.('Inicia sesión de nuevo.');

        const kind = document.getElementById('copa-kind')?.value || 'copa';
        const title = document.getElementById('copa-title')?.value?.trim();
        const description = document.getElementById('copa-desc')?.value?.trim() || '';
        const durationPreset = document.getElementById('copa-duration')?.value || DEFAULT_DURATION;
        const duration = DURATION_PRESETS[durationPreset] || DURATION_PRESETS[DEFAULT_DURATION];
        const cityCupEnabled = !!document.getElementById('copa-city-cup')?.checked;
        const publicRanking = document.getElementById('copa-public-ranking')
            ? !!document.getElementById('copa-public-ranking').checked
            : true;
        const qualityEnabled = !!document.getElementById('copa-quality')?.checked;
        const minRatingToClaim = parseFloat(document.getElementById('copa-min-rating')?.value) || 0;
        const minTripsToRank = parseInt(document.getElementById('copa-min-trips-rank')?.value, 10) || 0;
        const competeMode = readCompeteModeFromForm();

        const tiers = readTiersFromForm();
        const podiumPrizes = readPodiumFromForm();
        const econ = readEconomicsFromForm();
        const analysis = analyzeChallengeProfitability({
            competeMode,
            tiers,
            podiumPrizes,
            ...econ
        });
        window.refreshCopaProfitability?.();

        if (!title) return window.showToast?.('Escribe el título del reto.');
        if ((competeMode === 'ranking' || competeMode === 'both') && !podiumPrizes.length) {
            return window.showToast?.('Todos vs todos necesita premios del podio (1°, 2°, 3°) en L.');
        }
        if ((competeMode === 'tiers' || competeMode === 'both') && (!tiers.length || tiers.some((t) => !(t.rewardAmountLps > 0)))) {
            return window.showToast?.('Las metas personales necesitan premio en L. por tier.');
        }
        if (!analysis.ok) {
            window.showToast?.(
                'No se puede publicar: no es rentable. Revisá el panel rojo.',
                'error'
            );
            return;
        }

        const goalTripsRaw = parseInt(document.getElementById('copa-goal-trips')?.value, 10);
        const goalTrips = Number.isFinite(goalTripsRaw) && goalTripsRaw > 0
            ? Math.min(9999, goalTripsRaw)
            : 0;
        const unlimited = !!(duration.unlimited || durationPreset === 'unlimited' || !(duration.ms > 0));

        if ((competeMode === 'ranking' || competeMode === 'both') && unlimited && goalTrips < 1) {
            return window.showToast?.(
                'Sin límite de tiempo: poné la meta de viajes (ej. 1000). La competencia cierra cuando alguien la cumple.',
                'error'
            );
        }

        const original = btn?.innerHTML;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Publicando…</span>';
        }

        try {

            const docData = {
                title,
                description,
                kind,
                status: 'active',
                competeMode,
                tiers,
                podiumPrizes,
                cityCupEnabled,
                publicRanking,
                qualityEnabled,
                minRatingToClaim: qualityEnabled ? minRatingToClaim : 0,
                minTripsToRank,
                goalTrips,
                noTimeLimit: unlimited,
                unlimited,
                durationPreset,
                durationLabel: unlimited
                    ? (goalTrips > 0 ? `Hasta ${goalTrips} viajes` : 'Sin límite — hasta que se cumpla')
                    : duration.label,
                durationMs: unlimited ? 0 : duration.ms,
                startsAtMs: Date.now(),
                economics: {
                    avgTripFare: analysis.fare,
                    commissionPercent: analysis.commissionPercent,
                    estimatedDrivers: analysis.estimatedDrivers,
                    avgTripsPerDriver: analysis.avgTripsPerDriver,
                    minMarginPercent: analysis.minMarginPercent,
                    commissionPerTrip: analysis.commissionPerTrip,
                    totalRewardPerDriver: analysis.totalRewardPerDriver,
                    prizePool: analysis.prizePool,
                    worstCaseCommission: analysis.worstCaseCommission,
                    worstCasePayout: analysis.worstCasePayout,
                    fleetMargin: analysis.fleetMargin,
                    approvedAt: Date.now()
                },
                createdByUid: user.uid,
                createdByName: getSenderName(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            if (!unlimited && duration.ms > 0) {
                const expiresAtDate = new Date(Date.now() + duration.ms);
                docData.expiresAt = Timestamp.fromDate(expiresAtDate);
                docData.expiresAtMs = expiresAtDate.getTime();
            } else {
                docData.expiresAt = null;
                docData.expiresAtMs = null;
            }

            await addDoc(challengesCol(), docData);

            const podiumTxt = podiumPrizes.map((p) => `${p.place}° ${formatLps(p.rewardAmountLps)}`).join(' · ');
            const timeLine = unlimited
                ? (goalTrips > 0 ? `🏁 Sin reloj · hasta ${goalTrips} viajes` : '🏁 Sin reloj · hasta que se cumpla')
                : `⏱️ ${duration.label}`;
            try {
                await addDoc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'), {
                    targetRole: 'driver',
                    message: competeMode === 'tiers'
                        ? `🏆 ${title}\n${description}\n${timeLine}`
                        : `🏆 ${title}\nTODOS VS TODOS — ranking en vivo\nPodio: ${podiumTxt}\n${timeLine}`,
                    sentBy: user.uid,
                    sentByName: getSenderName(),
                    createdAt: serverTimestamp(),
                    createdAtMs: Date.now(),
                    copaAlert: true
                });
            } catch (_) {}

            if (publicRanking) {
                try {
                    await addDoc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'), {
                        targetRole: 'client',
                        message: `🏆 Ranking público (todos vs todos): ${title}. Mirá quién va ganando en HonduRaite.`,
                        sentBy: user.uid,
                        sentByName: getSenderName(),
                        createdAt: serverTimestamp(),
                        createdAtMs: Date.now(),
                        copaPublicAlert: true
                    });
                } catch (_) {}
            }

            window.showToast?.(
                '¡Competencia publicada! Conductores compiten todos vs todos. Ranking en vivo.',
                'success'
            );
            await window.loadSupervisorCopa();
        } catch (e) {
            console.error('createGlobalChallenge:', e);
            window.showToast?.('No se pudo publicar el reto.');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        }
    };

    window.closeGlobalChallenge = async (id) => {
        if (!confirm('¿Cerrar la competencia y fijar el podio final? Ya no sumará viajes. Los top del ranking quedan listos para cobrar.')) return;
        try {
            const result = await finalizeChallengePodium(id, { reason: 'manual' });
            const finalPodium = result?.finalPodium || [];
            window.showToast?.(
                finalPodium.length
                    ? `Competencia cerrada. Podio: ${finalPodium.map((w) => `#${w.place} ${w.driverName}`).join(', ')}`
                    : 'Competencia cerrada.',
                'success'
            );
            await window.loadSupervisorCopa();
        } catch (e) {
            console.error(e);
            window.showToast?.('Error al cerrar.');
        }
    };

    window.cancelGlobalChallenge = async (id) => {
        if (!confirm('¿Cancelar este reto?')) return;
        try {
            await updateDoc(challengeDocRef(id), {
                status: 'cancelled',
                updatedAt: serverTimestamp()
            });
            window.showToast?.('Reto cancelado.', 'warning');
            await window.loadSupervisorCopa();
        } catch (e) {
            console.error(e);
            window.showToast?.('Error al cancelar.');
        }
    };

    /**
     * Reconfigurar copa activa SIN borrar ranking ni poner viajes en 0.
     * Sirve para bajar "mín. viajes para rankear" a 1 (desde el primer viaje).
     */
    window.openReconfigureDriverCopa = async (challengeId) => {
        if (!challengeId) return;
        let ch = null;
        try {
            const snap = await getDoc(challengeDocRef(challengeId));
            if (!snap.exists()) return window.showToast?.('Reto no encontrado.');
            ch = { id: snap.id, ...snap.data() };
        } catch (e) {
            console.error(e);
            return window.showToast?.('No se pudo cargar el reto.');
        }
        if (ch.status !== 'active') {
            return window.showToast?.('Solo se reconfiguran retos activos.', 'warning');
        }

        document.getElementById('copa-reconfig-modal')?.remove();
        const minRank = parseInt(ch.minTripsToRank, 10);
        const goal = getGoalTrips(ch) || DEFAULT_GOAL_TRIPS;
        const modal = document.createElement('div');
        modal.id = 'copa-reconfig-modal';
        modal.setAttribute('style',
            'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;'
            + 'padding:1rem;background:rgba(0,0,0,0.78);'
        );
        modal.innerHTML = `
            <div style="background:#0f172a;color:#fff;width:100%;max-width:26rem;border-radius:1.25rem;border:1px solid #334155;
                box-shadow:0 25px 50px rgba(0,0,0,.5);padding:1.15rem;max-height:90dvh;overflow:auto;">
                <p style="margin:0;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#34d399;">Copa conductores</p>
                <h3 style="margin:0.25rem 0 0;font-size:1.1rem;font-weight:900;">Reconfigurar (sin borrar ranking)</h3>
                <p style="margin:0.45rem 0 0.85rem;font-size:12px;color:#94a3b8;font-weight:700;line-height:1.4;">
                    <b style="color:#6ee7b7;">${escHtml(ch.title || 'Reto')}</b><br>
                    Los puntos y viajes ya contados <b style="color:#fde68a;">se mantienen</b>. Solo cambias reglas de apariencia / meta.
                </p>
                <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.25rem;">
                    Mín. viajes para aparecer en el ranking
                </label>
                <input type="number" id="copa-reconfig-min-rank" min="0" max="999" value="${Number.isFinite(minRank) ? minRank : 1}"
                    style="width:100%;padding:0.65rem 0.75rem;border-radius:0.75rem;border:1px solid #334155;background:#020617;color:#fff;font-weight:800;margin-bottom:0.35rem;">
                <p style="margin:0 0 0.75rem;font-size:11px;color:#64748b;font-weight:700;line-height:1.35;">
                    Pon <b style="color:#93c5fd;">1</b> (o 0) para que cuente desde el <b>primer viaje</b>. Antes solía ser 3 o 5 y no salían en el podio.
                </p>
                <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.25rem;">
                    Meta de viajes (cierre automático)
                </label>
                <input type="number" id="copa-reconfig-goal" min="0" max="9999" value="${goal}"
                    style="width:100%;padding:0.65rem 0.75rem;border-radius:0.75rem;border:1px solid #334155;background:#020617;color:#fff;font-weight:800;margin-bottom:0.75rem;">
                <label style="display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8;margin-bottom:0.25rem;">
                    Título
                </label>
                <input type="text" id="copa-reconfig-title" maxlength="120" value="${escHtml(ch.title || '')}"
                    style="width:100%;padding:0.65rem 0.75rem;border-radius:0.75rem;border:1px solid #334155;background:#020617;color:#fff;font-weight:800;margin-bottom:0.75rem;">
                <label style="display:flex;align-items:center;gap:0.45rem;font-size:12px;font-weight:800;color:#e2e8f0;cursor:pointer;margin-bottom:1rem;">
                    <input type="checkbox" id="copa-reconfig-public" ${ch.publicRanking !== false ? 'checked' : ''}>
                    Ranking público (todos lo ven)
                </label>
                <button type="button" id="copa-reconfig-save" class="ops-btn ops-btn--emerald"
                    style="width:100%;padding:0.85rem;font-weight:900;border:0;border-radius:0.85rem;cursor:pointer;background:#059669;color:#fff;">
                    Guardar cambios (sin reiniciar a 0)
                </button>
                <button type="button" id="copa-reconfig-close"
                    style="width:100%;margin-top:0.45rem;padding:0.65rem;background:transparent;border:0;color:#94a3b8;font-weight:900;font-size:12px;cursor:pointer;">
                    Cancelar
                </button>
            </div>
        `;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        modal.querySelector('#copa-reconfig-close')?.addEventListener('click', close);
        modal.querySelector('#copa-reconfig-save')?.addEventListener('click', async () => {
            const btn = modal.querySelector('#copa-reconfig-save');
            const minTripsToRank = Math.max(0, parseInt(modal.querySelector('#copa-reconfig-min-rank')?.value, 10) || 0);
            const goalTrips = Math.max(0, parseInt(modal.querySelector('#copa-reconfig-goal')?.value, 10) || 0);
            const title = String(modal.querySelector('#copa-reconfig-title')?.value || '').trim() || ch.title;
            const publicRanking = !!modal.querySelector('#copa-reconfig-public')?.checked;
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Guardando…';
            }
            try {
                await updateDoc(challengeDocRef(challengeId), {
                    minTripsToRank,
                    goalTrips,
                    title,
                    publicRanking,
                    reconfiguredAt: serverTimestamp(),
                    reconfiguredBy: getCurrentUser()?.uid || null,
                    updatedAt: serverTimestamp()
                });
                window.showToast?.(
                    minTripsToRank <= 1
                        ? `Listo. Ranking desde el 1.er viaje (mín. ${minTripsToRank}). Puntos anteriores intactos.`
                        : `Listo. Mín. ${minTripsToRank} viajes para rankear. Puntos anteriores intactos.`,
                    'success'
                );
                close();
                await window.loadSupervisorCopa?.();
                try { window.refreshDriverCopaUI?.(); } catch (_) {}
                try { window.startPublicCopaListener?.(); } catch (_) {}
            } catch (e) {
                console.error('reconfigure driver copa:', e);
                window.showToast?.(e?.message || 'No se pudo guardar.', 'error');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Guardar cambios (sin reiniciar a 0)';
                }
            }
        });
    };

    window.markCopaRewardPaid = async (challengeId, driverUid, tierId) => {
        if (!confirm('¿Confirmas que ya pagaste este premio al conductor?')) return;
        const user = getCurrentUser();
        try {
            const ref = entryDocRef(challengeId, driverUid);
            const snap = await getDoc(ref);
            if (!snap.exists()) return window.showToast?.('Entrada no encontrada.');
            const data = snap.data();
            const paid = { ...(data.rewardPaidTiers || {}), [tierId]: true };
            await updateDoc(ref, {
                rewardPaidTiers: paid,
                updatedAt: serverTimestamp()
            });

            const chSnap = await getDoc(challengeDocRef(challengeId));
            const tier = normalizeTiers(chSnap.data()?.tiers).find((t) => t.id === tierId);
            const driverName = data.driverName || 'Conductor';

            const newRef = doc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'));
            await setDoc(newRef, {
                targetRole: 'driver',
                targetUserId: String(driverUid),
                targetUserName: driverName,
                personal: true,
                threadId: newRef.id,
                message: `🎉 Premio Copa pagado: ${tier?.label || tierId} — ${tier?.reward || ''}`,
                sentBy: user?.uid,
                sentByName: getSenderName(),
                createdAt: serverTimestamp(),
                createdAtMs: Date.now()
            });

            window.showToast?.('Premio marcado como pagado.', 'success');
            await window.loadSupervisorCopa();
        } catch (e) {
            console.error('markCopaRewardPaid:', e);
            window.showToast?.('Error al marcar pago.');
        }
    };

    window.claimCopaPodium = async (challengeId) => {
        const user = getCurrentUser();
        const profile = getDriverProfile() || window.userProfile;
        if (!user) return;
        if (!requireVerifiedForDriverCopa(profile)) return;
        try {
            const [chSnap, entrySnap] = await Promise.all([
                getDoc(challengeDocRef(challengeId)),
                getDoc(entryDocRef(challengeId, user.uid))
            ]);
            if (!chSnap.exists() || !entrySnap.exists()) return window.showToast?.('No encontrado.');
            const ch = { id: challengeId, ...chSnap.data() };
            if (ch.status === 'active' && isChallengeActive(ch)) {
                return window.showToast?.('La competencia sigue abierta. El podio se reclama al cerrar el reto.');
            }
            const entry = entrySnap.data();
            if (entry.podiumClaimed) return window.showToast?.('Ya reclamaste el premio de podio.');

            let finalRank = entry.finalRank;
            let rewardLps = entry.podiumRewardLps;
            if (!finalRank || !rewardLps) {
                const entries = await loadEntriesForChallenge(challengeId, 200);
                const info = computeRankFromEntries(entries, user.uid, ch.minTripsToRank || 0);
                finalRank = info.rank;
                const prize = normalizePodium(ch.podiumPrizes).find((p) => p.place === finalRank);
                if (!prize) return window.showToast?.('No estás en el podio de premios.');
                rewardLps = prize.rewardAmountLps;
            }
            if (qualityBlocksClaim(ch, entry)) {
                return window.showToast?.(`Rating mínimo ${ch.minRatingToClaim} requerido.`);
            }
            if (!confirm(`¿Reclamar premio del puesto #${finalRank}?\n${formatLps(rewardLps)}\n\nSe avisará a supervisión.`)) return;

            await updateDoc(entryDocRef(challengeId, user.uid), {
                podiumClaimed: true,
                podiumClaimedAt: serverTimestamp(),
                finalRank,
                podiumRewardLps: rewardLps,
                updatedAt: serverTimestamp()
            });

            await addDoc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'), {
                targetRole: 'supervisor',
                message: `🥇 ${profile?.name || 'Conductor'} reclamó podio #${finalRank} en «${ch.title}»: ${formatLps(rewardLps)}. ¡Págale!`,
                sentBy: user.uid,
                sentByName: profile?.name || 'Conductor',
                createdAt: serverTimestamp(),
                createdAtMs: Date.now(),
                copaPodiumClaim: true,
                challengeId,
                relatedDriverId: user.uid
            });

            window.showToast?.('¡Podio reclamado! Supervisión fue notificada.', 'success');
            cachedEntries[challengeId] = {
                ...entry,
                podiumClaimed: true,
                finalRank,
                podiumRewardLps: rewardLps
            };
            refreshDriverCopaUI();
        } catch (e) {
            console.error('claimCopaPodium:', e);
            window.showToast?.('No se pudo reclamar el podio.');
        }
    };

    window.markCopaPodiumPaid = async (challengeId, driverUid) => {
        if (!confirm('¿Confirmas que ya pagaste el premio de podio a este conductor?')) return;
        const user = getCurrentUser();
        try {
            const ref = entryDocRef(challengeId, driverUid);
            const snap = await getDoc(ref);
            if (!snap.exists()) return window.showToast?.('Entrada no encontrada.');
            const data = snap.data();
            await updateDoc(ref, {
                podiumPaid: true,
                podiumPaidAt: serverTimestamp(),
                podiumPaidBy: user?.uid || null,
                updatedAt: serverTimestamp()
            });
            const newRef = doc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'));
            await setDoc(newRef, {
                targetRole: 'driver',
                targetUserId: String(driverUid),
                targetUserName: data.driverName || 'Conductor',
                personal: true,
                threadId: newRef.id,
                message: `🎉 Premio de podio #${data.finalRank || ''} pagado: ${formatLps(data.podiumRewardLps || 0)}`,
                sentBy: user?.uid,
                sentByName: getSenderName(),
                createdAt: serverTimestamp(),
                createdAtMs: Date.now()
            });
            window.showToast?.('Podio marcado como pagado.', 'success');
            await window.loadSupervisorCopa();
        } catch (e) {
            console.error('markCopaPodiumPaid:', e);
            window.showToast?.('Error al marcar pago de podio.');
        }
    };

    window.claimCopaTier = async (challengeId, tierId) => {
        const user = getCurrentUser();
        const profile = getDriverProfile() || window.userProfile;
        if (!user) return;
        if (!requireVerifiedForDriverCopa(profile)) return;

        try {
            const [chSnap, entrySnap] = await Promise.all([
                getDoc(challengeDocRef(challengeId)),
                getDoc(entryDocRef(challengeId, user.uid))
            ]);
            if (!chSnap.exists()) return window.showToast?.('Reto no encontrado.');
            const ch = { id: challengeId, ...chSnap.data() };
            if (!isChallengeActive(ch)) return window.showToast?.('Este reto ya no está activo.');

            if (!entrySnap.exists()) return window.showToast?.('Aún no estás inscrito.');
            const entry = entrySnap.data();
            const tier = normalizeTiers(ch.tiers).find((t) => t.id === tierId);
            if (!tier) return;
            if ((parseInt(entry.progress, 10) || 0) < tier.targetTrips) {
                return window.showToast?.(`Te faltan viajes para ${tier.label}.`);
            }
            if (tierClaimKey(entry, tierId)) {
                return window.showToast?.('Ya reclamaste este tier.');
            }
            if (qualityBlocksClaim(ch, entry)) {
                return window.showToast?.(`Necesitás rating mínimo ${ch.minRatingToClaim}.`);
            }
            if (!confirm(`¿Reclamar premio ${tier.label}?\n${tier.reward}\n\nSe avisará a supervisión para el pago.`)) return;

            const claimed = { ...(entry.tiersClaimed || {}), [tierId]: true };
            await updateDoc(entryDocRef(challengeId, user.uid), {
                tiersClaimed: claimed,
                lastClaimedTier: tierId,
                lastClaimedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            await addDoc(collection(dbRef, 'artifacts', appIdRef, 'public', 'data', 'notifications'), {
                targetRole: 'supervisor',
                message: `🏆 ${profile?.name || 'Conductor'} reclamó ${tier.label} en «${ch.title}». Premio: ${tier.reward}. ¡Págale!`,
                sentBy: user.uid,
                sentByName: profile?.name || 'Conductor',
                createdAt: serverTimestamp(),
                createdAtMs: Date.now(),
                copaClaimAlert: true,
                challengeId,
                tierId,
                relatedDriverId: user.uid,
                rewardText: tier.reward
            });

            window.showToast?.('¡Premio reclamado! Supervisión fue notificada.', 'success');
            cachedEntries[challengeId] = { ...entry, tiersClaimed: claimed };
            refreshDriverCopaUI();
        } catch (e) {
            console.error('claimCopaTier:', e);
            window.showToast?.('No se pudo reclamar.');
        }
    };

    window.toggleCopaMinimized = (challengeId, minimized) => {
        setMinimized(challengeId, minimized);
        refreshDriverCopaUI();
    };

    // Reafirmar API global (también se define al cargar el módulo)
    window.dismissCopaFloat = (challengeId) => {
        if (challengeId) setDismissed(challengeId, true);
        dismissAllDriverCopaOnScreen();
    };

    window.dismissAllDriverCopa = () => {
        dismissAllDriverCopaOnScreen();
    };

    window.restoreCopaFloat = (challengeId) => {
        setStripDismissedThisSession(false);
        if (challengeId) restoreCopaOnScreen(challengeId);
        else resetCopaSessionDismiss();
        refreshDriverCopaUI();
    };

    window.openDriverCopaModal = async (challengeId, opts) => {
        setStripDismissedThisSession(false);
        if (challengeId) restoreCopaOnScreen(challengeId);
        return openDriverCopaModal(challengeId, opts);
    };
    window.closeDriverCopaModal = closeDriverCopaModal;
    window.openPublicCopaRanking = openPublicCopaRanking;
    window.dismissPublicCopaStrip = () => dismissPublicCopaStripOnScreen();
    window.refreshDriverCopaUI = () => refreshDriverCopaUI();

    window.openDriverCopaFromMenu = async () => {
        const role = window.userProfile?.role;
        if (role === 'driver') {
            try {
                if (!cachedChallenges.filter(isChallengeActive).length) {
                    await reloadDriverCopaState();
                }
                const active = cachedChallenges.filter(isChallengeActive);
                if (!active.length) {
                    return openPublicCopaRanking();
                }
                // Volver a mostrar todas (como reabrir promos)
                resetCopaSessionDismiss();
                active.forEach((c) => restoreCopaOnScreen(c.id));
                refreshDriverCopaUI();
                await openDriverCopaModal(active[0].id);
            } catch (e) {
                console.warn('openDriverCopaFromMenu:', e);
                window.showToast?.('No se pudo abrir la Copa.', 'warning');
            }
            return;
        }
        await openPublicCopaRanking();
    };

    /** Menú ⋮: Copa Conductores oculta (se veía mal en Android; ranking sigue en el mapa) */
    window.syncDriverCopaMenuVisibility = (_role) => {
        const el = document.getElementById('header-menu-copa');
        if (!el) return;
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
    };

    window.startPublicCopaListener = () => {
        if (publicChallengesUnsub) return;
        try {
            publicChallengesUnsub = onSnapshot(
                query(challengesCol(), where('status', '==', 'active'), limit(20)),
                (snap) => {
                    publicCachedChallenges = [];
                    snap.forEach((d) => {
                        const ch = { id: d.id, ...d.data() };
                        if (isChallengeActive(ch)) publicCachedChallenges.push(ch);
                    });
                    renderPublicCopaStrip();
                },
                (err) => console.warn('publicCopaListener:', err)
            );
        } catch (e) {
            console.warn('startPublicCopaListener:', e);
        }
    };

    window.stopPublicCopaListener = () => {
        if (publicChallengesUnsub) {
            publicChallengesUnsub();
            publicChallengesUnsub = null;
        }
        publicCachedChallenges = [];
        const el = document.getElementById('public-copa-strip');
        if (el) {
            el.classList.add('hidden');
            el.innerHTML = '';
        }
    };

    window.startDriverCopaListener = () => {
        const user = getCurrentUser();
        if (!user || window.userProfile?.role !== 'driver') return;
        if (challengesUnsub) return;

        // Nueva sesión de conductor: la ✕ anterior no cuenta; la copa vuelve a salir
        resetCopaSessionDismiss();

        clearInterval(expiryTimer);
        expiryTimer = setInterval(() => {
            if (window.userProfile?.role !== 'driver') return;
            const before = cachedChallenges.length;
            cachedChallenges = cachedChallenges.filter(isChallengeActive);
            if (cachedChallenges.length !== before) refreshDriverCopaUI();
        }, 30000);

        try {
            challengesUnsub = onSnapshot(
                query(challengesCol(), where('status', '==', 'active'), limit(20)),
                async (snap) => {
                    cachedChallenges = [];
                    snap.forEach((d) => cachedChallenges.push({ id: d.id, ...d.data() }));
                    cachedChallenges = cachedChallenges.filter(isChallengeActive);
                    const profile = getDriverProfile() || window.userProfile;
                    await Promise.all(cachedChallenges.map(async (ch) => {
                        try {
                            cachedEntries[ch.id] = await ensureEntry(ch.id, user.uid, profile);
                        } catch (_) {}
                    }));
                    const competing = canCompeteInDriverCopa(profile)
                        ? cachedChallenges
                        : cachedChallenges.filter((ch) => cachedEntries[ch.id] && !cachedEntries[ch.id]._localOnly);
                    bindEntryListeners(competing, user.uid);
                    if (canCompeteInDriverCopa(profile)) {
                        await Promise.all(cachedChallenges.filter(isRankingMode).map((ch) =>
                            refreshRankForChallenge(ch.id, user.uid, ch.minTripsToRank || 0)
                        ));
                    }
                    refreshDriverCopaUI();
                },
                (err) => console.warn('driverCopaListener:', err)
            );
        } catch (e) {
            console.warn('startDriverCopaListener:', e);
            reloadDriverCopaState().catch(() => {});
        }
    };

    window.stopDriverCopaListener = () => {
        if (challengesUnsub) {
            challengesUnsub();
            challengesUnsub = null;
        }
        stopEntryListeners();
        clearInterval(expiryTimer);
        expiryTimer = null;
        // Cerrar sesión: limpiar dismiss para que al re-login vuelva a abrir
        resetCopaSessionDismiss();
        document.getElementById('driver-copa-active')?.classList.add('hidden');
        const activeLayer = document.getElementById('driver-copa-active');
        if (activeLayer) activeLayer.innerHTML = '';
        const badge = document.getElementById('driver-copa-map-strip');
        if (badge) badge.classList.add('hidden');
        purgeDriverCopaFromPanel();
    };

    window.renderDriverCopaPanel = () => reloadDriverCopaState();
    window.incrementCopaOnTripComplete = incrementCopaOnTripComplete;
    window.applyCopaRatingFromTrip = applyCopaRatingFromTrip;
}
