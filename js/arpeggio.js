// Arpeggio pattern generation

import { getChordFrequencies } from './utils.js';

export function generateArpeggioPattern(tile, options) {
    const { happyChords, octaves, noteFrequencyMap } = options;
    const baseFrequency = parseFloat(tile.dataset.frequency);
    const note = tile.dataset.note;
    
    if (!baseFrequency || !note) return [];
    
    let frequencies = [];
    
    if (happyChords) {
        // Play happy chord climbing through octaves - octaves controls climb length
        const chordNotes = getChordFrequencies(note, noteFrequencyMap);
        
        // Climb up through octaves: play chord pattern (Root → Third → Fifth) as we go up
        for (let octave = 0; octave < octaves; octave++) {
            const octaveMultiplier = Math.pow(2, octave);
            frequencies.push(chordNotes[0] * octaveMultiplier); // Root
            frequencies.push(chordNotes[1] * octaveMultiplier); // Third
            frequencies.push(chordNotes[2] * octaveMultiplier); // Fifth
        }
        
        // Come back down: reverse pattern (Fifth → Third → Root) as we go down
        // Go through all octaves from top to bottom
        for (let octave = octaves - 1; octave >= 0; octave--) {
            const octaveMultiplier = Math.pow(2, octave);
            frequencies.push(chordNotes[2] * octaveMultiplier); // Fifth
            frequencies.push(chordNotes[1] * octaveMultiplier); // Third
            frequencies.push(chordNotes[0] * octaveMultiplier); // Root
        }
    } else {
        // Play octave arpeggio - up then down pattern
        // Go up octaves
        for (let i = 0; i < octaves; i++) {
            frequencies.push(baseFrequency * Math.pow(2, i));
        }
        // Come back down (skip the base note to avoid repetition)
        for (let i = octaves - 2; i > 0; i--) {
            frequencies.push(baseFrequency * Math.pow(2, i));
        }
    }
    
    return frequencies;
}
