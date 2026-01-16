// Utility functions for music player

export function createNoteFrequencyMap() {
    // Map note names to base frequencies (C4 = middle C)
    return {
        'C': 261.63,
        'C#': 277.18,
        'D': 293.66,
        'D#': 311.13,
        'E': 329.63,
        'F': 349.23,
        'F#': 369.99,
        'G': 392.00,
        'G#': 415.30,
        'A': 440.00,
        'A#': 466.16,
        'B': 493.88
    };
}

export function getChordFrequencies(rootNote, noteFrequencyMap) {
    // Return major triad frequencies (happy chord)
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const rootIndex = notes.indexOf(rootNote);
    if (rootIndex === -1) return [noteFrequencyMap[rootNote]];
    
    // Major third is 4 semitones up, perfect fifth is 7 semitones up
    const thirdRawIndex = rootIndex + 4;
    const fifthRawIndex = rootIndex + 7;
    
    const thirdIndex = thirdRawIndex % 12;
    const fifthIndex = fifthRawIndex % 12;
    
    // If the interval wrapped around (went past B), bump up an octave
    const thirdOctaveMultiplier = thirdRawIndex >= 12 ? 2 : 1;
    const fifthOctaveMultiplier = fifthRawIndex >= 12 ? 2 : 1;
    
    return [
        noteFrequencyMap[rootNote],
        noteFrequencyMap[notes[thirdIndex]] * thirdOctaveMultiplier,
        noteFrequencyMap[notes[fifthIndex]] * fifthOctaveMultiplier
    ];
}

export function createRainbowColors() {
    // Create rainbow colors for 12 chromatic notes
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const colors = {};
    
    notes.forEach((note, index) => {
        // Create rainbow gradient across 12 notes
        const hue = (index / 12) * 360;
        colors[note] = `hsl(${hue}, 70%, 60%)`;
    });
    
    return colors;
}

export function setupTileColors(noteColors) {
    const tiles = document.querySelectorAll('.tile');
    tiles.forEach(tile => {
        const note = tile.dataset.note;
        if (note && noteColors[note]) {
            tile.style.background = noteColors[note];
        }
    });
}
