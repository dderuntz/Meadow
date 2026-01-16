// Audio Adapter - Bridges Three.js pens to the existing audio engines

import { MusicPlayer } from '../music-player.js';
import { DrumKitLoader, getKitForNote, getKitPattern } from '../drum-kits.js';
import { generateArpeggioPattern } from '../arpeggio.js';
import { createNoteFrequencyMap, getChordFrequencies } from '../utils.js';

export class StudioAudioEngine {
    constructor() {
        this.audioContext = null;
        this.bpm = 100;
        this.noteFrequencyMap = createNoteFrequencyMap();
        
        // Map physical pen IDs to instrument mode IDs (can be changed via setPenMode)
        this.penModeMap = { 1: 1, 2: 2, 3: 3, 4: 4 };
        
        // Per PHYSICAL PEN, per INSTRUMENT TYPE state
        // Each pen has completely independent state for each instrument
        this.penStates = {};
        for (let i = 1; i <= 4; i++) {
            this.penStates[i] = {
                currentMode: i, // Track which mode is active
                note: null,
                frequency: null,
                lastNote: null, // For resuming arpeggio on black
                lastFrequency: null,
                drum: this.createDrumState(),
                bass: this.createBassState(),
                arp: this.createArpState(),
                vib: this.createVibState()
            };
        }
        
        this.drumKitLoader = null;
        this.drumBuffers = null;
        this.cricketBuffer = null;
        this.frogBuffer = null;
        this.meadowlarkBuffer = null;
    }
    
    createDrumState() {
        return {
            active: false,
            volume: 0.7,
            pattern: null,
            kitNumber: null,
            timeout: null,
            startTime: null,
            currentStep: 0,
            // Cricket mode (for black areas)
            cricketMode: false
        };
    }
    
    createBassState() {
        return {
            active: false,
            volume: 0.7,
            octaveDrop: 3,
            filterCutoff: 800,
            filterResonance: 16,
            envAmount: 2600,
            oscillator: null,
            filter: null,
            gain: null,
            pattern: this.createBassPattern(),
            timeout: null,
            currentFrequency: null,
            // Frog mode (for black areas)
            frogMode: false,
            startTime: null,
            currentStep: 0
        };
    }
    
    createArpState() {
        return {
            active: false,
            volume: 0.7,
            octaveShift: -1,
            octaves: 2,
            sustain: 0.35,
            frequencies: [],
            currentIndex: 0,
            timeout: null,
            startTime: null,
            // Over black - crystalline mode with chord progression
            overBlack: false,
            chordIndex: 0,
            notesInChord: 0
        };
    }
    
    createVibState() {
        return {
            active: false,
            volume: 0.6,
            octaveShift: 1,
            vibratoRate: 5,
            vibratoDepth: 2,
            oscillators: [],
            vibratoLFOs: [],
            gain: null,
            filter: null,
            vibratoStarted: false,
            timeout: null,
            currentFrequency: null,
            // Meadowlark mode (for black areas)
            meadowlarkMode: false,
            startTime: null,
            currentStep: 0
        };
    }

    createBassPattern() {
        // 32-step pattern for bass
        return [
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 },
            { play: 1, duration: 1, octaveUp: true }, { play: 0, duration: 1 }, { play: 0, duration: 1 }, { play: 0, duration: 1 }
        ];
    }

    async init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Load drum samples (shared by all pens in drum mode)
        this.drumKitLoader = new DrumKitLoader(this.audioContext);
        this.drumBuffers = await this.drumKitLoader.loadAll();
        
        // Load cricket chirp sample (for black areas - drums)
        try {
            const response = await fetch('audio/chirps.wav');
            const arrayBuffer = await response.arrayBuffer();
            this.cricketBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Error loading cricket sample:', error);
            this.cricketBuffer = null;
        }
        
        // Load frog sample (for black areas - bass)
        try {
            const response = await fetch('audio/frog.wav');
            const arrayBuffer = await response.arrayBuffer();
            this.frogBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Error loading frog sample:', error);
            this.frogBuffer = null;
        }
        
        // Load meadowlark sample (for black areas - vibrato/flute)
        try {
            const response = await fetch('audio/meadowlark_sm.m4a');
            const arrayBuffer = await response.arrayBuffer();
            this.meadowlarkBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Error loading meadowlark sample:', error);
            this.meadowlarkBuffer = null;
        }
        
        console.log('Studio audio engine initialized');
    }

    async ensureAudioContext() {
        if (!this.audioContext) {
            await this.init();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    // Set which mode a physical pen uses
    setPenMode(physicalPenId, modeId) {
        const penState = this.penStates[physicalPenId];
        if (!penState) return;
        
        const oldModeId = this.penModeMap[physicalPenId];
        
        // Stop the OLD instrument for THIS pen if it was playing
        if (penState.note) {
            switch (oldModeId) {
                case 1: this.stopDrums(penState.drum); break;
                case 2: this.stopBass(penState.bass); break;
                case 3: this.stopArpeggio(penState.arp); break;
                case 4: this.stopVibrato(penState.vib); break;
            }
        }
        
        // Update the mode
        this.penModeMap[physicalPenId] = modeId;
        penState.currentMode = modeId;
        
        // Start the NEW instrument if pen is currently over a note
        if (penState.note && penState.frequency) {
            switch (modeId) {
                case 1: this.startDrums(penState.drum, penState.note); break;
                case 2: this.startBass(penState.bass, penState.frequency); break;
                case 3: this.startArpeggio(penState.arp, penState.note, penState.frequency); break;
                case 4: this.startVibrato(penState.vib, penState.frequency); break;
            }
        }
        
        console.log(`Pen ${physicalPenId} now using mode ${modeId}`);
    }
    
    // Called when a pen enters a color
    async penEnter(penId, note, frequency) {
        await this.ensureAudioContext();
        
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState) return;
        
        penState.note = note;
        penState.frequency = frequency;
        penState.lastNote = note; // Store for resuming on black
        penState.lastFrequency = frequency;
        
        switch (modeId) {
            case 1: this.startDrums(penState.drum, note); break;
            case 2: this.startBass(penState.bass, frequency); break;
            case 3: this.startArpeggio(penState.arp, note, frequency); break;
            case 4: this.startVibrato(penState.vib, frequency); break;
        }
    }

    // Called when a pen leaves all colors
    penLeave(penId) {
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState) return;
        
        penState.note = null;
        penState.frequency = null;
        penState.overBlack = false;
        
        switch (modeId) {
            case 1: this.stopDrums(penState.drum); break;
            case 2: this.stopBass(penState.bass); break;
            case 3: this.stopArpeggio(penState.arp); break;
            case 4: this.stopVibrato(penState.vib); break;
        }
    }
    
    // Called when pen enters a black area (special sounds)
    async penEnterBlack(penId) {
        await this.ensureAudioContext();
        
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState) return;
        
        penState.overBlack = true;
        
        // For arpeggio mode, crystalline mode with chord progression
        if (modeId === 3) {
            penState.arp.overBlack = true;
            penState.arp.chordIndex = 0;
            penState.arp.notesInChord = 0;
            // If not already playing, start it with last note/frequency
            if (!penState.arp.active && penState.lastNote && penState.lastFrequency) {
                this.startArpeggio(penState.arp, penState.lastNote, penState.lastFrequency);
            }
        }
        // For other modes, stop current and start special sounds
        else {
            // Stop any current playing
            if (penState.note) {
                this.penLeave(penId);
            }
            
            // For drum mode, play cricket (16 steps)
            if (modeId === 1) {
                this.startCricket(penState.drum);
            }
        // For bass mode, play frog (48 steps)
        else if (modeId === 2) {
            this.startFrog(penState.bass);
        }
        // For vibrato/flute mode, play meadowlark (64 steps)
        else if (modeId === 4) {
            this.startMeadowlark(penState.vib);
        }
        }
    }
    
    // Called when pen leaves a black area
    penLeaveBlack(penId) {
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState) return;
        
        penState.overBlack = false;
        
        if (modeId === 1) {
            this.stopCricket(penState.drum);
            this.stopDrums(penState.drum);
        }
        else if (modeId === 2) {
            this.stopFrog(penState.bass);
            this.stopBass(penState.bass);
        }
        else if (modeId === 3) {
            // Arpeggio: clear overBlack flag, will speed back up on next scheduled note
            penState.arp.overBlack = false;
        }
        else if (modeId === 4) {
            this.stopMeadowlark(penState.vib);
            this.stopVibrato(penState.vib);
        }
    }

    // Called when pen moves to different note while still on paper
    penChange(penId, note, frequency) {
        const penState = this.penStates[penId];
        const modeId = this.penModeMap[penId] || penId;
        if (!penState || !penState.note) return;
        
        penState.note = note;
        penState.frequency = frequency;
        penState.lastNote = note; // Store for resuming on black
        penState.lastFrequency = frequency;
        
        // Each instrument handles note changes differently
        switch (modeId) {
            case 1: 
                // Drums - update pattern for new note
                const { kitNumber, isVariation } = getKitForNote(note);
                penState.drum.pattern = getKitPattern(kitNumber, isVariation);
                penState.drum.kitNumber = kitNumber;
                break;
            case 2:
                // Bass - update frequency (used on next pattern iteration)
                const bassState = penState.bass;
                bassState.currentFrequency = frequency;
                if (bassState.oscillator) {
                    const adjFreq = frequency / Math.pow(2, bassState.octaveDrop);
                    bassState.oscillator.frequency.setValueAtTime(adjFreq, this.audioContext.currentTime);
                }
                break;
            case 3:
                // Arpeggio - regenerate pattern
                penState.arp.frequencies = generateArpeggioPattern(
                    { dataset: { note, frequency } },
                    { happyChords: true, octaves: penState.arp.octaves, noteFrequencyMap: this.noteFrequencyMap }
                );
                break;
            case 4:
                // Vibrato - shift note
                this.shiftVibratoNote(penState.vib, frequency);
                break;
        }
    }

    // ==================== DRUMS ====================
    
    startDrums(state, note) {
        if (!this.drumBuffers) return;
        
        const { kitNumber, isVariation } = getKitForNote(note);
        state.pattern = getKitPattern(kitNumber, isVariation);
        state.kitNumber = kitNumber;
        state.startTime = this.audioContext.currentTime;
        state.currentStep = 0;
        state.active = true;
        
        this.scheduleDrumStep(state);
    }

    scheduleDrumStep(state) {
        if (!state.active || !state.pattern) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const currentTime = this.audioContext.currentTime;
        
        const stepTime = state.startTime + (state.currentStep * sixteenthNote);
        const stepInMeasure = state.currentStep % 16;
        
        if (stepTime >= currentTime - 0.05) {
            const beat = state.pattern.find(b => b.pos === stepInMeasure);
            if (beat) {
                this.playDrumSound(state, Math.max(stepTime, currentTime), beat.sound);
            }
        }
        
        state.currentStep++;
        
        const nextStepTime = state.startTime + (state.currentStep * sixteenthNote);
        const delay = (nextStepTime - currentTime) * 1000;
        
        if (state.timeout) clearTimeout(state.timeout);
        
        if (state.active && delay > 0) {
            state.timeout = setTimeout(() => this.scheduleDrumStep(state), Math.min(delay, 5000));
        } else if (state.active) {
            state.timeout = setTimeout(() => this.scheduleDrumStep(state), 10);
        }
    }

    playDrumSound(state, time, sound) {
        if (!this.drumBuffers) return;
        
        let bufferKey = null;
        switch (state.kitNumber) {
            case 1: bufferKey = sound === 'tick' ? 'kit1_tick' : 'kit1_tock'; break;
            case 2: bufferKey = sound === 'typewriter' ? 'kit2_typewriter' : 'kit2_keyboard'; break;
            case 3: bufferKey = sound === 'woodblock' ? 'kit3_woodblock' : 'kit3_woodblock_hi'; break;
            case 4: bufferKey = sound === 'clap' ? 'kit4_clap' : 'kit4_coin'; break;
            case 5: bufferKey = 'kit5_woodblock2'; break;
            case 6: bufferKey = 'kit6_xylo'; break;
        }
        
        const buffer = this.drumBuffers[bufferKey];
        if (!buffer) return;
        
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        
        source.buffer = buffer;
        gain.gain.setValueAtTime(state.volume, time);
        
        source.connect(gain);
        gain.connect(this.audioContext.destination);
        
        source.start(time);
    }

    stopDrums(state) {
        state.active = false;
        state.cricketMode = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        state.startTime = null;
        state.currentStep = 0;
    }

    // ==================== CRICKET (black areas) ====================
    
    startCricket(state) {
        state.active = true;
        state.cricketMode = true;
        state.startTime = this.audioContext.currentTime;
        state.currentStep = 0;
        
        this.scheduleCricketStep(state);
    }
    
    scheduleCricketStep(state) {
        if (!state.active || !state.cricketMode) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const currentTime = this.audioContext.currentTime;
        
        // Pattern: •---|----|----|---- (chirp on step 0, then rest for 15 steps)
        const stepInMeasure = state.currentStep % 16;
        
        const stepTime = state.startTime + (state.currentStep * sixteenthNote);
        
        if (stepTime >= currentTime - 0.05 && stepInMeasure === 0) {
            this.playCricketChirp(state, Math.max(stepTime, currentTime));
        }
        
        state.currentStep++;
        
        const nextStepTime = state.startTime + (state.currentStep * sixteenthNote);
        const delay = (nextStepTime - currentTime) * 1000;
        
        if (state.timeout) clearTimeout(state.timeout);
        
        if (state.active && state.cricketMode && delay > 0) {
            state.timeout = setTimeout(() => this.scheduleCricketStep(state), Math.min(delay, 5000));
        } else if (state.active && state.cricketMode) {
            state.timeout = setTimeout(() => this.scheduleCricketStep(state), 10);
        }
    }
    
    playCricketChirp(state, time) {
        if (!this.cricketBuffer) return;
        
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        
        source.buffer = this.cricketBuffer;
        gain.gain.setValueAtTime(state.volume, time);
        
        source.connect(gain);
        gain.connect(this.audioContext.destination);
        
        source.start(time);
    }
    
    stopCricket(state) {
        state.cricketMode = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
    }

    // ==================== FROG (black areas for bass) ====================
    
    startFrog(state) {
        state.active = true;
        state.frogMode = true;
        state.startTime = this.audioContext.currentTime;
        state.currentStep = 0;
        
        this.scheduleFrogStep(state);
    }
    
    scheduleFrogStep(state) {
        if (!state.active || !state.frogMode) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const currentTime = this.audioContext.currentTime;
        
        // Pattern: 48 steps, frog on step 0, then rest for 47 steps
        const stepInMeasure = state.currentStep % 48;
        
        const stepTime = state.startTime + (state.currentStep * sixteenthNote);
        
        if (stepTime >= currentTime - 0.05 && stepInMeasure === 0) {
            this.playFrog(state, Math.max(stepTime, currentTime));
        }
        
        state.currentStep++;
        
        const nextStepTime = state.startTime + (state.currentStep * sixteenthNote);
        const delay = (nextStepTime - currentTime) * 1000;
        
        if (state.timeout) clearTimeout(state.timeout);
        
        if (state.active && state.frogMode && delay > 0) {
            state.timeout = setTimeout(() => this.scheduleFrogStep(state), Math.min(delay, 5000));
        } else if (state.active && state.frogMode) {
            state.timeout = setTimeout(() => this.scheduleFrogStep(state), 10);
        }
    }
    
    playFrog(state, time) {
        if (!this.frogBuffer) return;
        
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        
        source.buffer = this.frogBuffer;
        gain.gain.setValueAtTime(state.volume, time);
        
        source.connect(gain);
        gain.connect(this.audioContext.destination);
        
        source.start(time);
    }
    
    stopFrog(state) {
        state.frogMode = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
    }

    // ==================== MEADOWLARK (black areas for vibrato/flute) ====================
    
    startMeadowlark(state) {
        state.active = true;
        state.meadowlarkMode = true;
        state.startTime = this.audioContext.currentTime;
        state.currentStep = 0;
        
        this.scheduleMeadowlarkStep(state);
    }
    
    scheduleMeadowlarkStep(state) {
        if (!state.active || !state.meadowlarkMode) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const currentTime = this.audioContext.currentTime;
        
        // Pattern: 64 steps, meadowlark on step 0, then rest for 63 steps
        const stepInMeasure = state.currentStep % 64;
        
        const stepTime = state.startTime + (state.currentStep * sixteenthNote);
        
        if (stepTime >= currentTime - 0.05 && stepInMeasure === 0) {
            this.playMeadowlark(state, Math.max(stepTime, currentTime));
        }
        
        state.currentStep++;
        
        const nextStepTime = state.startTime + (state.currentStep * sixteenthNote);
        const delay = (nextStepTime - currentTime) * 1000;
        
        if (state.timeout) clearTimeout(state.timeout);
        
        if (state.active && state.meadowlarkMode && delay > 0) {
            state.timeout = setTimeout(() => this.scheduleMeadowlarkStep(state), Math.min(delay, 5000));
        } else if (state.active && state.meadowlarkMode) {
            state.timeout = setTimeout(() => this.scheduleMeadowlarkStep(state), 10);
        }
    }
    
    playMeadowlark(state, time) {
        if (!this.meadowlarkBuffer) return;
        
        const source = this.audioContext.createBufferSource();
        const gain = this.audioContext.createGain();
        
        source.buffer = this.meadowlarkBuffer;
        gain.gain.setValueAtTime(state.volume, time);
        
        source.connect(gain);
        gain.connect(this.audioContext.destination);
        
        source.start(time);
    }
    
    stopMeadowlark(state) {
        state.meadowlarkMode = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
    }

    // ==================== BASS ====================
    
    startBass(state, frequency) {
        if (state.oscillator) {
            try { state.oscillator.stop(); } catch (e) {}
        }
        
        state.active = true;
        state.currentFrequency = frequency;
        
        const adjFreq = frequency / Math.pow(2, state.octaveDrop);
        
        state.oscillator = this.audioContext.createOscillator();
        state.filter = this.audioContext.createBiquadFilter();
        state.gain = this.audioContext.createGain();
        
        state.oscillator.type = 'sawtooth';
        state.oscillator.frequency.value = adjFreq;
        
        state.filter.type = 'lowpass';
        state.filter.frequency.value = state.filterCutoff;
        state.filter.Q.value = state.filterResonance;
        
        state.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        
        state.oscillator.connect(state.filter);
        state.filter.connect(state.gain);
        state.gain.connect(this.audioContext.destination);
        
        state.oscillator.start();
        this.scheduleBassPattern(state);
    }

    scheduleBassPattern(state) {
        if (!state.active || !state.oscillator) return;
        
        const beatDuration = 60 / this.bpm;
        const sixteenthNote = beatDuration / 4;
        const patternDuration = beatDuration * 8;
        
        const currentTime = this.audioContext.currentTime;
        let startTime = currentTime + 0.05;
        let currentStepTime = startTime;
        
        const frequency = state.currentFrequency || 220;
        
        state.pattern.forEach((step) => {
            if (step.play) {
                const adjFreq = frequency / Math.pow(2, state.octaveDrop);
                const noteFreq = step.octaveUp ? adjFreq * 2 : adjFreq;
                
                state.oscillator.frequency.setValueAtTime(noteFreq, currentStepTime);
                
                // Gain envelope
                state.gain.gain.linearRampToValueAtTime(0, currentStepTime + 0.005);
                state.gain.gain.linearRampToValueAtTime(0.25 * state.volume, currentStepTime + 0.02);
                state.gain.gain.linearRampToValueAtTime(0.15 * state.volume, currentStepTime + 0.3);
                state.gain.gain.linearRampToValueAtTime(0, currentStepTime + 0.5);
                
                // Filter envelope (squelch)
                const filterPeak = Math.min(state.filterCutoff + state.envAmount, 8000);
                state.filter.frequency.linearRampToValueAtTime(filterPeak, currentStepTime + 0.01);
                state.filter.frequency.linearRampToValueAtTime(state.filterCutoff * 0.3, currentStepTime + 0.5);
            }
            currentStepTime += step.duration * sixteenthNote;
        });
        
        // Schedule next pattern
        if (state.timeout) clearTimeout(state.timeout);
        
        const delay = patternDuration * 1000;
        if (state.active) {
            state.timeout = setTimeout(() => this.scheduleBassPattern(state), delay);
        }
    }

    stopBass(state) {
        state.active = false;
        state.frogMode = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        if (state.oscillator) {
            try { state.oscillator.stop(); } catch (e) {}
            state.oscillator = null;
        }
    }

    // ==================== ARPEGGIO ====================
    
    startArpeggio(state, note, frequency) {
        state.active = true;
        state.frequencies = generateArpeggioPattern(
            { dataset: { note, frequency } },
            { happyChords: true, octaves: state.octaves, noteFrequencyMap: this.noteFrequencyMap }
        );
        
        if (!state.frequencies.length) return;
        
        state.startTime = this.audioContext.currentTime + 0.05;
        state.currentIndex = 0;
        
        this.scheduleArpeggioNote(state);
    }

    // Dreamy chord progression for crystalline mode (relative to C4 = 261.63 Hz)
    getCrystallineChordFrequencies(chordIndex) {
        // Pretty progression: Cmaj7 -> Am7 -> Fmaj7 -> G7sus4
        const chords = [
            [261.63, 329.63, 392.00, 493.88],  // Cmaj7: C E G B
            [220.00, 261.63, 329.63, 392.00],  // Am7: A C E G
            [174.61, 220.00, 261.63, 329.63],  // Fmaj7: F A C E
            [196.00, 261.63, 293.66, 392.00],  // G7sus4: G C D G
        ];
        return chords[chordIndex % chords.length];
    }
    
    scheduleArpeggioNote(state) {
        if (!state.active || !state.frequencies.length) return;
        
        const beatDuration = 60 / this.bpm;
        // Over black: half speed (double interval) - 2 notes per beat instead of 4
        const noteInterval = state.overBlack ? beatDuration / 2 : beatDuration / 4;
        const currentTime = this.audioContext.currentTime;
        
        const noteTime = state.startTime + (state.currentIndex * noteInterval);
        
        let freq;
        if (state.overBlack) {
            // Crystalline mode: wander through chord progression
            const chordFreqs = this.getCrystallineChordFrequencies(state.chordIndex);
            freq = chordFreqs[state.notesInChord % chordFreqs.length];
            
            state.notesInChord++;
            // Change chord every 8 notes
            if (state.notesInChord >= 8) {
                state.notesInChord = 0;
                state.chordIndex++;
            }
        } else {
            freq = state.frequencies[state.currentIndex % state.frequencies.length];
        }
        
        if (noteTime >= currentTime - 0.05) {
            this.playArpeggioNote(state, Math.max(noteTime, currentTime), freq);
        }
        
        state.currentIndex++;
        
        const nextNoteTime = state.startTime + (state.currentIndex * noteInterval);
        const delay = (nextNoteTime - currentTime) * 1000;
        
        if (state.timeout) clearTimeout(state.timeout);
        
        if (state.active && delay > 0) {
            state.timeout = setTimeout(() => this.scheduleArpeggioNote(state), Math.min(delay, 5000));
        } else if (state.active) {
            state.timeout = setTimeout(() => this.scheduleArpeggioNote(state), 10);
        }
    }

    playArpeggioNote(state, time, frequency) {
        const shiftedFreq = frequency * Math.pow(2, state.octaveShift);
        
        if (state.overBlack) {
            // Crystalline mode: softer, shimmer, longer decay, wandering chords
            const crystalFreq = frequency; // Use the chord frequency directly (already correct pitch)
            const decayTime = 1.2 + (state.sustain * 1.5); // Longer, ethereal decay
            const vol = state.volume * 0.4; // Quieter, softer
            
            // Main tone
            const osc1 = this.audioContext.createOscillator();
            const gain1 = this.audioContext.createGain();
            osc1.type = 'sine'; // Softer than triangle
            osc1.frequency.value = crystalFreq;
            
            // Shimmer tone (slightly detuned for chorus effect)
            const osc2 = this.audioContext.createOscillator();
            const gain2 = this.audioContext.createGain();
            osc2.type = 'sine';
            osc2.frequency.value = crystalFreq * 1.002; // Subtle detune
            
            // High harmonic for sparkle (quieter)
            const osc3 = this.audioContext.createOscillator();
            const gain3 = this.audioContext.createGain();
            osc3.type = 'sine';
            osc3.frequency.value = crystalFreq * 2; // Octave up
            
            // Soft envelopes with slow attack
            gain1.gain.setValueAtTime(0, time);
            gain1.gain.linearRampToValueAtTime(vol * 0.5, time + 0.02);
            gain1.gain.exponentialRampToValueAtTime(0.01, time + decayTime);
            
            gain2.gain.setValueAtTime(0, time);
            gain2.gain.linearRampToValueAtTime(vol * 0.3, time + 0.03);
            gain2.gain.exponentialRampToValueAtTime(0.01, time + decayTime * 0.9);
            
            gain3.gain.setValueAtTime(0, time);
            gain3.gain.linearRampToValueAtTime(vol * 0.1, time + 0.01);
            gain3.gain.exponentialRampToValueAtTime(0.01, time + decayTime * 0.5);
            
            osc1.connect(gain1);
            osc2.connect(gain2);
            osc3.connect(gain3);
            gain1.connect(this.audioContext.destination);
            gain2.connect(this.audioContext.destination);
            gain3.connect(this.audioContext.destination);
            
            osc1.start(time);
            osc2.start(time);
            osc3.start(time);
            osc1.stop(time + decayTime + 0.1);
            osc2.stop(time + decayTime + 0.1);
            osc3.stop(time + decayTime + 0.1);
        } else {
            // Normal mode
            const decayTime = 0.05 + (state.sustain * 0.95);
            
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.value = shiftedFreq;
            
            gainNode.gain.setValueAtTime(0, time);
            gainNode.gain.linearRampToValueAtTime(state.volume * 0.5, time + 0.002);
            gainNode.gain.exponentialRampToValueAtTime(0.01, time + decayTime);
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.start(time);
            oscillator.stop(time + decayTime + 0.1);
        }
    }

    stopArpeggio(state) {
        state.active = false;
        state.overBlack = false;
        state.chordIndex = 0;
        state.notesInChord = 0;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        state.frequencies = [];
        state.currentIndex = 0;
        state.startTime = null;
    }

    // ==================== VIBRATO ====================
    
    startVibrato(state, frequency) {
        this.stopVibratoOscillators(state);
        
        state.active = true;
        state.vibratoStarted = false;
        state.oscillators = [];
        state.vibratoLFOs = [];
        
        const shiftedFreq = frequency * Math.pow(2, state.octaveShift);
        state.currentFrequency = shiftedFreq;
        
        // Master filter
        state.filter = this.audioContext.createBiquadFilter();
        state.filter.type = 'lowpass';
        state.filter.frequency.value = 8000;
        
        // Main gain
        state.gain = this.audioContext.createGain();
        state.gain.connect(state.filter);
        state.filter.connect(this.audioContext.destination);
        
        // Create flute-like sound
        const fundamental = this.audioContext.createOscillator();
        fundamental.type = 'sine';
        fundamental.frequency.value = shiftedFreq;
        fundamental.connect(state.gain);
        state.oscillators.push(fundamental);
        
        // Third harmonic
        const third = this.audioContext.createOscillator();
        const thirdGain = this.audioContext.createGain();
        third.type = 'sine';
        third.frequency.value = shiftedFreq * 3;
        thirdGain.gain.value = 0.08;
        third.connect(thirdGain);
        thirdGain.connect(state.gain);
        state.oscillators.push(third);
        
        // Fade in
        const currentTime = this.audioContext.currentTime;
        state.gain.gain.setValueAtTime(0, currentTime);
        state.gain.gain.linearRampToValueAtTime(0.3 * state.volume, currentTime + 0.08);
        
        state.oscillators.forEach(osc => osc.start());
        
        // Start vibrato after delay
        state.timeout = setTimeout(() => this.startVibratoLFO(state), 300);
    }

    startVibratoLFO(state) {
        if (!state.active || state.vibratoStarted) return;
        
        state.vibratoStarted = true;
        
        state.oscillators.forEach(osc => {
            if (!osc.frequency) return;
            
            const lfo = this.audioContext.createOscillator();
            const lfoGain = this.audioContext.createGain();
            
            lfo.type = 'sine';
            lfo.frequency.value = state.vibratoRate;
            
            const freqRatio = osc.frequency.value / state.currentFrequency;
            const depth = state.currentFrequency * (state.vibratoDepth / 100) * freqRatio;
            lfoGain.gain.value = depth;
            
            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            
            lfo.start();
            state.vibratoLFOs.push(lfo);
        });
    }

    shiftVibratoNote(state, frequency) {
        if (!state.oscillators.length || !state.gain) return;
        
        const shiftedFreq = frequency * Math.pow(2, state.octaveShift);
        const oldFreq = state.currentFrequency;
        
        state.oscillators.forEach(osc => {
            if (!osc.frequency) return;
            const ratio = osc.frequency.value / oldFreq;
            osc.frequency.setValueAtTime(shiftedFreq * ratio, this.audioContext.currentTime);
        });
        
        state.currentFrequency = shiftedFreq;
    }

    stopVibratoOscillators(state) {
        state.oscillators.forEach(osc => {
            try { osc.stop(); } catch (e) {}
        });
        state.vibratoLFOs.forEach(lfo => {
            try { lfo.stop(); } catch (e) {}
        });
        state.oscillators = [];
        state.vibratoLFOs = [];
    }

    stopVibrato(state) {
        state.active = false;
        state.meadowlarkMode = false;
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        
        if (state.gain && this.audioContext) {
            state.gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
            setTimeout(() => this.stopVibratoOscillators(state), 150);
        } else {
            this.stopVibratoOscillators(state);
        }
        
        state.vibratoStarted = false;
        state.currentFrequency = null;
    }
}
