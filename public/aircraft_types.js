// Aircraft Type Code to Full Name Mapping
const aircraftTypes = {
    // Boeing
    'B772': 'Boeing 777-200',
    'B77L': 'Boeing 777-200LR',
    'B773': 'Boeing 777-300',
    'B77W': 'Boeing 777-300ER',
    'B779': 'Boeing 777-9',
    'B788': 'Boeing 787-8',
    'B789': 'Boeing 787-9',
    'B78X': 'Boeing 787-10',
    'B763': 'Boeing 767-300',
    'B764': 'Boeing 767-400',
    'B762': 'Boeing 767-200',
    'B752': 'Boeing 757-200',
    'B753': 'Boeing 757-300',
    'B712': 'Boeing 717-200',
    'B732': 'Boeing 737-200',
    'B733': 'Boeing 737-300',
    'B734': 'Boeing 737-400',
    'B735': 'Boeing 737-500',
    'B736': 'Boeing 737-600',
    'B737': 'Boeing 737-700',
    'B738': 'Boeing 737-800',
    'B739': 'Boeing 737-900',
    'B37M': 'Boeing 737 MAX 7',
    'B38M': 'Boeing 737 MAX 8',
    'B39M': 'Boeing 737 MAX 9',
    'B3JM': 'Boeing 737 MAX 10',
    'B744': 'Boeing 747-400',
    'B748': 'Boeing 747-8',
    'B722': 'Boeing 727-200',
    'B721': 'Boeing 727-100',

    // Airbus
    'A320': 'Airbus A320',
    'A319': 'Airbus A319',
    'A321': 'Airbus A321',
    'A20N': 'Airbus A320neo',
    'A21N': 'Airbus A321neo',
    'A332': 'Airbus A330-200',
    'A333': 'Airbus A330-300',
    'A339': 'Airbus A330-900neo',
    'A342': 'Airbus A340-200',
    'A343': 'Airbus A340-300',
    'A345': 'Airbus A340-500',
    'A346': 'Airbus A340-600',
    'A359': 'Airbus A350-900',
    'A35K': 'Airbus A350-1000',
    'A388': 'Airbus A380-800',

    // Embraer
    'E170': 'Embraer 170',
    'E175': 'Embraer 175',
    'E190': 'Embraer 190',
    'E195': 'Embraer 195',
    'E290': 'Embraer E190-E2',
    'E295': 'Embraer E195-E2',

    // Bombardier/Canadair Regional Jets
    'CRJ1': 'Bombardier CRJ-100',
    'CRJ2': 'Bombardier CRJ-200',
    'CRJ7': 'Bombardier CRJ-700',
    'CRJ9': 'Bombardier CRJ-900',
    'CRJX': 'Bombardier CRJ-1000',
    
    // Bombardier Turboprops
    'DH8A': 'Bombardier Dash 8-100',
    'DH8B': 'Bombardier Dash 8-200',
    'DH8C': 'Bombardier Dash 8-300',
    'DH8D': 'Bombardier Dash 8-Q400',
    
    // ATR Turboprops
    'AT43': 'ATR 42-300',
    'AT45': 'ATR 42-500',
    'AT72': 'ATR 72-500',
    'AT73': 'ATR 72-600',
    'AT75': 'ATR 72-212A',
    'AT76': 'ATR 72-600',

    // McDonnell Douglas / Boeing Legacy
    'MD11': 'McDonnell Douglas MD-11',
    'MD80': 'McDonnell Douglas MD-80',
    'MD81': 'McDonnell Douglas MD-81',
    'MD82': 'McDonnell Douglas MD-82',
    'MD83': 'McDonnell Douglas MD-83',
    'MD87': 'McDonnell Douglas MD-87',
    'MD88': 'McDonnell Douglas MD-88',
    'MD90': 'McDonnell Douglas MD-90',
    'DC10': 'McDonnell Douglas DC-10',
    'DC93': 'McDonnell Douglas DC-9-30',
    
    // Older Airbus
    'A306': 'Airbus A300-600',
    'A310': 'Airbus A310',
    'A318': 'Airbus A318',

    // Additional Embraer variants
    'E75L': 'Embraer 175 (Long Range)',
    'E75S': 'Embraer 175 (Short Range)',
    'E145': 'Embraer ERJ-145',
    'E45X': 'Embraer ERJ-145XR',
    
    // Business Jets / Corporate Aircraft
    'C68A': 'Cessna Citation Latitude',
    'C208': 'Cessna 208 Caravan',
    'CL30': 'Bombardier Challenger 300',
    'CL35': 'Bombardier Challenger 350',
    'CL60': 'Bombardier Challenger 600',
    'LJ35': 'Learjet 35',
    'C25A': 'Cessna Citation CJ2',
    'C25B': 'Cessna Citation CJ3',
    'C25C': 'Cessna Citation CJ4',
    'C56X': 'Cessna Citation Excel',
    'C680': 'Cessna Citation Sovereign',
    'C700': 'Cessna Citation Longitude',
    'GLF4': 'Gulfstream IV',
    'GLF5': 'Gulfstream V',
    'GLF6': 'Gulfstream G650',
    'GL5T': 'Gulfstream G500/G550',
    'GL7T': 'Bombardier Global 7500',
    'GALX': 'Gulfstream G200',
    'F2TH': 'Dassault Falcon 2000',
    'FA7X': 'Dassault Falcon 7X',
    'H25B': 'Hawker 800XP',
    'E35L': 'Embraer Legacy 600',
    'E55P': 'Embraer Phenom 300',
    'E545': 'Embraer Legacy 450',
    'E550': 'Embraer Phenom 300E',
    'PC12': 'Pilatus PC-12',
    
    // Airbus A220 (formerly Bombardier CSeries)
    'BCS1': 'Airbus A220-100',
    'BCS3': 'Airbus A220-300',
    'CS100': 'Airbus A220-100',
    'CS300': 'Airbus A220-300',
    
    // Cargo Aircraft
    'B74F': 'Boeing 747-400F (Freighter)',
    'B74S': 'Boeing 747-8F (Freighter)',
    'B77F': 'Boeing 777F (Freighter)',
    'B76F': 'Boeing 767-300F (Freighter)',
    'A30B': 'Airbus A300B4-200F',
    'A306F': 'Airbus A300-600F',
    'A332F': 'Airbus A330-200F',
    
    // Other Common Aircraft
    'A124': 'Antonov An-124 (Cargo)',
    'A225': 'Antonov An-225 Mriya',
    'IL76': 'Ilyushin Il-76 (Cargo)',
    'C130': 'Lockheed C-130 Hercules',
    'C17': 'Boeing C-17 Globemaster III',
    'C5': 'Lockheed C-5 Galaxy',
    'KC135': 'Boeing KC-135 Stratotanker',
    'KC10': 'McDonnell Douglas KC-10 Extender',
    'KC46': 'Boeing KC-46 Pegasus',
    
    // Helicopters (common in airspace)
    'B06': 'Bell 206 JetRanger',
    'B407': 'Bell 407',
    'B429': 'Bell 429',
    'EC35': 'Airbus H135',
    'EC45': 'Airbus H145',
    'S76': 'Sikorsky S-76',
    'AS50': 'Airbus AS350 Ecureuil',
    'AS55': 'Airbus AS355 Ecureuil 2',
    
    // General Aviation - Beechcraft
    'BE36': 'Beechcraft Bonanza A36',
    'BE35': 'Beechcraft Bonanza F33/V35',
    'BE58': 'Beechcraft Baron 58',
    'BE20': 'Beechcraft King Air 200',
    'BE9L': 'Beechcraft King Air 90',
    'BE10': 'Beechcraft King Air 100',
    'BE40': 'Beechcraft King Air 350',
    'B350': 'Beechcraft King Air 350'
};

// Track unknown aircraft types for debugging
const unknownTypes = new Set();
let userAircraftTypes = {};

// Load user-submitted aircraft types
async function loadUserAircraftTypes() {
    try {
        const response = await fetch('/api/aircraft-types');
        if (response.ok) {
            userAircraftTypes = await response.json();
            console.log(`[Aircraft Types] Loaded ${Object.keys(userAircraftTypes).length} user-submitted types`);
        }
    } catch (error) {
        console.log('[Aircraft Types] No user-submitted types found');
    }
}

// Load user types on page load
loadUserAircraftTypes();

function getAircraftTypeName(code) {
    if (!code) return 'Unknown';
    
    // Check built-in types first
    if (aircraftTypes[code]) {
        return aircraftTypes[code];
    }
    
    // Check user-submitted types
    if (userAircraftTypes[code]) {
        return userAircraftTypes[code].name;
    }
    
    // Check localStorage for immediate feedback
    const localType = localStorage.getItem(`aircraft_${code}`);
    if (localType) {
        return localType;
    }
    
    // Log unknown types (only once per type)
    if (!unknownTypes.has(code)) {
        unknownTypes.add(code);
        console.log(`[Aircraft Types] Unknown aircraft type: "${code}" - Click to identify`);
    }
    
    return code;
}

// Function to get all unknown types (for debugging)
function getUnknownTypes() {
    return Array.from(unknownTypes);
}
