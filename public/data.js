// Airline ICAO to Name Mapping
const airlines = {
    'UAL': 'United Airlines',
    'AAL': 'American Airlines',
    'DAL': 'Delta Air Lines',
    'SWA': 'Southwest Airlines',
    'JBU': 'JetBlue Airways',
    'ASA': 'Alaska Airlines',
    'NKS': 'Spirit Airlines',
    'FFT': 'Frontier Airlines',
    'RPA': 'Republic Airways',
    'JIA': 'PSA Airlines',
    'EDV': 'Endeavor Air',
    'SKW': 'SkyWest Airlines',
    'EJA': 'NetJets',
    'GTI': 'Atlas Air',
    'UPS': 'UPS Airlines',
    'FDX': 'FedEx Express',
    'BAW': 'British Airways',
    'VIR': 'Virgin Atlantic',
    'AFR': 'Air France',
    'DLH': 'Lufthansa',
    'KLM': 'KLM Royal Dutch Airlines',
    'SAS': 'SAS',
    'EIN': 'Aer Lingus',
    'QTR': 'Qatar Airways',
    'UAE': 'Emirates',
    'ETD': 'Etihad Airways',
    'WJA': 'WestJet',
    'ACA': 'Air Canada'
};

function getAirlineName(icao) {
    if (!icao || icao.length < 3) return icao;
    const prefix = icao.substring(0, 3).toUpperCase();
    return airlines[prefix] || icao;
}

