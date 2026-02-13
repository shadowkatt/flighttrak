# Local Airline Logos

This directory contains custom airline logos that override the default GitHub CDN logos for better visibility on dark backgrounds.

## How It Works

1. Logo files stored here (`/public/logos/`) are checked first before falling back to GitHub CDN
2. Logo mappings are defined in `/public/data.js` in the `logoOverrides` object
3. Logo files should be named with the airline's ICAO code (e.g., `JBU.jpg` for JetBlue)

## Currently Overridden Logos

- **JBU** (JetBlue Airways) - `JBU.jpg` - Brighter logo for better visibility
- **ELY** (El Al Airlines) - `ELY.jpg` - Brighter logo for better visibility

## Adding New Logos

### Step 1: Download the logo
Save the logo file to this directory with the airline's ICAO code as the filename:
```bash
cd /Volumes/External/Docker/flighttrak/public/logos
curl -o {ICAO}.jpg "https://url-to-logo-image"
```

Example:
```bash
curl -o UAL.jpg "https://example.com/united-logo.jpg"
```

### Step 2: Add to logo overrides
Edit `/public/data.js` and add the entry to the `logoOverrides` object:

```javascript
const logoOverrides = {
    'JBU': 'logos/JBU.jpg',
    'ELY': 'logos/ELY.jpg',
    'UAL': 'logos/UAL.jpg'  // Add your new entry here
};
```

### Step 3: Restart the application
```bash
cd /Volumes/External/Docker/flighttrak
docker-compose restart
```

## Supported File Formats

- `.jpg` / `.jpeg`
- `.png`
- `.svg`
- `.webp`

## Finding Airline ICAO Codes

Common airline ICAO codes are listed in `/public/data.js` in the `airlines` object.

Examples:
- JetBlue: **JBU**
- El Al: **ELY**
- United: **UAL**
- American: **AAL**
- Delta: **DAL**
- Southwest: **SWA**

## Notes

- Logo files should be reasonably sized (under 500KB recommended)
- Images will be displayed at various sizes throughout the app
- Test on both light and dark backgrounds to ensure visibility
- The application will automatically fall back to GitHub CDN if a local logo fails to load
