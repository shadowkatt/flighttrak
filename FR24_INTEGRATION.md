# Flightradar24 API Integration Guide

## Overview

FlightTrak now supports **hybrid API mode**, allowing you to use multiple flight data providers simultaneously:

- **OpenSky Network** (Free): Live flight positions for all aircraft
- **Flightradar24** (Paid): Enhanced flight details, routes, aircraft types
- **FlightAware** (Paid): Alternative/additional enhanced flight data

## Why Flightradar24?

### Advantages over FlightAware

1. **Predictable Pricing**
   - FR24: $9/month flat rate (30K credits)
   - FlightAware: Pay-per-call (~$3-15/month, variable)

2. **Higher Rate Limits**
   - FR24: 10 calls/minute
   - FlightAware: 5 calls/minute

3. **Better Global Coverage**
   - FR24: Excellent worldwide coverage
   - FlightAware: Best for US flights

4. **Comprehensive Data**
   - Origin/destination airports (ICAO codes)
   - Aircraft type and registration
   - Airline information
   - Real-time position data

### FR24 API Plans

| Plan | Cost | Credits | Rate Limit | Response Limit | Historic Data |
|------|------|---------|------------|----------------|---------------|
| Explorer | $9/month | 30,000 | 10 req/min | 20 items | 30 days |
| Essential | $90/month | 333,000 | 30 req/min | 300 items | 2 years |

**Recommendation**: Start with Explorer plan. 30K credits is sufficient for typical home flight tracking.

## Setup Instructions

### 1. Get FR24 API Key

1. Visit [https://fr24api.flightradar24.com/](https://fr24api.flightradar24.com/)
2. Click "Subscribe" and choose Explorer plan ($9/month)
3. Complete registration and payment
4. Navigate to your dashboard
5. Copy your API key (Bearer token)

### 2. Test in Sandbox (Optional)

FR24 provides a free sandbox environment for testing:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://fr24api.flightradar24.com/api/v1/live/flight-positions/full?callsign=UAL123"
```

### 3. Update .env File

Add these lines to your `.env` file:

```bash
# Flightradar24 API
FLIGHTRADAR24_API_KEY=your_actual_fr24_api_key_here
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=2000
```

### 4. Restart FlightTrak

```bash
docker-compose restart
```

### 5. Verify Setup

Check the logs to confirm FR24 is enabled:

```bash
docker-compose logs | grep "Flightradar24"
```

You should see:
```
Flightradar24: ✓ ENABLED
  Altitude Filter: 2000 ft
  Rate Limit: 10 calls/min
```

## Using the Hybrid API System

### UI Controls

In the FlightTrak dashboard header, you'll see an **API** dropdown selector:

- **FR24**: Use Flightradar24 for enhanced lookups
- **FA**: Use FlightAware for enhanced lookups

**How to Use:**
1. Click the dropdown
2. Hold Ctrl (Windows/Linux) or Cmd (Mac)
3. Click to select/deselect APIs
4. Selected APIs are queried in order until data is found

### API Priority Examples

**Configuration 1: FR24 Only**
```
Selected: [FR24]
Behavior: All enhanced lookups use Flightradar24
Best For: Predictable costs, global coverage
```

**Configuration 2: FR24 + FlightAware**
```
Selected: [FR24, FA]
Behavior: Try FR24 first, fallback to FlightAware if no data
Best For: Maximum data availability and redundancy
```

**Configuration 3: FlightAware Only**
```
Selected: [FA]
Behavior: All enhanced lookups use FlightAware
Best For: US-focused tracking, existing FA subscription
```

**Configuration 4: Free Mode**
```
Selected: []
Behavior: Only OpenSky data (no enhanced lookups)
Best For: Zero cost operation
```

## Cost Management

### Understanding FR24 Credits

Each API call consumes credits based on the endpoint and response size:

- **Light flight positions**: ~1-5 credits per call
- **Full flight positions**: ~10-20 credits per call
- **Historic data**: Varies by time range

### Optimizing Credit Usage

1. **Altitude Filtering** (Most Effective)
   ```bash
   FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=3000  # Higher = fewer lookups
   ```
   - 2000 ft: Balanced (default)
   - 3000 ft: Conservative (fewer credits)
   - 1000 ft: Aggressive (more credits)

2. **Search Radius**
   ```bash
   SEARCH_RADIUS_MILES=3  # Smaller = fewer flights
   ```

3. **Poll Interval**
   ```bash
   POLL_INTERVAL=60000  # Longer = fewer updates
   ```

4. **Hybrid Strategy**
   - Use FR24 for most flights
   - Add FlightAware for redundancy
   - System caches results for 4 hours

### Monitoring Usage

The dashboard footer shows real-time FR24 usage:

```
FR24: 145 calls (1,234/30,000 credits)
```

- **145 calls**: Number of API requests made
- **1,234/30,000**: Credits used / total credits
- Credits reset monthly on your billing date

### Estimated Usage

Based on typical configurations:

| Config | Flights/Day | Credits/Month | Within 30K? |
|--------|-------------|---------------|-------------|
| Conservative (3000ft, 3mi, 60s) | 20-30 | ~5,000 | ✓ Yes |
| Balanced (2000ft, 5mi, 30s) | 40-60 | ~15,000 | ✓ Yes |
| Aggressive (1000ft, 10mi, 10s) | 100+ | ~35,000 | ✗ Upgrade needed |

## API Response Data

### What FR24 Provides

FlightTrak extracts and displays:

```javascript
{
  origin: "KJFK",              // Origin airport (ICAO)
  destination: "EGLL",         // Destination airport (ICAO)
  aircraft_type: "B77W",       // Aircraft type code
  airline: "British Airways",  // Airline name
  aircraft_registration: "G-STBC", // Aircraft registration
  source: "flightradar24"      // Data source identifier
}
```

### Data Display

This information appears in:
- **Flight popup notifications**: "NEW FLIGHT DETECTED"
- **Banner cards**: Persistent flight cards at top
- **History log**: Recent traffic table
- **Tooltips**: Hover over flights for details

## Troubleshooting

### Issue: No enhanced data showing

**Symptoms**: Flights appear but no routes/aircraft types

**Solutions**:
1. Verify API key in `.env`:
   ```bash
   grep FLIGHTRADAR24_API_KEY .env
   ```

2. Check API is selected in UI dropdown

3. Verify altitude filter:
   ```bash
   docker-compose logs | grep "Altitude threshold"
   ```

4. Check for API errors:
   ```bash
   docker-compose logs | grep "Flightradar24"
   ```

### Issue: Credits depleting too fast

**Symptoms**: Approaching 30K limit mid-month

**Solutions**:
1. Increase altitude filter:
   ```bash
   FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=3500
   ```

2. Reduce search radius:
   ```bash
   SEARCH_RADIUS_MILES=3
   ```

3. Use hybrid mode (FR24 + FA) to distribute load

4. Check for unnecessary calls:
   ```bash
   docker-compose logs | grep "\[Flightradar24\]"
   ```

### Issue: Rate limit errors

**Symptoms**: "Rate limit reached" in logs

**Solutions**:
- Explorer plan: 10 calls/minute
- This is normal during high traffic periods
- System automatically skips calls when limit reached
- Consider upgrading to Essential plan (30 calls/min)

### Issue: API authentication failed

**Symptoms**: 401 or 403 errors in logs

**Solutions**:
1. Verify API key is correct (no extra spaces)
2. Check subscription is active at [fr24api.flightradar24.com](https://fr24api.flightradar24.com/)
3. Ensure you're using Bearer token, not username/password
4. Try regenerating API key in FR24 dashboard

## Advanced Configuration

### Custom Provider Order

Edit `app.js` to change default provider order:

```javascript
let selectedProviders = ['flightradar24', 'flightaware']; // FR24 first
```

Or:

```javascript
let selectedProviders = ['flightaware', 'flightradar24']; // FA first
```

### Disable Specific Providers

Remove API key from `.env`:

```bash
# FLIGHTRADAR24_API_KEY=...  # Commented out = disabled
```

### Per-Provider Altitude Filters

Set different altitude thresholds:

```bash
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=2000  # FR24: 2000 ft
FLIGHTAWARE_LOOKUP_ALTITUDE_FEET=3000    # FA: 3000 ft (more selective)
```

## API Comparison Matrix

| Feature | OpenSky | FlightAware | Flightradar24 |
|---------|---------|-------------|---------------|
| **Cost** | Free | ~$3-15/mo | $9/mo (30K) |
| **Rate Limit** | 400/min | 5/min | 10/min |
| **Live Positions** | ✓ | ✗ | ✓ |
| **Origin/Dest** | Limited | ✓ | ✓ |
| **Aircraft Type** | ✗ | ✓ | ✓ |
| **Airline Info** | ✗ | Limited | ✓ |
| **Registration** | ✗ | ✓ | ✓ |
| **Historic Data** | 30 days | Varies | 30 days |
| **Global Coverage** | ✓ | US-focused | ✓ |
| **Predictable Cost** | ✓ | ✗ | ✓ |

## Best Practices

### Recommended Setup for Different Use Cases

**Home Enthusiast** ($9/month)
```bash
SEARCH_RADIUS_MILES=5
POLL_INTERVAL=30000
FLIGHTRADAR24_API_KEY=your_key
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=2000
# FR24 only, balanced settings
```

**Airport Proximity** ($9-18/month)
```bash
SEARCH_RADIUS_MILES=10
POLL_INTERVAL=15000
FLIGHTRADAR24_API_KEY=your_key
FLIGHTAWARE_API_KEY=your_key
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=1500
# Both APIs, more aggressive tracking
```

**Budget Conscious** ($0/month)
```bash
SEARCH_RADIUS_MILES=3
POLL_INTERVAL=60000
# No enhanced API keys
# OpenSky only
```

**Data Maximalist** ($18-25/month)
```bash
SEARCH_RADIUS_MILES=10
POLL_INTERVAL=10000
FLIGHTRADAR24_API_KEY=your_key
FLIGHTAWARE_API_KEY=your_key
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=1000
# Both APIs, maximum data collection
```

## Support and Resources

- **FR24 API Docs**: [https://fr24api.flightradar24.com/docs](https://fr24api.flightradar24.com/docs)
- **FR24 Support**: [https://support.fr24.com](https://support.fr24.com)
- **FlightTrak Issues**: Check `docker-compose logs -f`
- **Credit Monitoring**: [https://fr24api.flightradar24.com/subscriptions-and-credits](https://fr24api.flightradar24.com/subscriptions-and-credits)

## Migration from FlightAware Only

If you're currently using only FlightAware:

1. **Add FR24 key** to `.env` (keep FA key)
2. **Restart** FlightTrak
3. **Select both** APIs in UI dropdown
4. **Monitor** which API provides better data for your area
5. **Adjust** provider order based on preference
6. **Optional**: Remove FA key if FR24 meets all needs

No data loss - both APIs work simultaneously!




