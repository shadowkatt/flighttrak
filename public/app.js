const flightContainer = document.getElementById('flight-container');
const emptyState = document.getElementById('empty-state');
const trafficCount = document.getElementById('traffic-count');

// Polling interval tracker - prevents duplicate intervals
let flightPollingInterval = null;
let isInitialized = false; // Prevent multiple initializations
let isFetching = false; // Prevent concurrent fetches

// Banner & History Elements
const bannerGrid = document.getElementById('banner-grid');
const historyLogBody = document.getElementById('history-log-body');

// State
let activeFlights = new Map(); // Store currently active flights by icao24
let bannerFlights = []; // Flights to show in banner grid
let bannerFlightIds = new Set(); // Track which flights have been added to banner
const MAX_BANNER_CARDS = 5; // Maximum banner cards to show (reduced for larger display)
let flightHistory = []; // Store list of recent unique flights
const MAX_HISTORY = 500; // Hold up to a full day of traffic (adjustable based on traffic volume)
let ALTITUDE_THRESHOLD_FEET = null; // Loaded from server config (.env), no hardcoded default
let availableProviders = {}; // Track which API providers are available
let activeProvider = 'flightradar24'; // Current active enhanced provider (only ONE at a time)
let configLoaded = false; // Track if config has been loaded from server
let currentLocation = { lat: null, lon: null }; // Store base location from config for distance calculations



// Category Map
const aircraftCategories = {
    0: 'No Info', 1: 'No Info', 2: 'Light', 3: 'Small', 4: 'Large', 5: 'High Vortex', 6: 'Heavy',
    7: 'High Perf', 8: 'Rotorcraft', 9: 'Glider', 10: 'Lighter-than-air', 11: 'Parachutist',
    12: 'Ultralight', 13: 'UAV', 14: 'Space', 15: 'Unspec', 16: 'Service', 17: 'Obstacle', 18: 'Vant', 19: 'Other'
};
const DEFAULT_AIRCRAFT_ICON = 'logos/default.png';
const UNKNOWN_LOCATION = 'Unknown';
const PRIVATE_AIRLINE_LABEL = 'Private Jet';
const INVALID_AIRLINE_VALUES = new Set(['unknown', 'unk', 'n/a', 'na', 'null', 'none']);

function normalizeAirlineCode(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    if (INVALID_AIRLINE_VALUES.has(lowered)) return null;
    return raw.substring(0, 3).toUpperCase();
}

function resolveAirlineLookupCode(flight, callsign) {
    const logoCode = normalizeAirlineCode(flight?.airline_logo_code);
    const callsignCode = normalizeAirlineCode(callsign);

    // Prefer known mapped codes first; this prevents unknown/partner codes
    // from overriding a valid known callsign prefix (e.g., EJA -> NetJets).
    if (logoCode && typeof isKnownAirline === 'function' && isKnownAirline(logoCode)) return logoCode;
    if (callsignCode && typeof isKnownAirline === 'function' && isKnownAirline(callsignCode)) return callsignCode;

    // Fallback to whichever non-empty code is available.
    if (logoCode) return logoCode;
    return callsignCode;
}

function resolveRouteEndpoints(flight, safeGetAirportName) {
    const hasRouteOrigin = !!(flight.routeOrigin && String(flight.routeOrigin).trim());
    const hasRouteDestination = !!(flight.routeDestination && String(flight.routeDestination).trim());

    if (!hasRouteOrigin && !hasRouteDestination) {
        return { origin: UNKNOWN_LOCATION, dest: UNKNOWN_LOCATION };
    }

    const origin = hasRouteOrigin
        ? resolveDisplayLocation(safeGetAirportName(flight.routeOrigin) || flight.routeOrigin)
        : UNKNOWN_LOCATION;
    const dest = hasRouteDestination
        ? resolveDisplayLocation(safeGetAirportName(flight.routeDestination) || flight.routeDestination)
        : UNKNOWN_LOCATION;

    return { origin, dest };
}

function getDisplayAirlineName(flight, callsign) {
    // Military/government flights take priority
    if (flight.is_military) {
        return 'US Military';
    }

    // For N-number private flights, check if we have owner info from registry
    if (callsign && callsign.startsWith('N') && /^N\d/.test(callsign)) {
        if (flight.private_owner) {
            return flight.private_owner;
        }
    }
    
    const directAirline = (flight.airline || '').trim();
    if (directAirline && !INVALID_AIRLINE_VALUES.has(directAirline.toLowerCase())) {
        return directAirline;
    }

    const airlineCode = resolveAirlineLookupCode(flight, callsign);
    
    // Check if this is a regional carrier operating for a major airline
    // Show "Airline Express" for regional partners
    if (flight.operating_carrier && airlineCode) {
        const regionalCarriers = ['RPA', 'ASH', 'EDV', 'ENY', 'GJS', 'SKW', 'PDT', 'JIA'];
        const majorAirlines = {
            'UAL': 'United Express',
            'DAL': 'Delta Connection',
            'AAL': 'American Eagle'
        };
        
        if (regionalCarriers.includes(flight.operating_carrier) && majorAirlines[airlineCode]) {
            return majorAirlines[airlineCode];
        }
    }
    
    if (airlineCode && isKnownAirline(airlineCode)) {
        return getAirlineName(airlineCode);
    }

    return PRIVATE_AIRLINE_LABEL;
}

// NEW: Get operating carrier name for Recent Traffic (shows actual operator, not painted airline)
function getOperatingCarrierName(flight, callsign) {
    // Military/government flights take priority
    if (flight.is_military) {
        return 'US Military';
    }

    // For N-number private flights, check if we have owner info from registry
    if (callsign && callsign.startsWith('N') && /^N\d/.test(callsign)) {
        if (flight.private_owner) {
            return flight.private_owner;
        }
    }
    
    // If we have operating_carrier from FR24, use it
    if (flight.operating_carrier && isKnownAirline(flight.operating_carrier)) {
        return getAirlineName(flight.operating_carrier);
    }
    
    // Otherwise fall back to the display name logic
    return getDisplayAirlineName(flight, callsign);
}


function resolveDisplayLocation(value) {
    if (!value || !String(value).trim()) return UNKNOWN_LOCATION;
    return value;
}

function getAirlineLogo(callsign) {
    if (!callsign || callsign.length < 3) return DEFAULT_AIRCRAFT_ICON;
    // Assume first 3 chars are ICAO airline code (e.g., UAL from UAL123)
    const airlineCode = callsign.substring(0, 3).toUpperCase();
    
    // Check for local logo overrides first (defined in data.js)
    if (typeof logoOverrides !== 'undefined' && logoOverrides[airlineCode]) {
        return logoOverrides[airlineCode];
    }
    
    // Special cases: Use flightaware_logos for better quality on specific airlines
    const useFlightAwareLogos = ['ASA', 'EJA', 'NJE', 'APZ']; // Alaska Airlines, NetJets, NetJets Europe, Air Premia
    const logoFolder = useFlightAwareLogos.includes(airlineCode) ? 'flightaware_logos' : 'radarbox_logos';
    
    return `https://raw.githubusercontent.com/Jxck-S/airline-logos/main/${logoFolder}/${airlineCode}.png`;
}

async function fetchFlights() {
    // Prevent concurrent fetches (Layer 2 protection)
    if (isFetching) {
        console.log('[Fetch] Request already in progress, skipping duplicate call');
        return;
    }
    
    isFetching = true;
    try {
        const response = await fetch('/api/flights');
        if (!response.ok) throw new Error('Network response was not ok');

        const flights = await response.json();
        processFlights(flights);
    } catch (error) {
        console.error('Error fetching flights:', error);
    } finally {
        isFetching = false;
    }
}

function processFlights(flights) {
    // 1. Update Active Flights Map
    // We want to detect NEW flights that weren't there before
    const currentIcaos = new Set(flights.map(f => f.icao24));

    // Identify new flights
    flights.forEach(flight => {
        if (!activeFlights.has(flight.icao24)) {
            // It's a new flight!
            
            // Wait for config to load before applying altitude filter
            if (!configLoaded || ALTITUDE_THRESHOLD_FEET === null) {
                console.log(`[Filter] Config not loaded yet, tracking ${flight.callsign || flight.icao24} without filtering`);
                activeFlights.set(flight.icao24, flight);
                return; // Skip processing until config loads
            }
            
            // Filter: Only log flights above altitude threshold (from .env)
            const altitudeFeet = flight.altitude * 3.28084; // Convert meters to feet
            if (altitudeFeet < ALTITUDE_THRESHOLD_FEET) {
                console.log(`[Filter] Skipping ${flight.callsign || flight.icao24} - ${Math.round(altitudeFeet)} ft (below ${ALTITUDE_THRESHOLD_FEET} ft from .env)`);
                flight.__agentSkippedLowAltitude = true;
                // Still track it, but don't show popup/banner/history
                activeFlights.set(flight.icao24, flight);
                return; // Skip to next flight
            }

            // Enrich with Route Data (Async)
            // Skip API call if test data already has route info
            if (flight.routeOrigin && flight.routeDestination && flight.aircraft_type) {
                console.log(`[Test Data] Using pre-populated route data for ${flight.callsign || flight.icao24}`);

                // Show popup and banner for all flights (server-side filtering handles private flights)
                showFlightPopup(flight);
                addToBanner(flight);

                // Always add to history
                addToHistory(flight);
            } else {
                // Fetch route data from API for real flights
                fetchRouteData(flight).then(route => {
                    // Update local flight object with route info
                    flight.routeOrigin = route.origin;
                    flight.routeDestination = route.destination;
                    if (route.aircraft_type) {
                        flight.aircraft_type = route.aircraft_type;
                    }
                    if (route.airline) {
                        flight.airline = route.airline; // Store airline from API (e.g., "RPA (UAL)")
                    }
                    if (route.airline_logo_code) {
                        flight.airline_logo_code = route.airline_logo_code; // Store partner airline code for logo
                    }
                    if (route.operating_carrier) {
                        flight.operating_carrier = route.operating_carrier; // Store operating carrier (e.g., "RPA")
                    }
                    if (route.private_owner) {
                        flight.private_owner = route.private_owner; // Store private aircraft owner
                    }
                    if (route.is_military) {
                        flight.is_military = true;
                    }
                    if (route.is_ladd) {
                        flight.is_ladd = true; // LADD = privacy-opted aircraft, route data typically unavailable
                    }
                    if (route.is_pia) {
                        flight.is_pia = true; // PIA = rotating anonymous ICAO hex
                    }
                    if (route.departure_time) {
                        flight.departure_time = route.departure_time; // Store departure time
                    }

                    // Show popup and banner for all flights (server-side filtering handles private flights)
                    showFlightPopup(flight);
                    addToBanner(flight);

                    // Always add to history
                    addToHistory(flight);
                });
            }
        } else {
            // Preserve route info if we already have it
            const oldFlight = activeFlights.get(flight.icao24);
            if (oldFlight.routeOrigin) flight.routeOrigin = oldFlight.routeOrigin;
            if (oldFlight.routeDestination) flight.routeDestination = oldFlight.routeDestination;
            if (oldFlight.aircraft_type) flight.aircraft_type = oldFlight.aircraft_type;
        }
        // Update stored data (position updates etc)
        activeFlights.set(flight.icao24, flight);
    });

    // Remove old flights that are gone from active tracking
    for (const [icao, flight] of activeFlights) {
        if (!currentIcaos.has(icao)) {
            activeFlights.delete(icao);
            // Note: We intentionally do NOT remove from banner here
            // Banners persist and only rotate out when new flights are added
        }
    }

    // Update traffic count (only if changed to prevent reflow)
    if (trafficCount && trafficCount.textContent !== String(flights.length)) {
        trafficCount.textContent = flights.length;
    }

    // 2. Render Main Grid - DISABLED to save space on TV

    // renderGrid(flights);

    // 3. Update Banner Grid
    renderBannerGrid();

    // ... (rest of function)
}

// Track in-flight requests to prevent duplicates
const pendingRouteRequests = new Map();

async function fetchRouteData(flight) {
    try {
        const params = new URLSearchParams();
        if (flight.callsign) params.append('callsign', flight.callsign);
        if (flight.latitude) params.append('lat', flight.latitude);
        if (flight.longitude) params.append('lon', flight.longitude);
        if (flight.altitude !== undefined) params.append('altitude', flight.altitude);
        
        // Active provider is determined server-side, no need to send it
        
        const queryString = params.toString();
        const url = `/api/route/${flight.icao24}${queryString ? '?' + queryString : ''}`;
        
        // Check if request is already in flight
        if (pendingRouteRequests.has(flight.icao24)) {
            console.log(`[Dedup] Request already pending for ${flight.callsign || flight.icao24}, waiting...`);
            return await pendingRouteRequests.get(flight.icao24);
        }
        
        // Create and store the promise
        const requestPromise = fetch(url)
            .then(response => {
                if (!response.ok) return { origin: null, destination: null, aircraft_type: null };
                return response.json();
            })
            .then(route => {
                return route;
            })
            .finally(() => {
                // Clean up after request completes
                pendingRouteRequests.delete(flight.icao24);
            });
        
        pendingRouteRequests.set(flight.icao24, requestPromise);
        return await requestPromise;
    } catch (e) {
        pendingRouteRequests.delete(flight.icao24);
        return { origin: null, destination: null, aircraft_type: null };
    }
}

function renderGrid(flights) {
    flightContainer.innerHTML = flights.map(flight => {
        const altFt = Math.round(flight.altitude * 3.28084);
        const speedMph = Math.round(flight.velocity * 2.237);
        const vrFpm = Math.round((flight.vertical_rate || 0) * 196.85); // m/s to fpm
        const callsign = flight.callsign || 'N/A';
        const displayCallsign = (flight.callsign && flight.callsign.length > 0) ? flight.callsign : `Hex: ${flight.icao24}`;

        const { origin: originText, dest: destText } = resolveRouteEndpoints(flight, getAirportName);

        // Use partner airline code for logo if available (e.g., RPA operating as UAL)
        // Use painted_as (airline_logo_code) for logo if available, otherwise use callsign
        const logoCode = resolveAirlineLookupCode(flight, callsign) || callsign;
        const logoUrl = getAirlineLogo(logoCode);
        
        const category = aircraftCategories[flight.category] || '';
        
        // Use API airline if available, otherwise lookup from airline_logo_code (painted_as), then fallback to callsign
        const airlineDisplay = getDisplayAirlineName(flight, callsign);

        return `
            <div class="flight-card">
                <div class="card-header">
                    <div>
                        <div class="callsign">
                            ${logoUrl ? `<img src="${logoUrl}" class="airline-logo-card" onerror="this.onerror=null;this.src='${DEFAULT_AIRCRAFT_ICON}';">` : ''}
                            ${displayCallsign}
                        </div>
                        <div style="font-size:0.8rem; color:#888; margin-bottom:4px;">${airlineDisplay}</div>
                        <div class="origin">${originText} ➔ ${destText}</div>
                        ${category ? `<div class="origin" style="color:var(--accent-color); margin-top:2px;">${flight.aircraft_type || category}</div>` : ''}
                    </div>
                </div>
                <div class="altitude-speed">
                    <div class="metric">
                        <div class="metric-label">ALT (FT)</div>
                        <div class="metric-value">${altFt.toLocaleString()}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">SPD (MPH)</div>
                        <div class="metric-value">${speedMph}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">VR (FPM)</div>
                        <div class="metric-value">${vrFpm}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Flight Popup Notification
let currentPopup = null;
let popupQueue = []; // Queue for spacing out popup notifications
let popupQueueTimer = null;
let isProcessingPopup = false; // Track if we're currently showing a popup
const POPUP_DISPLAY_TIME_MS = 15000; // 15 seconds

function showFlightPopup(flight) {
    // Skip if already showing or queued for this flight
    if (currentPopup && currentPopup.dataset.icao24 === flight.icao24) return;
    if (popupQueue.some(f => f.icao24 === flight.icao24)) return;

    popupQueue.push(flight);
    console.log(`[Popup] Queued ${flight.callsign || flight.icao24} (queue length: ${popupQueue.length})`);

    if (!isProcessingPopup) {
        processPopupQueue();
    }
}

function processPopupQueue() {
    if (popupQueue.length === 0) {
        isProcessingPopup = false;
        popupQueueTimer = null;
        return;
    }

    isProcessingPopup = true;
    const flight = popupQueue.shift();

    if (currentPopup) {
        currentPopup.remove();
    }

    const callsign = flight.callsign || flight.icao24;
    const logoCallsign = resolveAirlineLookupCode(flight, callsign) || callsign;
    const logoUrl = getAirlineLogo(logoCallsign);

    const safeGetAirportName = (code) => {
        if (typeof getAirportName === 'function') {
            return getAirportName(code);
        }
        return code;
    };

    const { origin, dest } = resolveRouteEndpoints(flight, safeGetAirportName);

    const originCity = origin.includes('(') ? origin.replace(/\s*\([^)]*\)/, '') : origin;
    const destCity = dest.includes('(') ? dest.replace(/\s*\([^)]*\)/, '') : dest;

    const category = aircraftCategories[flight.category] || '';
    const rawType = flight.aircraft_type || category || '';
    const aircraftInfo = typeof getAircraftTypeName !== 'undefined' ? getAircraftTypeName(rawType) : rawType;

    const popup = document.createElement('div');
    popup.className = 'flight-popup';
    popup.dataset.icao24 = flight.icao24;
    popup.innerHTML = `
        <div class="flight-popup-header">✈ NEW FLIGHT DETECTED</div>
        <div class="flight-popup-content">
            <div class="flight-popup-logo">
                ${logoUrl ? `<img src="${logoUrl}" onerror="this.onerror=null;this.src='${DEFAULT_AIRCRAFT_ICON}';">` : ''}
            </div>
            <div class="flight-popup-details">
                <div class="flight-popup-callsign">${callsign}</div>
                <div class="flight-popup-route">${originCity} → ${destCity}</div>
                <div class="flight-popup-type">${aircraftInfo}</div>
            </div>
        </div>
    `;

    document.body.appendChild(popup);
    currentPopup = popup;
    const popupShownAt = Date.now();
    console.log(`[Popup] Showing ${callsign} — will dismiss in ${POPUP_DISPLAY_TIME_MS / 1000}s (${popupQueue.length} remaining in queue)`);

    setTimeout(() => {
        console.log(`[Popup] Dismissing ${callsign} after ${Date.now() - popupShownAt}ms`);
        popup.classList.add('fade-out');
        setTimeout(() => {
            if (popup.parentNode) {
                popup.remove();
            }
            if (currentPopup === popup) {
                currentPopup = null;
            }
            processPopupQueue();
        }, 400);
    }, POPUP_DISPLAY_TIME_MS);
}

// Banner Grid Functions
function addToBanner(flight) {
    // Skip flights without callsign
    if (!flight.callsign) return;

    // Skip if already in banner
    if (bannerFlightIds.has(flight.icao24)) return;

    // Add to beginning of array
    bannerFlights.unshift(flight);
    bannerFlightIds.add(flight.icao24);

    // Limit to MAX_BANNER_CARDS
    if (bannerFlights.length > MAX_BANNER_CARDS) {
        const removed = bannerFlights.pop(); // Remove oldest
        bannerFlightIds.delete(removed.icao24);
    }

    // Don't render here - let the main loop handle it
}

function renderBannerGrid() {
    if (bannerFlights.length === 0) {
        bannerGrid.innerHTML = '';
        return;
    }

    // Get current state
    const currentCards = Array.from(bannerGrid.children);
    const currentFlightIds = currentCards.map(card => card.dataset && card.dataset.icao24).filter(Boolean);
    const newFlightIds = bannerFlights.map(f => f.icao24);
    
    // Check if structure has changed (flights added/removed or reordered)
    const structureChanged = currentFlightIds.length !== newFlightIds.length || 
                             currentFlightIds.some((id, i) => id !== newFlightIds[i]);
    
    if (structureChanged) {
        // Full rebuild needed - use helper function to create HTML
        bannerGrid.innerHTML = bannerFlights.map(flight => createBannerCardHTML(flight)).join('');
    } else {
        // Just update data in existing cards (prevents jumpiness!)
        bannerFlights.forEach((flight, index) => {
            if (currentCards[index]) {
                updateBannerCard(currentCards[index], flight);
            }
        });
    }
}

// Helper function to create banner card HTML (extracted for reusability)
function createBannerCardHTML(flight) {
    const altFt = Math.round(flight.altitude * 3.28084);
    const speedMph = Math.round(flight.velocity * 2.237);
    const vrFpm = Math.round((flight.vertical_rate || 0) * 196.85);
    const callsign = flight.callsign || flight.icao24;
    
    // Use partner airline code for logo if available (e.g., RPA operating as UAL)
    const logoCallsign = resolveAirlineLookupCode(flight, callsign) || callsign;
    const logoUrl = getAirlineLogo(logoCallsign);
    
    // Use API airline if available, otherwise lookup from airline_logo_code (painted_as), then fallback to callsign
    const airlineName = getDisplayAirlineName(flight, callsign);
    const category = aircraftCategories[flight.category] || '';

    // Convert heading to cardinal direction
    const heading = flight.heading || 0;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const directionIndex = Math.round(heading / 45) % 8;
    const direction = directions[directionIndex];

    // Resolve Names
    const safeGetAirportName = (code) => {
        if (typeof getAirportName === 'function') {
            return getAirportName(code);
        }
        return code;
    };

    const { origin, dest } = resolveRouteEndpoints(flight, safeGetAirportName);

    // Strip airport codes for banner display
    const originCity = origin.includes('(') ? origin.replace(/\s*\([^)]*\)/, '') : origin;
    const destCity = dest.includes('(') ? dest.replace(/\s*\([^)]*\)/, '') : dest;

    // Format departure time if available
    let departureDisplay = '';
    if (flight.departure_time) {
        try {
            const departureDate = new Date(flight.departure_time);
            const hours = departureDate.getHours();
            const minutes = departureDate.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            
            // Get timezone abbreviation (EST, PST, etc.)
            const timezone = departureDate.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
            departureDisplay = `Departure: ${displayHours}:${minutes} ${ampm} ${timezone}`;
        } catch (e) {
            // Invalid date, skip departure display
        }
    }

    // Vertical rate indicator
    const vrIndicator = vrFpm > 500 ? '↗' : vrFpm < -500 ? '↘' : '→';

    // Aircraft type or category - translate codes to full names
    const rawType = flight.aircraft_type || category || '';
    const aircraftInfo = typeof getAircraftTypeName !== 'undefined' ? getAircraftTypeName(rawType) : rawType;
    
    // Check if aircraft type is unknown
    const isUnknown = rawType && rawType === aircraftInfo && rawType.length <= 6;

    const routeDisplay = (originCity === UNKNOWN_LOCATION && destCity === UNKNOWN_LOCATION)
        ? UNKNOWN_LOCATION
        : `${originCity} → ${destCity}`;

    return `
        <div class="banner-card" data-icao24="${flight.icao24}">
            <div class="airline-logo-container">
                ${logoUrl ? `<img src="${logoUrl}" class="airline-logo-banner" onerror="this.onerror=null;this.src='${DEFAULT_AIRCRAFT_ICON}';">` : ''}
            </div>
            <div class="banner-info">
                <div class="banner-callsign">${callsign}</div>
                ${airlineName ? `<div class="banner-airline">${airlineName}</div>` : ''}
            </div>
            <div class="banner-route">${routeDisplay}${departureDisplay ? ` <span class="eta-inline">(${departureDisplay})</span>` : ''}</div>
            <div class="banner-type ${isUnknown ? 'clickable-aircraft-type' : ''}" 
                 data-code="${isUnknown ? rawType : ''}" 
                 title="${isUnknown ? 'Click to identify this aircraft type' : aircraftInfo}">
                ${aircraftInfo}${isUnknown ? ' ❓' : ''}
            </div>
            <div class="banner-metrics">
                <span class="metric-altitude">${altFt.toLocaleString()} FT ${vrIndicator}</span>
                <span class="metric-speed">${speedMph} MPH ${direction}</span>
            </div>
        </div>
    `;
}

// Helper function to update existing banner card data without replacing DOM
function updateBannerCard(cardElement, flight) {
    const altFt = Math.round(flight.altitude * 3.28084);
    const speedMph = Math.round(flight.velocity * 2.237);
    const vrFpm = Math.round((flight.vertical_rate || 0) * 196.85);
    
    // Convert heading to cardinal direction
    const heading = flight.heading || 0;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const directionIndex = Math.round(heading / 45) % 8;
    const direction = directions[directionIndex];
    
    // Vertical rate indicator
    const vrIndicator = vrFpm > 500 ? '↗' : vrFpm < -500 ? '↘' : '→';
    
    // Format departure time if available
    let departureDisplay = '';
    if (flight.departure_time) {
        try {
            const departureDate = new Date(flight.departure_time);
            const hours = departureDate.getHours();
            const minutes = departureDate.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            
            // Get timezone abbreviation (EST, PST, etc.)
            const timezone = departureDate.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
            departureDisplay = `Departure: ${displayHours}:${minutes} ${ampm} ${timezone}`;
        } catch (e) {
            // Invalid date, skip departure display
        }
    }
    
    // Update route with departure time
    const safeGetAirportName = (code) => {
        if (typeof getAirportName === 'function') {
            return getAirportName(code);
        }
        return code;
    };
    
    const { origin, dest } = resolveRouteEndpoints(flight, safeGetAirportName);
    const originCity = origin.includes('(') ? origin.replace(/\s*\([^)]*\)/, '') : origin;
    const destCity = dest.includes('(') ? dest.replace(/\s*\([^)]*\)/, '') : dest;
    
    const routeElement = cardElement.querySelector('.banner-route');
    if (routeElement) {
        const routeDisplay = (originCity === UNKNOWN_LOCATION && destCity === UNKNOWN_LOCATION)
            ? UNKNOWN_LOCATION
            : `${originCity} → ${destCity}`;
        const newRouteHTML = `${routeDisplay}${departureDisplay ? ` <span class="eta-inline">(${departureDisplay})</span>` : ''}`;
        if (routeElement.innerHTML !== newRouteHTML) {
            routeElement.innerHTML = newRouteHTML;
        }
    }
    
    // Update only the dynamic metrics (prevents full re-render and jumpiness!)
    const altSpan = cardElement.querySelector('.metric-altitude');
    const speedSpan = cardElement.querySelector('.metric-speed');
    
    if (altSpan) {
        const newAltText = `${altFt.toLocaleString()} FT ${vrIndicator}`;
        if (altSpan.textContent !== newAltText) {
            altSpan.textContent = newAltText;
        }
    }
    
    if (speedSpan) {
        const newSpeedText = `${speedMph} MPH ${direction}`;
        if (speedSpan.textContent !== newSpeedText) {
            speedSpan.textContent = newSpeedText;
        }
    }

    // Keep aircraft type display/clickability in sync with latest data
    const typeElement = cardElement.querySelector('.banner-type');
    if (typeElement) {
        const category = aircraftCategories[flight.category] || '';
        const rawType = flight.aircraft_type || category || '';
        const aircraftInfo = typeof getAircraftTypeName !== 'undefined' ? getAircraftTypeName(rawType) : rawType;
        const isUnknown = rawType && rawType === aircraftInfo && rawType.length <= 6;

        typeElement.classList.toggle('clickable-aircraft-type', Boolean(isUnknown));
        typeElement.dataset.code = isUnknown ? rawType : '';
        typeElement.title = isUnknown ? 'Click to identify this aircraft type' : aircraftInfo;
        typeElement.textContent = `${aircraftInfo}${isUnknown ? ' ❓' : ''}`;
    }
}

function addToHistory(flight) {
    const now = Date.now();

    const altFt = Math.round(flight.altitude * 3.28084);
    const speedMph = Math.round(flight.velocity * 2.237);
    const vrFpm = Math.round((flight.vertical_rate || 0) * 196.85);
    const callsign = flight.callsign || flight.icao24;
    const logoCode = resolveAirlineLookupCode(flight, callsign) || callsign;
    const logoUrl = getAirlineLogo(logoCode);

    // Prefer Route Origin/Dest
    const safeGetAirportName = (code) => {
        if (typeof getAirportName === 'function') {
            return getAirportName(code);
        }
        return code;
    };

    const { origin, dest } = resolveRouteEndpoints(flight, safeGetAirportName);


    const logEntry = {
        time: flight.time_position ? new Date(flight.time_position * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date().toLocaleTimeString(),
        timestamp: now,
        icao24: flight.icao24,
        callsign: callsign,
        displayCallsign: callsign && callsign.length > 2 ? callsign : `<span style="opacity:0.5; font-size:0.9em">Hex: ${flight.icao24}</span>`,
        origin: origin,
        dest: dest,
        alt: altFt,
        speed: speedMph,
        vr: vrFpm,
        logo: logoUrl,
        airline: getOperatingCarrierName(flight, callsign), // Use operating carrier name for Recent Traffic
        type: flight.aircraft_type || aircraftCategories[flight.category] || 'N/A',
        detectedMiles: flight.detectedMiles || null // Store detected distance in miles
    };

    // Add to front
    flightHistory.unshift(logEntry);

    // Trim
    if (flightHistory.length > MAX_HISTORY) {
        flightHistory.pop();
    }

    renderHistory();
}

// Filter history based on search query
let historySearchQuery = '';

function filterHistory(query) {
    historySearchQuery = query.toLowerCase().trim();
    renderHistory();
}

function renderHistory() {
    // Filter flights based on search query
    const filteredHistory = historySearchQuery 
        ? flightHistory.filter(entry => {
            const searchFields = [
                entry.callsign || '',
                entry.airline || '',
                entry.origin || '',
                entry.dest || '',
                entry.type || ''
            ].join(' ').toLowerCase();
            
            return searchFields.includes(historySearchQuery);
        })
        : flightHistory;
    
    historyLogBody.innerHTML = filteredHistory.map(entry => `
        <tr>
            <td data-label="TIME"><span class="time-display">${entry.time}</span></td>
            <td data-label="AIRLINE" style="color:#aaa;">${entry.airline || '-'}</td>
            <td data-label="CALLSIGN">
                <div class="table-logo-container">
                    ${entry.logo ? `<img src="${entry.logo}" class="airline-logo-sm" onerror="this.onerror=null;this.src='${DEFAULT_AIRCRAFT_ICON}';">` : ''}
                </div>
                <strong>${entry.displayCallsign}</strong>
            </td>
            <td data-label="TYPE" style="color:#888;">${entry.type}</td>
            <td data-label="ORIGIN">${entry.origin}</td>
            <td data-label="DEST">${entry.dest}</td>
            <td data-label="ALTITUDE">${entry.alt.toLocaleString()}</td>
            <td data-label="SPEED">${entry.speed}</td>
            <td data-label="VR">${entry.vr}</td>
            <td data-label="DETECTED">${entry.detectedMiles ? entry.detectedMiles.toFixed(2) + ' mi' : '-'}</td>
        </tr>
    `).join('');
}

// Clock
setInterval(() => {
    document.getElementById('local-time').textContent = new Date().toLocaleTimeString();
}, 1000);

// API Cost Tracking
async function updateAPICost() {
    try {
        const response = await fetch('/api/cost');
        const data = await response.json();
        const costElement = document.getElementById('api-cost');
        if (costElement) {
            costElement.textContent = data.total;
        }
    } catch (error) {
        console.error('Failed to fetch API cost:', error);
    }
}

// Update cost every 30 seconds
setInterval(updateAPICost, 30000);
updateAPICost(); // Initial fetch

// Fetch API Cost and Call Counts
async function fetchCost() {
    try {
        const res = await fetch('/api/cost');
        const data = await res.json();

        // OpenSky credits (always visible)
        const osCreditsUsed = data.opensky_credits_used || 0;
        const osCreditsRemaining = data.opensky_credits_remaining;
        const osDailyLimit = data.opensky_daily_limit || 4000;
        
        // Use server-calculated values (from X-Rate-Limit-Remaining header)
        if (osCreditsRemaining !== null && osCreditsRemaining !== undefined) {
            document.getElementById('os-calls').textContent = `${osDailyLimit - osCreditsRemaining}/${osDailyLimit}`;
        } else {
            document.getElementById('os-calls').textContent = `${osCreditsUsed}/${osDailyLimit}`;
        }

        // Show active provider's stats + FlightAware (always shown as fallback)
        const faStats = document.getElementById('fa-stats');
        const fr24Stats = document.getElementById('fr24-stats');
        
        // Always show FlightAware stats (it's used as fallback even when not active)
        if (availableProviders.flightaware) {
            faStats.style.display = '';
            document.getElementById('fa-calls').textContent = data.flightaware_calls || 0;
            const faCost = data.flightaware || '0.00';
            const faCostCap = data.flightaware_cost_cap || 25.00;
            const faCostCapReached = data.flightaware_cost_cap_reached || false;
            
            // Show cost with cap indicator
            let costDisplay = faCost;
            if (faCostCapReached) {
                costDisplay += ` <span style="color: #ff4444; font-weight: bold;" title="Cost cap reached ($${faCostCap}). FlightAware disabled.">⚠ CAP</span>`;
            } else {
                costDisplay += ` <span style="color: #888; font-size: 0.9em;">/ $${faCostCap}</span>`;
            }
            document.getElementById('fa-cost').innerHTML = costDisplay;
        } else {
            faStats.style.display = 'none';
        }
        
        // Show FR24 stats if it's the active provider
        if (activeProvider === 'flightradar24' && availableProviders.flightradar24) {
            fr24Stats.style.display = '';
            document.getElementById('fr24-calls').textContent = data.flightradar24_calls || 0;
            const creditsUsed = data.flightradar24_credits_used || 0;
            const creditsRemaining = data.flightradar24_credits_remaining || 30000;
            const totalCredits = creditsUsed + creditsRemaining;
            document.getElementById('fr24-credits').textContent = `${creditsUsed}/${totalCredits}`;
        } else {
            fr24Stats.style.display = 'none';
        }

        // Update reset dates
        if (data.monthly_reset_date) {
            const monthlyResetDate = new Date(data.monthly_reset_date);
            const resetDateElem = document.getElementById('reset-date');
            resetDateElem.textContent = `Credits Reset: ${monthlyResetDate.toLocaleDateString()}`;
            
            // Add cache mode indicator if credits exhausted
            if (data.cache_mode) {
                const warning = ' <span style="color: #ffa500; font-weight: bold;" ' +
                    'title="API credits exhausted. Using cached data. Fresh flights show position only.">' +
                    '⚠ CACHE MODE (' + data.cache_entries + ' flights)</span>';
                resetDateElem.innerHTML = resetDateElem.textContent + warning;
            }
        }
    } catch (error) {
        console.error('Error fetching cost:', error);
    }
}

// Fetch Config (Radius/Location) and start polling
async function fetchConfig() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();

        // Store available providers and active provider
        availableProviders = config.availableProviders || {};

        // Check if provider changed server-side (e.g., hybrid mode auto-switch)
        const newProvider = config.activeEnhancedProvider || 'flightradar24';
        if (newProvider !== activeProvider) {
            console.log(`[Config] Server-side provider change detected: ${activeProvider} -> ${newProvider}`);
            activeProvider = newProvider;
            // Update radio buttons to reflect server state
            const radioButtons = document.querySelectorAll('input[name="api-provider"]');
            radioButtons.forEach(radio => {
                radio.checked = (radio.value === activeProvider);
            });
            // Update altitude display for the new provider
            updateAltitudeDisplay(config);
        }

        // Store hybrid mode status
        const hybridMode = config.hybridMode || false;

        // Update altitude threshold based on active provider (from .env only)
        updateAltitudeDisplay(config);
        
        // Store location for distance calculations
        currentLocation.lat = config.lat;
        currentLocation.lon = config.lon;
        
        // Mark config as loaded
        configLoaded = true;

        // Update location display
        if (config.zip) {
            document.getElementById('location-zip').textContent = config.zip;
        } else {
            document.getElementById('location-zip').textContent = `${config.lat.toFixed(2)}, ${config.lon.toFixed(2)}`;
        }

        // Update Range
        if (config.radiusMiles) {
            document.getElementById('location-range').textContent = `${config.radiusMiles} MILES`;
        }

        // Initialize API provider selector (hide if hybrid mode is enabled)
        initializeAPISelector(hybridMode);

        // Only set up polling on first initialization
        if (!isInitialized) {
            console.log('[Init] First-time initialization, setting up polling');
            isInitialized = true;
            
            const interval = config.pollInterval || 10000;
            console.log(`[Polling] Setting poll interval to ${interval}ms`);
            fetchFlights(); // Initial fetch
            flightPollingInterval = setInterval(fetchFlights, interval);
        } else {
            console.log('[Config] Config updated, polling already active');
        }

    } catch (e) {
        console.error('Failed to fetch config', e);
        
        // Only set up fallback polling if not already initialized
        if (!isInitialized) {
            console.error('[Init] Fallback initialization due to config error - using defaults from server');
            isInitialized = true;
            
            // DO NOT set defaults here - altitude must come from .env only
            // Log error and skip flight processing until config succeeds
            console.error('[Config Error] Cannot process flights without .env altitude values');
            
            // Retry config fetch after 5 seconds
            setTimeout(() => {
                console.log('[Config] Retrying config fetch...');
                fetchConfig();
            }, 5000);
        }
    }
}

// Update altitude display based on active provider
function updateAltitudeDisplay(config) {
    if (activeProvider === 'flightaware') {
        ALTITUDE_THRESHOLD_FEET = config.flightawareLookupAltitudeFeet;
    } else if (activeProvider === 'flightradar24') {
        ALTITUDE_THRESHOLD_FEET = config.flightradar24LookupAltitudeFeet;
    }
    
    if (ALTITUDE_THRESHOLD_FEET === undefined || ALTITUDE_THRESHOLD_FEET === null) {
        console.error(`[Config Error] Altitude threshold not provided by server for ${activeProvider}`);
        return;
    }
    
    console.log(`[Config] Altitude threshold set to ${ALTITUDE_THRESHOLD_FEET} ft from .env (${activeProvider})`);
    document.getElementById('altitude-filter').textContent = `${ALTITUDE_THRESHOLD_FEET} FT`;
}

// Initialize API Provider Selector (Radio Buttons)
function initializeAPISelector(hybridMode = false) {
    const apiSelector = document.querySelector('.api-selector');
    
    // Hide selector if hybrid mode is enabled
    if (hybridMode) {
        if (apiSelector) {
            apiSelector.style.display = 'none';
        }
        console.log('[Hybrid Mode] API selector hidden - auto-switching enabled');
        return;
    }
    
    const radioButtons = document.querySelectorAll('input[name="api-provider"]');
    
    // Set initial state based on server config
    radioButtons.forEach(radio => {
        radio.checked = (radio.value === activeProvider);
        
        // Disable if provider not available
        if (radio.value === 'flightaware' && !availableProviders.flightaware) {
            radio.disabled = true;
            radio.parentElement.style.opacity = '0.5';
            radio.parentElement.title = 'FlightAware not configured';
        }
        if (radio.value === 'flightradar24' && !availableProviders.flightradar24) {
            radio.disabled = true;
            radio.parentElement.style.opacity = '0.5';
            radio.parentElement.title = 'Flightradar24 not configured';
        }
    });
    
    // Listen for changes
    radioButtons.forEach(radio => {
        radio.addEventListener('change', handleProviderChange);
    });
    
    console.log(`[Config] Active provider: ${activeProvider}`);
}

// Handle provider change
async function handleProviderChange(event) {
    const newProvider = event.target.value;
    
    if (newProvider === activeProvider) return;
    
    console.log(`[Config] Switching provider from ${activeProvider} to ${newProvider}`);
    
    try {
        const response = await fetch('/api/config/provider', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ provider: newProvider })
        });
        
        if (response.ok) {
            const data = await response.json();
            activeProvider = newProvider;
            
            // Update altitude threshold
            ALTITUDE_THRESHOLD_FEET = data.altitudeFeet;
            document.getElementById('altitude-filter').textContent = `${ALTITUDE_THRESHOLD_FEET} FT`;
            
            // Update cost display
            fetchCost();
            
            console.log(`[Config] Provider switched to ${newProvider}, altitude: ${ALTITUDE_THRESHOLD_FEET} ft`);
        } else {
            const error = await response.json();
            alert(`Failed to switch provider: ${error.error}`);
            // Revert radio button
            event.target.checked = false;
            document.querySelector(`input[name="api-provider"][value="${activeProvider}"]`).checked = true;
        }
    } catch (error) {
        console.error('Error switching provider:', error);
        alert('Error switching provider. Check console for details.');
        // Revert radio button
        event.target.checked = false;
        document.querySelector(`input[name="api-provider"][value="${activeProvider}"]`).checked = true;
    }
}

// Aircraft Type Modal Functions
function showAircraftModal(aircraftCode) {
    const modal = document.getElementById('aircraft-modal');
    const codeInput = document.getElementById('aircraft-code');
    const nameInput = document.getElementById('aircraft-name');
    const categorySelect = document.getElementById('aircraft-category');
    
    codeInput.value = aircraftCode;
    nameInput.value = '';
    categorySelect.value = '';
    
    modal.style.display = 'flex';
    nameInput.focus();
}

function hideAircraftModal() {
    const modal = document.getElementById('aircraft-modal');
    modal.style.display = 'none';
}

async function submitAircraftType() {
    const code = document.getElementById('aircraft-code').value;
    const name = document.getElementById('aircraft-name').value.trim();
    const category = document.getElementById('aircraft-category').value;
    
    if (!name) {
        alert('Please enter an aircraft name');
        return;
    }
    
    try {
        const response = await fetch('/api/aircraft-type', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code, name, category })
        });
        
        if (response.ok) {
            console.log(`[Aircraft Type] Submitted: ${code} = ${name}`);
            alert(`Thank you! Aircraft type "${code}" has been saved as "${name}"`);
            hideAircraftModal();
            
            // Store locally for immediate use
            localStorage.setItem(`aircraft_${code}`, name);
            
            // Refresh the page to show updated names
            location.reload();
        } else {
            alert('Failed to submit aircraft type. Please try again.');
        }
    } catch (error) {
        console.error('Error submitting aircraft type:', error);
        alert('Error submitting aircraft type. Please check logs.');
    }
}

// Modal Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('aircraft-modal');
    const closeBtn = document.querySelector('.modal-close');
    const submitBtn = document.getElementById('submit-aircraft');
    const cancelBtn = document.getElementById('cancel-aircraft');
    
    // Close modal on X click
    if (closeBtn) {
        closeBtn.addEventListener('click', hideAircraftModal);
    }
    
    // Close modal on cancel
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideAircraftModal);
    }
    
    // Submit aircraft type
    if (submitBtn) {
        submitBtn.addEventListener('click', submitAircraftType);
    }
    
    // Close modal on outside click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideAircraftModal();
            }
        });
    }
    
    // Submit on Enter key
    document.getElementById('aircraft-name')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitAircraftType();
        }
    });
});

// Make aircraft types clickable in banners
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('clickable-aircraft-type')) {
        const aircraftCode = e.target.dataset.code;
        if (aircraftCode && aircraftCode.length <= 6) {
            // Only show modal if it looks like an unknown code (all caps, short)
            if (aircraftCode === aircraftCode.toUpperCase() && !/\s/.test(aircraftCode)) {
                showAircraftModal(aircraftCode);
            }
        }
    }
});

// Initialize
// Haversine Distance Calculation - for test mode
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in miles
}

// Test Data Generator - Creates a full page of diverse test flights
function loadTestData() {
    // Generate ETAs (30 min to 3 hours from now)
    const now = new Date();
    const generateETA = (minutesFromNow) => {
        const eta = new Date(now.getTime() + minutesFromNow * 60000);
        return eta.toISOString();
    };
    
    const testFlights = [
        // Major US Airlines
        { icao24: 'a12345', callsign: 'UAL904  ', altitude: 10668, velocity: 231.5, vertical_rate: 0, heading: 90, category: 3, on_ground: false, latitude: 40.70, longitude: -74.18, origin_country: 'United States', routeOrigin: 'KEWR', routeDestination: 'EGLL', aircraft_type: 'B763', eta: generateETA(120) },
        { icao24: 'b23456', callsign: 'DAL123  ', altitude: 9144, velocity: 205.2, vertical_rate: 3.048, heading: 180, category: 3, on_ground: false, latitude: 40.68, longitude: -74.20, origin_country: 'United States', routeOrigin: 'KJFK', routeDestination: 'KATL', aircraft_type: 'B738', eta: generateETA(45) },
        { icao24: 'c34567', callsign: 'AAL456  ', altitude: 11582, velocity: 246.8, vertical_rate: -2.438, heading: 270, category: 3, on_ground: false, latitude: 40.72, longitude: -74.15, origin_country: 'United States', routeOrigin: 'KBOS', routeDestination: 'KMIA', aircraft_type: 'A321', eta: generateETA(90) },
        { icao24: 'd45678', callsign: 'JBU789  ', altitude: 7620, velocity: 195.3, vertical_rate: 3.657, heading: 45, category: 3, on_ground: false, latitude: 40.65, longitude: -74.22, origin_country: 'United States', routeOrigin: 'KMCO', routeDestination: 'KJFK', aircraft_type: 'A320', eta: generateETA(35) },
        { icao24: 'e56789', callsign: 'SWA321  ', altitude: 10363, velocity: 220.1, vertical_rate: 0, heading: 135, category: 3, on_ground: false, latitude: 40.74, longitude: -74.12, origin_country: 'United States', routeOrigin: 'KLAS', routeDestination: 'KEWR', aircraft_type: 'B737', eta: generateETA(180) },
        
        // Budget Airlines
        { icao24: 'f67890', callsign: 'NKS2197 ', altitude: 8534, velocity: 198.7, vertical_rate: 5.08, heading: 195, category: 3, on_ground: false, latitude: 40.71, longitude: -74.17, origin_country: 'United States', routeOrigin: 'KFLL', routeDestination: 'KEWR', aircraft_type: 'A320', eta: generateETA(60) },
        { icao24: 'g78901', callsign: 'FFT1234 ', altitude: 9753, velocity: 210.5, vertical_rate: -1.524, heading: 315, category: 3, on_ground: false, latitude: 40.69, longitude: -74.19, origin_country: 'United States', routeOrigin: 'KDEN', routeDestination: 'KJFK', aircraft_type: 'A321', eta: generateETA(75) },
        
        // Regional/Commuter
        { icao24: 'h89012', callsign: 'RPA5709 ', altitude: 5182, velocity: 154.3, vertical_rate: 2.54, heading: 225, category: 3, on_ground: false, latitude: 40.66, longitude: -74.21, origin_country: 'United States', routeOrigin: 'KLGA', routeDestination: 'KDCA', aircraft_type: 'E75S', eta: generateETA(30) },
        { icao24: 'i90123', callsign: 'ENY3456 ', altitude: 4572, velocity: 145.2, vertical_rate: 3.048, heading: 60, category: 3, on_ground: false, latitude: 40.73, longitude: -74.14, origin_country: 'United States', routeOrigin: 'KBOS', routeDestination: 'KEWR', aircraft_type: 'E170', eta: generateETA(40) },
        { icao24: 'j01234', callsign: 'SKW7890 ', altitude: 6096, velocity: 167.8, vertical_rate: 0, heading: 120, category: 3, on_ground: false, latitude: 40.67, longitude: -74.16, origin_country: 'United States', routeOrigin: 'KORD', routeDestination: 'KLGA', aircraft_type: 'CRJ7', eta: generateETA(55) },
        
        // International
        { icao24: 'k12345', callsign: 'BAW117  ', altitude: 10972, velocity: 241.3, vertical_rate: 0, heading: 75, category: 4, on_ground: false, latitude: 40.75, longitude: -74.11, origin_country: 'United Kingdom', routeOrigin: 'EGLL', routeDestination: 'KJFK', aircraft_type: 'B77W', eta: generateETA(150) },
        { icao24: 'l23456', callsign: 'ACA865  ', altitude: 9449, velocity: 215.6, vertical_rate: -2.032, heading: 165, category: 3, on_ground: false, latitude: 40.71, longitude: -74.13, origin_country: 'Canada', routeOrigin: 'CYYZ', routeDestination: 'KEWR', aircraft_type: 'A321', eta: generateETA(50) },
        { icao24: 'm34567', callsign: 'WJA2174 ', altitude: 10973, velocity: 232.8, vertical_rate: 0, heading: 205, category: 3, on_ground: false, latitude: 40.73, longitude: -74.24, origin_country: 'Canada', routeOrigin: 'CYHZ', routeDestination: 'MMUN', aircraft_type: 'B738', eta: generateETA(95) },
        { icao24: 'n45678', callsign: 'AFR008  ', altitude: 11887, velocity: 254.7, vertical_rate: 0, heading: 90, category: 4, on_ground: false, latitude: 40.68, longitude: -74.23, origin_country: 'France', routeOrigin: 'LFPG', routeDestination: 'KJFK', aircraft_type: 'A359', eta: generateETA(135) },
        
        // Cargo
        { icao24: 'o56789', callsign: 'UPS2845 ', altitude: 8839, velocity: 201.3, vertical_rate: 1.016, heading: 270, category: 3, on_ground: false, latitude: 40.64, longitude: -74.18, origin_country: 'United States', routeOrigin: 'KSDF', routeDestination: 'KEWR', aircraft_type: 'B763', eta: generateETA(65) },
        { icao24: 'p67890', callsign: 'FDX1456 ', altitude: 10058, velocity: 218.9, vertical_rate: -3.048, heading: 180, category: 3, on_ground: false, latitude: 40.76, longitude: -74.10, origin_country: 'United States', routeOrigin: 'KMEM', routeDestination: 'KTEB', aircraft_type: 'B767', eta: generateETA(85) },
        
        // Low altitude (climbing/descending)
        { icao24: 'q78901', callsign: 'UAL1021 ', altitude: 2469, velocity: 128.6, vertical_rate: 9.56, heading: 191, category: 3, on_ground: false, latitude: 40.71, longitude: -74.23, origin_country: 'United States', routeOrigin: 'KEWR', routeDestination: 'MPTO', aircraft_type: 'B38M', eta: generateETA(110) },
        { icao24: 'r89012', callsign: 'AAL2312 ', altitude: 8845, velocity: 262.9, vertical_rate: 0, heading: 16, category: 3, on_ground: false, latitude: 40.73, longitude: -74.26, origin_country: 'United States', routeOrigin: 'KDCA', routeDestination: 'KBTV', aircraft_type: 'A319', eta: generateETA(42) },
        
        // High altitude cruise
        { icao24: 's90123', callsign: 'UAL886  ', altitude: 12192, velocity: 248.5, vertical_rate: 0, heading: 197, category: 3, on_ground: false, latitude: 40.71, longitude: -74.22, origin_country: 'United States', routeOrigin: 'KEWR', routeDestination: 'SPJC', aircraft_type: 'B752' },
        { icao24: 't01234', callsign: 'DAL2453 ', altitude: 11582, velocity: 235.7, vertical_rate: 0, heading: 45, category: 3, on_ground: false, latitude: 40.69, longitude: -74.25, origin_country: 'United States', routeOrigin: 'KSEA', routeDestination: 'KJFK', aircraft_type: 'A321' },
    ];
    
    // Calculate distances for test flights based on currentLocation
    const baseLat = currentLocation?.lat || 40.6895;
    const baseLon = currentLocation?.lon || -74.1745;
    testFlights.forEach(flight => {
        flight.detectedMiles = calculateDistance(baseLat, baseLon, flight.latitude, flight.longitude);
    });
    
    console.log(`[TEST MODE] Loading ${testFlights.length} test flights for UI testing...`);
    processFlights(testFlights);
}

// Check for test mode
// CSV Export Functionality
function exportHistoryToCSV() {
    if (flightHistory.length === 0) {
        alert('No flight history to export');
        return;
    }

    // CSV Headers
    const headers = ['Time', 'Airline', 'Callsign', 'Aircraft Type', 'Origin', 'Destination', 'Altitude (ft)', 'Speed (mph)', 'Vertical Rate (fpm)', 'Detected (mi)'];
    
    // Convert flight history to CSV rows
    const rows = flightHistory.map(flight => {
        return [
            flight.time || '',
            flight.airline || '',
            flight.callsign || '',
            flight.type || '',
            flight.origin || '',
            flight.dest || '',
            flight.alt || '',
            flight.speed || '',
            flight.vr || '',
            flight.detectedMiles ? flight.detectedMiles.toFixed(2) : ''
        ];
    });

    // Combine headers and rows
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    // Generate filename with current date/time
    const now = new Date();
    const filename = `flighttrak_history_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log(`[Export] Exported ${flightHistory.length} flights to ${filename}`);
}

// Attach export button event listener
document.getElementById('export-csv').addEventListener('click', exportHistoryToCSV);

// Attach search box event listener
document.getElementById('history-search').addEventListener('input', (e) => {
    filterHistory(e.target.value);
});

const urlParams = new URLSearchParams(window.location.search);
const isTestMode = urlParams.get('test') === 'true';

if (isTestMode) {
    console.log('[TEST MODE] Enabled - API polling disabled. Press T to load test data');
    
    // Load config even in test mode (needed for altitude filtering and UI updates)
    fetchConfig();
    fetchCost();
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 't' || e.key === 'T') {
            loadTestData();
        }
    });
} else {
    // Normal mode - start API polling
    fetchConfig();
    fetchCost();
    setInterval(fetchCost, 30000);
    
    // Poll config every 30 seconds to detect server-side provider changes (e.g., hybrid mode auto-switch)
    setInterval(fetchConfig, 30000);
}
