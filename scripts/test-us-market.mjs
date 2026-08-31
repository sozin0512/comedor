/** Checks de bbox / reglas US (sin importar .js del app: package.json es CJS). */

function coordsAreInUnitedStates(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
    if (la >= 24.4 && la <= 49.5 && ln >= -124.9 && ln <= -66.7) return true;
    if (la >= 51 && la <= 72 && ln >= -180 && ln <= -129) return true;
    if (la >= 18.8 && la <= 22.4 && ln >= -160.4 && ln <= -154.7) return true;
    if (la >= 17.8 && la <= 18.6 && ln >= -67.4 && ln <= -65.2) return true;
    return false;
}

function detectMarketFromCoords(lat, lng) {
    if (coordsAreInUnitedStates(lat, lng)) return 'us';
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) return 'hn';
    return null;
}

const checks = [];
function ok(name, cond) {
    checks.push({ name, pass: !!cond });
}

ok('Houston is US', detectMarketFromCoords(29.7604, -95.3698) === 'us');
ok('NYC bbox', coordsAreInUnitedStates(40.7128, -74.006));
ok('Honolulu bbox', coordsAreInUnitedStates(21.3069, -157.8583));
ok('Anchorage bbox', coordsAreInUnitedStates(61.2181, -149.9003));
ok('San Juan bbox', coordsAreInUnitedStates(18.4655, -66.1057));
ok('Comayagua is HN', detectMarketFromCoords(14.4513, -87.6374) === 'hn');
ok('Tegucigalpa not US', coordsAreInUnitedStates(14.0723, -87.1921) === false);
ok('Mexico City not US', coordsAreInUnitedStates(19.4326, -99.1332) === false);

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (failed.length) process.exit(1);
