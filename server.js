const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const pino = require('pino');
require('dotenv').config();

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_PRETTY = (process.env.LOG_PRETTY || 'true').toLowerCase() === 'true';
const logger = pino(
    { level: LOG_LEVEL },
    LOG_PRETTY
        ? pino.transport({
              target: 'pino-pretty',
              options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                  singleLine: true
              }
          })
        : undefined
);

function logWithPino(level, args) {
    if (!args || args.length === 0) return;

    const isPlainObject = (value) =>
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Error);

    const splitMetaAndExtra = (values) => {
        const meta = {};
        const extra = [];
        values.forEach((value) => {
            if (value instanceof Error) {
                meta.err = value;
            } else if (isPlainObject(value)) {
                Object.assign(meta, value);
            } else {
                extra.push(value);
            }
        });
        return { meta, extra };
    };

    const [first, ...rest] = args;
    if (typeof first === 'string') {
        if (rest.length === 0) {
            logger[level](first);
        } else {
            const { meta, extra } = splitMetaAndExtra(rest);
            if (extra.length > 0) {
                meta.args = extra;
            }
            logger[level](meta, first);
        }
        return;
    }

    if (first instanceof Error) {
        const { meta, extra } = splitMetaAndExtra(rest);
        meta.err = first;
        if (extra.length > 0) {
            meta.args = extra;
        }
        logger[level](meta, 'Error');
        return;
    }

    const { meta, extra } = splitMetaAndExtra(args);
    if (extra.length > 0) {
        meta.args = extra;
    }
    logger[level](meta, 'Log');
}

console.log = (...args) => logWithPino('info', args);
console.info = (...args) => logWithPino('info', args);
console.warn = (...args) => logWithPino('warn', args);
console.error = (...args) => logWithPino('error', args);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Usage tracking persistence file
const USAGE_FILE = path.join(__dirname, 'usage-tracking.json');

// Rate limit tracking for backoff
let rateLimitBackoff = {
    opensky: {
        backoffUntil: 0,
        remainingCredits: null, // Track remaining API credits from X-Rate-Limit-Remaining header
        lastChecked: 0,
        lastLoggedBackoff: 0 // Timestamp of last backoff log message (to throttle spam)
    }
};

// Request deduplication for flight data - prevents multiple simultaneous API calls
let pendingFlightRequest = null;

// Flight data logic
let flightCache = {
    data: [],
    lastUpdated: 0
};
const CACHE_DURATION = 60 * 1000; // 60 seconds (extended to reduce OpenSky rate limit hits)
const SEARCH_RADIUS_MILES = parseFloat(process.env.SEARCH_RADIUS_MILES) || 5;
const OFFSET = SEARCH_RADIUS_MILES / 69; // 1 degree latitude is approx 69 miles

// OAuth Token Cache
let authToken = {
    token: null,
    expiresAt: 0
};

// Calculate next billing reset date (FlightAware & FR24 reset on 1st of each month)
function getNextMonthlyResetDate() {
    const now = new Date();
    
    // If CREDITS_RESET is set in .env, use that day of the month
    if (process.env.CREDITS_RESET) {
        const envResetDate = new Date(process.env.CREDITS_RESET);
        if (!isNaN(envResetDate.getTime())) {
            const resetDay = envResetDate.getDate(); // Get the day (e.g., 1 for March 1st)
            
            // Start with this month at the reset day
            let resetDate = new Date(now.getFullYear(), now.getMonth(), resetDay);
            
            // If that date has already passed, move to next month
            if (resetDate <= now) {
                resetDate = new Date(now.getFullYear(), now.getMonth() + 1, resetDay);
            }
            
            console.log(`[Usage Tracking] Monthly reset on day ${resetDay} of each month. Next reset: ${resetDate.toISOString()}`);
            return resetDate.toISOString();
        }
    }
    
    // Default: Calculate 1st of next month
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return resetDate.toISOString();
}

// Calculate next daily reset date (OpenSky resets daily at midnight UTC)
function getNextDailyResetDate() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.toISOString();
}

// Load usage tracking from disk
async function loadUsageTracking() {
    try {
        const data = await fs.readFile(USAGE_FILE, 'utf8');
        const saved = JSON.parse(data);
        
        // Check if we need to reset monthly counters (FA/FR24)
        const now = new Date();
        const lastMonthlyReset = new Date(saved.monthly_reset_date || 0);
        const needsMonthlyReset = now >= lastMonthlyReset;
        
        // Check if we need to reset daily counters (OpenSky)
        const lastDailyReset = new Date(saved.opensky_reset_date || 0);
        const needsDailyReset = now >= lastDailyReset;
        
        if (needsMonthlyReset) {
            console.log('[Usage Tracking] Monthly reset triggered (FA/FR24)');
            saved.flightaware = 0;
            saved.flightaware_calls = 0;
            saved.flightradar24_calls = 0;
            saved.flightradar24_credits_used = 0;
            saved.flightradar24_credits_remaining = 30000;
            saved.monthly_reset_date = getNextMonthlyResetDate();
        }
        
        if (needsDailyReset) {
            console.log('[Usage Tracking] Daily reset triggered (OpenSky)');
            saved.opensky_calls = 0;
            saved.opensky_reset_date = getNextDailyResetDate();
        }
        
        console.log('[Usage Tracking] Loaded from disk:', {
            fa_calls: saved.flightaware_calls,
            fr24_calls: saved.flightradar24_calls,
            fr24_credits: `${saved.flightradar24_credits_used}/${saved.flightradar24_credits_used + saved.flightradar24_credits_remaining}`,
            os_calls: saved.opensky_calls,
            monthly_reset: new Date(saved.monthly_reset_date).toLocaleDateString(),
            daily_reset: new Date(saved.opensky_reset_date).toLocaleDateString()
        });
        
        return saved;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Usage Tracking] No saved data found, starting fresh');
        } else {
            console.error('[Usage Tracking] Error loading data:', error.message);
        }
        
        // Return default values
        return {
            total: 0,
            flightaware: 0,
            opensky: 0,
            flightradar24: 0,
            flightaware_calls: 0,
            opensky_calls: 0,
            flightradar24_calls: 0,
            flightradar24_credits_used: 0,
            flightradar24_credits_remaining: 30000,
            monthly_reset_date: getNextMonthlyResetDate(),
            opensky_reset_date: getNextDailyResetDate()
        };
    }
}

// Save usage tracking to disk
async function saveUsageTracking() {
    try {
        await fs.writeFile(USAGE_FILE, JSON.stringify(apiCosts, null, 2), 'utf8');
    } catch (error) {
        console.error('[Usage Tracking] Error saving data:', error.message);
    }
}

// API Cost Tracking (loaded from disk on startup, saved on updates)
let apiCosts = {
    total: 0,
    flightaware: 0,
    opensky: 0,
    flightradar24: 0,
    flightaware_calls: 0,
    opensky_calls: 0,
    flightradar24_calls: 0,
    flightradar24_credits_used: 0,
    flightradar24_credits_remaining: 30000,
    monthly_reset_date: getNextMonthlyResetDate(),
    opensky_reset_date: getNextDailyResetDate(),
    active_enhanced_provider: 'flightradar24', // Persisted UI selection
    opensky_credits_remaining: null, // Track from X-Rate-Limit-Remaining header
    opensky_daily_limit: 4000 // Can be 4000 or 8000 for contributing users
};

// API Logging Utility
function logAPI(service, method, url, status, duration, clientIP = null) {
    // Sanitize URL to remove tokens/secrets
    let sanitizedUrl = url;
    if (url.includes('access_token')) {
        sanitizedUrl = url.replace(/access_token=[^&]+/, 'access_token=***');
    }
    if (url.includes('client_secret')) {
        sanitizedUrl = sanitizedUrl.replace(/client_secret=[^&]+/, 'client_secret=***');
    }

    const ipInfo = clientIP ? ` [IP: ${clientIP}]` : '';
    const logMsg = `[API:${service}] ${method} ${sanitizedUrl} -> ${status} (${duration}ms)${ipInfo}`;
    console.log(logMsg);
}

// Helper to extract client IP from request
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
           req.headers['x-real-ip'] || 
           req.socket.remoteAddress || 
           req.ip;
}

// ============================================================================
// TWO-TIER FLIGHT DATA CACHING SYSTEM
// ============================================================================

// Tier 1: Recent Lookups (5-minute in-memory cache)
// Prevents duplicate API calls for same flight within 5 minutes
const recentLookups = new Map();
const RECENT_LOOKUP_TTL = 5 * 60 * 1000; // 5 minutes

// Tier 2: Persistent Cache (7-day disk cache)
// Provides route data when API credits exhausted
const PERSISTENT_CACHE_FILE = path.join(__dirname, 'flight-cache.json');
const CACHE_EXPIRY_DAYS = 7;
const CACHE_SAVE_INTERVAL = 5 * 60 * 1000; // Batch writes every 5 min

let flightDataCache = {
    metadata: { 
        created: null, 
        last_cleanup: null, 
        last_save: null,
        entry_count: 0 
    },
    flights: {}
};
let cacheNeedsSave = false;

// --- Recent Lookups (Tier 1) ---

function getRecentLookup(callsign) {
    const recent = recentLookups.get(callsign);
    if (!recent) return null;
    
    const age = Date.now() - recent.timestamp;
    if (age >= RECENT_LOOKUP_TTL) {
        recentLookups.delete(callsign);
        return null;
    }
    
    console.log(`[Recent Cache] Hit for ${callsign} (${Math.floor(age/1000)}s ago)`);
    return recent.data;
}

function saveRecentLookup(callsign, data) {
    recentLookups.set(callsign, { data, timestamp: Date.now() });
}

// Clean expired entries every minute
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [callsign, entry] of recentLookups.entries()) {
        if (now - entry.timestamp >= RECENT_LOOKUP_TTL) {
            recentLookups.delete(callsign);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log(`[Recent Cache] Cleaned ${cleaned} entries`);
}, 60 * 1000);

// --- Persistent Cache (Tier 2) ---

async function loadFlightCache() {
    try {
        const data = await fs.readFile(PERSISTENT_CACHE_FILE, 'utf8');
        flightDataCache = JSON.parse(data);
        console.log(`[Persistent Cache] Loaded ${flightDataCache.metadata.entry_count} flights`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Persistent Cache] No existing cache found, creating new cache');
        } else {
            console.error('[Persistent Cache] Error loading cache, creating fresh:', error.message);
        }
        flightDataCache = {
            metadata: { 
                created: new Date().toISOString(), 
                last_cleanup: new Date().toISOString(),
                last_save: null,
                entry_count: 0 
            },
            flights: {}
        };
    }
}

async function saveFlightCache() {
    try {
        flightDataCache.metadata.entry_count = Object.keys(flightDataCache.flights).length;
        flightDataCache.metadata.last_save = new Date().toISOString();
        await fs.writeFile(PERSISTENT_CACHE_FILE, JSON.stringify(flightDataCache, null, 2));
        console.log(`[Persistent Cache] Saved ${flightDataCache.metadata.entry_count} entries`);
    } catch (error) {
        console.error('[Persistent Cache] Save error:', error.message);
    }
}

// Batched save every 5 minutes
setInterval(async () => {
    if (cacheNeedsSave) {
        await saveFlightCache();
        cacheNeedsSave = false;
    }
}, CACHE_SAVE_INTERVAL);

function isCacheEntryValid(entry) {
    return Date.now() < new Date(entry.expires_at).getTime();
}

async function getCachedFlightData(callsign) {
    const entry = flightDataCache.flights[callsign];
    if (!entry) return null;
    
    if (!isCacheEntryValid(entry)) {
        delete flightDataCache.flights[callsign];
        cacheNeedsSave = true;
        return null;
    }
    
    const ageDays = Math.floor((Date.now() - new Date(entry.cached_at)) / (1000 * 60 * 60 * 24));
    console.log(`[Persistent Cache] Hit for ${callsign} (age: ${ageDays} days)`);
    return entry;
}

async function cacheFlightData(callsign, flightData) {
    const cachedAt = new Date();
    const expiresAt = new Date(cachedAt.getTime() + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000));
    
    flightDataCache.flights[callsign] = {
        callsign,
        origin: flightData.origin,
        destination: flightData.destination,
        aircraft_type: flightData.aircraft_type,
        airline: flightData.airline,
        airline_logo_code: flightData.airline_logo_code,
        aircraft_registration: flightData.aircraft_registration,
        source: flightData.source,
        cached_at: cachedAt.toISOString(),
        expires_at: expiresAt.toISOString()
        // Note: departure_time excluded from cache (would be stale)
    };
    
    cacheNeedsSave = true;
}

async function cleanExpiredCacheEntries() {
    let removed = 0;
    for (const [callsign, entry] of Object.entries(flightDataCache.flights)) {
        if (!isCacheEntryValid(entry)) {
            delete flightDataCache.flights[callsign];
            removed++;
        }
    }
    if (removed > 0) {
        flightDataCache.metadata.last_cleanup = new Date().toISOString();
        cacheNeedsSave = true;
        console.log(`[Persistent Cache] Removed ${removed} expired entries`);
    }
}

// FlightAware API Client
const FLIGHTAWARE_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi';
const FLIGHTAWARE_ENABLED = !!process.env.FLIGHTAWARE_API_KEY; // Enabled if API key is present

// Private Aircraft Registry Lookup (for N-number flights)
const PRIVATE_REGISTRY_PATH = path.join(__dirname, 'private_processed.json');
let privateRegistryMap = new Map(); // registration_number -> registrant_name

async function loadPrivateRegistry() {
    try {
        const fileContent = await fs.readFile(PRIVATE_REGISTRY_PATH, 'utf-8');
        const registrations = JSON.parse(fileContent);
        
        let skipped = 0;
        let loaded = 0;
        
        for (const entry of registrations) {
            const registration = entry.registration?.trim();
            const registrant = entry.registrant?.trim();
            
            if (!registration || !registrant) {
                skipped++;
                continue;
            }
            
            // Filter out placeholder/invalid entries
            const registrantUpper = registrant.toUpperCase();
            if (registrantUpper === 'REGISTRATION PENDING' || 
                registrantUpper === 'SALE REPORTED' || 
                registrantUpper === 'RESERVED') {
                skipped++;
                continue;
            }
            
            // Store in map (normalized registration as key)
            const normalizedReg = registration.toUpperCase().replace(/[\s-]/g, '');
            privateRegistryMap.set(normalizedReg, registrant);
            loaded++;
        }
        
        console.log(`[Private Registry] Loaded ${privateRegistryMap.size} aircraft registrations (${loaded} loaded, ${skipped} skipped, ${registrations.length} total entries)`);
    } catch (error) {
        console.error('[Private Registry] Failed to load private_processed.json:', error.message);
        // Continue without registry - will fall back to "Private Jet"
    }
}

// Load registry on startup
loadPrivateRegistry();

function lookupPrivateOwner(registration) {
    if (!registration || typeof registration !== 'string') return null;
    
    // Normalize registration (uppercase, remove spaces/dashes)
    const normalized = registration.toUpperCase().replace(/[\s-]/g, '');
    
    // Direct lookup
    const owner = privateRegistryMap.get(normalized);
    if (owner) {
        // Clean up common registry artifacts
        if (owner === 'REGISTRATION PENDING' || owner === 'SALE REPORTED' || owner === 'RESERVED') {
            return null; // Treat as no match
        }
        return owner;
    }
    
    return null;
}

// FlightAware Enhanced Lookup Altitude (in feet)
// 0 = Disabled (FREE), >0 = Enhanced data for flights above this altitude
// Default: 2000 feet (filters out landing/departing flights)
const FLIGHTAWARE_LOOKUP_ALTITUDE_FEET = parseInt(process.env.FLIGHTAWARE_LOOKUP_ALTITUDE_FEET) || 2000;
const FLIGHTAWARE_LOOKUP_ALTITUDE_METERS = FLIGHTAWARE_LOOKUP_ALTITUDE_FEET * 0.3048; // Convert feet to meters

// Flightradar24 API Client
const FLIGHTRADAR24_BASE_URL = 'https://fr24api.flightradar24.com/api';
const FLIGHTRADAR24_ENABLED = !!process.env.FLIGHTRADAR24_API_KEY;
const FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET = parseInt(process.env.FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET) || 2000;

// adsb.lol Route API (free backup route enrichment)
const ADSBLOL_ENABLED = (process.env.ADSBLOL_ENABLED || 'yes').toLowerCase() !== 'no';
const ADSBLOL_ROUTESET_URL = 'https://api.adsb.lol/api/0/routeset';
const ADSBLOL_TIMEOUT_MS = parseInt(process.env.ADSBLOL_TIMEOUT_MS) || 5000;

// ADSBexchange API Client (via RapidAPI) - TEMPORARY for debugging during OpenSky backoff
const ADSBEXCHANGE_ENABLED = process.env.USE_ADSB === 'true' && !!process.env.RAPIDAPI_KEY;
const ADSBEXCHANGE_BASE_URL = 'https://adsbexchange-com1.p.rapidapi.com';

// Hybrid Mode - Auto-switch from FlightAware to Flightradar24 at $5 threshold
const HYBRID_MODE = process.env.HYBRID_MODE &&
    (process.env.HYBRID_MODE.toLowerCase() === 'yes' ||
     process.env.HYBRID_MODE.toLowerCase() === 'true');
const HYBRID_SWITCH_THRESHOLD = 5.00; // Switch to FR24 when FA cost reaches $5

// Private Flights Filter - When set to 'no', only lookup commercial airline flights
const PRIVATE_FLIGHTS = process.env.PRIVATE_FLIGHTS ?
    process.env.PRIVATE_FLIGHTS.toLowerCase() : 'yes';
const FILTER_PRIVATE_FLIGHTS = PRIVATE_FLIGHTS === 'no';
const ASSUME_UNKNOWN_PREFIX_PRIVATE = (process.env.ASSUME_UNKNOWN_PREFIX_PRIVATE || 'yes').toLowerCase() === 'yes';

// Private Jet/Charter Operators - Load from external config file
// These operators are excluded when PRIVATE_FLIGHTS=no
// They also have special cache behavior (no caching when API credits exhausted)
const PRIVATE_JET_OPERATORS = require('./private_jet_operators.js');

// Private Jet Inclusion List - Operators to ALLOW even when PRIVATE_FLIGHTS=no
// This overrides the exclusion for specific operators you want to track
const PRIVATE_JET_INCLUSION_LIST = require('./private_jet_inclusion_list.js');

// Military/Government callsign prefixes — sorted longest-first to ensure correct prefix matching
const MILITARY_CALLSIGN_PREFIXES = [
    // User-specified prefixes
    'BLKCAT', 'VCUUM',                                                     // 6 chars
    'DEATH', 'CROWN', 'LUCKY', 'DRAGN',                                    // 5 chars
    'DOOM', 'SPAR', 'JAKE', 'IRON', 'BISON', 'DUDE', 'NINJA', 'SLAM',    // 4 chars
    'VOODOO', 'REACH', 'GHOST', 'BLADE', 'VIPER', 'RAPTOR',               // 4-6 chars (additional known)
    'VENUS', 'ROCKY', 'HOMER', 'HAVOC', 'GATOR', 'EVAC',                  // 4-5 chars (additional known)
    'RCH', 'AMC', 'SAM', 'NAT', 'VAR',                                    // 3 chars (user-specified)
    'VC', 'PD',                                                            // 2 chars (user-specified)
].sort((a, b) => b.length - a.length);

// Owner name keywords that indicate a military or government-operated N-number aircraft
const GOVERNMENT_OWNER_KEYWORDS = [
    'department of the air force', 'department of the navy', 'department of the army',
    'us air force', 'us army', 'us navy', 'department of defense',
    'dept of homeland security', 'department of homeland security',
    'federal bureau of investigation',
    'drug enforcement administration',
    'customs and border protection',
    'transportation security administration',
    'bureau of alcohol, tobacco',
    'air force life cycle management', 'air force material command',
];

function isMilitaryFlight(callsign, ownerName) {
    if (callsign) {
        const cs = callsign.toUpperCase().trim();
        for (const prefix of MILITARY_CALLSIGN_PREFIXES) {
            if (cs.startsWith(prefix)) {
                console.log(`[Military] ✈ ${callsign} matched military prefix: ${prefix}`);
                return true;
            }
        }
    }
    if (ownerName) {
        const owner = ownerName.toLowerCase();
        for (const keyword of GOVERNMENT_OWNER_KEYWORDS) {
            if (owner.includes(keyword)) {
                console.log(`[Military] ✈ ${callsign || 'N-number'} matched government owner: ${ownerName}`);
                return true;
            }
        }
    }
    return false;
}

// Commercial Airlines ICAO Codes (for filtering private flights)
// Based on FAA-authorized airline call signs from 123atc.com
// Includes passenger airlines and cargo/shipping companies
// Commercial Airlines - Consolidated list of all commercial airline ICAO codes
const COMMERCIAL_AIRLINES = new Set([
    // US Major Airlines (ICAO + IATA codes)
    'UAL', 'UA', 'AAL', 'AA', 'DAL', 'DL', 'SWA', 'WN', 'JBU', 'B6', 'ASA', 'AS', 'NKS', 'NK', 'FFT', 'F9', 'HAL', 'HA', 'BRE', 'AVX',
    // US Regional/Commuter
    'RPA', 'JIA', 'EDV', 'SKW', 'ENY', 'CPZ', 'GJS', 'PDT',
    'SCX', 'QXE', 'ASH', 'AWI', 'UCA', 'DJT', 'VJA',
    // Private/Charter (with public flight info)
    'JSX',
    // Cargo/Shipping
    'GTI', 'UPS', 'FDX', 'ABX', 'ATN', 'GEC',
    // Canadian
    'ACA', 'ROU', 'WJA', 'LOR', 'TSC', 'SWG', 'POE', 'JZA', 'PTR',
    // European Major
    'BAW', 'VIR', 'AFR', 'DLH', 'KLM', 'SAS', 'EIN', 'IBE', 'TAP',
    'AUA', 'SWR', 'LOT', 'ICE', 'THY', 'AZA',
    // European Low-Cost
    'EZY', 'RYR', 'WZZ', 'VLG', 'EJU', 'TRA', 'TVS', 'NAX', 'BER',
    'VOE', 'TVF', 'EXS', 'JAF', 'BEE', 'NOZ',
    // Middle East
    'QTR', 'UAE', 'ETD', 'ELY', 'MSR', 'ETH', 'SVA',
    // Asian
    'JAL', 'ANA', 'KAL', 'AAR', 'CXA', 'HDA', 'SIA', 'CPA', 'EVA', 'CSN', 'CES', 'CCA', 'GIA', 'AIC',
    // Australian/Oceania
    'QFA', 'VOZ', 'JST', 'ANZ',
    // Mexican
    'AMX', 'AIJ', 'VIV', 'VOI',
    // Latin American
    'AVA', 'CMP', 'TAM',
    // Other International
    'AIC', 'APZ', 'AAY', 'DWI', 'BMA', 'MXY', 'FBU',
    // 123ATC (Letter A) - additional commercial/cargo carriers
    'ABW', 'ABR', 'ACP', 'ADZ', 'AHK', 'AJT', 'AMF', 'AFL', 'ABY', 'ABL', 'ACI', 'AEA', 'ANE'
]);

function isCommercialFlight(callsign) {
    if (!callsign || callsign.length < 3) return false;
    const prefix = callsign.substring(0, 3).toUpperCase();
    
    // When PRIVATE_FLIGHTS=no, use EXCLUSION logic with INCLUSION override:
    // 1. Exclude N-numbers (N12345, etc.)
    // 2. INCLUDE operators in PRIVATE_JET_INCLUSION_LIST (override)
    // 3. Exclude operators in PRIVATE_JET_OPERATORS list
    // 4. Include everything else
    
    // Check for N-numbers - always exclude these
    if (callsign.startsWith('N') && callsign.length > 1 && /\d/.test(callsign[1])) {
        return false; // N-number = general aviation, always exclude
    }
    
    // Check inclusion list first - these override the exclusion
    if (PRIVATE_JET_INCLUSION_LIST.has(prefix)) {
        return true; // On inclusion list, always show
    }
    
    // Check if it's in the private jet exclusion list
    if (PRIVATE_JET_OPERATORS.has(prefix)) {
        return false; // Private jet operator, exclude (unless on inclusion list above)
    }

    // Optional strict mode: if prefix isn't in known commercial list, treat as private
    if (ASSUME_UNKNOWN_PREFIX_PRIVATE && !COMMERCIAL_AIRLINES.has(prefix)) {
        return false;
    }
    
    // Everything else is considered "commercial" (includes all airlines, regional, cargo, etc.)
    return true;
}

function isPrivateJetOperator(callsign) {
    if (!callsign || callsign.length < 3) return false;
    
    // Extract the 3-letter airline code from callsign
    const airlineCode = callsign.substring(0, 3).toUpperCase();
    
    // Also check for N-numbers (N12345, etc.)
    if (callsign.startsWith('N') && callsign.length > 1 && /\d/.test(callsign[1])) {
        return true;
    }

    // Inclusion list always overrides private classification
    if (PRIVATE_JET_INCLUSION_LIST.has(airlineCode)) {
        return false;
    }

    if (PRIVATE_JET_OPERATORS.has(airlineCode)) {
        return true;
    }

    // Optional strict mode: if prefix isn't in known commercial list, treat as private
    if (ASSUME_UNKNOWN_PREFIX_PRIVATE && !COMMERCIAL_AIRLINES.has(airlineCode)) {
        return true;
    }
    
    return false;
}

// Check if FR24 API is available (has credits and enabled)
function isFR24Available() {
    if (!FLIGHTRADAR24_ENABLED) return false;
    return apiCosts.flightradar24_credits_remaining > 0;
}

// Check if FlightAware API is available (under cost cap, cap not $0, and enabled)
function isFAAvailable() {
    if (!FLIGHTAWARE_ENABLED) return false;
    const costCap = parseFloat(process.env.FLIGHTAWARE_COST_CAP) || 25.00;
    if (costCap === 0) return false; // Cost cap of $0 means disabled
    return apiCosts.flightaware < costCap;
}

// Enhanced API Provider Selection (only ONE active at a time)
// Will be loaded from usage-tracking.json on startup, defaults to flightradar24
let ACTIVE_ENHANCED_PROVIDER = 'flightradar24';

async function getFlightAwareCost() {
    // Check if API key exists
    if (!FLIGHTAWARE_ENABLED) return { cost: 0, calls: 0 };

    try {
        const startTime = Date.now();
        const response = await axios.get(`${FLIGHTAWARE_BASE_URL}/account/usage`, {
            headers: {
                'x-apikey': process.env.FLIGHTAWARE_API_KEY
            }
        });
        const duration = Date.now() - startTime;
        logAPI('FlightAware', 'GET', '/account/usage', response.status, duration);

        return {
            cost: response.data.total_cost || 0,
            calls: response.data.total_calls || 0
        };
    } catch (error) {
        console.error('[FlightAware] Failed to get cost:', error.message);
        return { cost: 0, calls: 0 };
    }
}

// Cache for FR24 credits (check every 30 minutes like FlightAware)
let fr24CreditsCache = null;
let fr24CreditsCacheTime = 0;
const FR24_CREDITS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes - same as FlightAware

async function getFlightradar24Credits() {
    // FR24 usage API - simple endpoint that returns total credits used
    if (!FLIGHTRADAR24_ENABLED) return { credits_used: 0, credits_remaining: 0, calls: 0 };
    
    // Return cached value if still valid
    if (fr24CreditsCache && (Date.now() - fr24CreditsCacheTime < FR24_CREDITS_CACHE_TTL)) {
        return fr24CreditsCache;
    }
    
    try {
        const startTime = Date.now();
        const response = await axios.get(`${FLIGHTRADAR24_BASE_URL}/usage`, {
            headers: {
                'authorization': `Bearer ${process.env.FLIGHTRADAR24_API_KEY}`,
                'accept': 'application/json',
                'accept-version': 'v1'
            },
            params: {
                period: '30d' // Get 30-day rolling window (matches FR24 credit reset period)
            }
        });
        const duration = Date.now() - startTime;
        logAPI('Flightradar24', 'GET', '/usage?period=30d', response.status, duration);
        
        // FR24 response: { data: [{ endpoint: "...", request_count: 280, credits: "1974" }] }
        // Multiple endpoints in array - sum them all up
        // NOTE: Using 30d period provides 30-day rolling window
        // - First 30 days: Shows actual usage since signup
        // - After 30 days: Shows last 30 days (oldest calls drop off automatically)
        if (response.data && response.data.data && Array.isArray(response.data.data)) {
            const totalCredits = response.data.data.reduce((sum, item) => {
                // Credits might be string or number
                const credits = typeof item.credits === 'string' ? parseInt(item.credits) : (item.credits || 0);
                return sum + credits;
            }, 0);
            
            const totalCalls = response.data.data.reduce((sum, item) => sum + (item.request_count || 0), 0);
            
            // FR24 30K plan
            const planLimit = 30000;
            
            const result = {
                credits_used: totalCredits,
                credits_remaining: Math.max(0, planLimit - totalCredits),
                calls: totalCalls
            };
            
            // Cache the result
            fr24CreditsCache = result;
            fr24CreditsCacheTime = Date.now();
            
            console.log(`[Flightradar24] Usage API: ${totalCalls} calls, ${totalCredits} credits (${response.data.data.length} endpoints)`);
            
            return result;
        }
        
        // Return zeros if no data
        const defaultResult = { credits_used: 0, credits_remaining: 30000, calls: 0 };
        fr24CreditsCache = defaultResult;
        fr24CreditsCacheTime = Date.now();
        return defaultResult;
        
    } catch (error) {
        console.error('[Flightradar24] Failed to get usage:', error.message);
        
        // Return cached data if available, otherwise zeros
        if (fr24CreditsCache) {
            console.log('[Flightradar24] Using cached credits due to API error');
            return fr24CreditsCache;
        }
        
        return { credits_used: 0, credits_remaining: 30000, calls: 0 };
    }
}

// FlightAware Rate Limiting (5 calls per minute)
let flightAwareCallQueue = [];
const FA_RATE_LIMIT = 5; // calls per minute
const FA_RATE_WINDOW = 60000; // 1 minute in ms

function canMakeFlightAwareCall() {
    const now = Date.now();
    // Remove calls older than 1 minute
    flightAwareCallQueue = flightAwareCallQueue.filter(timestamp => now - timestamp < FA_RATE_WINDOW);
    return flightAwareCallQueue.length < FA_RATE_LIMIT;
}

function recordFlightAwareCall() {
    flightAwareCallQueue.push(Date.now());
}

// Flightradar24 Rate Limiting (10 calls per minute on Explorer plan)
let flightradar24CallQueue = [];
const FR24_RATE_LIMIT = 10; // calls per minute
const FR24_RATE_WINDOW = 60000; // 1 minute in ms

// FR24 Credit costs per endpoint (from API documentation)
const FR24_CREDIT_COSTS = {
    'flight-summary/light': 2,       // Per callsign with datetime window - PRIMARY ENDPOINT
    'flight-summary/full': 2,        // Per callsign with datetime window
    'live/flight-positions/full': {
        'area': 936,      // Area search with bounds parameter (AVOID - expensive)
        'callsign': 8     // Single callsign query (OLD METHOD - replaced by flight-summary)
    },
    'live/flight-positions/light': 468,
    'usage': 0 // Usage endpoint doesn't consume credits
};

function canMakeFlightradar24Call() {
    const now = Date.now();
    // Remove calls older than 1 minute
    flightradar24CallQueue = flightradar24CallQueue.filter(timestamp => now - timestamp < FR24_RATE_WINDOW);
    return flightradar24CallQueue.length < FR24_RATE_LIMIT;
}

function recordFlightradar24Call() {
    flightradar24CallQueue.push(Date.now());
}

// Update cost every 30 minutes
async function updateCostData() {
    // Only check FlightAware usage if it's the active provider (avoid unnecessary API charges)
    if (ACTIVE_ENHANCED_PROVIDER === 'flightaware') {
        const faCost = await getFlightAwareCost();
        apiCosts.flightaware = faCost.cost;
        apiCosts.flightaware_calls = faCost.calls;
        console.log(`[System] FlightAware cost updated: $${apiCosts.flightaware.toFixed(4)} (${apiCosts.flightaware_calls} calls)`);
    }
    
    // Try to get FR24 credits from API (checked every 10 minutes like FlightAware)
    const fr24Credits = await getFlightradar24Credits();
    
    // Sync with API data if available AND if it's higher than our local tracking
    // This prevents overwriting local increments that happened between API checks
    if (fr24Credits.credits_used > 0 || fr24Credits.calls > 0) {
        const apiCredits = Number(fr24Credits.credits_used);
        const localCredits = apiCosts.flightradar24_credits_used;
        
        // Only update if API value is higher (more accurate) or significantly different
        if (apiCredits > localCredits || Math.abs(apiCredits - localCredits) > 1000) {
            apiCosts.flightradar24_credits_used = apiCredits;
            apiCosts.flightradar24_credits_remaining = Number(fr24Credits.credits_remaining);
            console.log(`[System] FR24 credits synced from API: ${apiCosts.flightradar24_credits_used}/${apiCosts.flightradar24_credits_used + apiCosts.flightradar24_credits_remaining}`);
        } else {
            console.log(`[System] FR24 credits using local tracking (${localCredits}) - API shows ${apiCredits}`);
        }
    } else {
        // API unavailable or no usage yet - use local tracking
        // Initialize credits_remaining from default if still at initial value
        if (apiCosts.flightradar24_credits_remaining === 30000 && apiCosts.flightradar24_credits_used === 0) {
            console.log(`[System] FR24 credits initialized: 0/30000 (no API usage yet)`);
        } else {
            console.log(`[System] FR24 credits using local tracking: ${apiCosts.flightradar24_credits_used}/30000`);
        }
    }
    
    // FR24 is a flat $9/month subscription, not pay-per-use
    // Don't include in variable cost tracking - it's a fixed monthly cost
    apiCosts.flightradar24 = 0;
    
    // Total cost = only variable costs (FlightAware + OpenSky)
    // FR24 is excluded as it's a fixed subscription
    apiCosts.total = apiCosts.flightaware + apiCosts.opensky;
    console.log(`[System] Cost updated: $${apiCosts.total.toFixed(4)} (FA: ${apiCosts.flightaware_calls}, OS: ${apiCosts.opensky_calls}, FR24: ${apiCosts.flightradar24_calls} calls, ${fr24Credits.credits_used} credits)`);
    
    // Save to disk
    await saveUsageTracking();
}

// Flight info cache to prevent duplicate calls
// Note: Same flight number can operate multiple times per day on different routes
let faCache = new Map();
const FA_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (balance between API costs and accuracy)

let fr24Cache = new Map();
const FR24_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// List of major airline ICAO codes to prioritize for FlightAware lookups

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function shouldLookupFlightAware(callsign, flight, isTertiaryFallback = false) {
    if (!callsign || callsign.length < 3) return false;

    // Skip general aviation (N-numbers like N12345) but NOT airline codes starting with N (like NKS)
    // N-numbers have a digit as the second character, airline codes have letters
    // EXCEPTION: Allow N-numbers when called as tertiary fallback (adsb.lol failed to provide route)
    if (callsign.startsWith('N') && callsign.length > 1 && /\d/.test(callsign[1])) {
        if (!isTertiaryFallback) {
            return false;
        }
        console.log(`[FlightAware] Allowing N-number ${callsign} as tertiary fallback (adsb.lol incomplete)`);
    }

    // If filtering private flights, only lookup commercial airlines
    if (FILTER_PRIVATE_FLIGHTS && !isCommercialFlight(callsign)) {
        console.log(`[FlightAware] Skipping ${callsign} - not a commercial airline (PRIVATE_FLIGHTS=NO)`);
        return false;
    }

    // Check altitude - only lookup flights above threshold
    if (flight && flight.altitude !== undefined && flight.altitude !== null && !isNaN(flight.altitude)) {
        const altitudeMeters = flight.altitude;
        const altitudeFeet = altitudeMeters * 3.28084;

        if (altitudeFeet < FLIGHTAWARE_LOOKUP_ALTITUDE_FEET) {
            console.log(`[FlightAware] Skipping ${callsign} - ${Math.round(altitudeFeet)} ft (below ${FLIGHTAWARE_LOOKUP_ALTITUDE_FEET} ft threshold)`);
            return false;
        }

        console.log(`[FlightAware] ${callsign} at ${Math.round(altitudeFeet)} ft - will lookup`);
    } else {
        // If no altitude data, skip to be safe (probably on ground or bad data)
        console.log(`[FlightAware] Skipping ${callsign} - no valid altitude data`);
        return false;
    }

    return true;
}

function shouldLookupFlightradar24(callsign, flight) {
    if (!callsign || callsign.length < 3) return false;

    // Skip general aviation (N-numbers like N12345) but NOT airline codes starting with N (like NKS)
    // N-numbers have a digit as the second character, airline codes have letters
    if (callsign.startsWith('N') && callsign.length > 1 && /\d/.test(callsign[1])) return false;

    // If filtering private flights, only lookup commercial airlines
    if (FILTER_PRIVATE_FLIGHTS && !isCommercialFlight(callsign)) {
        console.log(`[Flightradar24] Skipping ${callsign} - not a commercial airline (PRIVATE_FLIGHTS=NO)`);
        return false;
    }

    // Check altitude - only lookup flights above threshold
    if (flight && flight.altitude !== undefined && flight.altitude !== null && !isNaN(flight.altitude)) {
        const altitudeMeters = flight.altitude;
        const altitudeFeet = altitudeMeters * 3.28084;

        if (altitudeFeet < FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET) {
            console.log(`[Flightradar24] Skipping ${callsign} - ${Math.round(altitudeFeet)} ft (below ${FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET} ft threshold)`);
            return false;
        }

        console.log(`[Flightradar24] ${callsign} at ${Math.round(altitudeFeet)} ft - will lookup`);
    } else {
        // If no altitude data, skip to be safe (probably on ground or bad data)
        console.log(`[Flightradar24] Skipping ${callsign} - no valid altitude data`);
        return false;
    }

    return true;
}

// FlightAware no-route blocklist
const FA_BLOCKLIST_FILE = path.join(__dirname, 'fa-blocklist.json');
let faBlocklist = new Set();

// Load FA blocklist on startup
async function loadFABlocklist() {
    try {
        if (fsSync.existsSync(FA_BLOCKLIST_FILE)) {
            const data = await fs.readFile(FA_BLOCKLIST_FILE, 'utf8');
            const list = JSON.parse(data);
            faBlocklist = new Set(list);
            console.log(`[FA Blocklist] Loaded ${faBlocklist.size} callsigns that FA could not identify`);
        }
    } catch (error) {
        console.error('[FA Blocklist] Failed to load:', error.message);
        faBlocklist = new Set();
    }
}

// Save FA blocklist to disk
async function saveFABlocklist() {
    try {
        await fs.writeFile(FA_BLOCKLIST_FILE, JSON.stringify([...faBlocklist], null, 2), 'utf8');
    } catch (error) {
        console.error('[FA Blocklist] Failed to save:', error.message);
    }
}

// Add callsign to blocklist
async function addToFABlocklist(callsign) {
    if (!callsign) return;
    const wasNew = !faBlocklist.has(callsign);
    faBlocklist.add(callsign);
    if (wasNew) {
        await saveFABlocklist();
        console.log(`[FA Blocklist] Added ${callsign} (no route found by FA)`);
    }
}

// Check if callsign is in blocklist
function isInFABlocklist(callsign) {
    return faBlocklist.has(callsign);
}

async function getFlightAwareFlightInfo(ident, flight, isTertiaryFallback = false) {
    if (!FLIGHTAWARE_ENABLED || !ident) return { success: false, reason: 'disabled', data: null };
    
    // Check blocklist first (callsigns that FA could not identify routes for)
    if (isInFABlocklist(ident)) {
        console.log(`[FlightAware] ⛔ ${ident} in blocklist (FA previously had no route data)`);
        return { success: false, reason: 'blocklisted', data: null };
    }
    
    // Check recent lookups first (prevents duplicate API calls within 5 min)
    const recentData = getRecentLookup(ident);
    if (recentData) {
        console.log(`[FlightAware] ⚡ Using 5-min dedup cache for ${ident}`);
        return { success: true, reason: 'cache', data: { ...recentData, from_recent_cache: true } };
    }
    
    // Check if cost cap reached (API unavailable)
    const costCap = parseFloat(process.env.FLIGHTAWARE_COST_CAP) || 25.00;
    if (costCap === 0) {
        console.log(`[FlightAware] Cost cap set to $0 - FA disabled`);
        return { success: false, reason: 'disabled', data: null };
    }
    if (apiCosts.flightaware >= costCap) {
        console.log(`[FlightAware] 💰 Cost cap reached ($${apiCosts.flightaware.toFixed(2)}/$${costCap.toFixed(2)}) - API unavailable`);
        return { success: false, reason: 'unavailable', data: null };
    }
    
    // Cost-saving filter: Only lookup major airlines within specified distance
    if (!shouldLookupFlightAware(ident, flight, isTertiaryFallback)) {
        return { success: false, reason: 'filtered', data: null };
    }

    // Rate limiting check
    if (!canMakeFlightAwareCall()) {
        console.log(`[FlightAware] Rate limit reached, skipping ${ident}`);
        return { success: false, reason: 'rate_limit', data: null };
    }

    try {
        recordFlightAwareCall();
        const startTime = Date.now();
        console.log(`[FlightAware] 💰 API call: /flights/${ident}`);
        const response = await axios.get(`${FLIGHTAWARE_BASE_URL}/flights/${ident}`, {
            headers: {
                'x-apikey': process.env.FLIGHTAWARE_API_KEY
            },
            params: {
                max_pages: 1
            }
        });
        const duration = Date.now() - startTime;
        logAPI('FlightAware', 'GET', `/flights/${ident}`, response.status, duration);

        // Note: Cost and call count will be updated by the 10-minute polling interval

        if (response.data && response.data.flights && response.data.flights.length > 0) {
            // FlightAware returns multiple flight segments - select the most relevant one
            // Priority: 1) Active/In Air, 2) Most Recent Departed, 3) Next Scheduled
            const flights = response.data.flights;
            
            // Log all flights for debugging
            console.log(`[FlightAware] ${ident} returned ${flights.length} flight(s)`);
            
            let selectedFlight = null;
            const now = new Date();
            
            // Priority 1: Find active/in-air flight
            const activeFlight = flights.find(f => 
                f.status === 'En Route' || 
                f.status === 'Active' ||
                (f.actual_off && !f.actual_on) // Has departed but not landed
            );
            
            if (activeFlight) {
                selectedFlight = activeFlight;
                console.log(`[FlightAware] Selected active flight for ${ident}`);
            } else {
                // Priority 2: Find most recently departed flight (within last 12 hours)
                const recentFlights = flights.filter(f => {
                    if (f.actual_off) {
                        const departureTime = new Date(f.actual_off);
                        const hoursAgo = (now - departureTime) / (1000 * 60 * 60);
                        return hoursAgo <= 12 && hoursAgo >= 0;
                    }
                    return false;
                }).sort((a, b) => new Date(b.actual_off) - new Date(a.actual_off));
                
                if (recentFlights.length > 0) {
                    selectedFlight = recentFlights[0];
                    console.log(`[FlightAware] Selected recent flight for ${ident} (departed ${selectedFlight.actual_off})`);
                } else {
                    // Priority 3: Next scheduled flight (within next 24 hours)
                    const upcomingFlights = flights.filter(f => {
                        if (f.scheduled_off && !f.actual_off) {
                            const schedTime = new Date(f.scheduled_off);
                            const hoursUntil = (schedTime - now) / (1000 * 60 * 60);
                            return hoursUntil >= 0 && hoursUntil <= 24;
                        }
                        return false;
                    }).sort((a, b) => new Date(a.scheduled_off) - new Date(b.scheduled_off));
                    
                    if (upcomingFlights.length > 0) {
                        selectedFlight = upcomingFlights[0];
                        console.log(`[FlightAware] Selected upcoming flight for ${ident} (scheduled ${selectedFlight.scheduled_off})`);
                    } else {
                        // Fallback: Use first flight
                        selectedFlight = flights[0];
                        console.log(`[FlightAware] No active/recent/upcoming flight found, using first result for ${ident}`);
                    }
                }
            }

            const flight = selectedFlight;

            // Log full response for debugging as requested
            console.log(`[FlightAware] Data for ${ident}:`, JSON.stringify(flight, null, 2));

            // FlightAware doesn't provide painted_as info, so we can't detect regional carrier partnerships
            // Return null to let client lookup full airline name from callsign
            let airlineDisplay = null;
            let airlineLogoCode = null;

            const result = {
                origin: flight.origin?.code_icao || null,
                destination: flight.destination?.code_icao || null,
                aircraft_type: flight.aircraft_type || null,
                airline: airlineDisplay, // Always null - client will lookup full name
                airline_logo_code: airlineLogoCode, // Always null - use callsign for logo
                aircraft_registration: null, // FlightAware doesn't provide this easily
                departure_time: flight.actual_off || null, // Use actual_off for departure time
                source: 'flightaware'
            };
            
            // If no route found, add to blocklist
            if (!result.origin && !result.destination) {
                console.log(`[FlightAware] ⛔ ${ident} has no origin/destination - adding to blocklist`);
                await addToFABlocklist(ident);
                return { success: false, reason: 'no_route', data: null };
            }

            // Save to caches (without departure_time - cache is for route info only)
            const cacheResult = {
                origin: result.origin,
                destination: result.destination,
                aircraft_type: result.aircraft_type,
                airline: result.airline,
                airline_logo_code: result.airline_logo_code,
                aircraft_registration: result.aircraft_registration,
                source: result.source
            };
            
            // Always save to 5-min dedup cache (prevents duplicate API calls)
            saveRecentLookup(ident, cacheResult);
            
            // Only persist to 7-day cache for commercial flights (private jets reuse callsigns)
            if (!isPrivateJetOperator(ident)) {
                // Only write to persistent cache when approaching API limits (saves disk I/O)
                const shouldPersistCache = 
                    apiCosts.flightradar24_credits_remaining < 5000 || 
                    apiCosts.flightaware > 20;
                
                if (shouldPersistCache) {
                    await cacheFlightData(ident, cacheResult);
                    console.log(`[FlightAware] 💾 Cached ${ident} (approaching limits: FR24=${apiCosts.flightradar24_credits_remaining}, FA=$${apiCosts.flightaware.toFixed(2)})`);
                }
            } else {
                console.log(`[FlightAware] 🚁 ${ident} is private jet - NOT cached (callsign reused)`);
            }

            return { success: true, reason: 'api', data: { ...result, from_cache: false } };
        }
        
        // No flights found - add to blocklist to prevent future API calls
        console.log(`[FlightAware] ⛔ No flight data for ${ident} - adding to blocklist`);
        await addToFABlocklist(ident);
        return { success: false, reason: 'no_data', data: null };
    } catch (error) {
        // Silent fail - FlightAware is optional
        // Don't add 404s to blocklist - they could be temporary (flight just departed)
        if (error.response && error.response.status !== 404) {
            console.error(`[FlightAware] Error fetching ${ident}:`, error.message);
        }
        return { success: false, reason: 'error', data: null };
    }
}

async function getFlightradar24FlightInfo(callsign, flight) {
    if (!FLIGHTRADAR24_ENABLED || !callsign) return { success: false, reason: 'disabled', data: null };
    
    // Check recent lookups first (prevents duplicate API calls within 5 min)
    const recentData = getRecentLookup(callsign);
    if (recentData) {
        console.log(`[FR24] ⚡ Using 5-min dedup cache for ${callsign}`);
        return { success: true, reason: 'cache', data: { ...recentData, from_recent_cache: true } };
    }
    
    // Check if credits exhausted (API unavailable)
    if (apiCosts.flightradar24_credits_remaining <= 0) {
        console.log(`[FR24] 💳 Credits exhausted (${apiCosts.flightradar24_credits_used}/30000) - API unavailable`);
        return { success: false, reason: 'unavailable', data: null };
    }

    // Credits available - proceed with normal altitude/filter checks
    if (!shouldLookupFlightradar24(callsign, flight)) {
        return { success: false, reason: 'filtered', data: null };
    }

    // Rate limiting check
    if (!canMakeFlightradar24Call()) {
        console.log(`[Flightradar24] Rate limit reached, skipping ${callsign}`);
        return { success: false, reason: 'rate_limit', data: null };
    }

    try {
        recordFlightradar24Call();
        const startTime = Date.now();
        
        // Using flight-summary/light with callsign and datetime window
        // Per FR24 docs: flight-summary/light = 2 credits (vs 8 for live/flight-positions/full)
        // Requires datetime window - using 1 hour window (accounts for flights detected during taxi)
        const now = new Date();
        const from = new Date(now.getTime() - (60 * 60 * 1000)); // 1 hour ago
        const fromStr = from.toISOString().replace(/\.\d{3}Z$/, 'Z');
        const toStr = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
        
        const url = `${FLIGHTRADAR24_BASE_URL}/flight-summary/light`;
        console.log(`[Flightradar24] 💰 API call (2 credits): ${url}?callsigns=${callsign}&flight_datetime_from=${fromStr}`);
        
        const response = await axios.get(url, {
            headers: {
                'authorization': `Bearer ${process.env.FLIGHTRADAR24_API_KEY}`,
                'accept': 'application/json',
                'accept-version': 'v1'
            },
            params: {
                callsigns: callsign,
                flight_datetime_from: fromStr,
                flight_datetime_to: toStr,
                limit: 500
            }
        });
        
        const duration = Date.now() - startTime;
        logAPI('Flightradar24', 'GET', `/flight-summary/light?callsigns=${callsign}`, response.status, duration);

        // Track API call count and estimate credits
        // flight-summary/light = 2 credits (75% savings vs 8 credits)
        // This local tracking helps between /usage API syncs (every 30 min)
        apiCosts.flightradar24_calls++;
        apiCosts.flightradar24_credits_used += 2;
        apiCosts.flightradar24_credits_remaining = Math.max(0, 30000 - apiCosts.flightradar24_credits_used);
        
        console.log(`[FR24] Local tracking: +2 credits, total: ${apiCosts.flightradar24_credits_used}/30000, remaining: ${apiCosts.flightradar24_credits_remaining}`);
        
        await saveUsageTracking();

        // Parse response - flight-summary/light returns complete flight data
        console.log(`[Flightradar24] Response for ${callsign}:`, JSON.stringify(response.data).substring(0, 500));

        // Handle response data structure - check if data array is empty
        if (!response.data?.data || response.data.data.length === 0) {
            console.log(`[Flightradar24] No flight data found for ${callsign} (empty response or outside time window)`);
            return { success: false, reason: 'no_data', data: null };
        }
        
        // FR24 can return multiple flights with same callsign (e.g., completed + active)
        // Priority: 1) Active flights (not ended), 2) Most recent flight
        const flights = response.data.data;
        console.log(`[FR24] Received ${flights.length} flight(s) for ${callsign}`);
        
        // Find active flight (flight_ended = false or null)
        let flightData = flights.find(f => !f.flight_ended);
        
        if (!flightData) {
            // All flights ended - use most recent (first in array)
            flightData = flights[0];
            console.log(`[FR24] All flights ended for ${callsign}, using most recent`);
        } else if (flights.length > 1) {
            console.log(`[FR24] Selected active flight for ${callsign} (filtered out ${flights.length - 1} completed flight(s))`);
        }

        // Log full response for debugging
        console.log(`[Flightradar24] Data for ${callsign}:`, JSON.stringify(flightData, null, 2));

        // GENERAL RULE: Always prioritize painted_as over operating_as
        // painted_as = airline livery/branding shown on aircraft
        // operating_as = actual operating carrier
        let airlineDisplay = null;
        let airlineLogoCode = null;
        
        // Use painted_as if available, fallback to operating_as
        const displayAirline = flightData.painted_as || flightData.operating_as;
        
        // Special handling for regional carriers operating for major airlines
        // Show only the partner airline (Delta, United, American), not the regional carrier
        if (flightData.operating_as === 'RPA' && flightData.painted_as) {
            const partnerAirlines = ['AAL', 'DAL', 'UAL'];
            if (partnerAirlines.includes(flightData.painted_as)) {
                // Don't set airlineDisplay - let frontend lookup partner airline name
                airlineLogoCode = flightData.painted_as;
                console.log(`[Flightradar24] Republic Airways operating as ${flightData.painted_as} for ${callsign} - displaying as ${flightData.painted_as}`);
            }
        } else if (flightData.operating_as === 'EDV' && flightData.painted_as) {
            const partnerAirlines = ['DAL'];
            if (partnerAirlines.includes(flightData.painted_as)) {
                airlineLogoCode = flightData.painted_as;
                console.log(`[Flightradar24] Endeavor Air operating as ${flightData.painted_as} for ${callsign} - displaying as ${flightData.painted_as}`);
            }
        } else if (flightData.operating_as === 'GJS' && flightData.painted_as) {
            const partnerAirlines = ['UAL', 'DAL'];
            if (partnerAirlines.includes(flightData.painted_as)) {
                airlineLogoCode = flightData.painted_as;
                console.log(`[Flightradar24] GoJet operating as ${flightData.painted_as} for ${callsign} - displaying as ${flightData.painted_as}`);
            }
        } else if (flightData.operating_as === 'ENY' && flightData.painted_as) {
            const partnerAirlines = ['AAL'];
            if (partnerAirlines.includes(flightData.painted_as)) {
                airlineLogoCode = flightData.painted_as;
                console.log(`[Flightradar24] Envoy Air operating as ${flightData.painted_as} for ${callsign} - displaying as ${flightData.painted_as}`);
            }
        }
        
        // If not a special regional case, use painted_as for logo
        if (!airlineLogoCode && displayAirline) {
            airlineLogoCode = displayAirline;
        }

        const result = {
            origin: flightData.orig_icao || flightData.origin?.icao || flightData.origin_icao || null,
            destination: flightData.dest_icao || flightData.dest_icao_actual || flightData.destination?.icao || flightData.destination_icao || null,
            aircraft_type: flightData.type || flightData.aircraft?.type || flightData.aircraft_type || null,
            airline: airlineDisplay,
            airline_logo_code: airlineLogoCode,
            operating_carrier: flightData.operating_as || null, // NEW: Send operating carrier to client
            aircraft_registration: flightData.reg || flightData.aircraft?.registration || flightData.registration || null,
            departure_time: flightData.datetime_takeoff || null, // Departure time instead of ETA
            source: 'flightradar24'
        };
        
        // Save to caches (without departure_time - cache is for route info only)
        const cacheResult = {
            origin: result.origin,
            destination: result.destination,
            aircraft_type: result.aircraft_type,
            airline: result.airline,
            airline_logo_code: result.airline_logo_code,
            aircraft_registration: result.aircraft_registration,
            source: result.source
        };
        
        // Always save to 5-min dedup cache (prevents duplicate API calls)
        saveRecentLookup(callsign, cacheResult);
        
        // Only persist to 7-day cache for commercial flights (private jets reuse callsigns)
        if (!isPrivateJetOperator(callsign)) {
            // Only write to persistent cache when approaching API limits (saves disk I/O)
            const shouldPersistCache = 
                apiCosts.flightradar24_credits_remaining < 5000 || 
                apiCosts.flightaware > 20;
            
            if (shouldPersistCache) {
                await cacheFlightData(callsign, cacheResult);
                console.log(`[FR24] 💾 Cached ${callsign} (approaching limits: FR24=${apiCosts.flightradar24_credits_remaining}, FA=$${apiCosts.flightaware.toFixed(2)})`);
            }
        } else {
            console.log(`[FR24] 🚁 ${callsign} is private jet - NOT cached (callsign reused)`);
        }
        
        return { success: true, reason: 'api', data: { ...result, from_cache: false } };
    } catch (error) {
        // Log detailed error for debugging
        if (error.response) {
            console.error(`[Flightradar24] Error fetching ${callsign}: ${error.response.status} - ${error.response.statusText}`);
            console.error(`[Flightradar24] Response:`, JSON.stringify(error.response.data));
        } else {
            console.error(`[Flightradar24] Error fetching ${callsign}:`, error.message);
        }
        return { success: false, reason: 'error', data: null };
    }
}

async function getAdsbLolFlightDetails(callsign) {
    const empty = { registration: null, aircraft_type: null, dbFlags: 0 };
    if (!ADSBLOL_ENABLED || !callsign) return empty;

    try {
        const encodedCallsign = encodeURIComponent(callsign.trim());
        const callsignUrl = `https://api.adsb.lol/v2/callsign/${encodedCallsign}`;
        const startCallsign = Date.now();
        const callsignResponse = await axios.get(callsignUrl, {
            headers: { 'accept': 'application/json' },
            timeout: ADSBLOL_TIMEOUT_MS
        });
        logAPI('adsb.lol', 'GET', `/v2/callsign/${callsign}`, callsignResponse.status, Date.now() - startCallsign);
        console.log(`[adsb.lol] Callsign response for ${callsign}:`, JSON.stringify(callsignResponse.data).substring(0, 500));

        const ac = Array.isArray(callsignResponse.data?.ac) ? callsignResponse.data.ac : [];
        const first = ac[0] || {};
        const registration = first.r || null;
        const callsignType = first.t || null;
        const dbFlags = first.dbFlags || 0;

        if (!registration) {
            return { registration: null, aircraft_type: callsignType, dbFlags };
        }

        const encodedReg = encodeURIComponent(registration);
        const regUrl = `https://api.adsb.lol/v2/reg/${encodedReg}`;
        const startReg = Date.now();
        const regResponse = await axios.get(regUrl, {
            headers: { 'accept': 'application/json' },
            timeout: ADSBLOL_TIMEOUT_MS
        });
        logAPI('adsb.lol', 'GET', `/v2/reg/${registration}`, regResponse.status, Date.now() - startReg);
        console.log(`[adsb.lol] Reg response for ${registration}:`, JSON.stringify(regResponse.data).substring(0, 500));

        const regAc = Array.isArray(regResponse.data?.ac) ? regResponse.data.ac : [];
        const regFirst = regAc[0] || {};
        const regType = regFirst.t || null;
        // Prefer dbFlags from reg response if present (more authoritative), fall back to callsign response
        const regDbFlags = regFirst.dbFlags || dbFlags;

        return {
            registration,
            aircraft_type: regType || callsignType || null,
            dbFlags: regDbFlags
        };
    } catch (error) {
        const status = error.response?.status;
        if (status) {
            console.error(`[adsb.lol] Flight detail lookup error for ${callsign}: ${status} - ${error.response.statusText}`);
            if (error.response?.data) {
                console.error('[adsb.lol] Flight detail error response:', JSON.stringify(error.response.data));
            }
        } else {
            console.error(`[adsb.lol] Flight detail lookup error for ${callsign}:`, error.message);
        }
        return empty;
    }
}

async function getAdsbLolRouteInfo(callsign, flight) {
    if (!ADSBLOL_ENABLED || !callsign) return { success: false, reason: 'disabled', data: null };

    const flightDetails = await getAdsbLolFlightDetails(callsign);
    const registration = flightDetails.registration || null;
    let aircraftType = flightDetails.aircraft_type || null;
    const dbFlags = flightDetails.dbFlags || 0;
    const isMilitaryByFlag = (dbFlags & 1) !== 0;
    const isLADD = (dbFlags & 8) !== 0;
    const isPIA = (dbFlags & 4) !== 0;
    if (dbFlags > 0) {
        const flagLabels = [isMilitaryByFlag && 'MILITARY', isLADD && 'LADD', isPIA && 'PIA'].filter(Boolean).join(', ');
        console.log(`[adsb.lol] ${callsign} dbFlags=${dbFlags} (${flagLabels})`);
    }

    let route = null;
    let origin = null;
    let destination = null;
    let airlineCode = callsign.substring(0, 3).toUpperCase();

    try {
        const lat = Number.isFinite(flight?.latitude) ? flight.latitude : 0;
        const lng = Number.isFinite(flight?.longitude) ? flight.longitude : 0;
        const payload = { planes: [{ callsign, lat, lng }] };

        const startTime = Date.now();
        const response = await axios.post(ADSBLOL_ROUTESET_URL, payload, {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            timeout: ADSBLOL_TIMEOUT_MS
        });
        const duration = Date.now() - startTime;
        logAPI('adsb.lol', 'POST', '/api/0/routeset', response.status, duration);
        console.log(`[adsb.lol] Response for ${callsign}:`, JSON.stringify(response.data).substring(0, 500));

        if (Array.isArray(response.data) && response.data.length > 0) {
            route = response.data[0] || {};
        }
    } catch (error) {
        const status = error.response?.status;
        if (status) {
            console.error(`[adsb.lol] Route lookup error for ${callsign}: ${status} - ${error.response.statusText}`);
            if (error.response?.data) {
                console.error('[adsb.lol] Route lookup error response:', JSON.stringify(error.response.data));
            }
        } else {
            console.error(`[adsb.lol] Route lookup error for ${callsign}:`, error.message);
        }
    }

    if (route) {
        const hasValidRoute = route.plausible !== 0;
        
        if (!hasValidRoute) {
            console.log(`[adsb.lol] Route data for ${callsign} marked implausible (plausible: ${route.plausible}) - treating as incomplete`);
            // Don't use implausible route data - let FlightAware try instead
            // But still extract aircraft type if available
            aircraftType = route.type || aircraftType;
        } else {
            // Try _airports array first (preferred: has lat/lon for position-based segment detection)
            if (Array.isArray(route._airports) && route._airports.length >= 2) {
                if (route._airports.length === 2) {
                    origin = route._airports[0]?.icao || null;
                    destination = route._airports[1]?.icao || null;
                } else {
                    // Multi-leg route: use aircraft position to find the current active segment
                    const aircraftLat = flight?.latitude;
                    const aircraftLon = flight?.longitude;
                    if (Number.isFinite(aircraftLat) && Number.isFinite(aircraftLon)) {
                        let minDist = Infinity;
                        let nearestIdx = 0;
                        for (let i = 0; i < route._airports.length; i++) {
                            const apt = route._airports[i];
                            if (Number.isFinite(apt.lat) && Number.isFinite(apt.lon)) {
                                const dist = calculateDistance(aircraftLat, aircraftLon, apt.lat, apt.lon);
                                if (dist < minDist) {
                                    minDist = dist;
                                    nearestIdx = i;
                                }
                            }
                        }
                        // Nearest airport is the likely destination; the one before it is the origin
                        const segOriginIdx = nearestIdx > 0 ? nearestIdx - 1 : 0;
                        const segDestIdx = nearestIdx > 0 ? nearestIdx : 1;
                        origin = route._airports[segOriginIdx]?.icao || null;
                        destination = route._airports[segDestIdx]?.icao || null;
                        console.log(`[adsb.lol] Multi-leg route for ${callsign}: nearest airport [${nearestIdx}] ${route._airports[nearestIdx]?.icao}, using segment ${origin} -> ${destination}`);
                    } else {
                        origin = route._airports[0]?.icao || null;
                        destination = route._airports[1]?.icao || null;
                    }
                }
            }

            // Fallback: try airport_codes string if _airports didn't resolve
            if ((!origin || !destination) && typeof route.airport_codes === 'string' && route.airport_codes.includes('-')) {
                const airports = route.airport_codes.split('-').filter(Boolean);
                if (airports.length >= 2) {
                    origin = airports[0] || null;
                    destination = airports[1] || null;
                }
            }

            if (route.airline_code && route.airline_code !== 'unknown') {
                airlineCode = route.airline_code;
            }
        }
    }

    if (!origin && !destination && !aircraftType) {
        console.log(`[adsb.lol] No usable route/type data for ${callsign}`);
        return { success: false, reason: 'no_data', data: null };
    }

    const result = {
        origin,
        destination,
        aircraft_type: aircraftType,
        airline: null,
        airline_logo_code: airlineCode,
        aircraft_registration: registration,
        departure_time: null,
        source: 'adsblol',
        ...(isMilitaryByFlag && { is_military: true }),
        ...(isLADD && { is_ladd: true }),
        ...(isPIA && { is_pia: true }),
    };
    console.log(
        `[adsb.lol] Route/type for ${callsign}: ${origin || 'Unknown'} -> ${destination || 'Unknown'} ` +
        `(airline_code: ${airlineCode}, reg: ${registration || 'Unknown'}, type: ${aircraftType || 'Unknown'}, plausible: ${route?.plausible ?? 'n/a'})`
    );

    // Save to caches (without departure_time - cache is for route info only)
    const cacheResult = {
        origin: result.origin,
        destination: result.destination,
        aircraft_type: result.aircraft_type,
        airline: result.airline,
        airline_logo_code: result.airline_logo_code,
        aircraft_registration: result.aircraft_registration,
        source: result.source
    };

    // Only save to 5-min dedup cache if we have complete route data (origin AND destination)
    // This prevents incomplete adsb.lol data from blocking FA fallback calls
    if (cacheResult.origin && cacheResult.destination) {
        saveRecentLookup(callsign, cacheResult);
    } else {
        console.log(`[adsb.lol] Not caching incomplete route data for ${callsign} (origin: ${cacheResult.origin}, dest: ${cacheResult.destination})`);
    }

    // Only persist to 7-day cache for commercial flights (private jets reuse callsigns)
    if (!isPrivateJetOperator(callsign)) {
        const shouldPersistCache =
            apiCosts.flightradar24_credits_remaining < 5000 ||
            apiCosts.flightaware > 20;

        if (shouldPersistCache) {
            await cacheFlightData(callsign, cacheResult);
            console.log(`[adsb.lol] 💾 Cached ${callsign} (approaching limits: FR24=${apiCosts.flightradar24_credits_remaining}, FA=$${apiCosts.flightaware.toFixed(2)})`);
        }
    } else {
        console.log(`[adsb.lol] 🚁 ${callsign} is private jet - NOT cached (callsign reused)`);
    }

    return { success: true, reason: 'api', data: { ...result, from_cache: false } };
}

async function getOpenSkyToken() {
    if (authToken.token && Date.now() < authToken.expiresAt) {
        return authToken.token;
    }

    try {
        console.log('[OpenSky] Refreshing OAuth token...');
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', process.env.OPENSKY_CLIENT_ID);
        params.append('client_secret', process.env.OPENSKY_CLIENT_SECRET);

        const startTime = Date.now();
        const response = await axios.post(
            'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
            params
        );
        const duration = Date.now() - startTime;

        authToken.token = response.data.access_token;
        // Token usually lasts 30 mins, set expiry with small buffer (e.g. - 1 minute)
        authToken.expiresAt = Date.now() + (response.data.expires_in * 1000) - 60000;

        logAPI('OpenSky', 'POST', '/auth/.../token', response.status, duration);
        console.log(`[OpenSky] ✓ Token acquired. Expires: ${new Date(authToken.expiresAt).toISOString()}`);
        return authToken.token;
    } catch (error) {
        console.error('[OpenSky] ✗ Failed to authenticate:', error.response ? error.response.data : error.message);
        if (error.response) {
            console.error(`[OpenSky] Auth error status: ${error.response.status}`);
        }
        console.warn('[OpenSky] ⚠ Falling back to anonymous access (rate limits: 10 req/min instead of 400 req/min)');
        return null; // Fallback to anonymous
    }
}

// TEMPORARY FR24 FUNCTION - Fetch all flights in area using FR24
// REVERT: Remove this entire function when switching back to OpenSky
// ADSBexchange API Function - TEMPORARY for debugging during OpenSky backoff
// REVERT: Remove this entire function when USE_ADSB is no longer needed
async function fetchFlightsFromADSB(lat, lon, offset) {
    console.log(`[ADSBexchange] Fetching flights in area (lat: ${lat}, lon: ${lon}, radius: ${offset * 69} miles)`);
    
    try {
        const startTime = Date.now();
        
        // ADSBexchange API v2 endpoint format: /v2/lat/{minLat}/{maxLat}/lon/{minLon}/{maxLon}
        // Note: API uses this exact path structure without 'json' extension
        const url = `${ADSBEXCHANGE_BASE_URL}/v2/lat/${lat.toFixed(5)}/lon/${lon.toFixed(5)}/dist/${Math.ceil(offset * 69 * 0.868976)}/`;
        
        console.log(`[ADSBexchange] API URL: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com'
            }
        });
        
        const duration = Date.now() - startTime;
        logAPI('ADSBexchange', 'GET', `/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${Math.ceil(offset * 69 * 0.868976)}/`, response.status, duration);
        
        // ADSBexchange response structure: { ac: [ ... array of aircraft ... ] }
        const rawFlights = response.data?.ac || [];
        console.log(`[ADSBexchange] Received ${rawFlights.length} flights`);
        
        // Map ADSBexchange data to OpenSky-compatible format
        const flights = rawFlights
            .filter(f => {
                // Filter out flights on the ground or with invalid data
                const onGround = f.gnd === "1" || f.gnd === 1 || f.alt_baro === "ground";
                const hasValidAlt = f.alt_baro && f.alt_baro !== "ground" && parseInt(f.alt_baro) > 0;
                
                if (!hasValidAlt && f.flight) {
                    console.log(`[ADSBexchange] Skipping ${(f.flight || '').trim()} - invalid/missing altitude: ${f.alt_baro}`);
                }
                
                return !onGround && hasValidAlt && f.lat && f.lon;
            })
            .map(f => {
                const flightLat = parseFloat(f.lat);
                const flightLon = parseFloat(f.lon);
                const distanceMiles = calculateDistance(lat, lon, flightLat, flightLon);
                
                return {
                    icao24: (f.hex || '').toLowerCase(),
                    callsign: (f.flight || '').trim(),
                    origin_country: f.flag || 'Unknown',
                    time_position: f.seen_pos ? Math.floor(Date.now() / 1000) - Math.floor(f.seen_pos) : Math.floor(Date.now() / 1000),
                    last_contact: f.seen ? Math.floor(Date.now() / 1000) - Math.floor(f.seen) : Math.floor(Date.now() / 1000),
                    longitude: flightLon,
                    latitude: flightLat,
                    altitude: parseInt(f.alt_baro) * 0.3048, // Convert feet to meters
                    velocity: f.gs ? parseFloat(f.gs) * 0.514444 : 0, // Convert knots to m/s
                    heading: parseFloat(f.track) || 0,
                    vertical_rate: f.baro_rate ? parseFloat(f.baro_rate) * 0.00508 : 0, // Convert fpm to m/s
                    on_ground: f.gnd === "1" || f.gnd === 1,
                    category: f.category || null,
                    // ADSBexchange BONUS: Aircraft type included!
                    aircraft_type: f.t || null,
                    // Additional useful data
                    registration: f.r || null,
                    // Note: ADSBexchange doesn't provide origin/destination in basic feed
                    routeOrigin: null,
                    routeDestination: null,
                    detectedMiles: distanceMiles // Distance from base location in miles
                };
            });
        
        // Apply commercial airline filter if enabled
        let filteredFlights = flights;
        if (FILTER_PRIVATE_FLIGHTS) {
            console.log(`[ADSBexchange] Filtering for commercial flights only`);
            filteredFlights = flights.filter(f => {
                const icaoPrefix = f.callsign ? f.callsign.substring(0, 3).toUpperCase() : '';
                const isCommercial = COMMERCIAL_AIRLINES.has(icaoPrefix);
                if (!isCommercial && f.callsign) {
                    console.log(`[ADSBexchange] Filtered out private flight: ${f.callsign}`);
                }
                return isCommercial;
            });
            console.log(`[ADSBexchange] ${filteredFlights.length}/${flights.length} flights after commercial filter`);
        }
        
        return filteredFlights;
        
    } catch (error) {
        console.error('[ADSBexchange] Error fetching flight data:', error.message);
        if (error.response) {
            console.error(`[ADSBexchange Error] Status: ${error.response.status}, Data:`, error.response.data);
        }
        throw error;
    }
}

app.get('/api/flights', async (req, res) => {
    const clientIp = getClientIP(req);
    const lat = currentLocation.lat;
    const lon = currentLocation.lon;

    if (!lat || !lon) {
        return res.status(500).json({ error: 'Latitude and Longitude not configured' });
    }

    const now = Date.now();
    
    // Check if we're in backoff period due to rate limiting
    if (rateLimitBackoff.opensky.backoffUntil > now) {
        const waitTime = Math.ceil((rateLimitBackoff.opensky.backoffUntil - now) / 1000);
        
        // Only log backoff message once per minute to reduce spam
        const timeSinceLastLog = now - rateLimitBackoff.opensky.lastLoggedBackoff;
        if (timeSinceLastLog > 60000) { // 60 seconds
            console.log(`[OpenSky] In backoff period. Serving cached data. Retry in ${waitTime}s (${Math.floor(waitTime/3600)}h ${Math.floor((waitTime%3600)/60)}m remaining)`);
            rateLimitBackoff.opensky.lastLoggedBackoff = now;
        }
        
        if (flightCache.data.length > 0) {
            return res.json(flightCache.data);
        }
        return res.status(429).json({ error: 'Rate limited, no cached data available', retryAfter: waitTime });
    }
    
    if (flightCache.data.length > 0 && (now - flightCache.lastUpdated < CACHE_DURATION)) {
        console.log(`[Cache HIT] Serving cached flight data to ${clientIp} (age: ${Math.round((now - flightCache.lastUpdated) / 1000)}s)`);
        return res.json(flightCache.data);
    }

    // Request deduplication: If a request is already in progress, wait for it instead of making a new one
    if (pendingFlightRequest) {
        console.log(`[Dedup] Request already pending for ${clientIp}, waiting for existing request...`);
        try {
            const data = await pendingFlightRequest;
            console.log(`[Dedup] Serving deduplicated data to ${clientIp}`);
            return res.json(data);
        } catch (error) {
            // If the pending request failed, serve stale cache or return error (don't retry!)
            console.log(`[Dedup] Pending request failed for ${clientIp}, serving stale cache if available`);
            if (flightCache.data.length > 0) {
                return res.json(flightCache.data);
            }
            return res.status(500).json({ error: 'Failed to fetch flight data' });
        }
    }

    console.log(`[Cache MISS] Fetching fresh flight data for ${clientIp}`);

    const lamin = lat - OFFSET;
    const lomin = lon - OFFSET;
    const lamax = lat + OFFSET;
    const lomax = lon + OFFSET;

    // TEMPORARY ADSB TOGGLE - Use ADSBexchange instead of OpenSky when enabled
    // REVERT: Remove this entire if block when USE_ADSB is no longer needed
    if (ADSBEXCHANGE_ENABLED) {
        console.log(`[ADSBexchange] Using ADSBexchange for flight list (temporary debugging mode)`);
        
        pendingFlightRequest = (async () => {
            try {
                const flights = await fetchFlightsFromADSB(lat, lon, OFFSET);
                
                flightCache = {
                    data: flights,
                    lastUpdated: Date.now() // FIX: Use actual completion time, not request start time
                };
                
                console.log(`[ADSBexchange] Successfully fetched and cached ${flights.length} flights`);
                return flights;
                
            } catch (error) {
                console.error('[ADSBexchange] Error in flight fetch:', error.message);
                // Serve stale data if available on error
                if (flightCache.data.length > 0) {
                    console.log('[Cache] Serving stale flight data due to ADSBexchange error');
                    return flightCache.data;
                }
                throw error;
            } finally {
                pendingFlightRequest = null;
            }
        })();
        
        try {
            const data = await pendingFlightRequest;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch flight data from ADSBexchange' });
        }
        return; // Exit early, don't use OpenSky
    }
    // END TEMPORARY ADSB TOGGLE

    // Always use OpenSky for flight positions (FREE)
    // Only use FR24/FA for route/airline details (2 credits each)
    
    // Create a promise for this request that other concurrent requests can wait for
    pendingFlightRequest = (async () => {
        try {
            const config = {
                params: { lamin, lomin, lamax, lomax }
            };

            if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) {
                const token = await getOpenSkyToken();
                if (token) {
                    config.headers = { 'Authorization': `Bearer ${token}` };
                }
            } else if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD) {
                config.auth = {
                    username: process.env.OPENSKY_USERNAME,
                    password: process.env.OPENSKY_PASSWORD
                };
            }

            const startTime = Date.now();
            const response = await axios.get('https://opensky-network.org/api/states/all', config);
            const duration = Date.now() - startTime;

            const queryParams = `lamin=${lamin.toFixed(4)}&lomin=${lomin.toFixed(4)}&lamax=${lamax.toFixed(4)}&lomax=${lomax.toFixed(4)}`;
            logAPI('OpenSky', 'GET', `https://opensky-network.org/api/states/all?${queryParams}`, response.status, duration);

            // Capture and log rate limit headers from successful responses
            if (response.headers['x-rate-limit-remaining']) {
                const remaining = parseInt(response.headers['x-rate-limit-remaining']);
                rateLimitBackoff.opensky.remainingCredits = remaining;
                rateLimitBackoff.opensky.lastChecked = Date.now();
                
                // Update apiCosts with actual server-side count
                apiCosts.opensky_credits_remaining = remaining;
                
                // Detect daily limit (4000 for standard, 8000 for contributing users)
                // If remaining > 4000, user has 8000 credit limit
                if (remaining > 4000 && apiCosts.opensky_daily_limit !== 8000) {
                    apiCosts.opensky_daily_limit = 8000;
                    console.log(`[OpenSky] ✓ Contributing user detected - 8000 daily credits!`);
                }
                
                const dailyLimit = apiCosts.opensky_daily_limit;
                const used = dailyLimit - remaining;
                console.log(`[OpenSky] Rate limit status - ${used}/${dailyLimit} credits used (${remaining} remaining)`);
                
                // Warn if credits are getting low
                if (remaining < 100) {
                    console.warn(`[OpenSky] WARNING: Only ${remaining} API credits remaining!`);
                }
            }

            // Increment call counter
            apiCosts.opensky_calls++;
            
            // Save updated tracking (including opensky_credits_remaining from header)
            await saveUsageTracking();


            // OpenSky returns { time: number, states: [][] }
            // State index: 0: icao24, 1: callsign, 2: origin_country, 5: longitude, 6: latitude, 7: baro_altitude, 9: velocity, 10: true_track
            const rawFlights = response.data.states || [];
            
            console.log(`[OpenSky] Received ${rawFlights.length} total flights in area`);
            
            // Log first few flights for debugging
            if (rawFlights.length > 0) {
                console.log(`[OpenSky] Sample flight data (first 3):`);
                rawFlights.slice(0, 3).forEach((state, idx) => {
                    console.log(`  ${idx + 1}. icao24: ${state[0]}, callsign: "${state[1]?.trim()}", alt: ${state[7]}m, on_ground: ${state[8]}`);
                });
            }

            let flights = rawFlights
                .filter(f => {
                    // Filter out flights on the ground or with invalid altitude (<= 0)
                    const onGround = f[8];
                    const altitude = f[7];
                    return !onGround && altitude > 0;
                })
                .map(f => {
                    const flightLat = f[6];
                    const flightLon = f[5];
                    const distanceMiles = calculateDistance(lat, lon, flightLat, flightLon);
                    
                    return {
                        icao24: f[0],
                        callsign: (f[1] || '').trim(),
                        origin_country: f[2],
                        time_position: f[3], // Unix timestamp of last position update
                        last_contact: f[4],
                        longitude: flightLon,
                        latitude: flightLat,
                        altitude: f[7], // meters
                        velocity: f[9], // m/s
                        heading: f[10],
                        vertical_rate: f[11], // m/s
                        on_ground: f[8],
                        category: f[17], // Aircraft Category
                        detectedMiles: distanceMiles // Distance from base location in miles
                    };
                });

            // Filter out private flights if PRIVATE_FLIGHTS=no
            if (FILTER_PRIVATE_FLIGHTS) {
                flights = flights.filter(f => {
                    const callsign = f.callsign;
                    if (!callsign || callsign.length < 3) return false;
                    // Only show commercial airline flights (N-numbers and private callsigns are filtered out)
                    const isCommercial = isCommercialFlight(callsign);
                    if (!isCommercial) {
                        console.log(`[Filter] Excluding private flight ${callsign} from flight list`);
                    }
                    return isCommercial;
                });
            }

            flightCache = {
                data: flights,
                lastUpdated: Date.now() // FIX: Use actual completion time, not request start time
            };

            // Reset backoff on success
            rateLimitBackoff.opensky.backoffUntil = 0;

            return flights;

        } catch (error) {
            console.error('Error fetching flight data from OpenSky:', error.message);
            if (error.response) {
                console.error(`[OpenSky Error] Status: ${error.response.status}, Data:`, error.response.data);
                
                // Log rate limit headers for debugging
                const headers = error.response.headers;
                if (headers) {
                    if (headers['x-rate-limit-remaining']) {
                        console.error('[OpenSky] Credits remaining:', headers['x-rate-limit-remaining']);
                        rateLimitBackoff.opensky.remainingCredits = parseInt(headers['x-rate-limit-remaining']);
                        rateLimitBackoff.opensky.lastChecked = Date.now();
                    }
                    if (headers['x-rate-limit-retry-after-seconds']) {
                        console.error('[OpenSky] Retry after (seconds):', headers['x-rate-limit-retry-after-seconds']);
                    }
                }
                
                if (error.response.status === 429) {
                    // Use OpenSky's actual retry-after value if provided, otherwise default to 60s
                    const retryAfterSeconds = headers?.['x-rate-limit-retry-after-seconds'] 
                        ? parseInt(headers['x-rate-limit-retry-after-seconds']) 
                        : 60; // Default to 60 seconds if header not present
                    
                    const backoffMs = retryAfterSeconds * 1000;
                    rateLimitBackoff.opensky.backoffUntil = Date.now() + backoffMs;
                    
                    console.error(`[OpenSky] Rate limit exceeded! Backing off for ${retryAfterSeconds}s (from API response)`);
                    console.error('[OpenSky] Authenticated:', !!authToken.token);
                    console.error('[OpenSky] Token expires:', authToken.expiresAt ? new Date(authToken.expiresAt).toISOString() : 'N/A');
                    console.error('[OpenSky] Next retry at:', new Date(rateLimitBackoff.opensky.backoffUntil).toISOString());
                }
            }
            // Serve stale data if available on error
            if (flightCache.data.length > 0) {
                console.log('[Cache] Serving stale flight data due to API error');
                return flightCache.data;
            }
            throw error; // Re-throw to signal failure to waiting requests
        } finally {
            // Clear the pending request so new requests can be made
            pendingFlightRequest = null;
        }
    })();

    try {
        const data = await pendingFlightRequest;
        res.json(data);
    } catch (error) {
        // Error already logged and handled in the promise, just return error response
        res.status(500).json({ error: 'Failed to fetch flight data' });
    }
});

// Route Fetching Endpoint
app.get('/api/route/:icao24', async (req, res) => {
    const { icao24 } = req.params;
    const { callsign, lat, lon, altitude } = req.query;
    const clientIP = getClientIP(req);

    // Log the route request with client IP
    console.log(`[Route Request] ${callsign || icao24} from ${clientIP}`);

    let routeData = null;
    
    // Create flight object with position and altitude for filtering
    const flightForLookup = {
        latitude: parseFloat(lat),
        longitude: parseFloat(lon),
        altitude: parseFloat(altitude) // in meters
    };
    
    // Log altitude validation for debugging
    if (!altitude || isNaN(flightForLookup.altitude)) {
        console.log(`[Route Request] WARNING: ${callsign || icao24} has invalid/missing altitude (${altitude}). Will fall back to OpenSky.`);
    }

    // Route logic:
    // - All flights: active provider -> adsb.lol -> FlightAware (if incomplete) -> cache
    // - Continue calling FlightAware until spend cap is reached
    if (callsign && callsign.length > 2) {
        const isPrivateCallsign = isPrivateJetOperator(callsign);
        let primaryResult = null;
        let secondaryResult = null;
        let hasCompleteRoute = false; // Track if we have origin AND destination

        // Helper function to check if route data is complete
        const isRouteComplete = (data) => {
            return data && data.origin && data.destination;
        };

        // Step 1: Try primary API (FR24 or FA based on config) for commercial flights
        if (!isPrivateCallsign) {
            if (ACTIVE_ENHANCED_PROVIDER === 'flightradar24' && isFR24Available()) {
                console.log(`[Route Request] Trying FR24 (primary)...`);
                primaryResult = await getFlightradar24FlightInfo(callsign, flightForLookup);
                if (primaryResult.success) {
                    routeData = primaryResult.data;
                    hasCompleteRoute = isRouteComplete(routeData);
                }
            } else if (ACTIVE_ENHANCED_PROVIDER === 'flightaware' && isFAAvailable()) {
                console.log(`[Route Request] Trying FA (primary)...`);
                primaryResult = await getFlightAwareFlightInfo(callsign, flightForLookup);
                if (primaryResult.success) {
                    routeData = primaryResult.data;
                    hasCompleteRoute = isRouteComplete(routeData);
                }
            }
        } else {
            console.log(`[Route Request] 🚁 ${callsign} identified as private - skipping paid primary API`);
        }

        // Step 2: Try adsb.lol (free) if we don't have complete route yet
        if (!hasCompleteRoute) {
            console.log(`[Route Request] Trying adsb.lol (secondary)...`);
            secondaryResult = await getAdsbLolRouteInfo(callsign, flightForLookup);
            if (secondaryResult.success) {
                // Merge adsb.lol data with existing data (prefer existing origin/destination if present)
                if (!routeData) {
                    routeData = secondaryResult.data;
                } else {
                    // Merge: keep existing route if present, add aircraft type from adsb.lol
                    routeData.origin = routeData.origin || secondaryResult.data.origin;
                    routeData.destination = routeData.destination || secondaryResult.data.destination;
                    routeData.aircraft_type = routeData.aircraft_type || secondaryResult.data.aircraft_type;
                    routeData.aircraft_registration = routeData.aircraft_registration || secondaryResult.data.aircraft_registration;
                }
                // Propagate dbFlags-derived tags regardless of route completeness
                if (secondaryResult.data.is_military) routeData.is_military = true;
                if (secondaryResult.data.is_ladd) routeData.is_ladd = true;
                if (secondaryResult.data.is_pia) routeData.is_pia = true;
                hasCompleteRoute = isRouteComplete(routeData);
            }
        }

        // Step 3: If still no complete route, try FlightAware as tertiary (for both commercial AND private)
        // Skip FA entirely for LADD/PIA aircraft — they never return route data by design, saving API credits
        const isLaddOrPia = routeData?.is_ladd || routeData?.is_pia || secondaryResult?.data?.is_ladd || secondaryResult?.data?.is_pia;
        if (isLaddOrPia) {
            console.log(`[Route Request] ⛔ ${callsign} is LADD/PIA - skipping FA tertiary call (route data will never be available)`);
        }
        if (!hasCompleteRoute && isFAAvailable() && !isLaddOrPia) {
            console.log(`[Route Request] ${hasCompleteRoute ? 'Incomplete' : 'No'} route data (origin: ${routeData?.origin || 'null'}, dest: ${routeData?.destination || 'null'}), trying FA (tertiary)...`);
            const tertiaryResult = await getFlightAwareFlightInfo(callsign, flightForLookup, true);
            if (tertiaryResult.success) {
                // Merge FA data with existing data
                if (!routeData) {
                    routeData = tertiaryResult.data;
                } else {
                    // Keep best available data from each source
                    routeData.origin = routeData.origin || tertiaryResult.data.origin;
                    routeData.destination = routeData.destination || tertiaryResult.data.destination;
                    routeData.aircraft_type = routeData.aircraft_type || tertiaryResult.data.aircraft_type;
                    routeData.aircraft_registration = routeData.aircraft_registration || tertiaryResult.data.aircraft_registration;
                    routeData.departure_time = tertiaryResult.data.departure_time; // Use FA departure time if available
                }
                hasCompleteRoute = isRouteComplete(routeData);
            }
        }

        // Step 4: LAST RESORT - If BOTH APIs unavailable/failed, check persistent cache
        if (!hasCompleteRoute && !isFR24Available() && !isFAAvailable()) {
            console.log(`[Route Request] 🚨 BOTH APIs unavailable - checking cache as last resort`);

            // For commercial flights: check persistent cache
            console.log(`[Route Request] 📦 Checking 7-day cache for ${callsign}`);
            const cachedData = await getCachedFlightData(callsign);
            if (cachedData) {
                console.log(`[Route Request] ✓ Serving from cache (cached: ${cachedData.cached_at})`);
                if (!routeData) {
                    routeData = {
                        ...cachedData,
                        departure_time: null, // Don't show stale departure time
                        from_cache: true
                    };
                } else {
                    // Merge cache data
                    routeData.origin = routeData.origin || cachedData.origin;
                    routeData.destination = routeData.destination || cachedData.destination;
                    routeData.aircraft_type = routeData.aircraft_type || cachedData.aircraft_type;
                }
            } else {
                console.log(`[Route Request] ✗ No cache entry for ${callsign}`);
            }
        }
    }

    if (routeData) {
        // For N-number private flights, try to look up owner from registration database
        let ownerName = null;
        if (callsign && callsign.startsWith('N') && /^N\d/.test(callsign)) {
            const registration = routeData.aircraft_registration || callsign;
            ownerName = lookupPrivateOwner(registration);
            if (ownerName) {
                console.log(`[Private Registry] Found owner for ${registration}: ${ownerName}`);
                routeData.private_owner = ownerName;
            } else {
                console.log(`[Private Registry] No owner found for ${registration}`);
                routeData.private_owner = null;
            }
        }

        // Tag military/government flights: callsign prefix, government N-number owner, or adsb.lol dbFlags
        if (routeData.is_military || isMilitaryFlight(callsign, ownerName)) {
            routeData.is_military = true;
            routeData.airline = 'US Military';
            routeData.airline_logo_code = 'MIL';
        }

        return res.json(routeData);
    }

    // Even with no route data, tag military flights so the UI shows the flag icon
    if (isMilitaryFlight(callsign, null)) {
        return res.json({
            origin: null,
            destination: null,
            aircraft_type: null,
            is_military: true,
            airline: 'US Military',
            airline_logo_code: 'MIL'
        });
    }

    // If no data from any source (APIs failed/unavailable, not in cache, or rejected by filters)
    console.log(`[Route Request] ${callsign || icao24} - no route data available from any source`);
    
    // Return basic flight data structure with nulls for route details
    // The UI will display the flight with position/altitude but no origin/destination
    res.json({ 
        origin: null, 
        destination: null, 
        aircraft_type: null,
        message: 'Enhanced route data not available'
    });
});

// Configure Node Geocoder with proper User-Agent to comply with OSM usage policy
const NodeGeocoder = require('node-geocoder');
const geocoder = NodeGeocoder({
    provider: 'openstreetmap',
    httpAdapter: 'https',
    formatter: null,
    // Required by OSM Nominatim usage policy
    headers: {
        'User-Agent': 'FlightTrak/1.0 (Flight Tracking Application)'
    }
});

// Global Location State
let currentLocation = {
    lat: parseFloat(process.env.LATITUDE) || 40.6895,
    lon: parseFloat(process.env.LONGITUDE) || -74.1745,
    zip: process.env.ZIPCODE || null
};

app.get('/api/config', (req, res) => {
    res.json({
        ...currentLocation,
        radiusMiles: SEARCH_RADIUS_MILES,
        pollInterval: parseInt(process.env.POLL_INTERVAL) || 10000,
        flightawareEnabled: FLIGHTAWARE_ENABLED,
        flightawareLookupAltitudeFeet: FLIGHTAWARE_LOOKUP_ALTITUDE_FEET,
        flightradar24Enabled: FLIGHTRADAR24_ENABLED,
        flightradar24LookupAltitudeFeet: FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET,
        activeEnhancedProvider: ACTIVE_ENHANCED_PROVIDER,
        hybridMode: HYBRID_MODE,
        hybridSwitchThreshold: HYBRID_SWITCH_THRESHOLD,
        privateFlights: PRIVATE_FLIGHTS,
        filterPrivateFlights: FILTER_PRIVATE_FLIGHTS,
        availableProviders: {
            flightaware: FLIGHTAWARE_ENABLED,
            flightradar24: FLIGHTRADAR24_ENABLED,
            opensky: true // Always available
        },
        openskyRateLimit: {
            remainingCredits: rateLimitBackoff.opensky.remainingCredits,
            lastChecked: rateLimitBackoff.opensky.lastChecked,
            backoffUntil: rateLimitBackoff.opensky.backoffUntil,
            inBackoff: rateLimitBackoff.opensky.backoffUntil > Date.now()
        }
    });
});

// Set Active Enhanced Provider
app.post('/api/config/provider', express.json(), (req, res) => {
    const { provider } = req.body;
    
    if (!provider || !['flightaware', 'flightradar24'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid provider. Must be "flightaware" or "flightradar24"' });
    }
    
    // Check if provider is available
    if (provider === 'flightaware' && !FLIGHTAWARE_ENABLED) {
        return res.status(400).json({ error: 'FlightAware is not enabled (missing API key)' });
    }
    if (provider === 'flightradar24' && !FLIGHTRADAR24_ENABLED) {
        return res.status(400).json({ error: 'Flightradar24 is not enabled (missing API key)' });
    }
    
    ACTIVE_ENHANCED_PROVIDER = provider;
    apiCosts.active_enhanced_provider = provider; // Save to tracking data
    
    // Persist the change immediately
    saveUsageTracking().then(() => {
        console.log(`[Config] Enhanced API provider changed to: ${provider} (saved to disk)`);
    }).catch(err => {
        console.error(`[Config] Failed to save provider change: ${err.message}`);
    });
    
    res.json({ 
        success: true, 
        activeProvider: ACTIVE_ENHANCED_PROVIDER,
        altitudeFeet: provider === 'flightaware' ? FLIGHTAWARE_LOOKUP_ALTITUDE_FEET : FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET
    });
});

// Admin endpoint to manually reset OpenSky rate limit backoff (useful for testing)
app.post('/api/admin/reset-opensky-backoff', (req, res) => {
    const previousBackoff = {
        backoffUntil: rateLimitBackoff.opensky.backoffUntil,
        remainingCredits: rateLimitBackoff.opensky.remainingCredits,
        lastChecked: rateLimitBackoff.opensky.lastChecked
    };
    
    // Reset backoff state
    rateLimitBackoff.opensky.backoffUntil = 0;
    rateLimitBackoff.opensky.remainingCredits = null;
    rateLimitBackoff.opensky.lastChecked = 0;
    
    console.log('[Admin] OpenSky backoff manually reset');
    console.log('[Admin] Previous state:', previousBackoff);
    
    res.json({
        success: true,
        message: 'OpenSky rate limit backoff has been reset',
        previousState: previousBackoff,
        currentState: {
            backoffUntil: 0,
            remainingCredits: null,
            lastChecked: 0
        }
    });
});

// Aircraft Type Submission Endpoint
app.post('/api/aircraft-type', async (req, res) => {
    const { code, name, category } = req.body;
    
    if (!code || !name) {
        return res.status(400).json({ error: 'Code and name are required' });
    }
    
    try {
        // Read current aircraft types file
        const filePath = path.join(__dirname, 'public', 'user_aircraft_types.json');
        let userTypes = {};
        
        try {
            const data = await fs.readFile(filePath, 'utf8');
            userTypes = JSON.parse(data);
        } catch (error) {
            // File doesn't exist yet, start with empty object
            console.log('[Aircraft Types] Creating new user types file');
        }
        
        // Add new type
        userTypes[code] = {
            name: name,
            category: category || 'unknown',
            submittedAt: new Date().toISOString()
        };
        
        // Write back to file
        await fs.writeFile(filePath, JSON.stringify(userTypes, null, 2));
        
        console.log(`[Aircraft Types] User submitted: ${code} = ${name} (${category || 'no category'})`);
        
        res.json({ success: true, message: 'Aircraft type saved' });
    } catch (error) {
        console.error('[Aircraft Types] Error saving:', error);
        res.status(500).json({ error: 'Failed to save aircraft type' });
    }
});

// Get User-Submitted Aircraft Types
app.get('/api/aircraft-types', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'public', 'user_aircraft_types.json');
        const data = await fs.readFile(filePath, 'utf8');
        const userTypes = JSON.parse(data);
        res.json(userTypes);
    } catch (error) {
        // File doesn't exist or is empty
        res.json({});
    }
});

// API Cost Endpoint
app.get('/api/cost', async (req, res) => {
    // Calculate OpenSky credits from actual server-side header data
    const openskyRemaining = apiCosts.opensky_credits_remaining !== null 
        ? apiCosts.opensky_credits_remaining 
        : rateLimitBackoff.opensky.remainingCredits;
    
    const openskyDailyLimit = apiCosts.opensky_daily_limit || 4000;
    const openskyUsed = openskyRemaining !== null ? (openskyDailyLimit - openskyRemaining) : 0;
    
    // Cache mode status
    const fr24Exhausted = apiCosts.flightradar24_credits_remaining <= 0;
    const inCacheMode = fr24Exhausted && ACTIVE_ENHANCED_PROVIDER === 'flightradar24';
    
    // FlightAware cost cap status
    const faCostCap = parseFloat(process.env.FLIGHTAWARE_COST_CAP) || 25.00;
    const faCostCapReached = apiCosts.flightaware >= faCostCap;
    
    res.json({
        total: apiCosts.total.toFixed(4),
        flightaware: apiCosts.flightaware.toFixed(4),
        opensky: apiCosts.opensky.toFixed(4),
        flightradar24: apiCosts.flightradar24.toFixed(4),
        flightaware_calls: apiCosts.flightaware_calls,
        flightaware_cost_cap: faCostCap,
        flightaware_cost_cap_reached: faCostCapReached,
        opensky_calls: apiCosts.opensky_calls, // For backwards compatibility
        opensky_credits_remaining: openskyRemaining,
        opensky_credits_used: openskyUsed,
        opensky_daily_limit: openskyDailyLimit,
        flightradar24_calls: apiCosts.flightradar24_calls,
        flightradar24_credits_used: apiCosts.flightradar24_credits_used,
        flightradar24_credits_remaining: apiCosts.flightradar24_credits_remaining,
        monthly_reset_date: apiCosts.monthly_reset_date, // FA & FR24
        opensky_reset_date: apiCosts.opensky_reset_date, // OpenSky daily
        credits_reset_date: process.env.CREDITS_RESET, // Single reset date from .env
        cache_enabled: true,
        cache_mode: inCacheMode,
        cache_entries: flightDataCache.metadata.entry_count,
        cache_last_save: flightDataCache.metadata.last_save
    });
});


// Start Server Wrapper
async function startServer() {
    // Clear any pending requests from previous shutdown
    pendingFlightRequest = null;
    console.log('[Startup] Cleared pending request state');
    
    // Load usage tracking from disk
    const savedUsage = await loadUsageTracking();
    Object.assign(apiCosts, savedUsage);
    
    // Load persistent flight cache from disk
    await loadFlightCache();
    
    // Clean expired cache entries on startup
    await cleanExpiredCacheEntries();
    
    // Schedule daily cache cleanup
    setInterval(cleanExpiredCacheEntries, 24 * 60 * 60 * 1000);
    
    // Restore active provider from saved data (UI selection)
    if (savedUsage.active_enhanced_provider) {
        ACTIVE_ENHANCED_PROVIDER = savedUsage.active_enhanced_provider;
        console.log(`[Startup] Restored active provider: ${ACTIVE_ENHANCED_PROVIDER}`);
    }
    
    // Log configuration
    console.log('\n=== FlightTrak Configuration ===');
    console.log(`Search Radius: ${SEARCH_RADIUS_MILES} miles`);
    console.log(`Poll Interval: ${process.env.POLL_INTERVAL || 10000}ms`);
    console.log(`Private Flights Filter: ${FILTER_PRIVATE_FLIGHTS ? 'YES (commercial only)' : 'NO (all flights)'}`);
    console.log('\n--- API Providers ---');
    console.log(`OpenSky Network: ✓ ALWAYS ENABLED (free)`);
    console.log('\n--- Enhanced Data Provider (ONE ACTIVE) ---');
    
    if (FLIGHTAWARE_ENABLED) {
        const isActive = ACTIVE_ENHANCED_PROVIDER === 'flightaware';
        console.log(`FlightAware: ${isActive ? '✓ ACTIVE' : '○ Available'}`);
        if (isActive) {
            console.log(`  Altitude Filter: ${FLIGHTAWARE_LOOKUP_ALTITUDE_FEET} ft`);
            console.log(`  Rate Limit: ${FA_RATE_LIMIT} calls/min`);
        }
    } else {
        console.log(`FlightAware: ✗ DISABLED (no API key)`);
    }
    
    if (FLIGHTRADAR24_ENABLED) {
        const isActive = ACTIVE_ENHANCED_PROVIDER === 'flightradar24';
        console.log(`Flightradar24: ${isActive ? '✓ ACTIVE' : '○ Available'}`);
        if (isActive) {
            console.log(`  Altitude Filter: ${FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET} ft`);
            console.log(`  Rate Limit: ${FR24_RATE_LIMIT} calls/min`);
        }
    } else {
        console.log(`Flightradar24: ✗ DISABLED (no API key)`);
    }
    
    console.log(`\nActive Enhanced Provider: ${ACTIVE_ENHANCED_PROVIDER.toUpperCase()}`);
    console.log(`Private Flights Filter: ${FILTER_PRIVATE_FLIGHTS ? 'COMMERCIAL ONLY' : 'ALL FLIGHTS'}`);
    console.log('================================\n');

    // Geocode Zip if provided
    if (process.env.ZIPCODE) {
        try {
            console.log(`Resolving Zip Code: ${process.env.ZIPCODE}...`);
            const results = await geocoder.geocode({
                zipcode: process.env.ZIPCODE,
                country: 'US' // Explicitly specify United States
            });

            if (results && results.length > 0) {
                currentLocation.lat = results[0].latitude;
                currentLocation.lon = results[0].longitude;
                currentLocation.zip = process.env.ZIPCODE;
                console.log(`✓ Location found: ${results[0].formattedAddress}`);
                console.log(`  Coordinates: ${currentLocation.lat}, ${currentLocation.lon}`);
            } else {
                console.warn('⚠ Zip Code not found, falling back to configured/default coordinates.');
                console.warn(`  Using: ${currentLocation.lat}, ${currentLocation.lon}`);
            }
        } catch (err) {
            console.error('✗ Geocoding error:', err.message);
            console.warn(`  Falling back to: ${currentLocation.lat}, ${currentLocation.lon}`);
        }
    } else {
        console.log(`Using explicit coordinates: ${currentLocation.lat}, ${currentLocation.lon}`);
    }

    // Initial Cost Fetch (FlightAware only - FR24 delayed to avoid rate limits)
    const faCost = await getFlightAwareCost();
    apiCosts.flightaware = faCost.cost;
    apiCosts.flightaware_calls = faCost.calls;
    apiCosts.total = apiCosts.flightaware + apiCosts.opensky;
    await saveUsageTracking();
    console.log(`[Startup] FlightAware cost loaded: $${apiCosts.flightaware.toFixed(4)} (${apiCosts.flightaware_calls} calls)`);

    // Load FA blocklist
    await loadFABlocklist();

    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Monitoring flight traffic around ${currentLocation.lat}, ${currentLocation.lon}`);
        
        // Graceful shutdown handler - save cache before exit
        const shutdown = async (signal) => {
            console.log(`\n[${signal}] Graceful shutdown initiated...`);
            if (cacheNeedsSave) {
                console.log('[Shutdown] Saving flight cache...');
                await saveFlightCache();
            }
            console.log('[Shutdown] Cleanup complete, exiting.');
            process.exit(0);
        };
        
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        
        // Delayed FR24 credit check (20 seconds after startup to avoid rate limits)
        setTimeout(async () => {
            console.log('[Startup] Fetching FR24 credits (delayed)...');
            await updateCostData();
        }, 20000);
        
        // TEMPORARY ADSB TOGGLE - Log when ADSBexchange mode is active
        // REVERT: Remove this block when USE_ADSB is no longer needed
        if (ADSBEXCHANGE_ENABLED) {
            console.log('\n╔════════════════════════════════════════════════════════════════╗');
            console.log('║  🔧 DEBUG MODE: Using ADSBexchange for Flight List            ║');
            console.log('║                                                                ║');
            console.log('║  Temporary substitute for OpenSky during rate limit backoff.  ║');
            console.log('║  Allows continued debugging/development.                      ║');
            console.log('║                                                                ║');
            console.log('║  To revert: Set USE_ADSB=false in .env                        ║');
            console.log('║  Default: OpenSky (when USE_ADSB is false or not set)         ║');
            console.log('╚════════════════════════════════════════════════════════════════╝\n');
        }
        // END TEMPORARY ADSB TOGGLE
        
    });

    // Update cost data every 30 minutes
    setInterval(updateCostData, 30 * 60 * 1000);
}

startServer();
