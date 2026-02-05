# FlightTrak Environment Variables Documentation

## Overview
This document provides a comprehensive guide to all environment variables used in FlightTrak, their purposes, recommended values, and cost implications.

## Location Settings

### `ZIPCODE`
**Purpose**: Your ZIP code for automatic location detection
**Type**: String (5 digits)
**Example**: `ZIPCODE=10001`
**Notes**: If set, system will geocode this automatically. If not set, uses LATITUDE/LONGITUDE

### `LATITUDE`
**Purpose**: Explicit latitude coordinate
**Type**: Decimal number
**Example**: `LATITUDE=40.7128`
**Notes**: Used only if ZIPCODE is not set

### `LONGITUDE`
**Purpose**: Explicit longitude coordinate
**Type**: Decimal number
**Example**: `LONGITUDE=-74.0060`
**Notes**: Used only if ZIPCODE is not set

## Flight Tracking Settings

### `SEARCH_RADIUS_MILES`
**Purpose**: How far to look for flights from your location
**Type**: Number
**Default**: `5`
**Recommended Values**:
- `3` = Local area, fewer flights, lower costs
- `5` = Balanced coverage and costs
- `10` = Wide area, more flights, higher costs

### `POLL_INTERVAL`
**Purpose**: How often to check for new flights
**Type**: Number (milliseconds)
**Default**: `30000` (30 seconds)
**Recommended Values**:
- `30000` = 30 seconds (real-time updates)
- `60000` = 1 minute (balanced)
- `120000` = 2 minutes (cost-saving)
- `300000` = 5 minutes (very cost-saving)

## FlightAware Settings

### `FLIGHTAWARE_API_KEY`
**Purpose**: API key for FlightAware enhanced flight data
**Type**: String
**Example**: `FLIGHTAWARE_API_KEY=your_api_key_here`
**Get Key**: https://flightaware.com/commercial/aeroapi/
**Notes**: If not set, system runs in FREE mode (OpenSky only)

### `FLIGHTAWARE_LOOKUP_ALTITUDE_FEET`
**Purpose**: Only lookup flights above this altitude (saves API calls)
**Type**: Number
**Default**: `2000`
**Recommended Values**:
- `1000` = More flights enhanced (higher cost ~$8-15/month)
- `2000` = Balanced - only stable cruising flights (lower cost ~$3-8/month)
- `3000` = Very selective (minimal cost ~$2-5/month)
- `0` = Disabled (same as removing FLIGHTAWARE_API_KEY)

### `FLIGHTAWARE_COST_CAP`
**Purpose**: Monthly cost limit in dollars - stops FA when reached
**Type**: Number
**Default**: `25.00`
**Example**: `FLIGHTAWARE_COST_CAP=10.00`
**Notes**: When cap is reached, FlightAware stops being used (including fallback)

## Flightradar24 Settings

### `FLIGHTRADAR24_API_KEY`
**Purpose**: API key for Flightradar24 enhanced flight data
**Type**: String
**Example**: `FLIGHTRADAR24_API_KEY=your_fr24_api_key_here`
**Get Key**: https://fr24api.flightradar24.com/
**Notes**: Alternative to FlightAware. Explorer Plan: $9/month for 30K credits

### `FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET`
**Purpose**: Same as FA altitude filter - only lookup flights above this altitude
**Type**: Number
**Default**: `2000`
**Notes**: Same logic as FlightAware altitude filter

## Provider Selection

### `ENHANCED_API_PROVIDER`
**Purpose**: Which enhanced API to use as primary provider
**Type**: String
**Default**: `flightradar24`
**Options**: `flightaware` or `flightradar24`
**Notes**: Only ONE will be active at a time (can be changed in UI)

### `HYBRID_MODE`
**Purpose**: Enable automatic switching between providers when costs get high
**Type**: String
**Default**: `no`
**Options**: `yes` or `no`
**When enabled**:
- Starts with FlightAware
- Auto-switches to Flightradar24 when FlightAware cost reaches $5
- UI selector is hidden (automatic mode)

## Flight Filtering

### `PRIVATE_FLIGHTS`
**Purpose**: Include private flights in enhanced API lookups
**Type**: String
**Default**: `yes`
**Options**: `yes` or `no`
**When set to `no`**:
- Only commercial airline flights sent to FA/FR24 APIs
- Saves API credits
- OpenSky data is always fetched for all flights

## OpenSky Credentials (Choose ONE method)

### OAuth2 Method (Recommended - higher rate limits)
- `OPENSKY_CLIENT_ID` - Your OpenSky client ID
- `OPENSKY_CLIENT_SECRET` - Your OpenSky client secret

### Basic Auth Method (Alternative)
- `OPENSKY_USERNAME` - Your OpenSky username
- `OPENSKY_PASSWORD` - Your OpenSky password

## Cost Management Examples

### Budget Setup ($5-10/month)
```bash
SEARCH_RADIUS_MILES=3
POLL_INTERVAL=120000
FLIGHTAWARE_LOOKUP_ALTITUDE_FEET=2000
FLIGHTAWARE_COST_CAP=10.00
```

### Free Setup ($0/month)
```bash
SEARCH_RADIUS_MILES=5
POLL_INTERVAL=30000
# Don't set FLIGHTAWARE_API_KEY or FLIGHTRADAR24_API_KEY
```

### Real-time Setup ($15-25/month)
```bash
SEARCH_RADIUS_MILES=5
POLL_INTERVAL=30000
FLIGHTAWARE_LOOKUP_ALTITUDE_FEET=1000
FLIGHTAWARE_COST_CAP=25.00
```

## System Behavior

### When Cost Caps Are Reached
- **FlightAware**: Stops all API calls (primary + fallback), shows 
