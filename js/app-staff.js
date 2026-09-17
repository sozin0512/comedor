/** Runtime staff: estadísticas, depósitos y personalización. Tras login admin/supervisor. */
import { collection, getDocs, doc, setDoc, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getCustomTones, saveTonePrefs, listTones } from './notification-tones.js';
import { isCapacitorNative } from './capacitor-native.js';

export function installStaffRuntime() {
    if (window.__hrStaffRuntime) return;
    window.__hrStaffRuntime = true;
    const db = window.db;
    const appId = window.appId;
// ================================================
// ESTADÍSTICAS GLOBALES (Admin)
// ================================================
window.loadGlobalStats = async (period = 'today', btnElement = null) => {
    const contentDiv = document.getElementById('global-stats-content');
    if (!contentDiv) return;

    // Cambiar botón activo
    if (btnElement) {
        btnElement.parentElement?.querySelectorAll('.ops-chip, button').forEach((b) => {
            b.classList.remove('ops-chip--active', 'bg-emerald-600', 'text-white');
            b.classList.add('bg-gray-700', 'text-white');
        });
        btnElement.classList.remove('bg-gray-700');
        btnElement.classList.add('ops-chip--active', 'bg-emerald-600', 'text-white');
    }

    contentDiv.innerHTML = `
        <div class="flex justify-center items-center py-12">
            <i class="fas fa-spinner fa-spin text-3xl text-emerald-500"></i>
        </div>
    `;

    try {
        const now = new Date();
        let startDate = new Date();

        if (period === 'today') {
            startDate.setHours(0, 0, 0, 0);
        } else if (period === 'week') {
            startDate.setDate(startDate.getDate() - 7);
        } else if (period === 'month') {
            startDate.setMonth(startDate.getMonth() - 1);
        } else if (period === 'year') {
            startDate.setFullYear(startDate.getFullYear() - 1);
        }

        const tripsSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'trips'));

        let totalTrips = 0;
        let totalEarned = 0;
        let cashEarned = 0;
        let saldoEarned = 0;
        let cashTrips = 0;
        let saldoTrips = 0;
        const tripRows = [];
        const driverStats = {};

        tripsSnap.forEach((tripDoc) => {
            const t = tripDoc.data();

            if (t.status === 'completed' && t.createdAt) {
                const tripDate = t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt);

                if (tripDate >= startDate) {
                    const price = parseTripPrice(t);
                    const completedAt = t.completedAt?.toDate?.() || null;
                    const startedAt = t.startedAt?.toDate?.() || null;
                    let durationMin = null;
                    if (completedAt && startedAt) {
                        durationMin = Math.max(1, Math.round((completedAt - startedAt) / 60000));
                    }

                    totalTrips++;
                    totalEarned += price;

                    if (t.paymentMethod === 'saldo') {
                        saldoEarned += price;
                        saldoTrips++;
                    } else {
                        cashEarned += price;
                        cashTrips++;
                    }

                    const driverKey = t.driverId || 'sin-conductor';
                    if (!driverStats[driverKey]) {
                        driverStats[driverKey] = {
                            name: t.driverName || 'Sin conductor',
                            trips: 0,
                            earned: 0
                        };
                    }
                    driverStats[driverKey].trips++;
                    driverStats[driverKey].earned += price;

                    tripRows.push({
                        date: tripDate,
                        driverName: t.driverName || '—',
                        clientName: t.clientName || '—',
                        origin: t.origin || '—',
                        destination: t.destination || '—',
                        price,
                        payment: t.paymentMethod === 'saldo' ? 'Saldo' : 'Efectivo',
                        durationMin,
                        timeLabel: tripDate.toLocaleString('es-HN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    });
                }
            }
        });

        tripRows.sort((a, b) => b.date - a.date);

        // % real de Cuentas bancarias / platformConfig (ej. 18%). Antes estaba hardcodeado 30%.
        let platformPct = 25;
        try {
            platformPct = await getPlatformCommission();
        } catch (_) {
            platformPct = Number(APP_CONFIG.commissionPercent) || 25;
        }
        if (!Number.isFinite(platformPct) || platformPct < 0 || platformPct > 100) {
            platformPct = Number(APP_CONFIG.commissionPercent) || 25;
        }
        const cashCommission = Math.round(cashEarned * (platformPct / 100) * 100) / 100;
        const saldoCommission = Math.round(saldoEarned * (platformPct / 100) * 100) / 100;
        const commission = Math.round((cashCommission + saldoCommission) * 100) / 100;
        const driverSummary = Object.values(driverStats)
            .sort((a, b) => b.earned - a.earned)
            .map((d) => `
                <div class="flex justify-between items-center bg-gray-800/80 rounded-xl px-3 py-2 text-xs">
                    <span class="text-emerald-300 font-bold truncate max-w-[55%]">${d.name}</span>
                    <span class="text-white font-black">${d.trips} viajes · L. ${d.earned.toFixed(2)}</span>
                </div>
            `).join('');

        const tripTable = tripRows.slice(0, 40).map((r) => `
            <div class="bg-gray-800/60 rounded-xl p-3 text-[10px] space-y-1 border border-gray-700/50">
                <div class="flex justify-between gap-2">
                    <span class="text-gray-400 font-bold">${r.timeLabel}</span>
                    <span class="text-emerald-400 font-black">L. ${r.price.toFixed(2)} · ${r.payment}</span>
                </div>
                <p><b class="text-blue-300">Pasajero:</b> ${r.clientName}</p>
                <p><b class="text-emerald-300">Conductor:</b> ${r.driverName}</p>
                <p class="text-gray-400 truncate">${r.origin} → ${r.destination}</p>
                ${r.durationMin ? `<p class="text-violet-300">Duración: ${r.durationMin} min</p>` : ''}
            </div>
        `).join('');

        // —— Conductores que aún no depositaron la comisión ——
        // Antes solo miraba “hoy” (remainingToDeposit). Si el día no se consolidó a deuda,
        // un viaje de hace 2 días desaparecía. Ahora: comisión efectivo 7d − depósitos aprobados.
        const formatElapsedSince = (fromMs) => {
            if (!fromMs || !Number.isFinite(fromMs)) return '—';
            const sec = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
            if (sec < 60) return `${sec} s`;
            const min = Math.floor(sec / 60);
            if (min < 60) return `${min} min`;
            const h = Math.floor(min / 60);
            if (h < 48) {
                const m = min % 60;
                return m ? `${h} h ${m} min` : `${h} h`;
            }
            const d = Math.floor(h / 24);
            const rh = h % 24;
            return rh ? `${d} d ${rh} h` : `${d} d`;
        };

        const depositLookback = new Date();
        depositLookback.setDate(depositLookback.getDate() - 7);
        depositLookback.setHours(0, 0, 0, 0);
        // Más amplio entre período elegido y 7 días (viajes de hace 2 días siempre entran)
        const depositSince = startDate < depositLookback ? startDate : depositLookback;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Por conductor: viajes en efectivo + comisión debida (últimos 7d / período)
        // Usa el % vivo de plataforma (igual que el sistema de depósito del conductor).
        const cashByDriver = {};
        const saldoCoveredByDriver = {};
        tripsSnap.forEach((tripDoc) => {
            const t = tripDoc.data();
            if (t.status !== 'completed' || !t.driverId) return;
            const tripDate = (typeof tripCompletedDate === 'function'
                ? tripCompletedDate(t)
                : null)
                || t.completedAt?.toDate?.()
                || (t.createdAt?.toDate ? t.createdAt.toDate() : (t.createdAt ? new Date(t.createdAt) : null));
            if (!tripDate || tripDate < depositSince) return;
            const id = t.driverId;
            const price = parseTripPrice(t);
            const pct = (typeof resolveDepositCommissionPercent === 'function')
                ? resolveDepositCommissionPercent(t, platformPct)
                : ((t.commissionWaivedBirthday || t.birthdayFree || t.paymentMethod === 'birthday_gift')
                    ? 0
                    : platformPct);
            const split = (typeof calcTripCommissionSplit === 'function')
                ? calcTripCommissionSplit(price, pct)
                : { commissionAmount: Math.round(price * (pct / 100) * 100) / 100 };

            // Viajes con saldo cubren parte de la comisión a depositar (igual que computeDriverDayStats)
            if (t.paymentMethod === 'saldo' || t.paymentMethod === 'birthday_gift' || t.birthdayFree) {
                saldoCoveredByDriver[id] = (saldoCoveredByDriver[id] || 0) + (split.commissionAmount || 0);
                return;
            }
            if (t.commissionWaivedBirthday) return;

            const ms = tripDate.getTime();
            const comm = Number(split.commissionAmount) || 0;
            if (!cashByDriver[id]) {
                cashByDriver[id] = {
                    oldestMs: ms,
                    newestMs: ms,
                    name: t.driverName || 'Conductor',
                    trips: 0,
                    cashGross: 0,
                    commissionDue: 0,
                    commissionDueToday: 0
                };
            }
            const row = cashByDriver[id];
            row.oldestMs = Math.min(row.oldestMs, ms);
            row.newestMs = Math.max(row.newestMs, ms);
            row.trips += 1;
            row.cashGross += price;
            row.commissionDue += comm;
            if (tripDate >= todayStart) row.commissionDueToday += comm;
            if (t.driverName) row.name = t.driverName;
        });

        // Depósitos aprobados por conductor (desde lookback) + de hoy
        const depositsByDriver = {};
        const depositsTodayByDriver = {};
        try {
            const depSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'driver_deposit_requests'));
            depSnap.forEach((d) => {
                const dep = d.data() || {};
                if (dep.status !== 'approved' || !dep.driverId) return;
                const depDate = dep.createdAt?.toDate?.()
                    || (dep.createdAt?.seconds ? new Date(dep.createdAt.seconds * 1000) : null)
                    || (dep.approvedAt?.toDate?.() || null);
                if (depDate && depDate < depositSince) return;
                const amt = parseFloat(dep.amount) || 0;
                depositsByDriver[dep.driverId] = (depositsByDriver[dep.driverId] || 0) + amt;
                if (depDate && depDate >= todayStart) {
                    depositsTodayByDriver[dep.driverId] = (depositsTodayByDriver[dep.driverId] || 0) + amt;
                }
            });
        } catch (depErr) {
            console.warn('stats deposits scan:', depErr);
        }

        // Deuda / perfil: allUsersData si ya se cargó; si no, un scan de public/users (una sola lectura)
        const debtByDriver = {};
        const profileByDriver = {};
        const ingestUserDebt = (id, u) => {
            if (!id || !u) return;
            profileByDriver[id] = { uid: id, ...u, ...(profileByDriver[id] || {}) };
            const role = u.role;
            if (role && role !== 'driver' && role !== 'conductor') return;
            const d = Math.max(
                0,
                parseFloat(u.pendingDepositDebt) || 0,
                parseFloat(u.driverLastDepositOwed) || 0
            );
            if (d > 0.009 || u.depositAutoBlocked) {
                debtByDriver[id] = Math.max(debtByDriver[id] || 0, d);
            }
        };
        (window.allUsersData || []).forEach((u) => {
            if (u?.uid) ingestUserDebt(u.uid, u);
        });
        try {
            // Siempre leer users públicos: cubre deudas aunque no se haya abierto la pestaña Usuarios
            // y da nombre/plazo para conductores de hace 2 días.
            const usersSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'users'));
            usersSnap.forEach((ud) => ingestUserDebt(ud.id, ud.data() || {}));
        } catch (usersDebtErr) {
            console.warn('stats debt scan:', usersDebtErr);
        }

        const owingDrivers = [];
        const candidateIds = new Set([
            ...Object.keys(cashByDriver),
            ...Object.keys(debtByDriver),
            ...Object.keys(driverStats).filter((k) => k !== 'sin-conductor')
        ]);

        for (const driverId of candidateIds) {
            if (!driverId || driverId === 'sin-conductor') continue;
            const cash = cashByDriver[driverId] || {
                oldestMs: 0, newestMs: 0, name: 'Conductor', trips: 0,
                cashGross: 0, commissionDue: 0, commissionDueToday: 0
            };
            const deposited = Math.max(0, Number(depositsByDriver[driverId]) || 0);
            const depositedToday = Math.max(0, Number(depositsTodayByDriver[driverId]) || 0);
            const saldoCovered = Math.max(0, Number(saldoCoveredByDriver[driverId]) || 0);
            const commissionDue = Math.round((cash.commissionDue || 0) * 100) / 100;
            // Hueco 7d = comisión efectivo − cobertura saldo − depósitos aprobados
            const gapFromTrips = Math.max(
                0,
                Math.round((commissionDue - saldoCovered - deposited) * 100) / 100
            );
            const remainingToday = Math.max(
                0,
                Math.round(((cash.commissionDueToday || 0) - depositedToday) * 100) / 100
            );
            const profile = profileByDriver[driverId]
                || (window.allUsersData || []).find((u) => u.uid === driverId)
                || {};
            const debt = Math.max(
                0,
                Number(debtByDriver[driverId]) || 0,
                parseFloat(profile.pendingDepositDebt) || 0,
                parseFloat(profile.driverLastDepositOwed) || 0
            );
            // total: el mayor entre deuda+hoy y el hueco de 7 días (no se pierde lo de hace 2 días)
            const totalOwed = Math.max(debt + remainingToday, gapFromTrips, debt, remainingToday);
            if (totalOwed < 0.01) continue;

            const workStart = typeof getDriverDepositWorkStartMs === 'function'
                ? getDriverDepositWorkStartMs(profile)
                : 0;
            const sinceMs = cash.oldestMs || workStart || 0;
            const deadlineMs = typeof getDriverDepositDeadlineMs === 'function'
                ? getDriverDepositDeadlineMs(profile)
                : 0;
            const graceOn = typeof isDriverDepositGraceActive === 'function'
                ? isDriverDepositGraceActive(profile)
                : false;
            const overdue = !graceOn && totalOwed > 0.009
                && ((deadlineMs > 0 && Date.now() >= deadlineMs) || !!profile.depositAutoBlocked);

            owingDrivers.push({
                uid: driverId,
                name: cash.name || profile.name || driverStats[driverId]?.name || 'Conductor',
                phone: profile.phone || '',
                totalOwed,
                remainingToday,
                debt,
                gapFromTrips,
                commissionDue,
                deposited,
                sinceMs,
                sinceLabel: formatElapsedSince(sinceMs),
                newestLabel: cash.newestMs ? formatElapsedSince(cash.newestMs) : '—',
                cashTripsPeriod: cash.trips || 0,
                deadlineLabel: (typeof formatDepositDeadlineLabel === 'function'
                    ? formatDepositDeadlineLabel(profile)
                    : null) || '—',
                graceOn,
                overdue
            });
        }
        owingDrivers.sort((a, b) => {
            if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
            return (a.sinceMs || Date.now()) - (b.sinceMs || Date.now());
        });

        const owingHtml = owingDrivers.length
            ? owingDrivers.map((d) => {
                const safeName = String(d.name || 'Conductor').replace(/'/g, "\\'");
                const border = d.overdue ? 'border-rose-500/50 bg-rose-950/40' : 'border-amber-600/40 bg-amber-950/30';
                return `
                <div class="rounded-xl border ${border} p-3 text-[11px] space-y-1.5">
                    <div class="flex justify-between gap-2 items-start">
                        <div class="min-w-0">
                            <p class="font-black text-white truncate">${String(d.name || '').replace(/</g, '')}</p>
                            <p class="text-[10px] font-bold ${d.overdue ? 'text-rose-300' : 'text-amber-200'}">
                                ${d.overdue ? '⚠ PLAZO VENCIDO' : 'Pendiente de depósito'}
                                ${d.graceOn ? ' · prórroga activa' : ''}
                            </p>
                        </div>
                        <p class="font-black text-amber-300 shrink-0">L. ${d.totalOwed.toFixed(2)}</p>
                    </div>
                    <p class="text-slate-300 font-bold leading-snug">
                        Sin depositar desde el 1.er viaje en efectivo:
                        <b class="text-white">hace ${d.sinceLabel}</b>
                        ${d.cashTripsPeriod ? ` · ${d.cashTripsPeriod} viaje(s) efectivo (últ. 7 d)` : ''}
                    </p>
                    <p class="text-slate-400 font-bold text-[10px] leading-snug">
                        Último viaje efectivo: hace ${d.newestLabel}<br>
                        Comisión debida ~L. ${Number(d.commissionDue || 0).toFixed(2)}
                        · Depositado L. ${Number(d.deposited || 0).toFixed(2)}
                        · Deuda perfil L. ${d.debt.toFixed(2)}
                        · Hoy L. ${d.remainingToday.toFixed(2)}
                        · Plazo: ${d.deadlineLabel}
                    </p>
                    <div class="flex flex-wrap gap-2 pt-1">
                        <button type="button"
                            onclick="window.sendDepositReminderToDriver('${d.uid}', '${safeName}', ${d.totalOwed.toFixed(2)}, '${d.sinceLabel}', ${d.overdue ? 'true' : 'false'})"
                            class="flex-1 min-w-[7rem] py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-black">
                            <i class="fas fa-bell"></i> Recordar depósito
                        </button>
                        <button type="button"
                            onclick="window.sendIndividualNotification('${d.uid}', '${safeName}', 'driver')"
                            class="flex-1 min-w-[7rem] py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-black">
                            Mensaje libre
                        </button>
                        <button type="button"
                            onclick="window.staffClearDriverPendingAccount('${d.uid}', '${safeName}', ${d.totalOwed.toFixed(2)})"
                            class="flex-1 min-w-[7rem] py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-[10px] font-black">
                            <i class="fas fa-trash-alt"></i> Borrar cuenta pendiente
                        </button>
                    </div>
                </div>`;
            }).join('')
            : '<p class="text-emerald-400/90 text-xs font-bold py-2">Ningún conductor con hueco de depósito en los últimos 7 días ni deuda en perfil.</p>';

        const bulkBtn = owingDrivers.length
            ? `<button type="button" onclick="window.sendDepositReminderBulk()"
                class="w-full mb-3 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-black">
                <i class="fas fa-bullhorn"></i> Recordar a todos (${owingDrivers.length})
               </button>`
            : '';

        window._statsOwingDrivers = owingDrivers;

        contentDiv.innerHTML = `
            <div class="grid grid-cols-2 gap-4 text-center mb-6">
                <div class="bg-gray-800 p-4 rounded-2xl">
                    <p class="text-xs text-gray-400">VIAJES TOTALES</p>
                    <p class="text-4xl font-black text-white mt-1">${totalTrips}</p>
                </div>
                <div class="bg-gray-800 p-4 rounded-2xl">
                    <p class="text-xs text-gray-400">GANADO TOTAL</p>
                    <p class="text-4xl font-black text-emerald-400 mt-1">L. ${totalEarned.toFixed(2)}</p>
                </div>
            </div>

            <div class="bg-gray-800 rounded-2xl p-5 text-sm space-y-3 mb-4">
                <div class="flex justify-between">
                    <span class="text-emerald-400">• En Efectivo</span>
                    <span class="font-bold">L. ${cashEarned.toFixed(2)} <span class="text-xs text-gray-400">(${cashTrips} viajes)</span></span>
                </div>
                <div class="flex justify-between">
                    <span class="text-purple-400">• En Saldo</span>
                    <span class="font-bold">L. ${saldoEarned.toFixed(2)} <span class="text-xs text-gray-400">(${saldoTrips} viajes)</span></span>
                </div>
                <div class="pt-3 border-t border-gray-700 flex justify-between">
                    <span class="font-bold text-amber-400">Comisión generada (${platformPct}%)</span>
                    <span class="font-black text-amber-400">L. ${commission.toFixed(2)}</span>
                </div>
                <p class="text-[10px] text-slate-400 font-bold leading-snug">
                    Usa el % de <b>Cuentas bancarias → Comisión de plataforma</b> (hoy ${platformPct}%).
                    Efectivo: L. ${cashCommission.toFixed(2)} · Saldo: L. ${saldoCommission.toFixed(2)}.
                </p>
            </div>

            <div class="bg-gray-900 border border-amber-700/40 rounded-2xl p-4 mb-4">
                <p class="text-[10px] font-black text-amber-300 uppercase tracking-widest mb-1">
                    <i class="fas fa-piggy-bank"></i> Sin depositar · comisión
                </p>
                <p class="text-[10px] text-slate-400 font-bold mb-3 leading-snug">
                    Revisa <b>últimos 7 días</b> (también si el filtro es “Hoy”): comisión en efectivo − depósitos aprobados + deuda en perfil.
                    Así salen los que viajaron <b>hace 2 días</b> y no depositaron.
                    Usa <b>Borrar cuenta pendiente</b> si pagó en persona o condonas el monto (admin/supervisor).
                </p>
                ${bulkBtn}
                <div class="space-y-2 max-h-72 overflow-y-auto">${owingHtml}</div>
            </div>

            <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Por conductor</p>
            <div class="space-y-2 mb-4 max-h-40 overflow-y-auto">${driverSummary || '<p class="text-gray-500 text-xs">Sin viajes</p>'}</div>

            <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Detalle de viajes (${tripRows.length})</p>
            <div class="space-y-2 max-h-80 overflow-y-auto">${tripTable || '<p class="text-gray-500 text-xs text-center py-4">No hay viajes en este período</p>'}</div>
        `;

    } catch (e) {
        console.error(e);
        contentDiv.innerHTML = `
            <div class="text-center py-8 text-red-400">
                <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                <p>Error al cargar las estadísticas.</p>
            </div>
        `;
    }
};

/** Recordatorio de depósito a un conductor (push + campana). */
window.sendDepositReminderToDriver = async (uid, userName, amount, sinceLabel = '', overdue = false) => {
    if (!canManageUsers()) {
        return window.showToast?.('Solo admin o supervisor.', 'warning');
    }
    if (!uid) return;
    const amt = Number(amount) || 0;
    const name = userName || 'Conductor';
    const waitBit = sinceLabel && sinceLabel !== '—'
        ? ` Llevas ${sinceLabel} sin depositar desde tu primer viaje en efectivo del período.`
        : '';
    const urgency = overdue
        ? '⚠ Tu plazo de depósito ya venció. '
        : '';
    const msg = `${urgency}Recordatorio HonduRaite: debes depositar la comisión pendiente de L. ${amt.toFixed(2)}.${waitBit} Toca «Depositar ahora» para ver el número de cuenta y enviar el baucher a revisión.`;
    if (!confirm(`¿Enviar recordatorio de depósito a ${name}?\n\nMonto: L. ${amt.toFixed(2)}\nTiempo sin depositar: ${sinceLabel || '—'}`)) {
        return;
    }
    try {
        const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'notifications');
        const newRef = doc(colRef);
        await setDoc(newRef, {
            targetRole: 'driver',
            targetUserId: String(uid),
            targetUserName: name,
            personal: true,
            sendPush: true,
            broadcastPush: false,
            pushDispatched: false,
            openDeposit: true,
            type: 'deposit_reminder',
            title: overdue ? '⚠ Depósito vencido' : 'Recordatorio de depósito',
            body: msg,
            message: msg,
            tag: `deposit-reminder-${uid}-${Date.now()}`,
            amount: amt,
            sentBy: window.currentUser?.uid || null,
            sentByName: window.getSenderDisplayName?.() || 'Staff',
            createdAt: serverTimestamp(),
            createdAtMs: Date.now()
        });
        window.showToast?.(`Recordatorio enviado a ${name}.`, 'success');
    } catch (e) {
        console.error('sendDepositReminderToDriver:', e);
        window.showToast?.(e?.message || 'No se pudo enviar el recordatorio.', 'error');
    }
};

/** Recordatorio masivo a todos los de la lista de estadísticas. */
window.sendDepositReminderBulk = async () => {
    if (!canManageUsers()) {
        return window.showToast?.('Solo admin o supervisor.', 'warning');
    }
    const list = Array.isArray(window._statsOwingDrivers) ? window._statsOwingDrivers : [];
    if (!list.length) return window.showToast?.('No hay conductores pendientes en la lista.', 'warning');
    if (!confirm(`¿Enviar recordatorio de depósito a ${list.length} conductor(es)?`)) return;
    let ok = 0;
    let fail = 0;
    for (const d of list) {
        try {
            const amt = Number(d.totalOwed) || 0;
            const waitBit = d.sinceLabel && d.sinceLabel !== '—'
                ? ` Llevas ${d.sinceLabel} sin depositar.`
                : '';
            const urgency = d.overdue ? '⚠ Tu plazo de depósito ya venció. ' : '';
            const msg = `${urgency}Recordatorio HonduRaite: debes depositar la comisión pendiente de L. ${amt.toFixed(2)}.${waitBit} Toca «Depositar ahora» para ver la cuenta y enviar el baucher.`;
            const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'notifications');
            const newRef = doc(colRef);
            await setDoc(newRef, {
                targetRole: 'driver',
                targetUserId: String(d.uid),
                targetUserName: d.name || 'Conductor',
                personal: true,
                sendPush: true,
                broadcastPush: false,
                pushDispatched: false,
                openDeposit: true,
                type: 'deposit_reminder',
                title: d.overdue ? '⚠ Depósito vencido' : 'Recordatorio de depósito',
                body: msg,
                message: msg,
                tag: `deposit-reminder-${d.uid}-${Date.now()}`,
                amount: amt,
                sentBy: window.currentUser?.uid || null,
                sentByName: window.getSenderDisplayName?.() || 'Staff',
                createdAt: serverTimestamp(),
                createdAtMs: Date.now()
            });
            ok += 1;
        } catch (_) {
            fail += 1;
        }
    }
    window.showToast?.(`Recordatorios: ${ok} enviados${fail ? ` · ${fail} fallaron` : ''}.`, ok ? 'success' : 'error');
};

const urlReferralCode = storeReferralFromURL();
if (urlReferralCode) showReferralInviteModal(urlReferralCode);

setTimeout(() => {
    const driverRefInput = document.getElementById('referral-code-input');
    const pendingRef = getPendingReferralCode();
    if (driverRefInput && pendingRef && !driverRefInput.value) {
        driverRefInput.value = pendingRef;
    }
}, 500);

        // Actualizar badge al iniciar sesión
        setTimeout(() => {
            if (typeof window.updateNotificationBadge === 'function') {
                window.updateNotificationBadge();
            }
        }, 3000);

        // Función mejorada para ver foto ampliada + botón de descarga
        window.showEnlargedPhoto = (src, labelOrMeta = null) => {
            if (!src) return;
            let label = 'Imagen de registro';
            let personName = '';
            let dType = 'registro';

            if (typeof labelOrMeta === 'string' && labelOrMeta) {
                label = labelOrMeta;
            } else if (labelOrMeta && typeof labelOrMeta === 'object') {
                label = labelOrMeta.label || label;
                personName = labelOrMeta.name || personName;
                dType = labelOrMeta.type || dType;
            }

            const safeName = (personName || 'usuario').replace(/[^a-z0-9]/gi, '_');
            const modal = document.createElement('div');
            modal.className = `fixed inset-0 bg-black/90 z-[50000] flex items-center justify-center p-4`;
            modal.innerHTML = `
                <div class="max-w-[94vw] max-h-[94vh] w-full flex flex-col items-center" onclick="event.target === this && this.remove()">
                    <div class="w-full flex justify-between items-center mb-2 px-1">
                        <div class="text-white text-sm font-black truncate">
                            ${label} ${personName ? `<span class="text-gray-400 font-normal">· ${personName}</span>` : ''}
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="event.stopImmediatePropagation(); window.downloadRefImage('${src}', '${safeName}', '${dType}');" 
                                    class="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-black px-3 py-1.5 rounded-full flex items-center gap-1">
                                ⬇ DESCARGAR
                            </button>
                            <button onclick="this.closest('.fixed').remove()" class="text-white text-3xl leading-none px-2">&times;</button>
                        </div>
                    </div>
                    <img src="${src}" class="max-w-full max-h-[82vh] rounded-3xl shadow-2xl border border-white/30 object-contain" style="background:#111;" />
                    <div class="mt-2 text-[10px] text-gray-400">Toca la X o fondo para cerrar. Usa el botón para descargar con nombre de referencia.</div>
                </div>
            `;
            document.body.appendChild(modal);
        };

      // === PERSONALIZACIÓN DEL LOGIN (Admin) ===
window.loadCurrentLoginCustomization = async () => {
    try {
        const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main');
        const snap = await getDoc(settingsRef);

        if (!snap.exists()) {
            return;
        }

        const s = snap.data();

        // Cargar logo guardado
        if (s.loginLogoBase64) {
            const img = document.getElementById('current-login-logo');
            const no = document.getElementById('no-login-logo');
            if (img && no) {
                img.src = s.loginLogoBase64;
                img.style.display = 'block';
                no.style.display = 'none';
            }
        }

        // Cargar mensaje de bienvenida
        if (s.welcomeMessage) {
            const ta = document.getElementById('welcome-message');
            if (ta) ta.value = s.welcomeMessage;
        }

        const vapidInput = document.getElementById('fcm-vapid-key');
        if (vapidInput) vapidInput.value = s.fcmVapidKey || '';

        // Cargar tonos globales (mapa + personalizados) y refrescar panel si está abierto
        try {
            if (s.toneMap || s.customTones) {
                applyRemoteToneConfig({
                    toneMap: s.toneMap || null,
                    customTones: s.customTones || null
                });
            }
            window.refreshAdminTonesSamples?.();
            window.refreshAdminCustomTonesList?.();
            window.refreshAdminToneMapSelects?.();
        } catch (_) {}

        // Configurar el input de subida
        const up = document.getElementById('login-logo-upload');
        if (up) {
            up.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    const r = new FileReader();
                    r.onload = async (ev) => {
                        const img = document.getElementById('current-login-logo');
                        const no = document.getElementById('no-login-logo');
                        if (img && no) {
                            img.src = ev.target.result;
                            img.style.display = 'block';
                            no.style.display = 'none';
                        }
                        window.newLoginLogoBase64 = ev.target.result;

                        // === GUARDAR EN FIREBASE ===
                        try {
                            const msg = document.getElementById('welcome-message')?.value.trim() || null;
                            
                            const data = { 
                                welcomeMessage: msg, 
                                loginLogoBase64: window.newLoginLogoBase64,
                                updatedAt: serverTimestamp() 
                            };
                            
                            await setDoc(settingsRef, data, { merge: true });

                            // Actualizar favicon
                            let link = document.querySelector("link[rel~='icon']");
                            if (!link) {
                                link = document.createElement('link');
                                link.rel = 'icon';
                                document.head.appendChild(link);
                            }
                            link.href = window.newLoginLogoBase64;

                            window.showToast("Logo guardado correctamente", "success");
                            
                        } catch (err) {
                            console.error("ERROR AL GUARDAR:", err);
                            window.showToast("Error al guardar el logo");
                        }
                    };
                    r.readAsDataURL(e.target.files[0]);
                }
            };
        }
    } catch(e) { 
        console.error("ERROR CRÍTICO en loadCurrentLoginCustomization:", e); 
        window.showToast("Error al cargar configuración");
    }
};

window.saveLoginCustomization = async (btn) => {
    btn.disabled = true;
    btn.innerText = "GUARDANDO...";
    try {
        const msg = document.getElementById('welcome-message').value.trim();
        const vapidKey = document.getElementById('fcm-vapid-key')?.value.trim() || '';
        const data = {
            welcomeMessage: msg || null,
            fcmVapidKey: vapidKey || null,
            updatedAt: serverTimestamp()
        };
        if (window.newLoginLogoBase64) data.loginLogoBase64 = window.newLoginLogoBase64;

        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), data, { merge: true });
        window.showToast("Personalización guardada correctamente.", "success");
        btn.innerText = "GUARDAR CAMBIOS";
        btn.disabled = false;
        window.newLoginLogoBase64 = null;
        await window.loadAppCustomization();
        window.showLoginLogo?.();

        const uid = auth.window.currentUser?.uid;
        if (uid && getNotificationPermission() === 'granted') {
            if (isCapacitorNative()) {
                await initAndroidFcmPush({ db, appId, uid }).catch(() => {});
            } else if (vapidKey) {
                await initFcmPush({
                    firebaseConfig: APP_CONFIG.firebase,
                    vapidKey,
                    db,
                    appId,
                    uid
                }).catch(() => {});
            }
        }
    } catch(e) {
        alert("Error al guardar los cambios");
        btn.innerText = "GUARDAR CAMBIOS";
        btn.disabled = false;
    }
};

// ─── Tonos de notificación (Personalización) ───────────────────────────────
window.renderAdminTonesPanel = (rootEl) => {
    if (!rootEl) return;
    const U = window.OpsUi;
    const maxMb = (getMaxCustomBytes() / (1024 * 1024)).toFixed(1);
    const platformNow = getPlatformToneLabel();

    rootEl.innerHTML =
        U.formPanel(
            'Tonos de notificación',
            `Sonidos propios de la app (no el del celular). Ahora estás en: <b>${platformNow}</b>. Al guardar, aplica a todos.`,
            `
            <p class="text-[11px] text-slate-400 font-bold mb-3 leading-relaxed">
                Asigna un tono por cada tipo de aviso (nuevo viaje, contraoferta, subida de tarifa, oferta al pasajero, etc.).
                <b>Web/PWA</b> y <b>App nativa</b> pueden ser distintos. Sube MP3/WAV/OGG (máx. ${maxMb} MB) y asígnalo a cualquier evento.
                Con la app abierta suena el tono que elijas; con la app en otra pantalla Android también vibra y usa el canal nativo de viajes.
            </p>

            <div class="mb-4">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Muestras integradas</p>
                <div id="admin-tones-samples" class="grid grid-cols-1 sm:grid-cols-2 gap-2"></div>
            </div>

            <div class="mb-4">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Subir / arrastrar tono nuevo</p>
                <div id="admin-tone-dropzone" class="admin-tone-dropzone border-2 border-dashed border-slate-600 rounded-2xl p-5 text-center cursor-pointer hover:border-emerald-500/60 hover:bg-slate-900/40 transition">
                    <i class="fas fa-music text-2xl text-emerald-400 mb-2"></i>
                    <p class="text-sm font-black text-white">Arrastra un audio aquí</p>
                    <p class="text-[10px] text-slate-400 font-bold mt-1">o toca para elegir archivo · MP3, WAV, OGG, M4A</p>
                    <input type="file" id="admin-tone-file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm" class="hidden">
                </div>
                <div class="mt-2 flex flex-wrap gap-2 items-center">
                    <input id="admin-tone-custom-name" type="text" maxlength="60" class="ops-input flex-1 min-w-[140px]" placeholder="Nombre del tono (opcional)">
                    <button type="button" id="admin-tone-upload-btn" class="ops-btn ops-btn--emerald" disabled>
                        <i class="fas fa-cloud-upload-alt"></i> Subir tono
                    </button>
                </div>
                <p id="admin-tone-upload-hint" class="text-[10px] text-slate-500 font-bold mt-1"></p>
            </div>

            <div class="mb-4">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Tonos personalizados</p>
                <div id="admin-tones-custom-list" class="space-y-2"></div>
            </div>

            <div class="mb-3">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Asignar por tipo de aviso</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
                    <div>
                        <p class="text-[10px] font-black text-sky-400 mb-1"><i class="fas fa-globe"></i> Web / PWA</p>
                        <div id="admin-tone-map-web" class="space-y-2"></div>
                    </div>
                    <div>
                        <p class="text-[10px] font-black text-emerald-400 mb-1"><i class="fab fa-android"></i> App nativa</p>
                        <div id="admin-tone-map-native" class="space-y-2"></div>
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap gap-2">
                <button type="button" onclick="window.saveAdminToneConfig(this)" class="ops-btn ops-btn--emerald flex-1 min-w-[140px]">
                    <i class="fas fa-save"></i> Guardar tonos para todos
                </button>
                <button type="button" onclick="window.resetAdminToneDefaults(this)" class="ops-btn ops-btn--ghost flex-1 min-w-[120px]">
                    Restablecer defaults
                </button>
            </div>
            `
        );

    window.refreshAdminTonesSamples?.();
    window.refreshAdminCustomTonesList?.();
    window.refreshAdminToneMapSelects?.();
    window.bindAdminToneDropzone?.();
};

window.refreshAdminTonesSamples = () => {
    const box = document.getElementById('admin-tones-samples');
    if (!box) return;
    const tones = listTones({ includeCustom: false });
    box.innerHTML = tones.map((t) => {
        const flavor =
            t.flavor === 'web' ? 'WEB'
            : t.flavor === 'native' ? 'NATIVO'
            : 'AMBOS';
        const color =
            t.flavor === 'web' ? 'text-sky-400'
            : t.flavor === 'native' ? 'text-emerald-400'
            : 'text-amber-400';
        return `
            <div class="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2">
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-black text-white truncate">${escapeHtmlLite(t.name)}</p>
                    <p class="text-[9px] ${color} font-bold">${flavor} · ${escapeHtmlLite(t.blurb || '')}</p>
                </div>
                <button type="button" class="ops-btn ops-btn--ghost text-[10px] py-1.5 px-2.5 shrink-0"
                    onclick="window.playToneSample('${t.id}')" title="Escuchar">
                    <i class="fas fa-play"></i>
                </button>
            </div>`;
    }).join('');
};

window.refreshAdminCustomTonesList = () => {
    const box = document.getElementById('admin-tones-custom-list');
    if (!box) return;
    const customs = getCustomTones();
    if (!customs.length) {
        box.innerHTML = `<p class="text-[11px] text-slate-500 font-bold py-2">Aún no hay tonos subidos. Arrastra un audio arriba.</p>`;
        return;
    }
    box.innerHTML = customs.map((t) => `
        <div class="flex items-center gap-2 bg-slate-900/60 border border-emerald-900/40 rounded-xl px-3 py-2">
            <div class="flex-1 min-w-0">
                <p class="text-xs font-black text-white truncate">${escapeHtmlLite(t.name)}</p>
                <p class="text-[9px] text-slate-400 font-bold truncate">${escapeHtmlLite(t.fileName || t.id)}</p>
            </div>
            <button type="button" class="ops-btn ops-btn--ghost text-[10px] py-1.5 px-2.5" onclick="window.playToneSample('${t.id}')">
                <i class="fas fa-play"></i>
            </button>
            <button type="button" class="ops-btn ops-btn--ghost text-[10px] py-1.5 px-2.5 text-rose-400"
                onclick="window.deleteAdminCustomTone('${t.id}')" title="Eliminar">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
};

window.refreshAdminToneMapSelects = () => {
    const prefs = loadTonePrefs();
    const fill = (platform, containerId) => {
        const el = document.getElementById(containerId);
        if (!el) return;
        const map = prefs[platform] || {};
        el.innerHTML = TONE_EVENTS.map((ev) => {
            const sel = map[ev.id] || '';
            const opts = buildToneOptionsHtml(sel);
            return `
                <div class="bg-slate-900/50 border border-slate-700 rounded-xl p-2.5">
                    <div class="flex items-start justify-between gap-2 mb-1.5">
                        <div class="min-w-0">
                            <p class="text-[11px] font-black text-white">${escapeHtmlLite(ev.label)}</p>
                            <p class="text-[9px] text-slate-500 font-bold leading-snug">${escapeHtmlLite(ev.desc)}</p>
                        </div>
                        <button type="button" class="text-[10px] text-sky-400 font-black shrink-0"
                            onclick="window.previewAdminToneSelect('${platform}','${ev.id}')" title="Probar">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                    <select data-tone-platform="${platform}" data-tone-event="${ev.id}"
                        class="ops-input text-xs py-2 admin-tone-select w-full">
                        ${opts}
                    </select>
                </div>`;
        }).join('');
    };
    fill('web', 'admin-tone-map-web');
    fill('native', 'admin-tone-map-native');
};

function escapeHtmlLite(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.playToneSample = (toneId) => {
    try {
        const ok = playToneById(toneId);
        if (!ok) window.showToast?.('No se pudo reproducir ese tono.', 'warning');
    } catch (_) {
        window.showToast?.('Error al reproducir.', 'error');
    }
};

window.previewAdminToneSelect = (platform, eventId) => {
    const sel = document.querySelector(
        `select.admin-tone-select[data-tone-platform="${platform}"][data-tone-event="${eventId}"]`
    );
    const id = sel?.value;
    if (id) window.playToneSample(id);
};

window.collectAdminToneMapFromUI = () => {
    const web = {};
    const native = {};
    document.querySelectorAll('select.admin-tone-select').forEach((sel) => {
        const p = sel.dataset.tonePlatform;
        const ev = sel.dataset.toneEvent;
        if (!p || !ev) return;
        if (p === 'web') web[ev] = sel.value;
        if (p === 'native') native[ev] = sel.value;
    });
    return { web, native };
};

window.bindAdminToneDropzone = () => {
    const zone = document.getElementById('admin-tone-dropzone');
    const input = document.getElementById('admin-tone-file');
    const btn = document.getElementById('admin-tone-upload-btn');
    const hint = document.getElementById('admin-tone-upload-hint');
    if (!zone || !input) return;

    window._pendingToneFile = null;

    const setFile = (file) => {
        if (!file) return;
        if (!isAllowedAudioFile(file)) {
            const maxMb = (getMaxCustomBytes() / (1024 * 1024)).toFixed(1);
            window.showToast?.(`Archivo no válido. Usa MP3/WAV/OGG/M4A (máx. ${maxMb} MB).`, 'warning');
            window._pendingToneFile = null;
            if (btn) btn.disabled = true;
            if (hint) hint.textContent = '';
            return;
        }
        window._pendingToneFile = file;
        if (btn) btn.disabled = false;
        if (hint) {
            hint.textContent = `Listo: ${file.name} (${(file.size / 1024).toFixed(0)} KB) — dale a Subir tono`;
        }
        const nameInput = document.getElementById('admin-tone-custom-name');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
        }
        // Preview local inmediato
        try {
            const url = URL.createObjectURL(file);
            const audio = new Audio(url);
            audio.volume = 0.9;
            audio.play().catch(() => {});
            setTimeout(() => URL.revokeObjectURL(url), 15000);
        } catch (_) {}
    };

    zone.onclick = () => input.click();
    input.onchange = () => {
        const f = input.files?.[0];
        if (f) setFile(f);
        input.value = '';
    };

    ['dragenter', 'dragover'].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('admin-tone-dropzone--active');
        });
    });
    ['dragleave', 'drop'].forEach((ev) => {
        zone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('admin-tone-dropzone--active');
        });
    });
    zone.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) setFile(f);
    });

    if (btn) {
        btn.onclick = () => window.uploadAdminCustomTone?.(btn);
    }
};

window.uploadAdminCustomTone = async (btn) => {
    const file = window._pendingToneFile;
    if (!file) return window.showToast?.('Elige o arrastra un audio primero.', 'warning');
    if (!isAllowedAudioFile(file)) return window.showToast?.('Archivo de audio no válido.', 'warning');

    const nameInput = document.getElementById('admin-tone-custom-name');
    const name = (nameInput?.value || file.name || 'Tono personalizado').trim().slice(0, 60);
    const toneId = makeCustomToneId();
    const safeFile = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const path = `artifacts/${appId}/public/tones/${toneId}_${safeFile}`;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo…';
    }

    try {
        if (!storage) throw new Error('Storage no disponible');
        const url = await uploadFile(storage, file, path);
        upsertCustomTone({
            id: toneId,
            name,
            kind: 'file',
            flavor: 'custom',
            url,
            fileName: file.name,
            blurb: 'Subido por admin',
            createdAt: Date.now()
        });

        // Persistir en appSettings (con el mapa actual) para todos
        const toneMap = window.collectAdminToneMapFromUI?.() || loadTonePrefs();
        saveTonePrefs(toneMap);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            customTones: getCustomTones(),
            toneMap,
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });

        window._pendingToneFile = null;
        const hint = document.getElementById('admin-tone-upload-hint');
        if (hint) hint.textContent = `✓ Subido: ${name}`;
        if (nameInput) nameInput.value = '';
        window.refreshAdminCustomTonesList?.();
        window.refreshAdminToneMapSelects?.();
        window.showToast?.(`Tono “${name}” listo. Ya puedes asignarlo a un aviso.`, 'success');
        playToneById(toneId);
    } catch (e) {
        console.error('uploadAdminCustomTone:', e);
        window.showToast?.(e?.message || 'No se pudo subir el audio. Revisa permisos de Storage.', 'error');
    } finally {
        if (btn) {
            btn.disabled = !window._pendingToneFile;
            btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Subir tono';
        }
    }
};

window.deleteAdminCustomTone = async (toneId) => {
    if (!toneId) return;
    if (!confirm('¿Eliminar este tono personalizado? Si estaba asignado a un aviso, vuelve al default.')) return;
    removeCustomTone(toneId);
    const toneMap = window.collectAdminToneMapFromUI?.() || loadTonePrefs();
    // Limpiar referencias huérfanas en el mapa
    ['web', 'native'].forEach((p) => {
        Object.keys(toneMap[p] || {}).forEach((ev) => {
            if (toneMap[p][ev] === toneId) {
                const defaults = window.HonduTones?.defaults?.[p] || {};
                toneMap[p][ev] = defaults[ev] || 'soft_ding';
            }
        });
    });
    saveTonePrefs(toneMap);
    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            customTones: getCustomTones(),
            toneMap,
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.warn('deleteAdminCustomTone persist:', e);
    }
    window.refreshAdminCustomTonesList?.();
    window.refreshAdminToneMapSelects?.();
    window.showToast?.('Tono eliminado.', 'success');
};

window.saveAdminToneConfig = async (btn) => {
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
    }
    try {
        const toneMap = window.collectAdminToneMapFromUI?.() || loadTonePrefs();
        saveTonePrefs(toneMap);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            toneMap,
            customTones: getCustomTones(),
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });
        window.showToast?.('Tonos guardados para todos (web y app).', 'success');
    } catch (e) {
        console.error('saveAdminToneConfig:', e);
        window.showToast?.(e?.message || 'No se pudieron guardar los tonos.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar tonos para todos';
        }
    }
};

window.resetAdminToneDefaults = async (btn) => {
    if (!confirm('¿Restablecer los tonos por defecto de web y nativo? (Los personalizados subidos se conservan)')) return;
    const defaults = window.HonduTones?.defaults || {};
    const toneMap = {
        web: { ...(defaults.web || {}) },
        native: { ...(defaults.native || {}) }
    };
    saveTonePrefs(toneMap);
    window.refreshAdminToneMapSelects?.();
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Guardando…';
    }
    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'main'), {
            toneMap,
            customTones: getCustomTones(),
            tonesUpdatedAt: serverTimestamp()
        }, { merge: true });
        window.showToast?.('Defaults de tonos restablecidos.', 'success');
    } catch (e) {
        window.showToast?.('Defaults locales listos; error al guardar en nube.', 'warning');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Restablecer defaults';
        }
    }
};
        
}
