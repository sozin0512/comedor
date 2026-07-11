import {
    doc, getDoc, setDoc, updateDoc, addDoc, getDocs,
    collection, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { APP_CONFIG } from "./config.js";

const REWARDS = APP_CONFIG.referrals;

const PENDING_KEY = "pendingReferralCode";

export function normalizeReferralCode(code) {
    return (code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function getPendingReferralCode() {
    const fromStorage = localStorage.getItem(PENDING_KEY);
    if (fromStorage) return normalizeReferralCode(fromStorage);

    const urlCode = new URLSearchParams(window.location.search).get("ref");
    return urlCode ? normalizeReferralCode(urlCode) : null;
}

export function setPendingReferralCode(code) {
    const normalized = normalizeReferralCode(code);
    if (normalized) localStorage.setItem(PENDING_KEY, normalized);
}

export function clearPendingReferralCode() {
    localStorage.removeItem(PENDING_KEY);
}

export function resolveReferralCodeInput() {
    const input = document.getElementById("referral-code-input")?.value?.trim()
        || document.getElementById("passenger-referral-code")?.value?.trim();
    if (input) return normalizeReferralCode(input);
    return getPendingReferralCode();
}

function referralCodesPath(appId, code) {
    return doc(dbRef(), "artifacts", appId, "public", "data", "referral_codes", code);
}

function userPrivatePath(appId, uid) {
    return doc(dbRef(), "artifacts", appId, "users", uid, "profile", "data");
}

function userPublicPath(appId, uid) {
    return doc(dbRef(), "artifacts", appId, "public", "data", "users", uid);
}

function referralEventsPath(appId) {
    return collection(dbRef(), "artifacts", appId, "public", "data", "referral_events");
}

let _db = null;
function dbRef() {
    return _db;
}

export function initReferrals(db) {
    _db = db;
}

function generateCode(name) {
    const prefix = (name || "USER").replace(/[^a-zA-Z]/g, "").substring(0, 4).toUpperCase() || "HOND";
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${suffix}`;
}

export async function ensureReferralCode(db, appId, uid, name, role) {
    initReferrals(db);

    const publicRef = userPublicPath(appId, uid);
    const publicSnap = await getDoc(publicRef);
    const existing = publicSnap.data()?.referralCode;

    if (existing) {
        await setDoc(referralCodesPath(appId, existing), {
            uid, name: name || "Usuario", role: role || "client",
            updatedAt: serverTimestamp()
        }, { merge: true });
        return existing;
    }

    for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateCode(name);
        const codeRef = referralCodesPath(appId, code);
        const codeSnap = await getDoc(codeRef);
        if (codeSnap.exists()) continue;

        await setDoc(codeRef, { uid, name: name || "Usuario", role: role || "client", createdAt: serverTimestamp() });

        if (publicSnap.exists()) {
            const payload = {
                referralCode: code,
                totalReferrals: publicSnap.data()?.totalReferrals || 0,
                referralEarnings: publicSnap.data()?.referralEarnings || 0
            };
            await setDoc(publicRef, payload, { merge: true });
            await setDoc(userPrivatePath(appId, uid), { referralCode: code }, { merge: true });
        }

        return code;
    }

    throw new Error("No se pudo generar un código de referido único.");
}

async function findReferrer(appId, code) {
    const codeSnap = await getDoc(referralCodesPath(appId, code));
    if (!codeSnap.exists()) return null;

    const { uid } = codeSnap.data();
    const userSnap = await getDoc(userPublicPath(appId, uid));
    if (!userSnap.exists()) return null;

    return { uid, ...userSnap.data() };
}

export async function processReferral(db, appId, newUserId, newUserName, newUserRole, rawCode) {
    initReferrals(db);

    const code = normalizeReferralCode(rawCode);
    if (!code) return { success: false, reason: "no_code" };

    const publicRef = userPublicPath(appId, newUserId);
    const profileSnap = await getDoc(publicRef);

    if (profileSnap.data()?.referredByUid || profileSnap.data()?.referralProcessed) {
        clearPendingReferralCode();
        return { success: false, reason: "already_referred" };
    }

    const referrer = await findReferrer(appId, code);
    if (!referrer) return { success: false, reason: "invalid_code" };

    if (referrer.uid === newUserId) {
        clearPendingReferralCode();
        return { success: false, reason: "self_referral" };
    }

    const isDriverReferrer = referrer.role === "driver";
    const referrerReward = REWARDS.referrerAmount;
    const newUserReward = REWARDS.newUserAmount;

    const currentProfile = profileSnap.data() || {};
    const newBalance = (currentProfile.balance || 0) + newUserReward;

    const referralData = {
        referrerUid: referrer.uid,
        referrerName: referrer.name || "Usuario",
        referredUid: newUserId,
        referredName: newUserName || "Usuario",
        referralCode: code,
        referrerReward,
        newUserReward,
        rewardType: isDriverReferrer ? "cash" : "points",
        referrerRewardClaimed: false,
        newUserRewardCredited: true,
        newUserRewardCreditedAt: serverTimestamp(),
        firstTripCompleted: false,
        createdAt: serverTimestamp()
    };

    const eventRef = await addDoc(referralEventsPath(appId), referralData);

    const referralFields = {
        referredByCode: code,
        referredByUid: referrer.uid,
        referredBy: code,
        referredAt: serverTimestamp(),
        referralProcessed: true,
        referralRewardPending: false,
        referralRewardCredited: true,
        referralSignupBonus: newUserReward,
        balance: newBalance
    };

    await setDoc(userPrivatePath(appId, newUserId), referralFields, { merge: true });
    await setDoc(publicRef, referralFields, { merge: true });

    clearPendingReferralCode();

    return {
        success: true,
        referrerName: referrer.name,
        newUserReward,
        referrerReward,
        rewardType: referralData.rewardType,
        newUserRewardCredited: true,
        newBalance,
        eventId: eventRef.id
    };
}

/** L. 20 al meter el código (respaldo si quedó pendiente en cuentas antiguas). */
export async function creditReferralSignupBonus(db, appId, uid) {
    initReferrals(db);

    const publicRef = userPublicPath(appId, uid);
    const profileSnap = await getDoc(publicRef);
    const profile = profileSnap.data() || {};

    if (!profile.referredByUid || profile.referralRewardCredited) {
        return { credited: false, reason: "not_needed" };
    }

    const eventsQ = query(referralEventsPath(appId), where("referredUid", "==", uid));
    const eventsSnap = await getDocs(eventsQ);
    if (eventsSnap.empty) return { credited: false, reason: "no_event" };

    const eventDoc = eventsSnap.docs[0];
    const event = eventDoc.data();
    if (event.newUserRewardCredited) {
        await setDoc(publicRef, { referralRewardCredited: true, referralRewardPending: false }, { merge: true });
        return { credited: false, reason: "already_credited_event" };
    }

    const newUserReward = event.newUserReward || REWARDS.newUserAmount;
    const newBalance = (profile.balance || 0) + newUserReward;
    const userUpdates = {
        balance: newBalance,
        referralRewardCredited: true,
        referralRewardPending: false,
        referralSignupBonus: newUserReward
    };

    await setDoc(publicRef, userUpdates, { merge: true });
    await setDoc(userPrivatePath(appId, uid), userUpdates, { merge: true });
    await updateDoc(eventDoc.ref, {
        newUserRewardCredited: true,
        newUserRewardCreditedAt: serverTimestamp()
    });

    if (typeof window !== "undefined" && window.userProfile && window.currentUser?.uid === uid) {
        Object.assign(window.userProfile, userUpdates);
        window.refreshPassengerBalanceUI?.();
    }

    return { credited: true, newUserReward, newBalance };
}

/**
 * Ya no paga al iniciar sesión. Solo sincroniza contadores desde eventos ya pagados.
 * El pago al referente ocurre en creditReferralOnFirstTrip cuando el referido termina su 1er viaje.
 */
export async function claimPendingReferralRewards(db, appId, uid, userProfile) {
    initReferrals(db);

    const q = query(referralEventsPath(appId), where("referrerUid", "==", uid));
    const snap = await getDocs(q);

    let paidCount = 0;
    let paidAmount = 0;
    let pendingCount = 0;

    snap.docs.forEach((eventDoc) => {
        const event = eventDoc.data();
        if (event.referrerRewardClaimed) {
            paidCount++;
            paidAmount += event.referrerReward || REWARDS.referrerAmount;
        } else {
            pendingCount++;
        }
    });

    const publicRef = userPublicPath(appId, uid);
    const privateRef = userPrivatePath(appId, uid);
    const currentPublic = (await getDoc(publicRef)).data() || {};

    const syncedTotalReferrals = Math.max(currentPublic.totalReferrals || 0, paidCount);
    const syncedEarnings = Math.max(currentPublic.referralEarnings || 0, paidAmount);

    if (
        syncedTotalReferrals !== (currentPublic.totalReferrals || 0)
        || syncedEarnings !== (currentPublic.referralEarnings || 0)
    ) {
        const updates = {
            totalReferrals: syncedTotalReferrals,
            referralEarnings: syncedEarnings
        };
        await setDoc(publicRef, updates, { merge: true });
        await setDoc(privateRef, updates, { merge: true });
        if (userProfile) Object.assign(userProfile, updates);
    }

    return { total: 0, amount: 0, paidCount, pendingCount };
}

/**
 * Acredita L. 50 al referente cuando el referido completa su primer viaje.
 * Los L. 20 del referido se cargan al meter el código (processReferral).
 */
export async function creditReferralOnFirstTrip(db, appId, clientUid) {
    initReferrals(db);

    const publicRef = userPublicPath(appId, clientUid);
    const profileSnap = await getDoc(publicRef);
    const profile = profileSnap.data() || {};

    if (!profile.referredByUid) return { credited: false, reason: "no_referral" };

    const eventsQ = query(referralEventsPath(appId), where("referredUid", "==", clientUid));
    const eventsSnap = await getDocs(eventsQ);
    if (eventsSnap.empty) return { credited: false, reason: "no_event" };

    const eventDoc = eventsSnap.docs[0];
    const event = eventDoc.data();

    if (event.referrerRewardClaimed) {
        return { credited: false, reason: "referrer_already_paid" };
    }

    const referrerReward = event.referrerReward || REWARDS.referrerAmount;
    const referrerUid = event.referrerUid;

    await updateDoc(eventDoc.ref, {
        firstTripCompleted: true,
        firstTripCompletedAt: serverTimestamp()
    });

    if (referrerUid && !event.referrerRewardClaimed) {
        try {
            const refPublicRef = userPublicPath(appId, referrerUid);
            const refSnap = await getDoc(refPublicRef);
            const refProfile = refSnap.data() || {};

            const refUpdates = {
                totalReferrals: (refProfile.totalReferrals || 0) + 1,
                referralEarnings: (refProfile.referralEarnings || 0) + referrerReward,
                balance: (refProfile.balance || 0) + referrerReward
            };

            await setDoc(refPublicRef, refUpdates, { merge: true });
            await setDoc(userPrivatePath(appId, referrerUid), refUpdates, { merge: true });

            await updateDoc(eventDoc.ref, {
                referrerRewardClaimed: true,
                referrerRewardCreditedAt: serverTimestamp()
            });

            if (typeof window !== "undefined" && window.currentUser?.uid === referrerUid) {
                if (window.userProfile) {
                    Object.assign(window.userProfile, refUpdates);
                }
                window.showToast?.(
                    `¡Tu referido completó su primer viaje! +L. ${referrerReward.toFixed(2)}`,
                    "success"
                );
                window.refreshPassengerBalanceUI?.();
            }
        } catch (e) {
            console.warn("No se pudo acreditar recompensa al referente:", e);
        }
    }

    return {
        credited: true,
        referrerReward,
        referrerUid
    };
}

export async function getMyReferrals(db, appId, uid, referralCode) {
    initReferrals(db);

    const q = query(referralEventsPath(appId), where("referrerUid", "==", uid));
    const eventsSnap = await getDocs(q);

    if (!eventsSnap.empty) {
        return eventsSnap.docs.map(d => {
            const e = d.data();
            const claimed = !!e.referrerRewardClaimed;
            return {
                name: e.referredName,
                reward: e.referrerReward || REWARDS.referrerAmount,
                rewardType: e.rewardType,
                date: e.createdAt?.toDate?.() || new Date(),
                claimed,
                statusLabel: claimed ? "Pagado" : "Pendiente (1er viaje)"
            };
        }).sort((a, b) => b.date - a.date);
    }

    const usersSnap = await getDocs(collection(dbRef(), "artifacts", appId, "public", "data", "users"));
    const referrals = [];

    usersSnap.forEach(d => {
        const data = d.data();
        if (data.referredByUid === uid || (referralCode && data.referredBy === referralCode)) {
            const claimed = !!data.referralRewardCredited;
            referrals.push({
                name: data.name,
                reward: REWARDS.referrerAmount,
                rewardType: data.role === "driver" ? "cash" : "points",
                date: data.referredAt?.toDate?.() || new Date(),
                claimed,
                statusLabel: claimed ? "Pagado" : "Pendiente (1er viaje)"
            });
        }
    });

    return referrals;
}

export function storeReferralFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get("ref");
    if (!refCode) return null;

    const normalized = normalizeReferralCode(refCode);
    setPendingReferralCode(normalized);
    return normalized;
}

export function showReferralInviteModal(code) {
    setTimeout(() => {
        if (document.querySelector("[data-referral-invite-modal]")) return;

        const modal = document.createElement("div");
        modal.setAttribute("data-referral-invite-modal", "1");
        modal.className = "fixed inset-0 bg-black/60 z-[50000] flex items-end md:items-center justify-center";

        modal.innerHTML = `
            <div class="bg-white w-full md:w-[380px] md:rounded-3xl rounded-t-3xl p-6 shadow-2xl">
                <div class="text-center">
                    <div class="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                        <i class="fas fa-gift text-emerald-600 text-3xl"></i>
                    </div>
                    <h3 class="font-black text-xl mb-2">¡Fuiste invitado!</h3>
                    <p class="text-gray-600 mb-1">Código de referido detectado:</p>
                    <p class="font-black text-2xl text-emerald-600 tracking-widest mb-4">${code}</p>
                    <p class="text-sm text-gray-500 mb-4">Recibes <strong>L. ${REWARDS.newUserAmount}</strong> al usar el código. Quien te invitó gana <strong>L. ${REWARDS.referrerAmount}</strong> cuando completes tu <strong>primer viaje</strong>.</p>
                    <button onclick="this.closest('.fixed').remove()"
                            class="w-full bg-emerald-600 text-white font-black py-3 rounded-2xl text-sm">
                        ENTENDIDO
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }, 1500);
}