// Base Pen class - draggable objects that generate sound

export class Pen {
    constructor(id, audioContext, bpm = 100) {
        this.id = id;
        this.audioContext = audioContext;
        this.bpm = bpm;
        this.element = null;
        this.isDragging = false;
        this.currentTile = null;
        this.lastTileTime = 0;
        this.resetTimeout = null;
        this.internalMetronome = null;
        this.metronomeStartTime = null;
        this.lastPosition = null; // Track position to avoid false "left tile" events
        
        this.tileCheckInterval = null;
        this.createElement();
        this.setupDragHandlers();
        // Start continuous tile checking immediately
        this.startContinuousTileChecking();
    }
    
    startContinuousTileChecking() {
        if (this.tileCheckInterval) return;
        const TILE_CHECK_INTERVAL = 100;
        this.tileCheckInterval = setInterval(() => {
            if (!this.isDragging) {
                // Check tile at pen's center position when not dragging
                const rect = this.element.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                // Check if pen has actually moved since last check
                const currentPos = `${Math.round(centerX)},${Math.round(centerY)}`;
                const penMoved = this.lastPosition !== currentPos;
                this.lastPosition = currentPos;
                
                // If pen hasn't moved and is already on a tile, skip the check
                // This prevents false "left tile" events from DOM interference
                if (!penMoved && this.currentTile) {
                    return;
                }
                
                // Temporarily disable pointer events to check what's underneath
                const originalPointerEvents = this.element.style.pointerEvents;
                this.element.style.pointerEvents = 'none';
                
                const elementAtPoint = document.elementFromPoint(centerX, centerY);
                const tile = elementAtPoint?.closest('.tile');
                
                // Restore pointer events
                this.element.style.pointerEvents = originalPointerEvents || '';
                
                this.handleTileInteraction(tile);
            }
        }, TILE_CHECK_INTERVAL);
    }

    createElement() {
        const container = document.getElementById('pens-container');
        this.element = document.createElement('div');
        this.element.className = `pen pen-${this.id}`;
        this.element.textContent = this.id;
        this.element.id = `pen-${this.id}`;
        this.element.style.position = 'fixed';
        
        // Initial positions for each pen
        const initialPositions = {
            1: { left: 20, top: 20 },
            2: { left: 100, top: 20 },
            3: { left: 180, top: 20 },
            4: { left: 260, top: 20 }
        };
        
        const pos = initialPositions[this.id] || { left: 20, top: 20 };
        this.element.style.left = pos.left + 'px';
        this.element.style.top = pos.top + 'px';
        
        container.appendChild(this.element);
    }

    setupDragHandlers() {
        let offsetX = 0;
        let offsetY = 0;
        let lastTileCheck = 0;
        const TILE_CHECK_INTERVAL = 100; // Check tile every 100ms to reduce lag

        // Note: Continuous tile checking is now handled by startContinuousTileChecking() method

        this.element.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.isDragging = true;
            const rect = this.element.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            this.element.classList.add('active');
            // Disable transition during drag for instant response
            this.element.style.transition = 'none';
        });

        // Use a bound handler so each pen only responds to its own drag
        const onMouseMove = (e) => {
            if (!this.isDragging) return;
            
            // Move pen to cursor position (using fixed positioning) - always smooth
            let x = e.clientX - offsetX;
            let y = e.clientY - offsetY;
            
            // Keep pen within viewport bounds
            const penSize = 60;
            x = Math.max(0, Math.min(x, window.innerWidth - penSize));
            y = Math.max(0, Math.min(y, window.innerHeight - penSize));
            
            this.element.style.left = x + 'px';
            this.element.style.top = y + 'px';
            
            // Update last position so stationary checks don't fire unnecessarily
            const rect = this.element.getBoundingClientRect();
            this.lastPosition = `${Math.round(rect.left + rect.width/2)},${Math.round(rect.top + rect.height/2)}`;
            
            // Throttle tile checking to reduce lag (only check every 100ms)
            const now = Date.now();
            if (now - lastTileCheck > TILE_CHECK_INTERVAL) {
                lastTileCheck = now;
                
                // Temporarily hide pen to check what's underneath
                const originalPointerEvents = this.element.style.pointerEvents;
                this.element.style.pointerEvents = 'none';
                
                // Check if cursor is over a tile (check at cursor position)
                const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
                const tile = elementAtPoint?.closest('.tile');
                
                // Restore pointer events
                this.element.style.pointerEvents = originalPointerEvents || '';
                
                this.handleTileInteraction(tile);
            }
        };
        document.addEventListener('mousemove', onMouseMove);

        document.addEventListener('mouseup', (e) => {
            if (this.isDragging) {
                this.isDragging = false;
                this.element.classList.remove('active');
                // Re-enable transitions after drag
                this.element.style.transition = '';
                
                // Check tile at pen's center position when released
                const rect = this.element.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                // Temporarily disable pointer events to check what's underneath
                const originalPointerEvents = this.element.style.pointerEvents;
                this.element.style.pointerEvents = 'none';
                
                const elementAtPoint = document.elementFromPoint(centerX, centerY);
                const tile = elementAtPoint?.closest('.tile');
                
                // Restore pointer events
                this.element.style.pointerEvents = originalPointerEvents || '';
                
                this.handleTileInteraction(tile);
            }
        });
    }

    handleTileInteraction(tile) {
        const now = Date.now();
        
        // Validate tile has required data
        const validTile = tile && tile.dataset && tile.dataset.note;
        
        if (validTile && tile !== this.currentTile) {
            // On a new tile
            const note = tile.dataset.note;
            this.currentTile = tile;
            this.lastTileTime = now;
            
            // Clear reset timeout
            if (this.resetTimeout) {
                clearTimeout(this.resetTimeout);
                this.resetTimeout = null;
            }
            
            // Start or continue metronome
            if (!this.internalMetronome || !this.internalMetronome.running) {
                this.startInternalMetronome();
            }
            
            // Visual feedback - pen is playing
            this.element.classList.add('playing');
            
            this.onTileEnter(tile);
        } else if (!validTile && this.currentTile) {
            // Left tiles
            this.currentTile = null;
            
            // Visual feedback - pen stopped playing
            this.element.classList.remove('playing');
            
            // Set reset timeout (1 second)
            if (this.resetTimeout) {
                clearTimeout(this.resetTimeout);
            }
            this.resetTimeout = setTimeout(() => {
                this.resetMetronome();
            }, 1000);
            
            this.onTileLeave();
        } else if (validTile && tile === this.currentTile) {
            // Still on same tile
            this.lastTileTime = now;
            if (tile && tile.dataset) {
                this.onTileStay(tile);
            }
        } else if (!validTile && !this.currentTile) {
            // Not over any tile and wasn't over one before - do nothing
        }
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
    }

    getBeatTime() {
        if (!this.internalMetronome || !this.internalMetronome.running) {
            return this.audioContext.currentTime;
        }
        
        const elapsed = this.audioContext.currentTime - this.internalMetronome.startTime;
        const beatDuration = this.internalMetronome.beatDuration;
        const currentBeat = Math.floor(elapsed / beatDuration);
        return this.internalMetronome.startTime + (currentBeat * beatDuration);
    }

    getNextBeatTime() {
        if (!this.internalMetronome || !this.internalMetronome.running) {
            return this.audioContext.currentTime + 0.01;
        }
        
        const beatDuration = this.internalMetronome.beatDuration;
        const currentBeatTime = this.getBeatTime();
        return currentBeatTime + beatDuration;
    }

    // Override these in subclasses
    onTileEnter(tile) {}
    onTileLeave() {}
    onTileStay(tile) {}
}
