/**
 * Private Jet Inclusion List
 * 
 * When PRIVATE_FLIGHTS=no is set, this list specifies which private jet
 * operators should STILL BE INCLUDED despite the filter.
 * 
 * HOW IT WORKS:
 * -------------
 * 1. PRIVATE_FLIGHTS=no → Excludes N-numbers and private jets
 * 2. Operators in THIS list → Override the exclusion and are displayed
 * 3. Result: You see commercial airlines + your selected private jet operators
 * 
 * EXAMPLE USE CASE:
 * -----------------
 * You want to track commercial airlines AND NetJets/Flexjet activity
 * in your area, but exclude random N-number general aviation flights.
 * 
 * TO ADD AN OPERATOR:
 * -------------------
 * 1. Add the ICAO code to the array below
 * 2. Restart: docker-compose restart
 * 3. That operator will now appear even with PRIVATE_FLIGHTS=no
 * 
 * COMMON OPERATORS TO CONSIDER:
 * ------------------------------
 * EJA - NetJets Aviation (most common private jet operator)
 * EJM - NetJets Management
 * LXJ - Flexjet
 * VJT - VistaJet
 * JRE - Jet Share
 * XOJ - XOJET Aviation
 */

const PRIVATE_JET_INCLUSION_LIST = [
    'EJA',  // NetJets Aviation
    'LXJ'   // Flexjet
];

// Export as a Set for efficient lookup
module.exports = new Set(PRIVATE_JET_INCLUSION_LIST);

/**
 * NOTES:
 * ------
 * - N-number flights (N12345, etc.) are ALWAYS excluded when PRIVATE_FLIGHTS=no
 * - This list does NOT apply when PRIVATE_FLIGHTS=yes (everything shows anyway)
 * - To see ALL private jets, set PRIVATE_FLIGHTS=yes instead of using this list
 */
