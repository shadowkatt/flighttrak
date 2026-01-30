const flightContainer = document.getElementById('flight-container');
const emptyState = document.getElementById('empty-state');
const trafficCount = document.getElementById('traffic-count');

// Banner & History Elements
const bannerGrid = document.getElementById('banner-grid');
const historyLogBody = document.getElementById('history-log-body');

// State
let activeFlights = new Map(); // Store currently active flights by icao24
let bannerFlights = []; // Flights to show in banner grid
let bannerFlightIds = new Set(); // Track which flights have been added to banner
const MAX_BANNER_CARDS = 5; // Maximum banner cards to show (reduced for larger display)
let flightHistory = []; // Store list of recent unique flights
const MAX_HISTORY = 10;
let ALTITUDE_THRESHOLD_FEET = 5000; // Default, will be loaded from config
let availableProviders = {}; // Track which API providers are available
let activeProvider = 'flightradar24'; // Current active enhanced provider (only ONE at a time)



// Category Map
const aircraftCategories = {
    0: 'No Info', 1: 'No Info', 2: 'Light', 3: 'Small', 4: 'Large', 5: 'High Vortex', 6: 'Heavy',
    7: 'High Perf', 8: 'Rotorcraft', 9: 'Glider', 10: 'Lighter-than-air', 11: 'Parachutist',
    12: 'Ultralight', 13: 'UAV', 14: 'Space', 15: 'Unspec', 16: 'Service', 17: 'Obstacle', 18: 'Vant', 19: 'Other'
};

function getAirlineLogo(callsign) {
    if (!callsign || callsign.length < 3) return '';
    // Assume first 3 chars are ICAO airline code (e.g., UAL from UAL123)
    const airlineCode = callsign.substring(0, 3).toUpperCase();
    // Using raw.githubusercontent for direct image access
    return `https://raw.githubusercontent.com/Jxck-S/airline-logos/main/flightaware_logos/${airlineCode}.png`;
}

async function fetchFlights() {
    try {
        const response = await fetch('/api/flights');
        if (!response.ok) throw new Error('Network response was not ok');

        const flights = await response.json();
        processFlights(flights);
    } catch (error) {
        console.error('Error fetching flights:', error);
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
            
            // Filter: Only log flights above altitude threshold
            const altitudeFeet = flight.altitude * 3.28084; // Convert meters to feet
            if (altitudeFeet < ALTITUDE_THRESHOLD_FEET) {
                console.log(`[Filter] Skipping ${flight.callsign || flight.icao24} - ${Math.round(altitudeFeet)} ft (below ${ALTITUDE_THRESHOLD_FEET} ft)`);
                // Still track it, but don't show popup/banner/history
                activeFlights.set(flight.icao24, flight);
                return; // Skip to next flight
            }

            // Enrich with Route Data (Async)
            fetchRouteData(flight).then(route => {
                // Update local flight object with route info
                flight.routeOrigin = route.origin;
                flight.routeDestination = route.destination;
                if (route.aircraft_type) {
                    flight.aircraft_type = route.aircraft_type;
                }

                // Check if N-designated (general aviation)
                const isGeneralAviation = flight.callsign && flight.callsign.startsWith('N');
                
                // Show popup and banner only for commercial flights
                if (!isGeneralAviation) {
                    showFlightPopup(flight);
                    addToBanner(flight);
                }
                
                // Always add to history (including N-designated)
                addToHistory(flight);
            });
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

    // Update traffic count
    if (trafficCount) {
        trafficCount.textContent = flights.length;
    }

    // 2. Render Main Grid - DISABLED to save space on TV

    // renderGrid(flights);

    // 3. Update Traffic Count
    trafficCount.textContent = flights.length;

    // 4. Update Banner Grid
    renderBannerGrid();

    // ... (rest of function)
}

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
        const response = await fetch(url);
        if (!response.ok) return { origin: null, destination: null, aircraft_type: null };
        return await response.json();
    } catch (e) {
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

        // Resolve Airport/Country Names using helper functions from data.js
        // If routeOrigin is an ICAO code (4 chars), try to resolve it. If it's a country, leave it.
        let originText = flight.origin_country;
        if (flight.routeOrigin) {
            originText = getAirportName(flight.routeOrigin) || flight.routeOrigin;
        }

        const destText = flight.routeDestination ? getAirportName(flight.routeDestination) || flight.routeDestination : '---';

        const logoUrl = getAirlineLogo(callsign);
        const category = aircraftCategories[flight.category] || '';

        return `
            <div class="flight-card">
                <div class="card-header">
                    <div>
                        <div class="callsign">
                            ${logoUrl ? `<img src="${logoUrl}" class="airline-logo-card" onerror="this.style.display='none'">` : ''}
                            ${displayCallsign}
                        </div>
                        <div style="font-size:0.8rem; color:#888; margin-bottom:4px;">${getAirlineName(callsign)}</div>
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

function showFlightPopup(flight) {
    console.log('[Popup] Showing new flight popup for:', flight.callsign || flight.icao24);

    // Remove existing popup if present
    if (currentPopup) {
        currentPopup.remove();
    }

    const callsign = flight.callsign || flight.icao24;
    const logoUrl = getAirlineLogo(callsign);

    // Resolve airport names
    const safeGetAirportName = (code) => {
        if (typeof getAirportName === 'function') {
            return getAirportName(code);
        }
        return code;
    };

    const origin = flight.routeOrigin ? (safeGetAirportName(flight.routeOrigin) || flight.routeOrigin) : (flight.origin_country || 'UNKNOWN');
    const dest = flight.routeDestination ? (safeGetAirportName(flight.routeDestination) || flight.routeDestination) : '---';

    // Strip airport codes for display
    const originCity = origin.includes('(') ? origin.replace(/\s*\([^)]*\)/, '') : origin;
    const destCity = dest.includes('(') ? dest.replace(/\s*\([^)]*\)/, '') : dest;

    // Get aircraft type
    const category = aircraftCategories[flight.category] || '';
    const rawType = flight.aircraft_type || category || '';
    const aircraftInfo = typeof getAircraftTypeName !== 'undefined' ? getAircraftTypeName(rawType) : rawType;

    // Create popup element
    const popup = document.createElement('div');
    popup.className = 'flight-popup';
    popup.innerHTML = `
        <div class="flight-popup-header">✈ NEW FLIGHT DETECTED</div>
        <div class="flight-popup-content">
            <div class="flight-popup-logo">
                ${logoUrl ? `<img src="${logoUrl}" onerror="this.style.display='none'">` : ''}
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

    // Auto-remove after 10 seconds
    setTimeout(() => {
        popup.classList.add('fade-out');
        setTimeout(() => {
            if (popup.parentNode) {
                popup.remove();
            }
            if (currentPopup === popup) {
                currentPopup = null;
            }
        }, 400); // Match fade-out animation duration
    }, 10000);
}

// Banner Grid Functions
function addToBanner(flight) {
    // Skip flights without callsign
    if (!flight.callsign) return;
    
    // Skip N-designated planes (general aviation)
    if (flight.callsign.startsWith('N')) {
        console.log(`[Banner] Skipping N-designated aircraft: ${flight.callsign}`);
        return;
    }

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

    bannerGrid.innerHTML = bannerFlights.map(flight => {
        const altFt = Math.round(flight.altitude * 3.28084);
        const speedMph = Math.round(flight.velocity * 2.237);
        const vrFpm = Math.round((flight.vertical_rate || 0) * 196.85);
        const callsign = flight.callsign || flight.icao24;
        const logoUrl = getAirlineLogo(callsign);
        const airlineName = getAirlineName(callsign);
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

        const origin = flight.routeOrigin ? (safeGetAirportName(flight.routeOrigin) || flight.routeOrigin) : (flight.origin_country || 'UNKNOWN');
        const dest = flight.routeDestination ? (safeGetAirportName(flight.routeDestination) || flight.routeDestination) : '---';

        // Strip airport codes for banner display: "London (LHR)" → "London"
        // If no match found, it returns the raw code (e.g., "KEWR"), so we keep it as-is
        const originCity = origin.includes('(') ? origin.replace(/\s*\([^)]*\)/, '') : origin;
        const destCity = dest.includes('(') ? dest.replace(/\s*\([^)]*\)/, '') : dest;

        // Vertical rate indicator
        const vrIndicator = vrFpm > 500 ? '↗' : vrFpm < -500 ? '↘' : '→';

        // Aircraft type or category - translate codes to full names
        const rawType = flight.aircraft_type || category || '';
        const aircraftInfo = typeof getAircraftTypeName !== 'undefined' ? getAircraftTypeName(rawType) : rawType;
        
        // Check if aircraft type is unknown (code matches the display name)
        const isUnknown = rawType && rawType === aircraftInfo && rawType.length <= 6;

        return `
            <div class="banner-card">
                <div class="airline-logo-container">
                    ${logoUrl ? `<img src="${logoUrl}" class="airline-logo-banner" onerror="this.style.display='none'">` : ''}
                </div>
                <div class="banner-info">
                    <div class="banner-callsign">${callsign}</div>
                    ${airlineName ? `<div class="banner-airline">${airlineName}</div>` : ''}
                </div>
                <div class="banner-route">${originCity} → ${destCity}</div>
                <div class="banner-type ${isUnknown ? 'clickable-aircraft-type' : ''}" 
                     data-code="${rawType}" 
                     title="${isUnknown ? 'Click to identify this aircraft type' : aircraftInfo}">
                    ${aircraftInfo}${isUnknown ? ' ❓' : ''}
                </div>
                <div class="banner-metrics">
                    <span>${altFt.toLocaleString()} FT ${vrIndicator}</span>
                    <span>${speedMph} MPH ${direction}</span>
                </div>
            </div>
        `;
    }).join('');
}

function addToHistory(flight) {
    const altFt = Math.round(flight.altitude * 3.28084);
    const speedMph = Math.round(flight.velocity * 2.237);
    const vrFpm = Math.round((flight.vertical_rate || 0) * 196.85);
    const callsign = flight.callsign || flight.icao24;
    const logoUrl = getAirlineLogo(callsign);

    // Prefer Route Origin/Dest
    const safeGetAirportName = (code) => {
        if (typeof getAirportName === 'function') {
            return getAirportName(code);
        }
        return code;
    };

    const origin = flight.routeOrigin ? (safeGetAirportName(flight.routeOrigin) || flight.routeOrigin) : (flight.origin_country || 'Unknown');
    const dest = flight.routeDestination ? (safeGetAirportName(flight.routeDestination) || flight.routeDestination) : '---';


    const logEntry = {
        time: flight.time_position ? new Date(flight.time_position * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date().toLocaleTimeString(),
        callsign: callsign,
        displayCallsign: callsign && callsign.length > 2 ? callsign : `<span style="opacity:0.5; font-size:0.9em">Hex: ${flight.icao24}</span>`,
        origin: origin,
        dest: dest,
        alt: altFt,
        speed: speedMph,
        vr: vrFpm,
        logo: logoUrl,
        airline: getAirlineName(callsign),
        type: flight.aircraft_type || aircraftCategories[flight.category] || 'N/A'
    };

    // Add to front
    flightHistory.unshift(logEntry);

    // Trim
    if (flightHistory.length > MAX_HISTORY) {
        flightHistory.pop();
    }

    renderHistory();
}

function renderHistory() {
    historyLogBody.innerHTML = flightHistory.map(entry => `
        <tr>
            <td data-label="TIME">${entry.time}</td>
            <td data-label="AIRLINE" style="color:#aaa;">${entry.airline || '-'}</td>
            <td data-label="CALLSIGN">
                <div class="table-logo-container">
                    ${entry.logo ? `<img src="${entry.logo}" class="airline-logo-sm" onerror="this.style.display='none'">` : ''}
                </div>
                <strong>${entry.displayCallsign}</strong>
            </td>
            <td data-label="TYPE" style="color:#888;">${entry.type}</td>
            <td data-label="ORIGIN">${entry.origin}</td>
            <td data-label="DEST">${entry.dest}</td>
            <td data-label="ALTITUDE">${entry.alt.toLocaleString()}</td>
            <td data-label="SPEED">${entry.speed}</td>
            <td data-label="VR">${entry.vr}</td>
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
        document.getElementById('api-cost').textContent = data.total;
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

        document.getElementById('os-calls').textContent = data.opensky_calls || 0;

        // Show ONLY the active provider's stats
        const faStats = document.getElementById('fa-stats');
        const fr24Stats = document.getElementById('fr24-stats');
        
        if (activeProvider === 'flightaware' && availableProviders.flightaware) {
            faStats.style.display = '';
            fr24Stats.style.display = 'none';
            document.getElementById('fa-calls').textContent = data.flightaware_calls || 0;
            document.getElementById('fa-cost').textContent = data.flightaware || '0.00';
        } else if (activeProvider === 'flightradar24' && availableProviders.flightradar24) {
            faStats.style.display = 'none';
            fr24Stats.style.display = '';
            document.getElementById('fr24-calls').textContent = data.flightradar24_calls || 0;
            const creditsUsed = data.flightradar24_credits_used || 0;
            const creditsRemaining = data.flightradar24_credits_remaining || 0;
            document.getElementById('fr24-credits').textContent = `${creditsUsed}/${creditsUsed + creditsRemaining}`;
        } else {
            // No enhanced provider active
            faStats.style.display = 'none';
            fr24Stats.style.display = 'none';
        }

        if (data.reset_date) {
            const resetDate = new Date(data.reset_date);
            document.getElementById('reset-date').textContent = resetDate.toLocaleDateString();
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
        activeProvider = config.activeEnhancedProvider || 'flightradar24';
        
        // Store hybrid mode status
        const hybridMode = config.hybridMode || false;
        
        // Update altitude threshold based on active provider
        updateAltitudeDisplay(config);
        
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

        // Start polling with configured interval
        const interval = config.pollInterval || 10000;
        console.log(`Setting poll interval to ${interval}ms`);
        fetchFlights(); // Initial fetch
        setInterval(fetchFlights, interval);

    } catch (e) {
        console.error('Failed to fetch config', e);
        // Fallback
        fetchFlights();
        setInterval(fetchFlights, 10000);
    }
}

// Update altitude display based on active provider
function updateAltitudeDisplay(config) {
    if (activeProvider === 'flightaware') {
        ALTITUDE_THRESHOLD_FEET = config.flightawareLookupAltitudeFeet || 2000;
    } else if (activeProvider === 'flightradar24') {
        ALTITUDE_THRESHOLD_FEET = config.flightradar24LookupAltitudeFeet || 2000;
    }
    console.log(`[Config] Altitude threshold set to ${ALTITUDE_THRESHOLD_FEET} ft (${activeProvider})`);
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
    if (e.target.classList.contains('banner-type') || e.target.classList.contains('clickable-aircraft-type')) {
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
// Test Data Generator
function loadTestData() {
    const testFlights = [
        { icao24: 'a12345', callsign: 'UAL904  ', altitude: 762, velocity: 77.16, vertical_rate: 1.524, heading: 90, category: 3, on_ground: false, latitude: 40.70, longitude: -74.18, origin_country: 'United States', routeOrigin: 'KEWR', routeDestination: 'EGLL', aircraft_type: 'B763' },
        { icao24: 'b23456', callsign: 'DAL123  ', altitude: 1066.8, velocity: 102.92, vertical_rate: 3.048, heading: 180, category: 3, on_ground: false, latitude: 40.68, longitude: -74.20, origin_country: 'United States', routeOrigin: 'KJFK', routeDestination: 'KATL', aircraft_type: 'B738' },
        { icao24: 'c34567', callsign: 'AAL456  ', altitude: 1280.16, velocity: 92.64, vertical_rate: -2.438, heading: 270, category: 3, on_ground: false, latitude: 40.72, longitude: -74.15, origin_country: 'United States', routeOrigin: 'KBOS', routeDestination: 'KEWR', aircraft_type: 'A320' },
        { icao24: 'd45678', callsign: 'JBU789  ', altitude: 548.64, velocity: 66.82, vertical_rate: 3.657, heading: 45, category: 3, on_ground: false, latitude: 40.65, longitude: -74.22, origin_country: 'United States', routeOrigin: 'KMCO', routeDestination: 'KEWR', aircraft_type: 'A321' },
        { icao24: 'e56789', callsign: 'SWA321  ', altitude: 1554.48, velocity: 113.14, vertical_rate: 0, heading: 135, category: 3, on_ground: false, latitude: 40.74, longitude: -74.12, origin_country: 'United States', routeOrigin: 'KLAS', routeDestination: 'KEWR', aircraft_type: 'B737' },
    ];
    
    console.log('[TEST] Loading 5 test flights...');
    processFlights(testFlights);
}

// Check for test mode
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('test') === 'true') {
    console.log('[TEST MODE] Press T to load test data');
    document.addEventListener('keydown', (e) => {
        if (e.key === 't' || e.key === 'T') {
            loadTestData();
        }
    });
}

fetchConfig();
fetchCost();
setInterval(fetchCost, 30000);
