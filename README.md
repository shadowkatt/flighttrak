<img width="1908" height="1107" alt="Screenshot 2026-01-29 215443" src="https://github.com/user-attachments/assets/2323f29b-fc94-40ff-b926-5cf81c0ccf52" />

---

# ✈️ FlightTrak

**FlightTrak** is a self-hosted flight tracking dashboard designed to mimic "FlightWall" displays. It provides real-time monitoring of aircraft in a specific geographic radius (e.g., your home or office) by combining data from multiple aviation APIs into a unified, cost-effective interface.

The system features a **Hybrid API Engine** that balances free live position data with paid enhanced data (routes, airlines, aircraft types) to minimize costs while maximizing detail.

---

## 🌟 Key Features

* **📍 Hyper-Local Tracking:** Monitors a specific radius (e.g., 5 miles) around a ZIP code or coordinate set.
* **🔄 Hybrid API Engine:** Simultaneously supports OpenSky, Flightradar24, and FlightAware.
* **Smart Fallback:** Tries your preferred provider first, then falls back to others if data is missing.
* **Caching:** Caches flight details for 4 hours to prevent redundant API calls.


* **💰 Cost Management Dashboard:**
* **Credit Monitoring:** Tracks Flightradar24 credits (e.g., "1,234/30,000") in real-time.
* **Altitude Filtering:** Configurable thresholds (e.g., only lookup flights above 2000ft) to save money on landing/departing aircraft.


* **🛡️ Privacy Filters:** Option to filter out private/GA flights and only show commercial airliners.
* **🎮 UI Controls:** Change API providers on-the-fly using the dropdown selector in the web interface.
* **🐛 Debug Mode:** Integrated support for ADSBexchange (via RapidAPI) for development when OpenSky is rate-limited.

---

## 🏗️ Architecture

FlightTrak uses a tiered data gathering approach:

1. **Detection (Layer 1):** The app polls **OpenSky Network** (free) every 10-30 seconds to find aircraft within your set radius.
2. **Enhancement (Layer 2):** When a flight is detected, the app checks the local cache. If data is missing, it calls your selected **Enhanced Provider** (Flightradar24 or FlightAware) to fetch metadata like routes and aircraft types.
3. **Optimization (Layer 3):** The system applies rate limiting and altitude filters to ensure you don't waste API credits on flights that don't matter (e.g., low-altitude Cessna traffic).

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
ENHANCED_API_PROVIDER=flightradar24
FLIGHTRADAR24_LOOKUP_ALTITUDE_FEET=2000

# FlightAware (Alternative)
FLIGHTAWARE_API_KEY=your_key

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

### Hybrid Mode

* `HYBRID_MODE`: Set to `yes` to enable auto-switching. If FlightAware costs reach a threshold (e.g., $5), the system will automatically switch to Flightradar24.
* `ENHANCED_API_PROVIDER`: Manually sets the priority provider (`flightradar24` or `flightaware`).

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
