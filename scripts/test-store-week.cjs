// Semana Honduras (lunes 00:00) y 10% sobre productos. El envío no entra.
// Uso: node scripts/test-store-week.cjs
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'store-week.js'), 'utf8').replace(/^export /gm, '');
const W = new Function(`${src}\nreturn { WEEKLY_COMMISSION_RATE, hondurasWeekRange, formatWeekLabel, orderCreatedMs, weeklySalesReport };`)();
const res = [];
const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);

ok('la comisión es 10%', W.WEEKLY_COMMISSION_RATE === 0.10);
const tue = new Date('2026-10-20T15:00:00Z');
const cur = W.hondurasWeekRange(tue, 'current');
ok('martes 20 oct: semana empieza lunes 19 a las 00:00 HN', cur.start.toISOString() === '2026-10-19T06:00:00.000Z' && cur.end.toISOString() === '2026-10-26T06:00:00.000Z', `${cur.start.toISOString()} → ${cur.end.toISOString()}`);
const prev = W.hondurasWeekRange(tue, 'previous');
ok('semana pasada empieza el 12', prev.start.toISOString() === '2026-10-12T06:00:00.000Z' && prev.end.toISOString() === '2026-10-19T06:00:00.000Z');
const sun = W.hondurasWeekRange(new Date('2026-10-26T05:00:00Z'), 'current');
ok('domingo 25 a las 23:00 HN sigue en la semana del 19', sun.start.toISOString() === '2026-10-19T06:00:00.000Z');
const mon = W.hondurasWeekRange(new Date('2026-10-26T06:30:00Z'), 'current');
ok('lunes 26 a las 00:30 HN ya es la semana nueva', mon.start.toISOString() === '2026-10-26T06:00:00.000Z' && mon.end.toISOString() === '2026-11-02T06:00:00.000Z');

const orders = [
    { id: 'a', status: 'delivered', itemsTotal: 200, deliveryFee: 115, createdAt: Date.parse('2026-10-20T15:00:00Z'), clientName: 'Ana' },
    { id: 'b', status: 'pending', itemsTotal: 50.5, deliveryFee: 40, createdAt: { seconds: Date.parse('2026-10-21T12:00:00Z') / 1000 }, clientName: 'Luis' },
    { id: 'c', status: 'cancelled', itemsTotal: 999, deliveryFee: 40, createdAt: Date.parse('2026-10-20T16:00:00Z'), clientName: 'No' },
    { id: 'd', status: 'delivered', itemsTotal: 80, deliveryFee: 40, createdAt: Date.parse('2026-10-12T18:00:00Z'), clientName: 'Otra' },
    { id: 'e', status: 'accepted', itemsTotal: 10, createdAt: Date.parse('2026-10-26T05:00:00Z'), clientName: 'Domingo' },
];
const report = W.weeklySalesReport(orders, cur);
ok('bruto 260.50 sin cancelados ni envío ni la otra semana', report.gross === 260.5 && report.count === 3 && report.fee === 26.05, JSON.stringify({ gross: report.gross, count: report.count, fee: report.fee }));
ok('lo entregado es solo el pedido de 200', report.deliveredCount === 1 && report.deliveredGross === 200 && report.deliveredFee === 20);
ok('el más nuevo va primero', report.rows.map((r) => r.id).join(',') === 'e,b,a');
ok('timestamp de Firestore', W.orderCreatedMs({ createdAt: { toMillis: () => 1234 } }) === 1234 && W.orderCreatedMs({}) === 0);
const prevReport = W.weeklySalesReport(orders, prev);
ok('semana pasada solo el de 80', prevReport.gross === 80 && prevReport.fee === 8 && prevReport.count === 1);
ok('la etiqueta nombra el lunes y el domingo', /19/.test(W.formatWeekLabel(cur)) && /25/.test(W.formatWeekLabel(cur)), W.formatWeekLabel(cur));

for (const r of res) console.log(...r);
console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
process.exit(res.every((r) => r[0] === 'PASS') ? 0 : 1);
