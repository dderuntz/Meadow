// PenCore - Core timing and metronome logic for pens (UI-agnostic)
// This class handles beat timing, scheduling, and state management
// without any DOM dependencies. UI adapters (DOM, Three.js) extend this.

export class PenCore {
    constructor(id, audioContext, bpm = 100) {
        this.id = id;
        this.audioContext = audioContext;
        this.bpm = bpm;
        
        // State (using 'active' prefix to avoid conflicts with subclass property names)
        this.activeNote = null;
        this.activeFrequency = null;
        this.isActive = false; // Whether pen is currently over a valid target
        
        // Timing
        this.internalMetronome = null;
        this.metronomeStartTime = null;
        this.resetTimeout = null;
        this.lastInteractionTime = 0;
    }

    // Called when pen enters a note/color region
    activate(note, frequency) {
        this.activeNote = note;
        this.activeFrequency = frequency;
        this.isActive = true;
        this.lastInteractionTime = Date.now();
        
        // Clear reset timeout
        if (this.resetTimeout) {
            clearTimeout(this.resetTimeout);
            this.resetTimeout = null;
        }
        
        // Start or continue metronome
        if (!this.internalMetronome || !this.internalMetronome.running) {
            this.startInternalMetronome();
        }
        
        // Subclasses override this for sound
        this.onActivate(note, frequency);
    }

    // Called when pen leaves all note/color regions
    deactivate() {
        this.isActive = false;
        
        // Set reset timeout (1 second)
        if (this.resetTimeout) {
            clearTimeout(this.resetTimeout);
        }
        this.resetTimeout = setTimeout(() => {
            this.resetMetronome();
        }, 1000);
        
        // Subclasses override this
        this.onDeactivate();
    }

    // Called when pen moves to a different note while still active
    changeNote(note, frequency) {
        if (note !== this.activeNote) {
            this.activeNote = note;
            this.activeFrequency = frequency;
            this.lastInteractionTime = Date.now();
            
            // Subclasses override this
            this.onNoteChange(note, frequency);
        }
    }

    // Called while pen stays on the same note
    sustain() {
        this.lastInteractionTime = Date.now();
        // Subclasses can override for continuous effects
        this.onSustain();
    }

    startInternalMetronome() {
        if (!this.audioContext || this.audioContext.state !== 'running') {
            // Try to get audio context from global player if not available
            if (window.musicPlayer && window.musicPlayer.audioContext) {
                this.audioContext = window.musicPlayer.audioContext;
            } else {
                return;
            }
        }
        
        if (this.audioContext.state !== 'running') {
            return;
        }
        
        // Create simple internal metronome
        this.metronomeStartTime = this.audioContext.currentTime;
        this.internalMetronome = {
            running: true,
            startTime: this.metronomeStartTime,
            beatDuration: 60 / this.bpm
        };
    }

    resetMetronome() {
        if (this.internalMetronome) {
            this.internalMetronome.running = false;
            this.internalMetronome = null;
            this.metronomeStartTime = null;
        }
        this.activeNote = null;
        this.activeFrequency = null;
    }

    getBeatTime() {
        if (!this.internalMetronome || !this.internalMetronome.running) {
            return this.audioContext ? this.audioContext.currentTime : 0;
        }
        
        const elapsed = this.audioContext.currentTime - this.internalMetronome.startTime;
        const beatDuration = this.internalMetronome.beatDuration;
        const currentBeat = Math.floor(elapsed / beatDuration);
        return this.internalMetronome.startTime + (currentBeat * beatDuration);
    }

    getNextBeatTime() {
        if (!this.internalMetronome || !this.internalMetronome.running) {
            return this.audioContext ? this.audioContext.currentTime + 0.01 : 0.01;
        }
        
        const beatDuration = this.internalMetronome.beatDuration;
        const currentBeatTime = this.getBeatTime();
        return currentBeatTime + beatDuration;
    }

    // Override these in subclasses for sound generation
    onActivate(note, frequency) {}
    onDeactivate() {}
    onNoteChange(note, frequency) {}
    onSustain() {}
    
    // Cleanup
    destroy() {
        if (this.resetTimeout) {
            clearTimeout(this.resetTimeout);
            this.resetTimeout = null;
        }
        this.resetMetronome();
    }
}
