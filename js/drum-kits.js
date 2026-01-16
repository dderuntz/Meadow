// Drum kit definitions and audio loading

export class DrumKitLoader {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.buffers = {};
        this.loadingPromises = [];
    }

    async loadAll() {
        // Define kit mappings
        const kitFiles = {
            // Kit 1: Clock tick/tock
            'kit1_tick': 'audio/click_clock_tick.wav',
            'kit1_tock': 'audio/click_clock_tock.wav',
            
            // Kit 2: Typewriter/Keyboard
            'kit2_typewriter': 'audio/click_typewriter.wav',
            'kit2_keyboard': 'audio/click_keyboard.wav',
            
            // Kit 3: Woodblock
            'kit3_woodblock': 'audio/click_woodblock.wav',
            'kit3_woodblock_hi': 'audio/click_wood_hi.wav',
            
            // Kit 4: Coin purse (cabasa) + clap
            'kit4_coin': 'audio/etc_coin_purse.wav',
            'kit4_clap': 'audio/click_tock_clap.wav',
            
            // Kit 5: Woodblock 2
            'kit5_woodblock2': 'audio/etc_woodblock_02.wav',
            
            // Kit 6: Xylo (will be pitch shifted)
            'kit6_xylo': 'audio/music_xylo_note.wav'
        };

        // Load all audio files
        for (const [key, path] of Object.entries(kitFiles)) {
            this.loadingPromises.push(
                this.loadAudio(path).then(buffer => {
                    this.buffers[key] = buffer;
                })
            );
        }

        await Promise.all(this.loadingPromises);
        return this.buffers;
    }

    async loadAudio(url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            return await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error(`Error loading audio ${url}:`, error);
            return null;
        }
    }

    getBuffer(key) {
        return this.buffers[key];
    }
}

// Map chromatic notes to kits (C/C# = Kit 1, D/D# = Kit 2, etc.)
export function getKitForNote(note) {
    const noteIndex = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(note);
    const kitNumber = Math.floor(noteIndex / 2) + 1; // 1-6
    const isVariation = noteIndex % 2 === 1; // Odd indices are variations
    
    return { kitNumber, isVariation };
}

// Get kit name for display
export function getKitName(kitNumber, isVariation) {
    const kitNames = {
        1: 'Clock Tick/Tock',
        2: 'Typewriter/Keyboard',
        3: 'Woodblock',
        4: 'Coin Purse',
        5: 'Woodblock 2',
        6: 'Xylo'
    };
    
    const baseName = kitNames[kitNumber] || 'Unknown';
    return isVariation ? `${baseName} (Variation)` : baseName;
}

// Define patterns for each kit
export function getKitPattern(kitNumber, isVariation) {
    switch (kitNumber) {
        case 1: // Clock tick/tock - basic drums
            if (isVariation) {
                // C# variation - basic with offbeat
                return [
                    { pos: 0, sound: 'tick' },
                    { pos: 4, sound: 'tock' },
                    { pos: 8, sound: 'tick' },
                    { pos: 12, sound: 'tock' },
                    { pos: 14, sound: 'tick' }
                ];
            } else {
                // C base pattern: •-•-|•-•-|•-•-|•-••|
                return [
                    { pos: 0, sound: 'tick' },
                    { pos: 4, sound: 'tock' },
                    { pos: 8, sound: 'tick' },
                    { pos: 12, sound: 'tock' },
                    { pos: 14, sound: 'tick' }
                ];
            }
            
        case 2: // Typewriter/Keyboard - eclectic beat with typey bursts
            if (isVariation) {
                // D# variation - busier, rapid burst at end
                return [
                    { pos: 0, sound: 'typewriter' },
                    { pos: 4, sound: 'typewriter' },
                    { pos: 6, sound: 'keyboard' },
                    { pos: 8, sound: 'typewriter' },
                    { pos: 12, sound: 'typewriter' },
                    { pos: 13, sound: 'typewriter' },
                    { pos: 14, sound: 'typewriter' },
                    { pos: 15, sound: 'keyboard' }
                ];
            } else {
                // D base pattern - steady rhythm with ttt burst at end
                return [
                    { pos: 0, sound: 'typewriter' },
                    { pos: 4, sound: 'typewriter' },
                    { pos: 8, sound: 'typewriter' },
                    { pos: 10, sound: 'keyboard' },
                    { pos: 12, sound: 'typewriter' },
                    { pos: 13, sound: 'typewriter' },
                    { pos: 14, sound: 'typewriter' }
                ];
            }
            
        case 3: // Woodblock - metronome-like but funky
            if (isVariation) {
                // D# variation
                return [
                    { pos: 0, sound: 'woodblock' },
                    { pos: 4, sound: 'woodblock_hi' },
                    { pos: 7, sound: 'woodblock' },
                    { pos: 11, sound: 'woodblock_hi' },
                    { pos: 14, sound: 'woodblock' }
                ];
            } else {
                // E base pattern
                return [
                    { pos: 0, sound: 'woodblock' },
                    { pos: 4, sound: 'woodblock_hi' },
                    { pos: 8, sound: 'woodblock' },
                    { pos: 12, sound: 'woodblock_hi' }
                ];
            }
            
        case 4: // Coin purse + clap - bossa nova
            if (isVariation) {
                // G variation - bossa with clap accents
                return [
                    { pos: 0, sound: 'coin' },
                    { pos: 3, sound: 'coin' },
                    { pos: 4, sound: 'clap' },
                    { pos: 6, sound: 'coin' },
                    { pos: 10, sound: 'coin' },
                    { pos: 12, sound: 'clap' },
                    { pos: 14, sound: 'coin' }
                ];
            } else {
                // F# base pattern - bossa nova with clap on backbeat
                return [
                    { pos: 0, sound: 'coin' },
                    { pos: 3, sound: 'coin' },
                    { pos: 4, sound: 'clap' },
                    { pos: 7, sound: 'coin' },
                    { pos: 10, sound: 'coin' },
                    { pos: 12, sound: 'clap' }
                ];
            }
            
        case 5: // Woodblock 2 - 2,4,2,4 straight beat (beats on positions 2, 4, 2, 4 repeating)
            if (isVariation) {
                // G# variation - slight variation
                return [
                    { pos: 2, sound: 'woodblock2' },
                    { pos: 4, sound: 'woodblock2' },
                    { pos: 10, sound: 'woodblock2' },
                    { pos: 12, sound: 'woodblock2' }
                ];
            } else {
                // G base pattern - 2,4,2,4 straight beat
                return [
                    { pos: 2, sound: 'woodblock2' },
                    { pos: 4, sound: 'woodblock2' },
                    { pos: 8, sound: 'woodblock2' },
                    { pos: 10, sound: 'woodblock2' }
                ];
            }
            
        case 6: // Xylo - syncopated, pitch shifted
            if (isVariation) {
                // A# variation
                return [
                    { pos: 1, sound: 'xylo' },
                    { pos: 4, sound: 'xylo' },
                    { pos: 7, sound: 'xylo' },
                    { pos: 10, sound: 'xylo' },
                    { pos: 13, sound: 'xylo' }
                ];
            } else {
                // A base pattern - syncopated
                return [
                    { pos: 0, sound: 'xylo' },
                    { pos: 3, sound: 'xylo' },
                    { pos: 6, sound: 'xylo' },
                    { pos: 9, sound: 'xylo' },
                    { pos: 12, sound: 'xylo' }
                ];
            }
            
        default:
            return [];
    }
}
