const HN_TZ = 'America/Tegucigalpa';

const FIXED_HOLIDAYS = [
    { month: 1, day: 1, name: 'Año Nuevo', greeting: '¡Feliz Año Nuevo!' },
    { month: 4, day: 14, name: 'Día de las Américas', greeting: '¡Feliz Día de las Américas!' },
    { month: 5, day: 1, name: 'Día del Trabajador', greeting: '¡Feliz Día del Trabajador!' },
    { month: 9, day: 15, name: 'Día de la Independencia', greeting: '¡Feliz Día de la Independencia de Honduras!' },
    { month: 10, day: 3, name: 'Día del Soldado', greeting: '¡Feliz Día del Soldado Hondureño!' },
    { month: 10, day: 12, name: 'Día de la Raza', greeting: '¡Feliz Día de la Raza y la Herencia Cultural!' },
    { month: 10, day: 21, name: 'Día de las Fuerzas Armadas', greeting: '¡Feliz Día de las Fuerzas Armadas!' },
    { month: 12, day: 25, name: 'Navidad', greeting: '¡Feliz Navidad!' }
];

function getEasterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return { year, month, day };
}

function getSemanaSantaHolidays(year) {
    const easter = getEasterSunday(year);
    const easterDate = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
    const offsets = [
        { days: -3, name: 'Jueves Santo', greeting: '¡Feliz Jueves Santo!' },
        { days: -2, name: 'Viernes Santo', greeting: '¡Feliz Viernes Santo!' },
        { days: -1, name: 'Sábado de Gloria', greeting: '¡Feliz Sábado de Gloria!' }
    ];
    return offsets.map(({ days, name, greeting }) => {
        const d = new Date(easterDate);
        d.setUTCDate(d.getUTCDate() + days);
        return {
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            name,
            greeting
        };
    });
}

export function getHondurasDateParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: HN_TZ,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        hour12: false
    });
    const parts = fmt.formatToParts(date);
    const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour')
    };
}

export function getHondurasHoliday(date = new Date()) {
    const { year, month, day } = getHondurasDateParts(date);
    const fixed = FIXED_HOLIDAYS.find((h) => h.month === month && h.day === day);
    if (fixed) return fixed;

    const semanaSanta = getSemanaSantaHolidays(year);
    return semanaSanta.find((h) => h.month === month && h.day === day) || null;
}

export function getTimeGreeting(hour) {
    if (hour >= 5 && hour < 12) return 'Buenos días';
    if (hour >= 12 && hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
}

export function getFirstName(fullName) {
    if (!fullName) return 'Usuario';
    const trimmed = String(fullName).trim();
    if (!trimmed) return 'Usuario';
    return trimmed.split(/\s+/)[0];
}

export function getGenderHonorific(gender) {
    if (gender === 'male') return 'estimado';
    if (gender === 'female') return 'estimada';
    return '';
}

export function getGenderedBirthdayWord(gender) {
    if (gender === 'male') return 'querido';
    if (gender === 'female') return 'querida';
    return 'querido/a';
}

export function isBirthdayToday(birthDate, date = new Date()) {
    if (!birthDate || typeof birthDate !== 'string') return false;
    const match = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return false;
    const [, , month, day] = match;
    const { month: hnMonth, day: hnDay } = getHondurasDateParts(date);
    return parseInt(month, 10) === hnMonth && parseInt(day, 10) === hnDay;
}

export function canUseBirthdayFreeTrip(profile, date = new Date()) {
    if (!profile || profile.role !== 'client') return false;
    if (!profile.birthDate) return false;
    if (!isBirthdayToday(profile.birthDate, date)) return false;
    const { year } = getHondurasDateParts(date);
    return profile.birthdayFreeTripYear !== year;
}

export function isDriverBirthdayNoCommission(profile, date = new Date()) {
    if (!profile || profile.role !== 'driver') return false;
    if (!profile.birthDate) return false;
    return isBirthdayToday(profile.birthDate, date);
}

export function getBirthdayBannerDetail(profile) {
    if (profile?.role === 'driver') {
        return 'Hoy todos tus viajes finalizados van sin comisión de la plataforma.';
    }
    if (profile?.role === 'client') {
        if (canUseBirthdayFreeTrip(profile)) {
            return 'Calcula tu ruta y solicita el viaje: la tarifa será L. 0.00 (1 regalo al año).';
        }
        return 'Ya usaste tu viaje gratis de este año. ¡Disfruta tu día!';
    }
    return '¡Que tengas un excelente día!';
}

export function getBirthdayCelebrationMessage(profile) {
    const name = getFirstName(profile?.name);
    const word = getGenderedBirthdayWord(profile?.gender);
    if (profile?.role === 'driver') {
        return `¡Feliz cumpleaños, ${word} ${name}! Hoy no pagas comisión en tus viajes.`;
    }
    if (profile?.role === 'client') {
        const used = !canUseBirthdayFreeTrip(profile);
        if (used) {
            return `¡Feliz cumpleaños, ${word} ${name}! Disfruta tu día en Honduras.`;
        }
        return `¡Feliz cumpleaños, ${word} ${name}! Tienes 1 viaje gratis hoy.`;
    }
    return `¡Feliz cumpleaños, ${word} ${name}!`;
}

export function getHonduranCompanionTerm(gender) {
    if (gender === 'male') return 'alero';
    if (gender === 'female') return 'alera';
    return '';
}

export function getClientTripHeadline(profile) {
    const name = getFirstName(profile?.name);
    const term = getHonduranCompanionTerm(profile?.gender);
    if (term) {
        return `¿A dónde vamos hoy, ${term} ${name}?`;
    }
    return `¿A dónde vamos hoy, ${name}?`;
}

export function buildUserGreeting(profile, date = new Date()) {
    const { hour } = getHondurasDateParts(date);
    const timeGreeting = getTimeGreeting(hour);
    const name = getFirstName(profile?.name);
    const honorific = getGenderHonorific(profile?.gender);
    const holiday = getHondurasHoliday(date);

    if (profile?.birthDate && isBirthdayToday(profile.birthDate, date)) {
        const bday = getBirthdayCelebrationMessage(profile);
        return `${bday} ${timeGreeting}, ${name}.`;
    }

    const honorificPart = honorific ? ` ${honorific}` : '';
    const base = `${timeGreeting},${honorificPart} ${name}`;

    if (holiday) {
        return `${holiday.greeting} ${base}`;
    }

    return base;
}