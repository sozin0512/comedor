/**
 * El aviso «Viaje cancelado correctamente.» no se repite por el historial.
 *   node scripts/test-cancel-notice.mjs
 */
import { planCancellationNotice } from '../js/cancel-notice.js';

const results = [];
const t = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
const ok = (c, msg) => { if (!c) throw new Error(msg || 'falso'); };

const ownOld = {
    id: 'old-1',
    status: 'cancelled',
    cancelledBy: 'josue',
    cancelledFromStatus: 'pending',
};

t('cancelar yo mismo, en el momento, sí avisa una vez', () => {
    const plan = planCancellationNotice({
        trip: ownOld,
        uid: 'josue',
        source: 'user-action',
        watchingTripId: '',
    });
    ok(plan.toast?.message === 'Viaje cancelado correctamente.');
    ok(!plan.bell);
});

t('el mismo cancelado, ya marcado, no vuelve a salir', () => {
    const plan = planCancellationNotice({
        trip: ownOld,
        uid: 'josue',
        source: 'listener',
        watchingTripId: 'live-envio',
        handledIds: new Set(['old-1']),
    });
    ok(!plan.toast && !plan.bell && !plan.markHandled);
});

t('un cancelado mío viejo, mientras sigo otro envío, va a la campana y no al toast', () => {
    const plan = planCancellationNotice({
        trip: ownOld,
        uid: 'josue',
        source: 'listener',
        watchingTripId: 'live-envio',
    });
    ok(!plan.toast, plan.toast?.message);
    ok(plan.bell?.id === 'cancel-history-josue');
    ok(plan.finishWatching === false);
});

t('si el otro cancela el viaje que estoy viendo, el aviso sigue en pantalla', () => {
    const plan = planCancellationNotice({
        trip: { id: 'live-envio', status: 'cancelled', cancelledBy: 'rider', cancelledFromStatus: 'accepted' },
        uid: 'josue',
        source: 'listener',
        watchingTripId: 'live-envio',
    });
    ok(plan.needsExistingSurveyPath === true);
    ok(!plan.bell);
});

t('una cancelación ajena que no es el envío abierto no usa el toast de éxito', () => {
    const plan = planCancellationNotice({
        trip: { id: 'otro', status: 'cancelled', cancelledBy: 'rider', cancelledFromStatus: 'pending' },
        uid: 'josue',
        source: 'listener',
        watchingTripId: 'live-envio',
    });
    ok(!plan.toast);
    ok(plan.bell?.title === 'Un viaje fue cancelado');
});

for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? `  → ${x}` : ''}`);
const failed = results.filter((row) => row[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
