/**
 * Condiciones de ruta: tráfico (Google Routes) y clima (Open-Meteo, sin API key).
 */

const WEATHER_CACHE_MS = 10 * 60 * 1000;
const weatherCache = new Map();

const WEATHER_LABELS = {
    clear: 'Despejado',
    cloudy: 'Nublado',
    drizzle: 'Llovizna',
    rain: 'Lluvia',
    heavy_rain: 'Lluvia fuerte',
    storm: 'Tormenta',
    fog: 'Neblina',
};

function weatherCodeCategory(code) {
    const c = Number(code);
    if (Number.isNaN(c)) return 'cloudy';
    if (c === 0 || c === 1) return 'clear';
    if (c >= 2 && c <= 3) return 'cloudy';
    if (c >= 45 && c <= 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if (c >= 61 && c <= 67) return 'rain';
    if (c >= 80 && c <= 82) return 'rain';
    if (c >= 95 && c <= 99) return 'storm';
    return 'cloudy';
}

function surchargeForWeather(category, precipitationMm = 0) {
    // Clima: llovizna, lluvia y lluvia fuerte afectan el precio en todos los servicios.
    if (category === 'heavy_rain') {
        return { percent: 15, extraMinutes: 6, label: WEATHER_LABELS.heavy_rain };
    }
    if (category === 'rain') {
        return { percent: 12, extraMinutes: 4, label: WEATHER_LABELS.rain };
    }
    if (category === 'drizzle') {
        return { percent: 10, extraMinutes: 2, label: WEATHER_LABELS.drizzle };
    }
    return { percent: 0, extraMinutes: 0, label: WEATHER_LABELS[category] || WEATHER_LABELS.cloudy };
}

export function analyzeTrafficFromRoute(route) {
    const durationMs = route?.durationMillis || route?.legs?.[0]?.durationMillis || 0;
    const staticMs = route?.staticDurationMillis || route?.legs?.[0]?.staticDurationMillis || 0;

    if (!durationMs) {
        return {
            delayMinutes: 0,
            delayRatio: 0,
            level: 'unknown',
            surchargePercent: 0,
            durationMs: 0,
            staticMs: 0,
            trafficAware: false,
        };
    }

    const staticRef = staticMs > 0 ? staticMs : durationMs;
    const delayMs = Math.max(0, durationMs - staticRef);
    const delayMinutes = Math.round(delayMs / 60000);
    const delayRatio = staticRef > 0 ? delayMs / staticRef : 0;

    // Diferenciar tráfico:
    // - Dentro de la ciudad (ej. Liceo Jesús de Nazaret → Golf Club): tráfico SÍ afecta (umbral bajo, % más alto)
    // - Sale de ciudad / carretera (ej. CA-5 a La Paz): tráfico más leve/raro → umbral alto y % más leve
    const distanceKm = (route?.distanceMeters || route?.legs?.[0]?.distanceMeters || 0) / 1000;
    const isCityTrip = distanceKm <= 15;

    let level = 'free';
    let surchargePercent = 0;

    const minDelayForSurcharge = isCityTrip ? 5 : 12;

    if (delayMinutes >= minDelayForSurcharge) {
        if (delayRatio >= 0.35 || delayMinutes >= (isCityTrip ? 12 : 20)) {
            level = 'heavy';
            surchargePercent = isCityTrip ? 12 : 7;
        } else if (delayMinutes >= (isCityTrip ? 8 : 15) || delayRatio >= 0.18) {
            level = 'moderate';
            surchargePercent = isCityTrip ? 8 : 5;
        } else {
            level = 'light';
            surchargePercent = isCityTrip ? 5 : 3;
        }
    }

    return {
        delayMinutes,
        delayRatio,
        level,
        surchargePercent,
        durationMs,
        staticMs: staticRef,
        trafficAware: staticMs > 0,
        isCityTrip,
    };
}

export async function fetchWeatherAtPoint(lat, lng) {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (Number.isNaN(latN) || Number.isNaN(lngN)) return null;

    const key = `${latN.toFixed(2)},${lngN.toFixed(2)}`;
    const cached = weatherCache.get(key);
    if (cached && Date.now() - cached.at < WEATHER_CACHE_MS) return cached.data;

    try {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', String(latN));
        url.searchParams.set('longitude', String(lngN));
        url.searchParams.set('current', 'weather_code,precipitation,rain,temperature_2m,wind_speed_10m');
        url.searchParams.set('timezone', 'America/Tegucigalpa');
        url.searchParams.set('forecast_days', '1');

        const res = await fetch(url.toString());
        if (!res.ok) return null;
        const json = await res.json();
        const current = json?.current;
        if (!current) return null;

        const category = weatherCodeCategory(current.weather_code);
        const precip = Number(current.precipitation) || Number(current.rain) || 0;
        const wx = surchargeForWeather(category, precip);

        const data = {
            category,
            label: wx.label,
            precipitationMm: precip,
            temperatureC: current.temperature_2m,
            windKmh: current.wind_speed_10m,
            surchargePercent: wx.percent,
            extraMinutes: wx.extraMinutes,
            weatherCode: current.weather_code,
            fetchedAt: Date.now(),
        };
        weatherCache.set(key, { at: Date.now(), data });
        return data;
    } catch (e) {
        console.warn('[ROUTE-CONDITIONS] Clima no disponible:', e?.message || e);
        return null;
    }
}

export function buildRouteConditions(traffic, weather) {
    const trafficSurchargePercent = traffic?.surchargePercent || 0;
    const weatherSurchargePercent = weather?.surchargePercent || 0;
    const extraMinutes = (traffic?.delayMinutes || 0) + (weather?.extraMinutes || 0);

    return {
        traffic: traffic || null,
        weather: weather || null,
        trafficSurchargePercent,
        weatherSurchargePercent,
        extraMinutes,
        hasAdjustments: trafficSurchargePercent > 0 || weatherSurchargePercent > 0,
    };
}

export async function getRouteConditions(route, midpoint) {
    const traffic = analyzeTrafficFromRoute(route);
    let weather = null;
    if (midpoint?.lat != null && midpoint?.lng != null) {
        weather = await fetchWeatherAtPoint(midpoint.lat, midpoint.lng);
    }
    return buildRouteConditions(traffic, weather);
}

export function formatConditionsSummary(conditions) {
    if (!conditions) return '';
    const parts = [];
    const t = conditions.traffic;
    if (t?.trafficAware && t.delayMinutes > 0) {
        const levelLabel = t.level === 'heavy' ? 'tráfico intenso'
            : t.level === 'moderate' ? 'tráfico moderado'
                : t.level === 'light' ? 'tráfico ligero' : 'tráfico';
        parts.push(`${levelLabel} (+${t.delayMinutes} min)`);
    } else if (t?.trafficAware) {
        parts.push('tráfico fluido');
    }
    if (conditions.weather?.label && conditions.weather.surchargePercent > 0) {
        parts.push(`${conditions.weather.label.toLowerCase()}`);
    } else if (conditions.weather?.label) {
        parts.push(conditions.weather.label);
    }
    return parts.join(' · ');
}

export function formatConditionsNote(conditions) {
    if (!conditions?.hasAdjustments) {
        if (conditions?.traffic?.trafficAware) {
            return 'Estimación con tráfico en tiempo real';
        }
        return '';
    }
    const bits = [];
    if (conditions.trafficSurchargePercent > 0) {
        bits.push(`tráfico +${conditions.trafficSurchargePercent}%`);
    }
    if (conditions.weatherSurchargePercent > 0) {
        const wxLabel = (conditions.weather?.label || 'clima').toLowerCase();
        bits.push(`${wxLabel} +${conditions.weatherSurchargePercent}%`);
    }
    return bits.length ? `Ajuste por ${bits.join(' y ')}` : '';
}

export function getAdjustedDurationMinutes(route, conditions) {
    const baseMs = route?.durationMillis || route?.legs?.[0]?.durationMillis || 0;
    const baseMin = Math.max(1, Math.round(baseMs / 60000));
    const extra = conditions?.extraMinutes || 0;
    return Math.max(3, baseMin + extra);
}