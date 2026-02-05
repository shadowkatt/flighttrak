#!/bin/bash
# Script to identify aircraft types in logs that aren't in aircraft_types.js

echo "=== Checking for Unidentified Aircraft Types ==="
echo ""

# Get aircraft types from logs
echo "Extracting aircraft types from recent logs..."
FOUND_TYPES=$(docker-compose logs --tail=2000 2>&1 | grep "aircraft_type" | sed -n 's/.*"aircraft_type": "\([^"]*\)".*/\1/p' | sort -u)

# Get aircraft types from aircraft_types.js
echo "Loading known aircraft types from aircraft_types.js..."
KNOWN_TYPES=$(grep -oE "'[A-Z0-9]+'" public/aircraft_types.js | tr -d "'" | sort -u)

# Find missing types
echo ""
echo "=== Aircraft Types Found in Logs ==="
echo "$FOUND_TYPES" | while read -r type; do
    count=$(docker-compose logs --tail=2000 2>&1 | grep "aircraft_type" | grep -c "\"$type\"")
    printf "  %-10s (seen %d times)\n" "$type" "$count"
done

echo ""
echo "=== Missing from aircraft_types.js ==="
MISSING=0
echo "$FOUND_TYPES" | while read -r type; do
    if ! echo "$KNOWN_TYPES" | grep -q "^$type$"; then
        count=$(docker-compose logs --tail=2000 2>&1 | grep "aircraft_type" | grep -c "\"$type\"")
        printf "  %-10s (seen %d times) - NEEDS TO BE ADDED\n" "$type" "$count"
        MISSING=$((MISSING + 1))
    fi
done

if [ $MISSING -eq 0 ]; then
    echo "  ✓ All aircraft types are identified!"
fi

echo ""
echo "=== Summary ==="
TOTAL_FOUND=$(echo "$FOUND_TYPES" | wc -l | tr -d ' ')
TOTAL_KNOWN=$(echo "$KNOWN_TYPES" | wc -l | tr -d ' ')
echo "  Aircraft types in logs: $TOTAL_FOUND"
echo "  Aircraft types in database: $TOTAL_KNOWN"
echo ""
echo "Tip: To see full logs, run: docker-compose logs --tail=500 | grep aircraft_type"













