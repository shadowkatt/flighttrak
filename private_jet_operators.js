/**
 * Private Jet & Charter Operator Configuration
 * 
 * This file defines which operators are considered "private jets" for filtering purposes.
 * 
 * HOW IT WORKS:
 * -------------
 * 1. When PRIVATE_FLIGHTS=no in .env:
 *    - N-number flights (N12345, etc.) are EXCLUDED entirely
 *    - Private jet operators listed here are EXCLUDED entirely
 *    - All commercial airlines (regional + major) are INCLUDED
 * 
 * 2. When PRIVATE_FLIGHTS=yes (default):
 *    - Everything is included (N-numbers, private jets, commercial)
 * 
 * 3. These operators also have special cache behavior:
 *    - They reuse callsigns frequently throughout the day
 *    - Should NOT be cached when API credits are exhausted
 *    - Use OpenSky data only in that case
 * 
 * WHAT TO ADD HERE:
 * -----------------
 * - Fractional ownership operators (NetJets, Flexjet, etc.)
 * - True charter operators without scheduled routes
 * - Executive/corporate flight departments
 * 
 * WHAT NOT TO ADD:
 * ----------------
 * - Regional airlines (Republic, SkyWest, GoJet, Endeavor, Envoy, etc.)
 *   These operate scheduled flights for major airlines
 * - Major airlines (obvious)
 * - Cargo airlines (UPS, FedEx, etc.)
 */

const PRIVATE_JET_OPERATORS = [
    // === Fractional Ownership Programs ===
    'EJA',  // NetJets Aviation (world's largest private jet operator)
    'EJM',  // NetJets Management
    'LXJ',  // Flexjet
    'VJT',  // VistaJet
    'JRE',  // Jet Share
    
    // === Charter Operators ===
    'XOJ',  // XOJET Aviation
    'TMC',  // TradeWinds Airlines
    'MMD',  // Air Medical
    'CFS',  // Corporate Flight Management
    'EJL',  // Executive Jet Management
    'VCG',  // Volo Aviation
    'FLG',  // Flexjet
    'CMH',  // Cal-Western Aviation
    
    // === Private Charter Companies (from recent airline additions) ===
    'BVR',  // ACM Air Charter
    'ERY',  // Sky Quest
    'JTL',  // Jet Linx Aviation
    'KFB',  // STAjets
    'KOW',  // Baker Aviation
    'MJS',  // JET SAVER
    'RKJ',  // Charter Airlines
    'RNI',  // Rennia Aviation
    'SGX',  // Slate Aviation
    'TCN',  // BellAir
    'TFF',  // Talon Air
    'TWY',  // Sunset Aviation
    'XAA',  // Centene Corporation (corporate flight dept)
    'XFL',  // EX-FLIGHT
    
    // === Special Cases ===
    'N'     // N-numbers (N12345, etc.) - handled separately in code
];

// Export as a Set for efficient lookup
module.exports = new Set(PRIVATE_JET_OPERATORS);

/**
 * COMMON MISTAKES TO AVOID:
 * 
 * ❌ DO NOT ADD these - they are REGIONAL AIRLINES (commercial):
 *    - GJS (GoJet Airlines) - operates for United/Delta
 *    - RPA (Republic Airways) - operates for American/Delta/United
 *    - EDV (Endeavor Air) - operates for Delta
 *    - ENY (Envoy Air) - operates for American
 *    - SKW (SkyWest Airlines) - operates for United/Delta/Alaska
 *    - JIA (PSA Airlines) - operates for American
 *    - PDT (Piedmont Airlines) - operates for American
 *    - CPZ (Compass Airlines) - operates for American/Delta
 * 
 * ❌ DO NOT ADD these - they are SCHEDULED CARRIERS:
 *    - FBU (French Bee) - scheduled international flights
 *    - JSX (JSX Air) - scheduled regional flights
 *    - Any airline with regular scheduled service
 * 
 * HOW TO CHECK:
 * - Look up the airline on Wikipedia or FlightAware
 * - If it has flight numbers and scheduled routes = NOT a private jet
 * - If it's fractional ownership or on-demand charter = private jet
 */
