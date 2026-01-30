const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Flight data logic
let flightCache = {
    data: [],
    lastUpdated: 0
};
const CACHE_DURATION = 10 * 1000; // 10 seconds
const SEARCH_RADIUS_MILES = parseFloat(process.env.SEARCH_RADIUS_MILES) || 5;
const OFFSET = SEARCH_RADIUS_MILES / 69; // 1 degree latitude is approx 69 miles

// OAuth Token Cache
let authToken = {
    token: null,
    expiresAt: 0
};

// API Cost Tracking (in-memory only, no persistence needed)
const apiCosts = {
    total: 0,
    flightaware: 0,
    opensky: 0,
    flightradar24: 0,
    flightaware_calls: 0,
    opensky_calls: 0,
    flightradar24_calls: 0,
    flightradar24_credits_used: 0,
    flightradar24_credits_remaining: 30000, // Default to 30K plan
    reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
};

// API Logging Utility
function logAPI(service, method, url, status, duration) {
    // Sanitize URL to remove tokens/secrets
    let sanitizedUrl = url;
    if (url.includes('access_token')) {
        sanitizedUrl = url.replace(/access_token=[^&]+/, 'access_token=***');
    }
    if (url.includes('client_secret')) {
        sanitizedUrl = sanitizedUrl.replace(/client_secret=[^&]+/, 'client_secret=***');
    }

    const logMsg = `[API:${service}] ${method} ${sanitizedUrl} -> ${status} (${duration}ms)`;
    console.log(logMsg);
}

// FlightAware API Client
const FLIGHTAWARE_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi';
const FLIGHTAWARE_ENABLED = !!process.env.FLIGHTAWARE_API_KEY; // Enabled if API key is present

// FlightAware Enhanced Lookup Altitude (in feet)
// 0 = Disabled (FREE), >0 = Enhanced data for flights above this altitude
// Default: 2000 feet (filters out landing/departing flights)
const FLIGHTAWARE_LOOKUP_ALTITUDE_FEET = parseInt(process.env.FLIGHTAWARE_LOOKUP_ALTITUDE_FEET) || 2000;
const FLIGHTAWARE_LOOKUP_ALTITUDE_METERS = FLIGHTAWARE_LOOKUP_ALTITUDE_FEET * 0.3048; // Convert feet to meters

// Flightradar24 API Client
const FLIGHTRADAR24_BASE_URL = 'https://fr24api.flightradar24.com/api';
const FLIGHTRADAR24_ENABLED = !!process.env.FLIGHTRADAR24_API_KEY;
const FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET = parseInt(process.env.FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET) || 2000;

// Hybrid Mode - Auto-switch from FlightAware to Flightradar24 at $5 threshold
const HYBRID_MODE = process.env.HYBRID_MODE && 
    (process.env.HYBRID_MODE.toLowerCase() === 'yes' || 
     process.env.HYBRID_MODE.toLowerCase() === 'true');
const HYBRID_SWITCH_THRESHOLD = 5.00; // Switch to FR24 when FA cost reaches $5

// Enhanced API Provider Selection (only ONE active at a time)
let ACTIVE_ENHANCED_PROVIDER = process.env.ENHANCED_API_PROVIDER || 'flightradar24';

// In hybrid mode, override provider selection
if (HYBRID_MODE && FLIGHTAWARE_ENABLED && FLIGHTRADAR24_ENABLED) {
    ACTIVE_ENHANCED_PROVIDER = 'flightaware'; // Start with FlightAware
    console.log(`[Hybrid Mode] Enabled - Starting with FlightAware, will auto-switch to Flightradar24 at $${HYBRID_SWITCH_THRESHOLD.toFixed(2)}`);
} else {
    // Validate provider setting
    if (!['flightaware', 'flightradar24'].includes(ACTIVE_ENHANCED_PROVIDER)) {
        console.warn(`[Config] Invalid ENHANCED_API_PROVIDER: ${ACTIVE_ENHANCED_PROVIDER}, defaulting to flightradar24`);
        ACTIVE_ENHANCED_PROVIDER = 'flightradar24';
    }

    // If selected provider isn't available, switch to the other
    if (ACTIVE_ENHANCED_PROVIDER === 'flightaware' && !FLIGHTAWARE_ENABLED) {
        console.warn('[Config] FlightAware selected but not enabled, switching to Flightradar24');
        ACTIVE_ENHANCED_PROVIDER = 'flightradar24';
    } else if (ACTIVE_ENHANCED_PROVIDER === 'flightradar24' && !FLIGHTRADAR24_ENABLED) {
        console.warn('[Config] Flightradar24 selected but not enabled, switching to FlightAware');
        ACTIVE_ENHANCED_PROVIDER = 'flightaware';
    }
}

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

// Cache for FR24 credits (check every 10 minutes like FlightAware)
let fr24CreditsCache = null;
let fr24CreditsCacheTime = 0;
const FR24_CREDITS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes - same as FlightAware

async function getFlightradar24Credits() {
    // Check if API key exists
    if (!FLIGHTRADAR24_ENABLED) return { credits_used: 0, credits_remaining: 0, calls: 0 };

    // Return cached value if still valid
    if (fr24CreditsCache && (Date.now() - fr24CreditsCacheTime < FR24_CREDITS_CACHE_TTL)) {
        return fr24CreditsCache;
    }

    try {
        const startTime = Date.now();
        // Use /usage endpoint as per FR24 API docs
        const response = await axios.get(`${FLIGHTRADAR24_BASE_URL}/usage`, {
            headers: {
                'Authorization': `Bearer ${process.env.FLIGHTRADAR24_API_KEY}`,
                'Accept-Version': 'v1'
            },
            params: {
                period: '30d' // Get usage for last 30 days
            }
        });
        const duration = Date.now() - startTime;
        logAPI('Flightradar24', 'GET', '/usage', response.status, duration);

        // Parse usage data - sum up credits from all endpoints
        if (response.data && response.data.data && Array.isArray(response.data.data)) {
            const totalCredits = response.data.data.reduce((sum, item) => sum + (item.credits || 0), 0);
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
            
            return result;
        }

        // Default if no data
        const defaultResult = {
            credits_used: 0,
            credits_remaining: 30000,
            calls: 0
        };
        
        fr24CreditsCache = defaultResult;
        fr24CreditsCacheTime = Date.now();
        
        return defaultResult;
    } catch (error) {
        console.error('[Flightradar24] Failed to get credits:', error.message);
        
        // If we have cached data, return it even if expired
        if (fr24CreditsCache) {
            console.log('[Flightradar24] Using cached credits data due to API error');
            return fr24CreditsCache;
        }
        
        // Return tracked values if API call fails and no cache
        return { 
            credits_used: apiCosts.flightradar24_credits_used, 
            credits_remaining: apiCosts.flightradar24_credits_remaining,
            calls: apiCosts.flightradar24_calls 
        };
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
    'live/flight-positions/full': 936,
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

// Update cost every 10 minutes
async function updateCostData() {
    const faCost = await getFlightAwareCost();
    apiCosts.flightaware = faCost.cost;
    apiCosts.flightaware_calls = faCost.calls;
    
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
        // API unavailable - use local tracking
        console.log(`[System] FR24 credits using local tracking: ${apiCosts.flightradar24_credits_used}/30000`);
    }
    
    // FR24 is a flat $9/month subscription, not pay-per-use
    // Don't include in variable cost tracking - it's a fixed monthly cost
    apiCosts.flightradar24 = 0;
    
    // Total cost = only variable costs (FlightAware + OpenSky)
    // FR24 is excluded as it's a fixed subscription
    apiCosts.total = apiCosts.flightaware + apiCosts.opensky;
    console.log(`[System] Cost updated: $${apiCosts.total.toFixed(4)} (FA: ${apiCosts.flightaware_calls}, OS: ${apiCosts.opensky_calls}, FR24: ${apiCosts.flightradar24_calls} calls, ${fr24Credits.credits_used} credits)`);
    
    // Hybrid Mode: Auto-switch from FlightAware to Flightradar24 at threshold
    if (HYBRID_MODE && ACTIVE_ENHANCED_PROVIDER === 'flightaware' && apiCosts.flightaware >= HYBRID_SWITCH_THRESHOLD) {
        console.log(`\n[Hybrid Mode] FlightAware cost ($${apiCosts.flightaware.toFixed(2)}) reached threshold ($${HYBRID_SWITCH_THRESHOLD.toFixed(2)})`);
        console.log(`[Hybrid Mode] Auto-switching to Flightradar24...`);
        ACTIVE_ENHANCED_PROVIDER = 'flightradar24';
        console.log(`[Hybrid Mode] Now using Flightradar24 for enhanced data\n`);
    }
}

// Flight info cache to prevent duplicate calls
// Note: Same flight number can operate multiple times per day on different routes
let faCache = new Map();
const FA_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (balance between API costs and accuracy)

let fr24Cache = new Map();
const FR24_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// List of major airline ICAO codes to prioritize for FlightAware lookups
const MAJOR_AIRLINES = new Set([
    'UAL', 'DAL', 'AAL', 'SWA', 'JBU', 'ASA', 'SKW', 'FFT', 'NKS', 'RPA',
    'ENY', 'CPZ', 'GJS', 'JIA', 'FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'ACA', 'ROU', 'VJA',
    'WJA', 'LOR', 'TSC'
]);

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

function shouldLookupFlightAware(callsign, flight) {
    if (!callsign || callsign.length < 3) return false;
    
    // Skip general aviation (N-numbers) and private flights
    if (callsign.startsWith('N')) return false;
    
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
    
    // Skip general aviation (N-numbers) and private flights
    if (callsign.startsWith('N')) return false;
    
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

async function getFlightAwareFlightInfo(ident, flight) {
    if (!FLIGHTAWARE_ENABLED || !ident) return null;

    // Cost-saving filter: Only lookup major airlines within specified distance
    if (!shouldLookupFlightAware(ident, flight)) {
        return null;
    }

    // Check cache
    if (faCache.has(ident)) {
        const cached = faCache.get(ident);
        if (Date.now() - cached.timestamp < FA_CACHE_TTL) {
            console.log(`[Cache:FA] Returning cached data for ${ident}`);
            return cached.data;
        }
    }

    // Rate limiting check
    if (!canMakeFlightAwareCall()) {
        console.log(`[FlightAware] Rate limit reached, skipping ${ident}`);
        return null;
    }

    try {
        recordFlightAwareCall();
        const startTime = Date.now();
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

        // Note: Cost will be updated by the 10-minute polling interval

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

            const result = {
                origin: flight.origin?.code_icao || null,
                destination: flight.destination?.code_icao || null,
                aircraft_type: flight.aircraft_type || null,
                source: 'flightaware'
            };

            // Update cache
            faCache.set(ident, {
                timestamp: Date.now(),
                data: result
            });

            return result;
        }
        return null;
    } catch (error) {
        // Silent fail - FlightAware is optional
        if (error.response && error.response.status !== 404) {
            console.error(`[FlightAware] Error fetching ${ident}:`, error.message);
        }
        return null;
    }
}

async function getFlightradar24FlightInfo(callsign, flight) {
    if (!FLIGHTRADAR24_ENABLED || !callsign) return null;

    // Use Flightradar24-specific altitude filter
    if (!shouldLookupFlightradar24(callsign, flight)) {
        return null;
    }

    // Check cache
    if (fr24Cache.has(callsign)) {
        const cached = fr24Cache.get(callsign);
        if (Date.now() - cached.timestamp < FR24_CACHE_TTL) {
            console.log(`[Cache:FR24] Returning cached data for ${callsign}`);
            return cached.data;
        }
    }

    // Rate limiting check
    if (!canMakeFlightradar24Call()) {
        console.log(`[Flightradar24] Rate limit reached, skipping ${callsign}`);
        return null;
    }

    try {
        recordFlightradar24Call();
        const startTime = Date.now();
        
        // FR24 API: Search for flight by callsign
        // According to docs, use 'callsigns' parameter (comma-separated)
        const url = `${FLIGHTRADAR24_BASE_URL}/live/flight-positions/full?callsigns=${encodeURIComponent(callsign.trim())}`;
        console.log(`[Flightradar24] Requesting URL: ${url}`);
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${process.env.FLIGHTRADAR24_API_KEY}`,
                'Accept': 'application/json',
                'Accept-Version': 'v1'
            }
        });
        
        const duration = Date.now() - startTime;
        logAPI('Flightradar24', 'GET', `/live/flight-positions/full?callsign=${callsign}`, response.status, duration);

        // Increment call counter and track credits
        apiCosts.flightradar24_calls++;
        
        // Track credits used (936 credits per full position lookup)
        const creditsForThisCall = FR24_CREDIT_COSTS['live/flight-positions/full'];
        apiCosts.flightradar24_credits_used += creditsForThisCall;
        apiCosts.flightradar24_credits_remaining = Math.max(0, 30000 - apiCosts.flightradar24_credits_used);
        
        console.log(`[Flightradar24] Credits: ${creditsForThisCall} used for this call, total: ${apiCosts.flightradar24_credits_used}/${30000}`);

        // Log response structure for debugging
        console.log(`[Flightradar24] Response for ${callsign}:`, JSON.stringify(response.data).substring(0, 500));

        // FR24 API returns data in a 'data' property
        if (response.data && response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
            const flightData = response.data.data[0];

            // Log full response for debugging
            console.log(`[Flightradar24] Data for ${callsign}:`, JSON.stringify(flightData, null, 2));

            const result = {
                origin: flightData.orig_icao || null,
                destination: flightData.dest_icao || null,
                aircraft_type: flightData.type || null,
                airline: flightData.operating_as || flightData.painted_as || null,
                aircraft_registration: flightData.reg || null,
                source: 'flightradar24'
            };

            // Update cache
            fr24Cache.set(callsign, {
                timestamp: Date.now(),
                data: result
            });

            return result;
        }
        return null;
    } catch (error) {
        // Log detailed error for debugging
        if (error.response) {
            console.error(`[Flightradar24] Error fetching ${callsign}: ${error.response.status} - ${error.response.statusText}`);
            console.error(`[Flightradar24] Response:`, JSON.stringify(error.response.data));
        } else {
            console.error(`[Flightradar24] Error fetching ${callsign}:`, error.message);
        }
        return null;
    }
}

async function getOpenSkyToken() {
    if (authToken.token && Date.now() < authToken.expiresAt) {
        return authToken.token;
    }

    try {
        console.log('Refreshing OpenSky OAuth token...');
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', process.env.OPENSKY_CLIENT_ID);
        params.append('client_secret', process.env.OPENSKY_CLIENT_SECRET);

        const response = await axios.post(
            'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
            params
        );

        authToken.token = response.data.access_token;
        // Token usually lasts 30 mins, set expiry with small buffer (e.g. - 1 minute)
        authToken.expiresAt = Date.now() + (response.data.expires_in * 1000) - 60000;

        logAPI('OpenSky', 'POST', '/auth/.../token', response.status, Date.now() - Date.now()); // Approximate duration or capture start time
        console.log('Token acquired successfully.');
        return authToken.token;
    } catch (error) {
        console.error('✗ Failed to authenticate with OpenSky:', error.response ? error.response.data : error.message);
        console.warn('⚠ Falling back to anonymous access (rate limits: 10 req/min instead of 400 req/min)');
        return null; // Fallback to anonymous
    }
}

app.get('/api/flights', async (req, res) => {
    const lat = currentLocation.lat;
    const lon = currentLocation.lon;

    if (!lat || !lon) {
        return res.status(500).json({ error: 'Latitude and Longitude not configured' });
    }

    const now = Date.now();
    if (flightCache.data.length > 0 && (now - flightCache.lastUpdated < CACHE_DURATION)) {
        return res.json(flightCache.data);
    }

    const lamin = lat - OFFSET;
    const lomin = lon - OFFSET;
    const lamax = lat + OFFSET;
    const lomax = lon + OFFSET;

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

        // Increment call counter
        apiCosts.opensky_calls++;


        // OpenSky returns { time: number, states: [][] }
        // State index: 0: icao24, 1: callsign, 2: origin_country, 5: longitude, 6: latitude, 7: baro_altitude, 9: velocity, 10: true_track
        const rawFlights = response.data.states || [];

        const flights = rawFlights
            .filter(f => {
                // Filter out flights on the ground or with invalid altitude (<= 0)
                const onGround = f[8];
                const altitude = f[7];
                return !onGround && altitude > 0;
            })
            .map(f => ({
                icao24: f[0],
                callsign: (f[1] || '').trim(),
                origin_country: f[2],
                time_position: f[3], // Unix timestamp of last position update
                last_contact: f[4],
                longitude: f[5],
                latitude: f[6],
                altitude: f[7], // meters
                velocity: f[9], // m/s
                heading: f[10],
                vertical_rate: f[11], // m/s
                on_ground: f[8],
                category: f[17] // Aircraft Category
            }));

        flightCache = {
            data: flights,
            lastUpdated: now
        };

        res.json(flights);

    } catch (error) {
        console.error('Error fetching flight data:', error.message);
        // Serve stale data if available on error
        if (flightCache.data.length > 0) {
            return res.json(flightCache.data);
        }
        res.status(500).json({ error: 'Failed to fetch flight data' });
    }
});

// Route Fetching Endpoint
app.get('/api/route/:icao24', async (req, res) => {
    const { icao24 } = req.params;
    const { callsign, lat, lon, altitude } = req.query;

    let routeData = null;
    
    // Create flight object with position and altitude for filtering
    const flightForLookup = {
        latitude: parseFloat(lat),
        longitude: parseFloat(lon),
        altitude: parseFloat(altitude) // in meters
    };

    // Use ONLY the active enhanced provider (not both)
    if (callsign && callsign.length > 2) {
        if (ACTIVE_ENHANCED_PROVIDER === 'flightradar24' && FLIGHTRADAR24_ENABLED) {
            routeData = await getFlightradar24FlightInfo(callsign, flightForLookup);
        } else if (ACTIVE_ENHANCED_PROVIDER === 'flightaware' && FLIGHTAWARE_ENABLED) {
            routeData = await getFlightAwareFlightInfo(callsign, flightForLookup);
        }
    }

    if (routeData) {
        return res.json(routeData);
    }

    // Fallback to OpenSky (Route estimation)
    // Look back 24 hours to find the most recent flight segment
    const end = Math.floor(Date.now() / 1000);
    const begin = end - (24 * 60 * 60);

    try {
        const config = {
            params: { begin, end, icao24 }
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
        const response = await axios.get('https://opensky-network.org/api/flights/aircraft', config);
        const duration = Date.now() - startTime;
        logAPI('OpenSky', 'GET', '/api/flights/aircraft', response.status, duration);

        // Increment call counter
        apiCosts.opensky_calls++;

        // Response is a list of flights.
        const flights = response.data || [];
        if (flights.length === 0) {
            return res.json({ origin: null, destination: null, aircraft_type: null });
        }

        // Sort descending by firstSeen to get latest
        flights.sort((a, b) => b.firstSeen - a.firstSeen);

        const route = flights[0];

        res.json({
            origin: route.estDepartureAirport || null,
            destination: route.estArrivalAirport || null,
            aircraft_type: null // OpenSky doesn't easily give this here
        });

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.json({ origin: null, destination: null, aircraft_type: null });
        }
        // console.error(`Error fetching route for ${icao24}:`, error.message);
        // Silent fail on error to keep logs clean
        res.json({ origin: null, destination: null, aircraft_type: null });
    }
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
        availableProviders: {
            flightaware: FLIGHTAWARE_ENABLED,
            flightradar24: FLIGHTRADAR24_ENABLED,
            opensky: true // Always available
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
    console.log(`[Config] Enhanced API provider changed to: ${provider}`);
    
    res.json({ 
        success: true, 
        activeProvider: ACTIVE_ENHANCED_PROVIDER,
        altitudeFeet: provider === 'flightaware' ? FLIGHTAWARE_LOOKUP_ALTITUDE_FEET : FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET
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
    // Return cached costs only. 
    // Actual updates are triggered by flight lookups (see scheduleCostUpdate)
    res.json({
        total: apiCosts.total.toFixed(4),
        flightaware: apiCosts.flightaware.toFixed(4),
        opensky: apiCosts.opensky.toFixed(4),
        flightradar24: apiCosts.flightradar24.toFixed(4),
        flightaware_calls: apiCosts.flightaware_calls,
        opensky_calls: apiCosts.opensky_calls,
        flightradar24_calls: apiCosts.flightradar24_calls,
        flightradar24_credits_used: apiCosts.flightradar24_credits_used,
        flightradar24_credits_remaining: apiCosts.flightradar24_credits_remaining,
        reset_date: apiCosts.reset_date
    });
});


// Start Server Wrapper
async function startServer() {
    // Log configuration
    console.log('\n=== FlightTrak Configuration ===');
    console.log(`Search Radius: ${SEARCH_RADIUS_MILES} miles`);
    console.log(`Poll Interval: ${process.env.POLL_INTERVAL || 10000}ms`);
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

    // Initial Cost Fetch
    await updateCostData();

    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Monitoring flight traffic around ${currentLocation.lat}, ${currentLocation.lon}`);
    });

    // Update cost data every 10 minutes
    setInterval(updateCostData, 10 * 60 * 1000);
}

startServer();
