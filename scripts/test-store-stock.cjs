// Stock de tiendas (comida no lleva) + recargo de carro sobre la zona.
// Uso: node scripts/test-store-stock.cjs   (sin emulador)
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'functions', 'store-stock'));
const DZ = require(path.join(__dirname, '..', 'functions', 'delivery-zones'));
const res = [];
const ok = (n, c, x = '') => res.push([c ? 'PASS' : 'FAIL', n, x]);

ok('la fábrica sigue siendo función con helpers', typeof S === 'function' && typeof S.planStockDebit === 'function' && typeof S.planStockRestore === 'function');

const cats = ['', 'comida', 'restaurante', 'Comida / restaurante', 'Restaurante doña', 'pulperia', 'farmacia', 'tienda', 'otro', '  COMIDA  '];
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'merchant-stores.js'), 'utf8');
const fnSrc = src.match(/function storeTracksStock\(store\) \{[\s\S]*?\n\}/);
ok('la app tiene storeTracksStock', !!fnSrc);
const clientTracks = fnSrc ? new Function(`${fnSrc[0]}\nreturn storeTracksStock;`)() : () => null;
for (const category of cats) {
    const a = S.storeTracksStock({ category });
    const b = clientTracks({ category });
    ok(`stock igual app/servidor «${category || '(vacío)'}»`, a === b && (category.toLowerCase().includes('comida') || category.toLowerCase().includes('restaurante') ? a === false : a === true), `${a} vs ${b}`);
}
ok('sin categoría lleva stock', S.storeTracksStock({}) === true && S.storeTracksStock(null) === true);

const short = S.planStockDebit([{ productId: 'p1', qty: 3 }], { p1: { stock: 2 } });
ok('no alcanza', short.ok === false && /stock/.test(short.error));
const gone = S.planStockDebit([{ productId: 'p1', qty: 1 }], {});
ok('producto borrado', gone.ok === false);
const nan = S.planStockDebit([{ productId: 'p1', qty: 1 }], { p1: { stock: 'no' } });
ok('stock vacío cuenta como 0', nan.ok === false);
const empty = S.planStockDebit([], { p1: { stock: 5 } });
ok('pedido sin productos', empty.ok === false);
const merged = S.planStockDebit([{ productId: 'p1', qty: 2 }, { productId: 'p1', qty: 1 }, { productId: 'p2', qty: 4 }], { p1: { stock: 3 }, p2: { stock: 4 } });
ok('suma líneas del mismo producto y deja el siguiente stock', merged.ok === true && merged.lines.length === 2 && merged.lines.find((l) => l.productId === 'p1').next === 0 && merged.lines.find((l) => l.productId === 'p2').next === 0);
const badQty = S.planStockDebit([{ productId: 'p1', qty: 0 }], { p1: { stock: 5 } });
ok('cantidad 0 no pasa', badQty.ok === false);

const back = S.planStockRestore(
    [{ productId: 'p1', qty: 2 }, { productId: 'gone', qty: 4 }, { productId: '', qty: 1 }, { productId: 'p2', qty: 0 }],
    { p1: { stock: 1 }, p2: { stock: 9 } }
);
ok('al cancelar devuelve solo lo que sigue existiendo', back.length === 1 && back[0].productId === 'p1' && back[0].next === 3);

const C = { lat: 14.4598, lng: -87.6378 };
const sq = (lat, lng, d) => [{ lat: lat - d, lng: lng - d }, { lat: lat - d, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng: lng - d }];
const zc = { id: 'c', name: 'Céntrica', active: true, priority: 1, baseFee: 45, polygon: sq(C.lat, C.lng, 0.005), cityId: 'comayagua' };
const zf = { id: 'f', name: 'Fuera', active: true, priority: 2, baseFee: 110, minFee: 100, maxFee: 120, polygon: sq(C.lat, C.lng, 0.03), cityId: 'comayagua' };
const qMoto = DZ.quoteDelivery({ zones: [zc], lat: C.lat, lng: C.lng });
ok('sin vehículo la tarifa es la de la moto (y carro mínimo L. 75)', qMoto.fee === 45 && qMoto.feeMoto === 45 && qMoto.feeCar === 75 && qMoto.vehicle === 'moto' && qMoto.carFactor === 1.25);
const qCar = DZ.quoteDelivery({ zones: [zc], lat: C.lat, lng: C.lng, vehicle: 'carro' });
ok('carro mínimo L. 75: 45 → 75', qCar.fee === 75 && qCar.vehicle === 'auto' && qCar.feeMoto === 45);
const q115 = DZ.quoteDelivery({ zones: [zf], storeFees: { f: { mode: 'custom', fee: 115 } }, lat: C.lat + 0.02, lng: C.lng, vehicle: 'auto' });
ok('carro sobre tarifa de la tienda: 115 → 143.75', q115.fee === 143.75 && q115.feeMoto === 115 && q115.feeCar === 143.75 && q115.source === 'store_custom');
const q115m = DZ.quoteDelivery({ zones: [zf], storeFees: { f: { mode: 'custom', fee: 115 } }, lat: C.lat + 0.02, lng: C.lng, vehicle: 'moto' });
ok('moto sigue en 115', q115m.fee === 115 && q115m.vehicle === 'moto');
ok('elección de vehículo', DZ.deliveryVehicleChoice('') === '' && DZ.deliveryVehicleChoice('moto') === 'moto' && DZ.deliveryVehicleChoice('CARRO') === 'auto' && DZ.CAR_DELIVERY_FACTOR === 1.25);

for (const r of res) console.log(...r);
console.log(`${res.filter((r) => r[0] === 'PASS').length}/${res.length} PASS`);
process.exit(res.every((r) => r[0] === 'PASS') ? 0 : 1);
