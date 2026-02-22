const fs = require('fs');
const path = require('path');

const inputFile = 'private.csv';
const outputFile = 'private_processed.json';

// Common words to keep lowercase in title case (according to titlecaseconverter.com rules)
const lowercaseWords = new Set([
    // Articles
    'a', 'an', 'the',
    // Coordinating conjunctions
    'and', 'but', 'for', 'nor', 'or', 'so', 'yet', 'as',
    // Prepositions (4 letters or fewer)
    'at', 'by', 'from', 'into', 'of', 'on', 'onto', 'out', 'over', 'to', 'up', 'via'
]);

// Common abbreviations to preserve in uppercase
const abbreviations = new Set([
    'LLC', 'INC', 'LTD', 'CORP', 'CO', 'LP', 'LLP', 'PLLC', 'PC', 'PA',
    'MD', 'DO', 'DDS', 'PHD', 'JR', 'SR', 'II', 'III', 'IV', 'V',
    'DBA'
]);

function toTitleCase(name) {
    const words = name.split(' ').filter(word => word.length > 0);
    
    if (words.length === 0) return name;
    
    return words.map((word, index) => {
        const isFirstWord = index === 0;
        const isLastWord = index === words.length - 1;
        const upperWord = word.toUpperCase();
        const lowerWord = word.toLowerCase();
        
        // Skip words with numbers (keep as is)
        if (/\d/.test(word)) return word;
        
        // Skip specific abbreviations
        if (upperWord === 'UTS' || upperWord === 'FLJ') return word;
        
        // Handle hyphenated words - keep all uppercase
        if (word.includes('-')) {
            return word.toUpperCase();
        }
        
        // Keep common abbreviations in uppercase
        if (abbreviations.has(upperWord)) return upperWord;
        
        // Capitalize first and last word
        if (isFirstWord) {
            // If first word is 2 or 3 letters, make it all uppercase
            if (word.length === 2 || word.length === 3) {
                return word.toUpperCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
        if (isLastWord) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
        
        // Lowercase articles, conjunctions, and short prepositions
        if (lowercaseWords.has(lowerWord)) {
            return lowerWord;
        }
        
        // Apply title case: first letter uppercase, rest lowercase
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
}

const data = [];

const readStream = fs.createReadStream(inputFile, { encoding: 'utf8' });

readStream.on('data', chunk => {
    const lines = chunk.split('\n');
    lines.forEach(line => {
        // Remove carriage returns and trim
        const cleanLine = line.replace(/\r/g, '').trim();
        if (cleanLine && !cleanLine.startsWith('registration')) {
            const parts = cleanLine.split(',');
            if (parts.length >= 2) {
                // Rejoin parts after first comma in case there are commas in the name
                const tail = parts.slice(1).join(',');
                const processed = toTitleCase(tail);
                data.push({
                    registration: parts[0],
                    registrant: processed
                });
            }
        }
    });
});

readStream.on('end', () => {
    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
    console.log('Processing complete. Output written to', outputFile);
});

readStream.on('error', err => {
    console.error('Error reading file:', err);
});