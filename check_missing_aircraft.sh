#!/bin/bash
# Script to scan logs, identify missing aircraft types, and update aircraft_types.js directly.

set -u

CONTAINER_NAME="${1:-flighttrak-flighttrak-1}"
LOG_TAIL="${LOG_TAIL:-2000}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"
BASE_TYPES_FILE="public/aircraft_types.js"

upsert_base_type() {
    local code="$1"
    local name="$2"

    CODE="$code" NAME="$name" FILE_PATH="$BASE_TYPES_FILE" node <<'NODE'
const fs = require('fs');

const code = process.env.CODE;
const name = process.env.NAME;
const filePath = process.env.FILE_PATH;

let content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

const startIdx = lines.findIndex((line) => line.includes('const aircraftTypes = {'));
if (startIdx === -1) {
  throw new Error('Could not find "const aircraftTypes = {" in aircraft_types.js');
}

let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
  if (lines[i].trim() === '};') {
    endIdx = i;
    break;
  }
}
if (endIdx === -1) {
  throw new Error('Could not find closing "};" for aircraftTypes object');
}

const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const newEntryLine = `    '${code}': '${escapedName}',`;
const entryRegex = new RegExp(`^\\s*'${code}':\\s*'.*?',?\\s*$`);

// Update existing entry if present
for (let i = startIdx + 1; i < endIdx; i++) {
  if (entryRegex.test(lines[i])) {
    lines[i] = newEntryLine;
    fs.writeFileSync(filePath, `${lines.join('\n').replace(/\n?$/, '\n')}`);
    process.exit(0);
  }
}

// Add new entry before closing brace, fixing trailing comma if needed
let prevIdx = endIdx - 1;
while (prevIdx > startIdx && lines[prevIdx].trim() === '') {
  prevIdx--;
}
if (prevIdx > startIdx) {
  const prevLine = lines[prevIdx];
  const isComment = prevLine.trim().startsWith('//');
  if (!isComment && !prevLine.trim().endsWith(',')) {
    lines[prevIdx] = `${prevLine},`;
  }
}

lines.splice(endIdx, 0, newEntryLine);
fs.writeFileSync(filePath, `${lines.join('\n').replace(/\n?$/, '\n')}`);
NODE
}

echo "=== Checking for Unidentified Aircraft Types ==="
echo ""
echo "Container: $CONTAINER_NAME"
echo "Log window: last $LOG_TAIL lines"
echo ""

echo "Extracting aircraft types from recent logs..."
LOG_DATA="$(docker logs "$CONTAINER_NAME" --tail="$LOG_TAIL" 2>&1 || true)"

# Strip ANSI color codes and extract aircraft types
# Extract from multiple formats:
# 1. Escaped JSON: \"type\":\"A320\"
# 2. Parsed output: type: A320
FOUND_TYPES="$(
    printf '%s\n' "$LOG_DATA" \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | rg -o '(\\"(type|aircraft_type)\\":\\"([A-Z0-9]{3,5})\\"|type: ([A-Z0-9]{3,5}))' \
    | sed -E 's/.*:\\"?([A-Z0-9]{3,5})\\".*/\1/' \
    | sed -E 's/.*: ([A-Z0-9]{3,5}).*/\1/' \
    | rg '^[A-Z0-9]{3,5}$' \
    | sort -u
)"

echo "Loading known aircraft types from $BASE_TYPES_FILE..."
KNOWN_BASE_TYPES="$(
    rg -o "^[[:space:]]*'[A-Z0-9]{3,5}'[[:space:]]*:" "$BASE_TYPES_FILE" \
    | sed -E "s/^[[:space:]]*'([A-Z0-9]{3,5})'.*/\1/" \
    | sort -u
)"

KNOWN_TYPES="$KNOWN_BASE_TYPES"

TOTAL_FOUND="$(printf '%s\n' "$FOUND_TYPES" | rg '^[A-Z0-9]{3,5}$' | wc -l | tr -d ' ')"
TOTAL_KNOWN="$(printf '%s\n' "$KNOWN_TYPES" | rg '^[A-Z0-9]{3,5}$' | wc -l | tr -d ' ')"

echo ""
echo "=== Aircraft Types Found in Logs ==="
if [ "$TOTAL_FOUND" -eq 0 ]; then
    echo "  (No aircraft types found in recent logs)"
else
    # Strip ANSI codes once for counting
    STRIPPED_LOG_DATA="$(printf '%s\n' "$LOG_DATA" | sed 's/\x1b\[[0-9;]*m//g')"
    
    while IFS= read -r type; do
        [ -z "$type" ] && continue
        # Simple count: just count how many times the type appears in logs
        count=$(echo "$STRIPPED_LOG_DATA" | grep -c "\"$type\"" 2>/dev/null || echo 1)
        count=$(echo "$count" | head -1 | tr -d '\n')
        printf "  %-10s (seen %s times)\n" "$type" "$count"
    done <<EOF
$FOUND_TYPES
EOF
fi

echo ""
echo "=== Missing from aircraft type database ==="
MISSING=0
MISSING_CODES=""
if [ "$TOTAL_FOUND" -gt 0 ]; then
    while IFS= read -r type; do
        [ -z "$type" ] && continue
        if ! printf '%s\n' "$KNOWN_TYPES" | rg -Fxq "$type"; then
            count=$(echo "$STRIPPED_LOG_DATA" | grep -c "\"$type\"" 2>/dev/null || echo 1)
            count=$(echo "$count" | head -1 | tr -d '\n')
            printf "  %-10s (seen %s times) - NEEDS TO BE ADDED\n" "$type" "$count"
            MISSING_CODES="${MISSING_CODES}${type}"$'\n'
            MISSING=$((MISSING + 1))
        fi
    done <<EOF
$FOUND_TYPES
EOF
fi

if [ "$MISSING" -eq 0 ]; then
    echo "  ✓ All aircraft types are identified!"
fi

echo ""
echo "=== Summary ==="
echo "  Aircraft types in logs: $TOTAL_FOUND"
echo "  Aircraft types in database: $TOTAL_KNOWN"
echo "  Missing aircraft types: $MISSING"
echo "  Mode: $([ "$NON_INTERACTIVE" -eq 1 ] && echo "non-interactive" || echo "interactive")"
echo ""

if [ "$MISSING" -gt 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
    echo "=== Add Missing Aircraft Types ==="
    ADDED=0
    SKIPPED=0

    while IFS= read -r code; do
        [ -z "$code" ] && continue
        echo ""
        echo "Missing type: $code"
        printf "Enter aircraft name for %s (or type 'skip'): " "$code"
        IFS= read -r name </dev/tty

        if [ -z "$name" ] || [ "$name" = "skip" ] || [ "$name" = "SKIP" ]; then
            echo "  Skipped $code"
            SKIPPED=$((SKIPPED + 1))
            continue
        fi

        upsert_base_type "$code" "$name"
        echo "  Added/updated $code -> $name"
        ADDED=$((ADDED + 1))
    done <<EOF
$MISSING_CODES
EOF

    echo ""
    echo "=== Update Results ==="
    echo "  Added: $ADDED"
    echo "  Skipped: $SKIPPED"
    echo "  Saved to: $BASE_TYPES_FILE"
fi

echo "Tip: For report-only mode (no prompts), run:"
echo "  NON_INTERACTIVE=1 bash check_missing_aircraft.sh"
echo "Tip: To inspect raw matches, run:"
echo "  docker logs $CONTAINER_NAME --tail=500 | rg '\"(type|aircraft_type)\"'"
















