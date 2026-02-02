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
    'GJS': 'United Express',
    'JZA': 'Air Canada Express',
    'PTR': 'Porter Airlines',
    'LXJ': 'Flexjet',
    'JSX': 'JSX Air',
    'VJA': 'Vista America',
    'TIV': 'Thrive',
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
    'ELY': 'El Al Airlines',
    'WJA': 'WestJet',
    'ACA': 'Air Canada',
    'DWI': 'Arajet',
    'TAP': 'Air Portugal',
    'BMA': 'BermudAir'
};

function getAirlineName(icao) {
    if (!icao || icao.length < 3) return icao;
    const prefix = icao.substring(0, 3).toUpperCase();
    return airlines[prefix] || icao;
}

// Expand airline codes in display text (e.g., "RPA (UAL)" -> "Republic Airways (United Airlines)")
function expandAirlineDisplay(displayText) {
    if (!displayText) return displayText;
    
    // Check if it matches pattern like "RPA (UAL)" or "EDV (DAL)"
    const match = displayText.match(/^([A-Z]{3})\s*\(([A-Z]{3})\)$/);
    if (match) {
        const operator = match[1]; // e.g., "RPA"
        const partner = match[2];  // e.g., "UAL"
        
        const operatorName = getAirlineName(operator);
        const partnerName = getAirlineName(partner);
        
        return `${operatorName} (${partnerName})`;
    }
    
    return displayText;
}

