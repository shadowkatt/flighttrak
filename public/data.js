// Airline ICAO to Name Mapping
const airlines = {
    'UAL': 'United Airlines',
    'AAL': 'American Airlines',
    'DAL': 'Delta Air Lines',
    'SWA': 'Southwest Airlines',
    'JBU': 'JetBlue Airways',
    'ASA': 'Alaska Airlines',
    'AAY': 'Allegiant Air',
    'NKS': 'Spirit Airlines',
    'FFT': 'Frontier Airlines',
    'HAL': 'Hawaiian Airlines',
    'BRE': 'Breeze Airways',
    'MXY': 'Breeze Airways',
    'AVX': 'Avelo Airlines',
    'RPA': 'Republic Airways',
    'ASH': 'Mesa Airlines',
    'JIA': 'PSA Airlines',
    'EDV': 'Endeavor Air',
    'ENY': 'Envoy Air',
    'PDT': 'Piedmont Airlines',
    'SKW': 'SkyWest Airlines',
    'VTE': 'Contour Airlines',
    'GGT': 'Trans Island Airways',
    'SCX': 'Sun Country Airlines',
    'GJS': 'GoJet',
    'JZA': 'Air Canada Express',
    'WJA': 'WestJet',
    'PTR': 'Porter Airlines',
    'POE': 'Porter Airlines',
    'JSX': 'JSX Air',
    'DJT': 'La Compagnie',
    'GTI': 'Atlas Air',
    'ABW': 'AirBridgeCargo Airlines',
    'ABR': 'ASL Airlines Ireland',
    'ACP': 'Astral Aviation',
    'ADZ': 'Compass Cargo Airlines',
    'AHK': 'Air Hong Kong',
    'AJT': 'Amerijet International',
    'AMF': 'Ameriflight',
    'UPS': 'UPS Airlines',
    'FDX': 'FedEx Express',
    'ABX': 'ABX Air',
    'MTN': 'Mountain Air Cargo',
    'BAW': 'British Airways',
    'VIR': 'Virgin Atlantic',
    'AFR': 'Air France',
    'DLH': 'Lufthansa',
    'KLM': 'KLM Royal Dutch Airlines',
    'SAS': 'SAS',
    'ICE': 'Icelandair',
    'FIN': 'Finnair',
    'AEE': 'Aegean Airlines',
    'EIN': 'Aer Lingus',
    'IBE': 'Iberia',
    'SWR': 'Swiss International Air Lines',
    'AUA': 'Austrian Airlines',
    'LOT': 'LOT Polish Airlines',
    'AZA': 'ITA Airways',
    'TAP': 'Air Portugal',
    'BEL': 'Brussels Airlines',
    'CLH': 'Lufthansa Cargo',
    'CLX': 'Cargolux',
    'QTR': 'Qatar Airways',
    'UAE': 'Emirates',
    'ETD': 'Etihad Airways',
    'ELY': 'El Al Airlines',
    'THY': 'Turkish Airlines',
    'SVA': 'Saudia',
    'MEA': 'Middle East Airlines',
    'RJA': 'Royal Jordanian',
    'ETH': 'Ethiopian Airlines',
    'SAA': 'South African Airways',
    'ANA': 'All Nippon Airways',
    'JAL': 'Japan Airlines',
    'SIA': 'Singapore Airlines',
    'CPA': 'Cathay Pacific',
    'EVA': 'EVA Air',
    'KAL': 'Korean Air',
    'APZ': 'Air Premia',
    'CSN': 'China Southern',
    'CES': 'China Eastern',
    'CCA': 'Air China',
    'CAL': 'China Airlines',
    'CSA': 'Czech Airlines',
    'CSC': 'Sichuan Airlines',
    'CSH': 'Shanghai Airlines',
    'CSZ': 'Shenzhen Airlines',
    'CXA': 'Xiamen Airlines',
    'CGN': 'Air Changan',
    'HVN': 'Vietnam Airlines',
    'MAS': 'Malaysia Airlines',
    'THA': 'Thai Airways',
    'PAL': 'Philippine Airlines',
    'FJI': 'Fiji Airways',
    'GIA': 'Garuda Indonesia',
    'AIC': 'Air India',
    'AIB': 'Air India Express',
    'SEJ': 'SpiceJet',
    'ANZ': 'Air New Zealand',
    'VOZ': 'Virgin Australia',
    'QFA': 'Qantas',
    'ACA': 'Air Canada',
    'TSC': 'Air Transat',
    'ROU': 'Air Canada Rouge',
    'VOI': 'Volaris',
    'AMX': 'Aeroméxico',
    'AVA': 'Avianca',
    'CMP': 'Copa Airlines',
    'TAM': 'LATAM Airlines',
    'DWI': 'Arajet',
    'BMA': 'BermudAir',
    'RYR': 'Ryanair',
    'EZY': 'easyJet',
    'WZZ': 'Wizz Air',
    'VLG': 'Vueling',
    'VOE': 'Volotea',
    'TVS': 'Transavia',
    'TVF': 'Transavia France',
    'TOM': 'TUI Airways',
    'EXS': 'Jet2',
    'GWI': 'Eurowings',
    'RBA': 'Royal Brunei',
    'FBU': 'French Bee',
    'AAR': 'Asiana Airlines',
    'ABL': 'Air Busan',
    'ABY': 'Air Arabia',
    'ACI': 'Aircalin',
    'AEA': 'Air Europa',
    'AFL': 'Aeroflot',
    'ANE': 'Air Nostrum',
    
    // Private Aviation & Charter Operators
    'EJA': 'NetJets',
    'EJM': 'NetJets Management',
    'LXJ': 'Flexjet',
    'VJT': 'VistaJet',
    'VJA': 'Vista America',
    'TIV': 'Thrive',
    'ASP': 'AirSprint',
    'BLK': 'BLAK International',
    'JAS': 'Jet Aviation',
    'VJH': 'VistaJet Germany',
    'ELZ': 'Elite Air',
    'EDG': 'Jet Edge',
    'NOJ': 'NovaJet',
    'SIY': 'Aerosiyusa',
    'VNT': 'Ventura Air Services',
    'WUP': 'Wheels Up',
    'WWI': 'Worldwide Jet Charter',
    'XEN': 'Zenflight',
    'XSR': 'Airshare',
    'BVR': 'ACM Air Charter',
    'CNS': 'Cobalt Air',
    'ERY': 'Sky Quest',
    'JRE': 'Jet Share',
    'JTL': 'Jet Linx Aviation',
    'KFB': 'STAjets',
    'KOW': 'Baker Aviation',
    'MJS': 'JET SAVER',
    'MVJ': 'Mira Vista Aviation',
    'RKJ': 'Charter Airlines',
    'RNI': 'Rennia Aviation',
    'SBY': 'Skyservice',
    'SGX': 'Slate Aviation',
    'TCN': 'BellAir',
    'TFF': 'Talon Air',
    'TWY': 'Sunset Aviation',
    'WDY': 'Aviation Spectrum',
    'GTX': 'GTA Air',
    'XAA': 'Centene Corporation',
    'XFL': 'EX-FLIGHT'
};

function getAirlineName(icao) {
    if (!icao || icao.length < 3) return icao;
    const prefix = icao.substring(0, 3).toUpperCase();
    return airlines[prefix] || icao;
}

// Logo Override Configuration
const logoOverrides = {
    // JetBlue - Brighter logo for better visibility
    'JBU': 'logos/JBU.png',
    
    // El Al - Brighter logo for better visibility
    'ELY': 'logos/ELY.jpg',
    
    // Porter Airlines - Custom logo for better visibility
    'PTR': 'logos/PTR.png'
};

function getAirlineLogo(icao) {
    if (!icao || icao.length < 2) return null;
    
    // Extract first 3 chars for airline code (handles callsigns like "JBU123")
    const airlineCode = icao.substring(0, 3).toUpperCase();
    
    // Check for local override first
    if (logoOverrides[airlineCode]) {
        return logoOverrides[airlineCode];
    }
    
    // Fall back to GitHub CDN
    const cdnBase = 'https://raw.githubusercontent.com/sexym0nk3y/airline-logos/main/logos';
    return `${cdnBase}/${airlineCode}.png`;
}
// Helper to check if an airline code is known
function isKnownAirline(icao) {
    if (!icao || icao.length < 3) return false;
    const prefix = icao.substring(0, 3).toUpperCase();
    return prefix in airlines;
}