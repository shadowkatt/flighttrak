# FR24 Temporary Mode - Revert Instructions

**Date Implemented**: January 31, 2026 ~12:50 AM EST  
**Reason**: OpenSky API rate-limited for ~19 hours due to excessive requests (now fixed)  
**Duration**: Temporary until OpenSky backoff expires (~7:48 PM EST today)

## What Changed

### 1. Environment Variables (`.env`)
- **Added**: `USE_FR24_FOR_FLIGHT_LIST=true`
- **Changed**: `POLL_INTERVAL=30000` → `POLL_INTERVAL=60000` (30s → 60s)

### 2. Server Code (`server.js`)

#### Lines 16-19: Added FR24 Toggle Constant
```javascript
// TEMPORARY FR24 TOGGLE - Set to true to use FR24 instead of OpenSky for flight list
// REVERT: Change back to false after OpenSky backoff expires (~19 hours)
const USE_FR24_FOR_FLIGHT_LIST = process.env.USE_FR24_FOR_FLIGHT_LIST === 'true' || false;
```

#### Lines 717-810: Added FR24 Flight List Function
```javascript
// TEMPORARY FR24 FUNCTION - Fetch all flights in area using FR24
// REVERT: Remove this entire function when switching back to OpenSky
async function fetchFlightsFromFR24(lat, lon, offset) {
    // ... complete function ~95 lines ...
}
```

#### Lines 869-910: Added FR24 Route in `/api/flights` Endpoint
```javascript
// TEMPORARY FR24 TOGGLE - Use FR24 instead of OpenSky when enabled
// REVERT: Remove this entire if block when switching back to OpenSky
if (USE_FR24_FOR_FLIGHT_LIST && FLIGHTRADAR24_ENABLED) {
    // ... FR24 logic ~40 lines ...
    return; // Exit early, don't use OpenSky
}
// END TEMPORARY FR24 TOGGLE
```

#### Lines 1480-1492: Added Startup Warning Banner
```javascript
// TEMPORARY FR24 TOGGLE - Log when FR24 mode is active
// REVERT: Remove this block when switching back to OpenSky
if (USE_FR24_FOR_FLIGHT_LIST && FLIGHTRADAR24_ENABLED) {
    // ... banner display ...
}
// END TEMPORARY FR24 TOGGLE
```

## How to Revert (After OpenSky Backoff Expires)

### Method 1: Quick Revert (Recommended)
```bash
cd /Volumes/External/Docker/flighttrak

# 1. Disable FR24 mode
sed -i '' 's/USE_FR24_FOR_FLIGHT_LIST=true/USE_FR24_FOR_FLIGHT_LIST=false/' .env

# 2. Set poll interval back to 30 seconds (optional)
sed -i '' 's/POLL_INTERVAL=60000/POLL_INTERVAL=30000/' .env

# 3. Restart service
docker-compose restart
```

### Method 2: Clean Revert (Remove All Changes)

1. **Remove from `.env`**:
   - Delete lines containing `USE_FR24_FOR_FLIGHT_LIST`
   - Change `POLL_INTERVAL=60000` back to `POLL_INTERVAL=30000`

2. **Remove from `server.js`**:
   - Search for `TEMPORARY` comments
   - Remove all code blocks marked with:
     - `// TEMPORARY FR24 TOGGLE`
     - `// REVERT:`
   
3. **Restart**:
   ```bash
   docker-compose restart
   ```

## FR24 Mode Benefits (Temporary)

1. ✅ **Single API Call** - FR24 provides flight list + details in ONE call (no secondary lookups needed)
2. ✅ **Includes Route Data** - Origin, destination, aircraft type all included
3. ✅ **Full Details** - Airline codes, flight numbers, etc.
4. ✅ **No Rate Limit Issues** - FR24 has 10 calls/min limit (vs OpenSky's current 0)

## FR24 Mode Costs

- **Credits per call**: 936 credits
- **Plan limit**: 30,000 credits/month
- **At 60s intervals**: ~1,440 calls/day = 1,350,720 credits/day
  - ⚠️ **This will exceed your monthly limit in ~20 hours!**
- **Recommended**: Use only during OpenSky backoff, then switch back

## Current Status

- ✅ FR24 mode enabled
- ✅ Poll interval set to 60 seconds
- ⚠️ Monitor FR24 credit usage in logs
- ⏱ OpenSky backoff expires: ~January 31, 2026 7:48 PM EST

## Testing the Change

1. Check startup logs for FR24 banner:
   ```bash
   docker logs flighttrak-flighttrak-1 --tail 50
   ```

2. Look for:
   ```
   [FR24] Using Flightradar24 for flight list (temporary override)
   [FR24] Fetching flights in area...
   [FR24] Credits: 936 used, total: X/30000
   ```

3. Verify flights have `routeOrigin`, `routeDestination`, `aircraft_type` already populated

4. Monitor credit usage - should stay under 30,000

## Notes

- All changes are clearly marked with `TEMPORARY` and `REVERT` comments
- Original OpenSky code is untouched, just bypassed when toggle is enabled
- FR24 data is mapped to OpenSky-compatible format for UI compatibility
- Commercial airline filter still applies
- Caching still works (60-second cache duration)
- Request deduplication still active

## Questions?

- FR24 API docs: https://fr24api.flightradar24.com/docs
- OpenSky backoff status: Check `/api/config` endpoint → `openskyRateLimit` object



