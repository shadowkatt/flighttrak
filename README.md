<img width="1908" height="1107" alt="Screenshot 2026-01-29 215443" src="https://github.com/user-attachments/assets/2323f29b-fc94-40ff-b926-5cf81c0ccf52" />

---

# ✈️ FlightTrak

**FlightTrak** is a self-hosted flight tracking dashboard designed to mimic "FlightWall" displays. It provides real-time monitoring of aircraft in a specific geographic radius (e.g., your home or office) by combining data from multiple aviation APIs into a unified, cost-effective interface.

It features a unique **Hybrid API Engine** that balances free live position data with paid enhanced data (routes, airlines, aircraft types) to minimize costs while maximizing detail.

## 🌟 Key Features

* **📍 Hyper-Local Tracking:** Monitors a specific radius (e.g., 5 miles) around a ZIP code or coordinate set.
* **🔄 Hybrid API Engine:**
* **OpenSky Network (Free):** Used for live positioning and traffic detection.
* **Flightradar24 / FlightAware (Paid/Freemium):** Used *only* to fetch metadata (Routes, Airline, Aircraft Type) for identified flights.


* **💰 Smart Cost Management:**
* **Caching:** Caches flight details for 4 hours to prevent redundant API calls.
* **Altitude Filtering:** Ignored low-altitude traffic (optional) to save credits.
* **Rate Limiting:** Intelligent backoff logic to respect API limits (e.g., OpenSky's rate limits).
* **Cost Dashboard:** Real-time tracking of API credits and estimated monthly costs in the footer.


* **🛡️ Privacy Filters:** Option to filter out private/GA flights and only show commercial airliners.
* **🛠️ Debug Mode:** Support for ADSBexchange as a temporary fallback source.
* **🐳 Dockerized:** One-command deployment via Docker Compose.

---

## 🏗️ Architecture: The Hybrid System

FlightTrak uses a tiered approach to gather data:

1. **Detection (Layer 1):** The app polls **OpenSky Network** (free) to find aircraft within your set radius.
2. **Enhancement (Layer 2):** When a flight is detected, the app checks if it has metadata (Route, Airline, Image) in the local cache.
3. **API Call (Layer 3):** If data is missing, it calls your selected **Enhanced Provider** (Flightradar24 or FlightAware) to fetch the details.
* *Note:* You can configure the app to switch providers automatically (Hybrid Mode) or manually via the UI.



---

## 🚀 Getting Started

### Prerequisites

* [Docker](https://www.docker.com/) & Docker Compose
* API Keys (see below)

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

**Required Settings:**

```dotenv
# Location (Zip Code is easiest, or use LATITUDE/LONGITUDE)
ZIPCODE=10001

# OpenSky Credentials (Required for the base layer)
OPENSKY_CLIENT_ID=your_client_id
OPENSKY_CLIENT_SECRET=your_client_secret

```

**Enhanced Data Settings (Recommended):**

```dotenv
# Flightradar24 (Best value: $9/mo for 30k credits)
FLIGHTRADAR24_API_KEY=your_key
ENHANCED_API_PROVIDER=flightradar24

# OR FlightAware
FLIGHTAWARE_API_KEY=your_key

```

### 3. Running the App

Start the container:

```bash
docker-compose up -d

```

Access the dashboard at:
`http://localhost:3005`

---

## ⚙️ Configuration Reference

### Location & Tuning

| Variable | Description | Default |
| --- | --- | --- |
| `ZIPCODE` | Automatically geocodes to Lat/Lon (US only). | `null` |
| `LATITUDE` / `LONGITUDE` | Manual coordinates (if ZIP is not used). | `40.6895, -74.1745` |
| `SEARCH_RADIUS_MILES` | Radius to track. Smaller = fewer API calls. | `5` |
| `POLL_INTERVAL` | Update frequency in ms. | `10000` (10s) |

### API Providers

| Variable | Description |
| --- | --- |
| `OPENSKY_CLIENT_ID` | **Required.** Your OpenSky auth. |
| `FLIGHTRADAR24_API_KEY` | Key for FR24 (Explorer plan recommended). |
| `FLIGHTAWARE_API_KEY` | Key for FlightAware AeroAPI. |
| `ENHANCED_API_PROVIDER` | Which API to prioritize: `flightradar24` or `flightaware`. |
| `HYBRID_MODE` | `yes` to auto-switch from FA to FR24 if costs get high. |

### Filters

| Variable | Description | Default |
| --- | --- | --- |
| `PRIVATE_FLIGHTS` | `yes` to show all, `no` to show only commercial. | `yes` |
| `*_LOOKUP_ALTITUDE_FEET` | Min altitude to trigger a paid API lookup. | `2000` |

---

## 📊 API Provider Comparison

FlightTrak supports multiple providers. You can select active providers in the Web UI header.

| Feature | OpenSky | Flightradar24 | FlightAware | ADSBexchange |
| --- | --- | --- | --- | --- |
| **Role** | Base Layer (Position) | Enhancement | Enhancement | Debug / Fallback |
| **Cost** | **Free** | ~$9/mo (Flat) | Pay-as-you-go | Varies (RapidAPI) |
| **Routes** | ❌ | ✅ | ✅ | ❌ |
| **Airline Info** | ❌ | ✅ | Limited | ❌ |
| **Rate Limit** | 400/min (Auth) | 10/min (Explorer) | 5/min | Plan Dependent |

**Recommendation:** Use **OpenSky** + **Flightradar24 (Explorer Plan)**.

* The FR24 Explorer plan ($9/mo) gives 30,000 credits, which is sufficient for 24/7 tracking of a home radius with standard filters.

---

## 🛠️ Advanced Usage

### Debug Mode (ADSBexchange)

If OpenSky rate limits you (backoff), you can temporarily switch to ADSBexchange via RapidAPI to keep developing or tracking.

1. Get a RapidAPI key for ADSBexchange.
2. Set `USE_ADSB=true` and `RAPIDAPI_KEY=...` in `.env`.
3. Restart container.

### Resetting Rate Limits

If OpenSky puts you in a "penalty box" (backoff), you can check the logs or use the admin endpoint (dev only):
`POST /api/admin/reset-opensky-backoff`

### Adding Custom Aircraft

The system allows user submission of aircraft types via the UI if the API returns an unknown code. These are stored in `public/user_aircraft_types.json`.

---

## 📝 License

This project is licensed under the **ISC License**.

## 🤝 Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/NewFeature`).
3. Commit your changes.
4. Push to the branch.
5. Open a Pull Request.
