<img width="1908" height="1107" alt="Screenshot 2026-01-29 215443" src="https://github.com/user-attachments/assets/2323f29b-fc94-40ff-b926-5cf81c0ccf52" />

---

# ✈️ FlightTrak

**FlightTrak** is a self-hosted flight tracking dashboard designed to mimic "FlightWall" displays. It provides real-time monitoring of aircraft in a specific geographic radius (e.g., your home or office) by combining data from multiple aviation APIs into a unified, cost-effective interface.

The system features a **Hybrid API Engine** that balances free live position data with paid enhanced data (routes, airlines, aircraft types) to minimize costs while maximizing detail.

---

## 🌟 Key Features

* **📍 Hyper-Local Tracking:** Monitors a specific radius (e.g., 5 miles) around a ZIP code or coordinate set.
* **🔄 Hybrid API Engine:** Simultaneously supports OpenSky, Flightradar24, and FlightAware.
* **Smart Fallback:** Tries primary provider, then secondary if needed, and only uses cache when both APIs are exhausted.
* **Intelligent Caching:** 
  * **5-Minute Deduplication Cache:** Prevents duplicate API calls within 5 minutes.
  * **7-Day Persistent Cache:** Used ONLY when both APIs are unavailable. Commercial flights cached; private jets skip cache (callsigns reused).
  * **Smart Writes:** Persistent cache only written when approaching API limits (FR24 <5K credits or FA >$20) to minimize disk I/O.
* **Filter Optimization:** Prevents wasted secondary API calls when primary filters out flights (e.g., altitude too low).


* **💰 Cost Management Dashboard:**
* **Credit Monitoring:** Tracks Flightradar24 credits (e.g., "13,723/30,000") and FlightAware spend (e.g., "$5.67/$25.00") in real-time.
* **Altitude Filtering:** Configurable thresholds (e.g., only lookup flights above 2000ft) to save money on landing/departing aircraft.
* **Cost Cap Protection:** FlightAware usage automatically stops when monthly cap is reached.
* **Private Jet Optimization:** Private jets (EJA, GJS, FBU, etc.) are never cached since they reuse callsigns multiple times per day.


* **🛡️ Privacy Filters:** Option to filter out private/GA flights and only show commercial airliners.
* **🎮 UI Controls:** Change API providers on-the-fly using the dropdown selector in the web interface.
* **🐛 Debug Mode:** Integrated support for ADSBexchange (via RapidAPI) for development when OpenSky is rate-limited.

---

## 🏗️ Architecture

FlightTrak uses a tiered data gathering approach with intelligent cost optimization:

### Data Flow

1. **Detection (Layer 1):** The app polls **OpenSky Network** (free) every 10-30 seconds to find aircraft within your set radius.
2. **Enhancement (Layer 2):** When a flight is detected above the altitude threshold, the system fetches detailed route information:
   * **Step 1:** Try Primary API (FR24 or FA, based on your active provider)
   * **Step 2:** If primary returns no data (and didn't filter it out), try Secondary API
   * **Step 3:** If BOTH APIs are unavailable/exhausted, check persistent cache as last resort
3. **Optimization (Layer 3):** Multiple layers of cost control:
   * **Altitude Filters:** Only lookup flights above threshold (e.g., 2000ft) to avoid wasting credits on landing/departing traffic
   * **Filter Skip Logic:** If primary API filters out a flight, skip secondary API (same filters would reject it)
   * **Rate Limiting:** Enforces per-minute call limits to prevent API overages
   * **Private Jet Detection:** Private jets (EJA, GJS, FBU, etc.) are NEVER cached since they reuse callsigns multiple times per day

### Caching Strategy

FlightTrak uses a **two-tier cache** system:

#### Tier 1: 5-Minute Deduplication Cache (In-Memory)
* Prevents duplicate API calls for the same flight within 5 minutes
* Always active regardless of API credit status
* Automatically cleared after 5 minutes

#### Tier 2: 7-Day Persistent Cache (Disk-Based)
* **Only used when BOTH APIs are unavailable** (credits exhausted or cost cap reached)
* **Commercial flights only:** Private jets skip cache (callsigns reused)
* **Smart writes:** Only written when approaching limits:
  * FR24 credits < 5,000 remaining (out of 30,000)
  * FlightAware cost > $20 spent (out of $25 cap)
* Reduces disk I/O by ~80% during normal operation
* Entries expire after 7 days

#### Cost Cap Behavior
* **`FLIGHTAWARE_COST_CAP = $0`:** Disables FlightAware entirely
* **`FLIGHTAWARE_COST_CAP` reached:** FA marked as unavailable, system falls back to FR24
* **FR24 credits exhausted:** System falls back to FA (if under cost cap)
* **Both exhausted:** Cache used for commercial flights, OpenSky-only for private jets

---

## 📊 API Provider Support

FlightTrak allows you to mix and match providers based on your budget and data needs.

| Feature | OpenSky | Flightradar24 | FlightAware | ADSBexchange |
| --- | --- | --- | --- | --- |
| **Role** | Base Layer (Position) | Enhancement | Enhancement | Debug / Fallback |
| **Cost** | **Free** | ~$9/mo (Flat) | Pay-as-you-go | Varies (RapidAPI) |
| **Routes** | ❌ | ✅ | ✅ | ❌ |
| **Airline Info** | ❌ | ✅ | Limited | ❌ |
| **Aircraft Type** | ❌ | ✅ | ✅ | ✅ |
| **Rate Limit** | 400/min (Auth) | 10/min (Explorer) | 5/min | Plan Dependent |

**Recommendation:** The **Flightradar24 Explorer Plan ($9/month)** is recommended for the best balance of cost and data quality.

---

## 🚀 Getting Started

### Prerequisites

* Docker & Docker Compose
* OpenSky Network Account (Free)
* *Optional:* Flightradar24 or FlightAware API Keys

### 1. Installation

Clone the repository and enter the directory:

```bash
git clone https://github.com/yourusername/flighttrak.git
cd flighttrak

```

### 2. Configuration

Create your environment file from the example:

```bash
cp env.example .env

```

Open `.env` and configure your settings. At a minimum, you need location data and the OpenSky credentials.

**Required Settings**:

```dotenv
# Location (ZIP Code or Lat/Lon)
ZIPCODE=10001

# OpenSky Credentials (Required for the base layer)
OPENSKY_CLIENT_ID=your_client_id
OPENSKY_CLIENT_SECRET=your_client_secret

```

**Enhanced Data Settings**:

```dotenv
# Flightradar24 (Recommended)
FLIGHTRADAR24_API_KEY=your_key
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=2000

# FlightAware (Alternative or Fallback)
FLIGHTAWARE_API_KEY=your_key
FLIGHTAWARE_COST_CAP=25.00  # Max monthly spend (set to 0 to disable)

# Active Provider (can be changed in UI)
# This is managed automatically, but you can set initial preference here

```

### 3. Running the App

Start the container:

```bash
docker-compose up -d

```

Access the dashboard at `http://localhost:3005`.

---

## ⚙️ Configuration Reference

### Tuning & performance

* `SEARCH_RADIUS_MILES`: Radius to track (Default: `5`). Smaller radius = fewer API calls = lower cost.
* `POLL_INTERVAL`: Update frequency in ms (Default: `10000` / 10s). Increase to 30s or 60s to save credits.
* `*_LOOKUP_ALTITUDE_FEET`: The minimum altitude an aircraft must be at to trigger a paid API lookup. Useful for filtering out landing/departing traffic.
* `FLIGHTAWARE_COST_CAP`: Maximum monthly spend for FlightAware (Default: `25.00`). Set to `0` to disable FlightAware entirely.

### API Fallback Logic

The system intelligently manages API costs with automatic fallback:

1. **Primary API Available:** Uses your selected provider (FR24 or FA)
2. **Primary Returns No Data:** Automatically tries secondary provider
3. **Primary Filters Flight:** Skips secondary (same filters would reject it)
4. **Both APIs Exhausted:** 
   * Commercial flights: Serves from 7-day cache (if available)
   * Private jets: Shows OpenSky data only (accurate position, no route)

**Example Scenarios:**

* **FR24 credits exhausted + FA under cap:** System uses FA for all lookups
* **FA cost cap reached + FR24 has credits:** System uses FR24 for all lookups
* **Both exhausted:** Cache serves commercial flights; private jets get OpenSky-only data
* **Flight at 1500ft (below 2000ft threshold):** Primary filters it out, secondary is NOT called (saves credits)

---

## 💰 Cost Optimization

FlightTrak includes several layers of optimization to minimize API costs while maintaining data accuracy:

### Automatic Cost Controls

1. **Smart Caching:**
   * 5-minute deduplication prevents redundant API calls for the same flight
   * Persistent cache only written when approaching API limits (saves ~80% disk I/O)
   * Private jets never cached (callsigns reused multiple times per day)

2. **Filter Optimization:**
   * Altitude threshold prevents lookups for low-flying aircraft
   * Secondary API skipped when primary filters out flight (prevents wasted calls)
   * Typical savings: ~10-20 API calls per day

3. **Intelligent Fallback:**
   * Primary API exhausted → Automatically switches to secondary
   * Both APIs exhausted → Serves from cache (commercial flights only)
   * Private jets when APIs exhausted → OpenSky-only mode (accurate but incomplete)

### Cost Monitoring

The dashboard displays real-time API usage:
* **Flightradar24:** Shows credits used/remaining (e.g., "13,723/30,000")
* **FlightAware:** Shows monthly spend and cap (e.g., "$5.67/$25.00")
* **OpenSky:** Shows daily credits used (free service, 4000/day with auth)

### Typical Monthly Costs

With default settings (4-mile radius, 2000ft threshold, 10s polling):
* **Flightradar24 Explorer:** $9/month (flat rate, ~15,000-20,000 credits/month)
* **FlightAware:** $5-15/month (pay-as-you-go, depends on traffic)
* **Combined (with fallback):** $9-24/month total

**Cost Reduction Tips:**
* Increase `POLL_INTERVAL` to 30s (reduces calls by 66%)
* Increase `*_LOOKUP_ALTITUDE_FEET` to 5000ft (reduces calls by ~50%)
* Set `FLIGHTAWARE_COST_CAP=0` to use FR24-only mode
* Enable `PRIVATE_FLIGHTS=no` to filter out general aviation

---

## 🛠️ Debug Mode (ADSBexchange)

If OpenSky places your IP in a "penalty box" (rate limit backoff) due to excessive requests, development doesn't have to stop. FlightTrak includes a temporary **Debug Mode** that uses ADSBexchange via RapidAPI.

### How to Enable

1. Get a RapidAPI key for ADSBexchange.
2. Add to `.env`:
```dotenv
USE_ADSB=true
RAPIDAPI_KEY=your_key

```


3. Restart the container.

This replaces OpenSky with ADSBexchange for the base flight list until you disable it. Note that RapidAPI calls are not free (pricing varies by plan).
