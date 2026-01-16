// Main Music Player class

import { createNoteFrequencyMap, createRainbowColors, setupTileColors } from './utils.js';
import { generateArpeggioPattern } from './arpeggio.js';
import { Metronome } from './metronome.js';

export class MusicPlayer {
    constructor() {
        this.audioContext = null;
        this.oscillators = new Map();
        this.isDragging = false;
        this.currentTile = null;
        this.noteColors = createRainbowColors();
        this.octaves = 2; // Locked at 2
        this.happyChords = true; // Always on
        this.arpeggioRatio = 4;
        this.arpeggioInterval = null;
        this.noteFrequencyMap = createNoteFrequencyMap();
        
        // Metronome and clock
        this.bpm = 100;
        this.metronomeVolume = 0.5;
        this.metronome = null; // Will be initialized after audio context
        
        // Scheduling
        this.scheduledNotes = [];
        this.scheduledArpeggioNotes = [];
        this.pendingNote = null;
        this.pendingArpeggio = null;
        this.queuedTile = null;
        this.activeArpeggioTile = null;
        this.shouldContinueArpeggio = false;
        
        this.schedulerRunning = false;
        this.initAudio();
        setupTileColors(this.noteColors);
        this.setupControls();
        this.setupEventListeners();
    }

    async initAudio() {
        // Initialize Web Audio API context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                } catch (error) {
                    console.error('Failed to resume audio context:', error);
                }
            }
            return;
        }
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                } catch (error) {
                    console.error('Failed to resume audio context:', error);
                }
            }
            
            // Initialize metronome
            this.metronome = new Metronome(this.audioContext, this.bpm, this.metronomeVolume);
            
            // Start scheduler if not already running
            if (!this.schedulerRunning) {
                this.startScheduler();
                this.schedulerRunning = true;
            }
        } catch (error) {
            console.error('Web Audio API not supported:', error);
        }
    }

    setupControls() {
        // Controls removed - values are locked
        // BPM: 100 (locked)
        // Octaves: 2 (locked)
        // Happy chords: always on
    }

    startScheduler() {
        const scheduleCheck = () => {
            if (!this.audioContext) {
                requestAnimationFrame(scheduleCheck);
                return;
            }
            
            const currentTime = this.audioContext.currentTime;
            
            // Process scheduled notes
            while (this.scheduledNotes.length > 0 && this.scheduledNotes[0].time <= currentTime) {
                const note = this.scheduledNotes.shift();
                this.playNoteImmediate(note.tile, note.frequency);
            }
            
            // Process scheduled arpeggio notes
            while (this.scheduledArpeggioNotes.length > 0 && this.scheduledArpeggioNotes[0].time <= currentTime) {
                const note = this.scheduledArpeggioNotes.shift();
                this.playArpeggioNote(note.frequency);
            }
            
            // Process pen scheduled notes (drums, bass, arpeggio, vibrato)
            if (this.pens) {
                this.pens.forEach(pen => {
                    if (pen.scheduledBeats) {
                        while (pen.scheduledBeats.length > 0 && pen.scheduledBeats[0].time <= currentTime) {
                            const beat = pen.scheduledBeats.shift();
                            if (pen.playDrumSound) {
                                // New format: playDrumSound(time, soundInfo)
                                pen.playDrumSound(beat.time, beat);
                            }
                        }
                    }
                    if (pen.scheduledNotes) {
                        while (pen.scheduledNotes.length > 0 && pen.scheduledNotes[0].time <= currentTime) {
                            const note = pen.scheduledNotes.shift();
                            if (pen.playArpeggioNote) {
                                pen.playArpeggioNote(note.frequency);
                            }
                        }
                    }
                });
            }
            
            requestAnimationFrame(scheduleCheck);
        };
        
        scheduleCheck();
    }

    updateScheduler() {
        // Scheduler already running, just make sure pens are accessible
    }

    async toggleMetronome() {
        await this.initAudio();
        
        if (!this.audioContext || this.audioContext.state === 'closed' || !this.metronome) {
            return;
        }
        
        const toggle = document.getElementById('metronomeToggle');
        
        if (this.metronome.running) {
            this.metronome.stop();
            toggle.textContent = 'Start Metronome';
            toggle.classList.remove('active');
        } else {
            this.metronome.start();
            toggle.textContent = 'Stop Metronome';
            toggle.classList.add('active');
        }
    }

    getNextBeatTime() {
        if (!this.audioContext) {
            this.initAudio();
            if (!this.audioContext) return 0;
        }
        const beatDuration = 60 / this.bpm;
        const currentTime = this.audioContext.currentTime;
        const timeSinceLastBeat = currentTime % beatDuration;
        return currentTime - timeSinceLastBeat + beatDuration;
    }

    setupEventListeners() {
        // Old event listeners removed - pens handle their own interactions
        // Just initialize audio on any interaction
        const initializeOnInteraction = async () => {
            await this.initAudio();
        };
        
        document.addEventListener('mousedown', initializeOnInteraction, { once: true });
        document.addEventListener('touchstart', initializeOnInteraction, { once: true });
    }

    async queueArpeggioForNextBeat(tile) {
        await this.initAudio();
        
        if (!this.audioContext || this.audioContext.state === 'closed') {
            return;
        }
        
        if (this.activeArpeggioTile && this.activeArpeggioTile !== tile) {
            this.shiftArpeggioToTile(tile);
            return;
        }
        
        this.startArpeggio(tile);
    }
    
    shiftArpeggioToTile(tile) {
        const currentTime = this.audioContext.currentTime;
        this.stopArpeggio();
        this.startArpeggio(tile, currentTime + 0.01);
    }

    scheduleArpeggio(tile) {
        this.startArpeggio(tile);
    }

    async startArpeggio(tile, startTime = null) {
        await this.initAudio();
        
        if (!this.audioContext || this.audioContext.state === 'closed') {
            return;
        }
        
        this.pendingArpeggio = null;
        this.activeArpeggioTile = tile;
        this.shouldContinueArpeggio = true;
        
        const frequencies = generateArpeggioPattern(tile, {
            happyChords: this.happyChords,
            octaves: this.octaves,
            noteFrequencyMap: this.noteFrequencyMap
        });
        
        if (frequencies.length === 0) return;

        const beatDuration = 60 / this.bpm;
        const noteInterval = beatDuration / this.arpeggioRatio;
        
        const currentTime = this.audioContext.currentTime;
        let nextNoteTime = startTime || (currentTime + 0.01);
        
        if (!startTime) {
            const nextBeatTime = this.getNextBeatTime();
            if (nextBeatTime - currentTime < noteInterval) {
                nextNoteTime = nextBeatTime;
            }
        }
        
        let currentIndex = 0;
        let cycleStartIndex = 0;
        
        const scheduleNext = () => {
            const isStillActive = (this.currentTile === tile || this.queuedTile === tile) && this.shouldContinueArpeggio;
            
            if (!isStillActive && currentIndex > cycleStartIndex) {
                const cycleLength = frequencies.length;
                const notesInCycle = currentIndex - cycleStartIndex;
                if (notesInCycle >= cycleLength) {
                    this.pendingArpeggio = null;
                    this.activeArpeggioTile = null;
                    return;
                }
            } else if (!isStillActive) {
                this.pendingArpeggio = null;
                this.activeArpeggioTile = null;
                return;
            }

            const freq = frequencies[currentIndex % frequencies.length];
            this.scheduledArpeggioNotes.push({
                frequency: freq,
                time: nextNoteTime
            });
            
            if (currentIndex % frequencies.length === 0) {
                cycleStartIndex = currentIndex;
            }
            
            currentIndex++;
            nextNoteTime += noteInterval;
            
            const delay = (nextNoteTime - this.audioContext.currentTime) * 1000;
            if (delay > 0 && delay < 2000) {
                this.pendingArpeggio = setTimeout(scheduleNext, delay);
            } else {
                this.pendingArpeggio = null;
                this.activeArpeggioTile = null;
            }
        };

        scheduleNext();
    }

    scheduleArpeggioStop() {
        this.shouldContinueArpeggio = false;
    }

    playArpeggioNote(frequency) {
        if (!this.audioContext || this.audioContext.state === 'closed') {
            return;
        }

        const currentTime = this.audioContext.currentTime;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        gainNode.gain.setValueAtTime(0, currentTime);
        gainNode.gain.linearRampToValueAtTime(0.2, currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.15);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start(currentTime);
        oscillator.stop(currentTime + 0.15);
    }

    stopArpeggio() {
        if (this.pendingArpeggio) {
            clearTimeout(this.pendingArpeggio);
            this.pendingArpeggio = null;
        }
        this.scheduledArpeggioNotes = [];
        this.activeArpeggioTile = null;
        this.queuedTile = null;
        this.shouldContinueArpeggio = false;
    }

    playNote(tile) {
        if (!this.audioContext) {
            this.initAudio();
        }

        this.stopNote(tile);
        this.stopArpeggio();

        const frequency = parseFloat(tile.dataset.frequency);
        if (!frequency) return;

        const nextBeatTime = this.getNextBeatTime();
        this.scheduledNotes.push({
            tile: tile,
            frequency: frequency,
            time: nextBeatTime
        });

        tile.classList.add('active');
        this.currentTile = tile;
    }

    playNoteImmediate(tile, frequency) {
        if (!this.audioContext) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        const currentTime = this.audioContext.currentTime;
        gainNode.gain.setValueAtTime(0, currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.5);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start(currentTime);
        oscillator.stop(currentTime + 0.5);

        this.oscillators.set(tile, { oscillator, gainNode });
    }

    stopNote(tile) {
        if (!tile) return;

        const noteData = this.oscillators.get(tile);
        if (noteData) {
            try {
                noteData.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
                noteData.gainNode.gain.setValueAtTime(noteData.gainNode.gain.value, this.audioContext.currentTime);
                noteData.gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
                noteData.oscillator.stop(this.audioContext.currentTime + 0.1);
            } catch (e) {
                // Oscillator might already be stopped
            }
            this.oscillators.delete(tile);
        }

        tile.classList.remove('active');
        if (this.currentTile === tile) {
            this.currentTile = null;
        }
    }

    stopAllNotes() {
        this.stopArpeggio();
        const tiles = document.querySelectorAll('.tile');
        tiles.forEach(tile => {
            this.stopNote(tile);
        });
    }
}
