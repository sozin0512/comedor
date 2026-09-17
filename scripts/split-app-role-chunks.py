# One-off splitter: extracts role chunks from app.js (idempotent if markers exist).
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "js" / "app.js"
text = APP.read_text(encoding="utf-8")
if "/* HR_SPLIT_PASSENGER_START */" in text:
    print("already split")
    raise SystemExit(0)

lines = text.splitlines(True)

def slice_inclusive(start_1, end_1):
    return "".join(lines[start_1 - 1 : end_1])

passenger = slice_inclusive(40791, 41912)
driver = slice_inclusive(29461, 29890)
staff = slice_inclusive(44200, len(lines))

header_p = '''/** Runtime pasajero: cotizar ruta y paradas extra. Se carga tras el login de cliente. */
import { isClientTripEligible } from './age-verification.js';
import { normalizeHondurasPhone } from './phone-utils.js';
import { ensureEndpointCoords } from './zones.js';
import { canUseBirthdayFreeTrip } from './greetings.js';
import {
    normalizeServiceType, extraStopsSurcharge, calculateServiceFare, calculateFreightFare,
    calculateTowFare, isFreightService, isTowService, getHourlyLabel, calculateHourlyFare,
    collectFreightDetailsFromUI, validateFreightDetails, collectTowDetailsFromUI,
    getServiceMeta, applyPassengerSurcharge, getHourlyRate
} from './service-types.js';

export function installPassengerRuntime() {
    if (window.__hrPassengerRuntime) return;
    window.__hrPassengerRuntime = true;
'''
header_d = '''/** Runtime conductor: llegada a origen/destino. Se carga tras el login de conductor. */
export function installDriverRuntime() {
    if (window.__hrDriverRuntime) return;
    window.__hrDriverRuntime = true;
'''
header_s = '''/** Runtime staff: estadísticas, depósitos y personalización. Tras login admin/supervisor. */
import { collection, getDocs, doc, setDoc, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getCustomTones, saveTonePrefs, listTones } from './notification-tones.js';

export function installStaffRuntime() {
    if (window.__hrStaffRuntime) return;
    window.__hrStaffRuntime = true;
    const db = window.db;
    const appId = window.appId;
'''

import re

def live_current_user(src: str) -> str:
    return re.sub(r"(?<!window\.)\bcurrentUser\b", "window.currentUser", src)

def live_active_trip(src: str) -> str:
    return re.sub(r"(?<!window\.)\bactiveTrip\b", "window.activeTrip", src)

(ROOT / "js" / "app-passenger.js").write_text(header_p + passenger + "\n}\n", encoding="utf-8")
(ROOT / "js" / "app-driver.js").write_text(header_d + live_active_trip(live_current_user(driver)) + "\n}\n", encoding="utf-8")
(ROOT / "js" / "app-staff.js").write_text(header_s + live_current_user(staff) + "\n}\n", encoding="utf-8")

# Replace extracted ranges in app.js with lazy stubs (reverse order)
def replace_range(start_1, end_1, stub):
    global lines
    lines = lines[: start_1 - 1] + [stub] + lines[end_1:]

replace_range(44200, len(lines), """
window.loadRoleStaffRuntime = async () => {
    const m = await import(`./app-staff.js?v=${APP_CONFIG.appVersion}`);
    m.installStaffRuntime();
};

""")
replace_range(40791, 41912, """
window.loadRolePassengerRuntime = async () => {
    const m = await import(`./app-passenger.js?v=${APP_CONFIG.appVersion}`);
    m.installPassengerRuntime();
};
window.calculateTripRoute = async (options = {}) => {
    await window.loadRolePassengerRuntime();
    return window.calculateTripRoute(options);
};

""")
replace_range(29461, 29890, """
window.loadRoleDriverRuntime = async () => {
    const m = await import(`./app-driver.js?v=${APP_CONFIG.appVersion}`);
    m.installDriverRuntime();
};

""")

APP.write_text("".join(lines), encoding="utf-8")
print("wrote app-passenger.js, app-driver.js, app-staff.js and trimmed app.js")
print("app.js lines", len(lines))
