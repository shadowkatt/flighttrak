# FlightTrak Hybrid API Implementation Summary

## What Was Implemented

FlightTrak has been upgraded to support **multiple flight data APIs simultaneously**, giving you flexibility to choose the best data sources for your needs.

## Key Features

### 1. **Multi-Provider Support**

Three APIs are now supported:

- **OpenSky Network** (Free, Always Active)
  - Live flight positions for all aircraft
  - Basic route estimation
  - 400 requests/minute with OAuth

- **Flightradar24** (New!)
  - $9/month for 30K credits
  - 10 requests/minute
  - Comprehensive flight data
  - Global coverage

- **FlightAware** (Existing)
  - Pay-as-you-go pricing
  - 5 requests/minute
  - Detailed US flight data

### 2. **UI API Selector**

A new dropdown in the header allows you to:
- Select which enhanced APIs to use
- Choose multiple APIs for redundancy
- Change providers on-the-fly without restart
- Preferences saved automatically

### 3. **Enhanced Cost Tracking**

The footer now shows detailed metrics for all APIs:
- **Total Cost**: Combined monthly estimate
- **OS**: OpenSky call count (always free)
- **FA**: FlightAware calls and cost
- **FR24**: Flightradar24 calls and credit usage (e.g., "1,234/30,000")

### 4. **Smart API Fallback**

The system queries APIs in your preferred order:
1. Try first selected API
2. If no data, try second API
3. Finally fallback to OpenSky estimation
4. Cache results for 4 hours to minimize costs

### 5. **Credit Monitoring**

Real-time Flightradar24 credit tracking:
- Displays credits used vs. total available
- Updates every 10 minutes
- Helps prevent overage

## How to Use

### Quick Start

1. **Add FR24 API key to `.env`**:
   ```bash
   FLIGHTRADAR24_API_KEY=your_api_key_here
   FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=2000
   ```

2. **Restart FlightTrak**:
   ```bash
   docker-compose restart
   ```

3. **Select APIs in UI**:
   - Look for "API:" dropdown in header
   - Click to select FR24, FA, or both
   - Hold Ctrl/Cmd to select multiple

### Switching Between APIs

You can switch APIs anytime:

**Use FR24 only**:
- Select only "FR24" in dropdown
- Best for predictable monthly cost

**Use both FR24 + FlightAware**:
- Select both in dropdown
- FR24 tried first, FA as fallback
- Maximum data availability

**Free mode (OpenSky only)**:
- Deselect all enhanced APIs
- Zero cost operation

## Files Modified

### Backend (`server.js`)
- Added Flightradar24 API client
- Implemented FR24 credit tracking
- Added rate limiting (10 calls/min)
- Updated route endpoint to support provider selection
- Enhanced cost tracking for all APIs
- Added FR24 cache (4-hour TTL)

### Frontend (`app.js`)
- Added API provider state management
- Implemented provider selection dropdown
- Enhanced cost display for all APIs
- Added localStorage for preference persistence
- Updated route fetching to include provider parameter

### UI (`index.html`)
- Added API selector dropdown in header
- Updated footer with detailed API statistics
- Added FR24 credit display

### Styling (`style.css`)
- Added styles for API selector dropdown
- Themed to match existing design

### Documentation
- **`env.example`**: Added FR24 configuration
- **`ADD_TO_ENV.txt`**: Complete hybrid setup guide
- **`FR24_INTEGRATION.md`**: Comprehensive FR24 guide
- **`HYBRID_API_SUMMARY.md`**: This file

## Configuration Options

### Environment Variables

```bash
# Flightradar24
FLIGHTRADAR24_API_KEY=your_key_here
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=2000

# FlightAware (Optional)
FLIGHTAWARE_API_KEY=your_key_here
FLIGHTAWARE_LOOKUP_ALTITUDE_FEET=2000

# OpenSky (Required)
OPENSKY_CLIENT_ID=your_client_id
OPENSKY_CLIENT_SECRET=your_client_secret
```

### Altitude Filtering

Both FR24 and FA support altitude filtering:
- **2000 ft** (default): Balanced - only cruising flights
- **3000 ft**: Conservative - fewer API calls
- **1000 ft**: Aggressive - more flights enhanced

Higher altitude = fewer API calls = lower costs

## API Comparison

| Feature | OpenSky | FlightAware | Flightradar24 |
|---------|---------|-------------|---------------|
| Cost | Free | Variable | $9/mo fixed |
| Rate Limit | 400/min | 5/min | 10/min |
| Global Coverage | ✓ | US-focused | ✓ |
| Live Positions | ✓ | ✗ | ✓ |
| Route Data | Limited | ✓ | ✓ |
| Aircraft Type | ✗ | ✓ | ✓ |
| Airline Info | ✗ | Limited | ✓ |
| Predictable Cost | ✓ | ✗ | ✓ |

## Cost Scenarios

### Scenario 1: Budget ($0/month)
- OpenSky only
- No enhanced APIs
- Full flight tracking
- Limited route information

### Scenario 2: Recommended ($9/month)
- OpenSky + Flightradar24
- Predictable monthly cost
- Comprehensive data
- Global coverage

### Scenario 3: Premium ($12-20/month)
- OpenSky + FR24 + FlightAware
- Maximum data quality
- Redundancy and fallback
- Best for high-traffic areas

## Technical Details

### API Request Flow

1. **Flight Detection**: OpenSky detects new flight
2. **Altitude Check**: Is flight above threshold?
3. **Provider Query**: Query selected APIs in order
4. **Cache Check**: Is data already cached?
5. **Rate Limit**: Can we make API call?
6. **API Call**: Fetch enhanced data
7. **Cache Store**: Store result for 4 hours
8. **Display**: Show in UI

### Caching Strategy

- **Cache Duration**: 4 hours
- **Cache Key**: Flight callsign
- **Purpose**: Minimize API costs
- **Invalidation**: Automatic after TTL

### Rate Limiting

Each API has independent rate limiting:
- **OpenSky**: 400 calls/min (OAuth)
- **FlightAware**: 5 calls/min
- **Flightradar24**: 10 calls/min

System automatically skips calls when limit reached.

## Monitoring and Debugging

### Check API Status

```bash
docker-compose logs | grep "FlightTrak Configuration" -A 15
```

Expected output:
```
--- API Providers ---
OpenSky Network: ✓ ALWAYS ENABLED (free)
FlightAware: ✓ ENABLED
  Altitude Filter: 2000 ft
  Rate Limit: 5 calls/min
Flightradar24: ✓ ENABLED
  Altitude Filter: 2000 ft
  Rate Limit: 10 calls/min
```

### Monitor API Calls

```bash
docker-compose logs -f | grep "\[API:"
```

Shows real-time API requests:
```
[API:Flightradar24] GET /live/flight-positions/full?callsign=UAL123 -> 200 (245ms)
[API:FlightAware] GET /flights/DAL456 -> 200 (312ms)
```

### Check Credit Usage

```bash
docker-compose logs | grep "Cost updated"
```

Shows periodic cost updates:
```
[System] Cost updated: $0.0234 (FA: 12, OS: 145, FR24: 8 calls, 156 credits)
```

## Troubleshooting

### Issue: API not showing in dropdown

**Solution**: Check API key is in `.env` and restart:
```bash
grep FLIGHTRADAR24_API_KEY .env
docker-compose restart
```

### Issue: No enhanced data

**Solution**: 
1. Select API in dropdown
2. Check altitude filter
3. Verify API key is valid
4. Check logs for errors

### Issue: Credits depleting fast

**Solution**:
1. Increase altitude filter: `FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=3000`
2. Reduce search radius: `SEARCH_RADIUS_MILES=3`
3. Increase poll interval: `POLL_INTERVAL=60000`

## Additional Information Displayed

With Flightradar24, you now get:

### In Flight Popups
- Airline name (e.g., "United Airlines")
- Aircraft registration (e.g., "N12345")
- Full route (e.g., "New York → London")

### In Banner Cards
- Enhanced aircraft type names
- Airline logos (existing feature)
- Accurate origin/destination

### In History Log
- Complete route information
- Aircraft type codes
- Airline names

### In Footer
- Real-time credit usage
- Cost breakdown by API
- Monthly reset date

## Migration Path

### From FlightAware-Only

1. Keep existing FA key in `.env`
2. Add FR24 key
3. Restart
4. Select both in UI
5. Monitor which provides better data
6. Optionally remove FA key if FR24 sufficient

### From Free (OpenSky-Only)

1. Add FR24 key to `.env`
2. Restart
3. Select FR24 in UI
4. Monitor credit usage
5. Adjust altitude filter as needed

## Future Enhancements

Potential additions:
- Per-provider statistics dashboard
- Credit usage predictions
- Automatic provider failover
- Custom provider priority rules
- Historical cost analytics

## Support

For issues or questions:
1. Check logs: `docker-compose logs -f`
2. Review documentation: `FR24_INTEGRATION.md`
3. Verify configuration: `ADD_TO_ENV.txt`
4. Test API keys in FR24 sandbox

## Summary

You now have a flexible, cost-effective flight tracking system that:
- ✓ Supports multiple data providers
- ✓ Allows real-time provider switching
- ✓ Tracks costs and credits accurately
- ✓ Provides comprehensive flight data
- ✓ Optimizes API usage automatically
- ✓ Scales from free to premium tiers

**Recommended**: Start with Flightradar24 Explorer plan ($9/month) for best value and predictability.






