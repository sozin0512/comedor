/**
 * Ciudades / metros de EE. UU. para matching HonduRaite.
 * department = estado (el spill solo ocurre dentro del mismo estado).
 */
export const US_CITIES = [
    // Texas
    { id: 'us-houston', name: 'Houston', department: 'Texas', center: { lat: 29.7604, lng: -95.3698 }, coverageKm: 42 },
    { id: 'us-dallas', name: 'Dallas', department: 'Texas', center: { lat: 32.7767, lng: -96.7970 }, coverageKm: 38 },
    { id: 'us-fort-worth', name: 'Fort Worth', department: 'Texas', center: { lat: 32.7555, lng: -97.3308 }, coverageKm: 32 },
    { id: 'us-austin', name: 'Austin', department: 'Texas', center: { lat: 30.2672, lng: -97.7431 }, coverageKm: 32 },
    { id: 'us-san-antonio', name: 'San Antonio', department: 'Texas', center: { lat: 29.4241, lng: -98.4936 }, coverageKm: 35 },
    { id: 'us-el-paso', name: 'El Paso', department: 'Texas', center: { lat: 31.7619, lng: -106.4850 }, coverageKm: 28 },
    { id: 'us-mcallen', name: 'McAllen', department: 'Texas', center: { lat: 26.2034, lng: -98.2300 }, coverageKm: 24 },
    { id: 'us-laredo', name: 'Laredo', department: 'Texas', center: { lat: 27.5306, lng: -99.4803 }, coverageKm: 22 },
    // Florida
    { id: 'us-miami', name: 'Miami', department: 'Florida', center: { lat: 25.7617, lng: -80.1918 }, coverageKm: 35 },
    { id: 'us-orlando', name: 'Orlando', department: 'Florida', center: { lat: 28.5383, lng: -81.3792 }, coverageKm: 32 },
    { id: 'us-tampa', name: 'Tampa', department: 'Florida', center: { lat: 27.9506, lng: -82.4572 }, coverageKm: 30 },
    { id: 'us-fort-lauderdale', name: 'Fort Lauderdale', department: 'Florida', center: { lat: 26.1224, lng: -80.1373 }, coverageKm: 24 },
    { id: 'us-jacksonville', name: 'Jacksonville', department: 'Florida', center: { lat: 30.3322, lng: -81.6557 }, coverageKm: 32 },
    // California
    { id: 'us-los-angeles', name: 'Los Angeles', department: 'California', center: { lat: 34.0522, lng: -118.2437 }, coverageKm: 42 },
    { id: 'us-san-diego', name: 'San Diego', department: 'California', center: { lat: 32.7157, lng: -117.1611 }, coverageKm: 32 },
    { id: 'us-san-francisco', name: 'San Francisco', department: 'California', center: { lat: 37.7749, lng: -122.4194 }, coverageKm: 28 },
    { id: 'us-san-jose', name: 'San Jose', department: 'California', center: { lat: 37.3382, lng: -121.8863 }, coverageKm: 28 },
    { id: 'us-sacramento', name: 'Sacramento', department: 'California', center: { lat: 38.5816, lng: -121.4944 }, coverageKm: 28 },
    // Northeast
    { id: 'us-new-york', name: 'New York', department: 'New York', center: { lat: 40.7128, lng: -74.0060 }, coverageKm: 32 },
    { id: 'us-newark', name: 'Newark', department: 'New Jersey', center: { lat: 40.7357, lng: -74.1724 }, coverageKm: 22 },
    { id: 'us-boston', name: 'Boston', department: 'Massachusetts', center: { lat: 42.3601, lng: -71.0589 }, coverageKm: 28 },
    { id: 'us-philadelphia', name: 'Philadelphia', department: 'Pennsylvania', center: { lat: 39.9526, lng: -75.1652 }, coverageKm: 30 },
    { id: 'us-washington-dc', name: 'Washington D.C.', department: 'District of Columbia', center: { lat: 38.9072, lng: -77.0369 }, coverageKm: 30 },
    { id: 'us-baltimore', name: 'Baltimore', department: 'Maryland', center: { lat: 39.2904, lng: -76.6122 }, coverageKm: 26 },
    // Midwest / South
    { id: 'us-chicago', name: 'Chicago', department: 'Illinois', center: { lat: 41.8781, lng: -87.6298 }, coverageKm: 38 },
    { id: 'us-atlanta', name: 'Atlanta', department: 'Georgia', center: { lat: 33.7490, lng: -84.3880 }, coverageKm: 35 },
    { id: 'us-charlotte', name: 'Charlotte', department: 'North Carolina', center: { lat: 35.2271, lng: -80.8431 }, coverageKm: 28 },
    { id: 'us-nashville', name: 'Nashville', department: 'Tennessee', center: { lat: 36.1627, lng: -86.7816 }, coverageKm: 28 },
    { id: 'us-new-orleans', name: 'New Orleans', department: 'Louisiana', center: { lat: 29.9511, lng: -90.0715 }, coverageKm: 26 },
    { id: 'us-detroit', name: 'Detroit', department: 'Michigan', center: { lat: 42.3314, lng: -83.0458 }, coverageKm: 28 },
    { id: 'us-minneapolis', name: 'Minneapolis', department: 'Minnesota', center: { lat: 44.9778, lng: -93.2650 }, coverageKm: 28 },
    { id: 'us-columbus', name: 'Columbus', department: 'Ohio', center: { lat: 39.9612, lng: -82.9988 }, coverageKm: 26 },
    { id: 'us-indianapolis', name: 'Indianapolis', department: 'Indiana', center: { lat: 39.7684, lng: -86.1581 }, coverageKm: 28 },
    { id: 'us-kansas-city', name: 'Kansas City', department: 'Missouri', center: { lat: 39.0997, lng: -94.5783 }, coverageKm: 28 },
    { id: 'us-st-louis', name: 'St. Louis', department: 'Missouri', center: { lat: 38.6270, lng: -90.1994 }, coverageKm: 26 },
    { id: 'us-memphis', name: 'Memphis', department: 'Tennessee', center: { lat: 35.1495, lng: -90.0490 }, coverageKm: 26 },
    { id: 'us-louisville', name: 'Louisville', department: 'Kentucky', center: { lat: 38.2527, lng: -85.7585 }, coverageKm: 24 },
    { id: 'us-oklahoma-city', name: 'Oklahoma City', department: 'Oklahoma', center: { lat: 35.4676, lng: -97.5164 }, coverageKm: 28 },
    // West
    { id: 'us-phoenix', name: 'Phoenix', department: 'Arizona', center: { lat: 33.4484, lng: -112.0740 }, coverageKm: 38 },
    { id: 'us-tucson', name: 'Tucson', department: 'Arizona', center: { lat: 32.2226, lng: -110.9747 }, coverageKm: 26 },
    { id: 'us-las-vegas', name: 'Las Vegas', department: 'Nevada', center: { lat: 36.1699, lng: -115.1398 }, coverageKm: 30 },
    { id: 'us-denver', name: 'Denver', department: 'Colorado', center: { lat: 39.7392, lng: -104.9903 }, coverageKm: 32 },
    { id: 'us-seattle', name: 'Seattle', department: 'Washington', center: { lat: 47.6062, lng: -122.3321 }, coverageKm: 30 },
    { id: 'us-portland', name: 'Portland', department: 'Oregon', center: { lat: 45.5152, lng: -122.6784 }, coverageKm: 26 },
    { id: 'us-salt-lake-city', name: 'Salt Lake City', department: 'Utah', center: { lat: 40.7608, lng: -111.8910 }, coverageKm: 26 },
    { id: 'us-albuquerque', name: 'Albuquerque', department: 'New Mexico', center: { lat: 35.0844, lng: -106.6504 }, coverageKm: 26 },
    // Hawaii / Alaska / PR
    { id: 'us-honolulu', name: 'Honolulu', department: 'Hawaii', center: { lat: 21.3069, lng: -157.8583 }, coverageKm: 22 },
    { id: 'us-anchorage', name: 'Anchorage', department: 'Alaska', center: { lat: 61.2181, lng: -149.9003 }, coverageKm: 24 },
    { id: 'us-san-juan', name: 'San Juan', department: 'Puerto Rico', center: { lat: 18.4655, lng: -66.1057 }, coverageKm: 22 },
].map((z) => ({ ...z, country: 'us' }));

export const US_DEFAULT_ZONE_ID = 'us-houston';
