# ADSBexchange Debug Mode

**Date Implemented**: January 31, 2026 ~1:10 AM EST  
**Reason**: Enable continued debugging/development during OpenSky rate limit backoff  
**Duration**: Temporary - use while OpenSky is rate-limited

## Purpose

ADSBexchange integration allows you to continue developing and debugging FlightTrak while OpenSky is in rate limit backoff. It's a drop-in replacement that provides the same flight position data.

## Setup

### 1. Get RapidAPI Key

1. Go to [ADSBexchange on RapidAPI](https://rapidapi.com/adsbx/api/adsbexchange-com1)
2. Sign up for a RapidAPI account (if you don't have one)
3. Subscribe to a plan:
   - **Basic (Free)**: ~500 requests/month - good for light testing
   - **Pro (~$10-20/month)**: 10K-50K requests/month - good for debugging sessions
   - Choose based on your testing needs

4. Copy your RapidAPI key from the dashboard

### 2. Add to `.env`

Add these two lines to your `.env` file:

```bash
# ADSBexchange via RapidAPI - TEMPORARY for debugging
USE_ADSB=true
RAPIDAPI_KEY=your_rapidapi_key_here
```

### 3. Restart Service

```bash
cd /Volumes/External/Docker/flighttrak
docker-compose restart
```

## How It Works

When `USE_ADSB=true`:
- ✅ ADSBexchange replaces OpenSky for the main flight list
- ✅ Same geographic area search (lat/lon bounds)
- ✅ Data mapped to OpenSky-compatible format
- ✅ Includes aircraft type (bonus!)
- ✅ All existing caching, deduplication, and filtering still works
- ✅ Commercial airline filter still applies

When `USE_ADSB=false` or not set:
- ✅ Defaults back to OpenSky (normal operation)

## Data Comparison

| Feature | OpenSky | ADSBexchange |
|---------|---------|--------------|
| Position (lat/lon) | ✅ | ✅ |
| Altitude | ✅ | ✅ |
| Speed/Heading | ✅ | ✅ |
| Callsign | ✅ | ✅ |
| Aircraft Type | ❌ | ✅ |
| Registration | ❌ | ✅ |
| Origin/Dest | ❌ (requires lookup) | ❌ (requires lookup) |
| Rate Limits | 400/min (auth) | Plan-dependent |
| Cost | FREE | ~$10-20/month (Pro plan) |

## Usage Calculation

At 30-second poll intervals (default):
```
2 calls/minute × 60 minutes = 120 calls/hour
120 calls/hour × 24 hours = 2,880 calls/day

For testing session:
- 1 hour = 120 calls
- 4 hours = 480 calls
- 8 hours = 960 calls
```

**Free tier (500 calls/month)** = ~4 hours of debugging time  
**Pro tier (10K calls/month)** = ~83 hours of debugging time

## Benefits for Debugging

1. **Continue Development** - No waiting 18+ hours for OpenSky backoff
2. **Test UI Changes** - See real flight data while styling/debugging
3. **Validate Fixes** - Ensure all the deduplication/caching fixes work
4. **Aircraft Type Included** - Less API calls needed for complete data
5. **Easy Toggle** - Switch between providers with one env variable

## Reverting to OpenSky

### Quick Disable (Keep Config)
```bash
cd /Volumes/External/Docker/flighttrak
sed -i '' 's/USE_ADSB=true/USE_ADSB=false/' .env
docker-compose restart
```

### Complete Removal
1. Remove from `.env`:
   - Delete `USE_ADSB=true` line
   - Delete `RAPIDAPI_KEY=...` line (or keep for future use)

2. Restart:
   ```bash
   docker-compose restart
   ```

## Code Changes Summary

All changes are marked with `TEMPORARY ADSB` and `REVERT` comments:

1. **Line ~96**: Added `ADSBEXCHANGE_ENABLED` constant
2. **Lines ~820-905**: Added `fetchFlightsFromADSB()` function
3. **Lines ~965-1006**: Added ADSB route in `/api/flights` endpoint
4. **Lines ~1530-1541**: Added startup banner for ADSB mode

## Testing

After enabling, check logs for:
```
[ADSBexchange] Using ADSBexchange for flight list (temporary debugging mode)
[ADSBexchange] Fetching flights in area...
[ADSBexchange] Received X flights
[ADSBexchange] Successfully fetched and cached X flights
```

Verify in UI:
- Flights appear on map
- Callsigns display
- Altitude/speed update
- Aircraft types shown (if available)
- Updates every 30 seconds

## Troubleshooting

### "Error: Request failed with status code 403"
- Check your RAPIDAPI_KEY is correct
- Verify you're subscribed to a plan on RapidAPI
- Ensure the key has permissions for ADSBexchange API

### "Error: Request failed with status code 429"
- You've exceeded your RapidAPI plan limit
- Increase poll interval or upgrade plan
- Wait for monthly limit reset

### No flights showing
- Check your geographic area has flights (use FlightAware/FR24 to verify)
- Verify lat/lon coordinates in `.env` are correct
- Check commercial airline filter isn't too restrictive

## Cost Warning

⚠️ **Be mindful of your RapidAPI plan limits!**

At default 30-second intervals:
- Free tier (500 calls) = ~4 hours
- Pro tier (10K calls) = ~83 hours

Consider increasing poll interval for longer sessions:
```bash
# In .env - 2 minute intervals instead of 30 seconds
POLL_INTERVAL=120000
```

## Notes

- This is a **debugging tool**, not a permanent solution
- OpenSky remains the primary/free provider
- ADSBexchange has excellent coverage and reliability
- Data quality is comparable to or better than OpenSky
- No changes needed to UI - data format is compatible
- Can be kept as a backup provider long-term if desired

## Links

- [ADSBexchange API Docs](https://rapidapi.com/adsbx/api/adsbexchange-com1)
- [RapidAPI Dashboard](https://rapidapi.com/developer/dashboard)
- [ADSBexchange Website](https://www.adsbexchange.com/)



