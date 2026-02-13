# FlightTrak - Custom Logo System Quick Reference

## ✅ System Installed

The local logo override system is now active. Custom logos stored in `/public/logos/` will be used instead of the GitHub CDN logos.

## 📂 Current Custom Logos

| Airline | ICAO | File | Status |
|---------|------|------|--------|
| JetBlue Airways | JBU | `logos/JBU.jpg` | ✅ Active (60KB) |
| El Al Airlines | ELY | `logos/ELY.jpg` | ✅ Active (34KB) |

## 🚀 Quick Add New Logo

```bash
# 1. Download logo to logos directory
cd /Volumes/External/Docker/flighttrak/public/logos
curl -o {ICAO}.jpg "https://url-to-logo"

# 2. Edit /public/data.js and add to logoOverrides:
#    '{ICAO}': 'logos/{ICAO}.jpg',

# 3. Restart
cd /Volumes/External/Docker/flighttrak
docker-compose restart
```

## 📝 Example: Adding United Airlines Logo

```bash
# Download
cd /Volumes/External/Docker/flighttrak/public/logos
curl -o UAL.png "https://example.com/united-logo.png"

# Then edit /public/data.js:
const logoOverrides = {
    'JBU': 'logos/JBU.jpg',
    'ELY': 'logos/ELY.jpg',
    'UAL': 'logos/UAL.png'  // Add this line
};

# Restart
docker-compose restart
```

## 🔍 Finding ICAO Codes

Common codes are in `/public/data.js`. Here are some frequently used ones:

**Major US Airlines:**
- United: UAL
- American: AAL
- Delta: DAL
- Southwest: SWA
- JetBlue: JBU
- Alaska: ASA

**International:**
- British Airways: BAW
- Lufthansa: DLH
- Air France: AFR
- Emirates: UAE
- Qatar: QTR
- El Al: ELY

## 📍 File Locations

- **Logo Files:** `/Volumes/External/Docker/flighttrak/public/logos/`
- **Configuration:** `/Volumes/External/Docker/flighttrak/public/data.js` (logoOverrides object)
- **Documentation:** `/Volumes/External/Docker/flighttrak/public/logos/README.md`

## ⚙️ How It Works

1. App checks `logoOverrides` object in `data.js`
2. If ICAO code found → uses local file from `/logos/`
3. If not found → falls back to GitHub CDN (Jxck-S/airline-logos)
4. Logo displayed in banners, history table, and flight cards

## 🎨 Logo Guidelines

- **Recommended size:** Under 500KB
- **Formats:** JPG, PNG, SVG, WEBP
- **Naming:** Use ICAO code (e.g., `JBU.jpg` not `jetblue.jpg`)
- **Visibility:** Test on dark backgrounds - ensure good contrast
- **Dimensions:** Square aspect ratio works best (e.g., 900x900px)

---

**Last Updated:** February 12, 2026
**System Version:** 1.0
