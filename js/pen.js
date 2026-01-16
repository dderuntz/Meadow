// Pen class - DOM-based draggable pen that extends PenCore
// Handles DOM rendering, drag interactions, and tile detection

import { PenCore } from './pen-core.js';

export class Pen extends PenCore {
    constructor(id, audioContext, bpm = 100) {
        super(id, audioContext, bpm);
        
        this.element = null;
        this.isDragging = false;
        this.currentTile = null;
        this.lastTileTime = 0;
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
            const frequency = parseFloat(tile.dataset.frequency);
            this.currentTile = tile;
            this.lastTileTime = now;
            
            // Visual feedback - pen is playing
            this.element.classList.add('playing');
            
            // Use PenCore methods
            if (!this.isActive) {
                this.activate(note, frequency);
            } else {
                this.changeNote(note, frequency);
            }
            
            // Legacy callback for subclasses
            this.onTileEnter(tile);
        } else if (!validTile && this.currentTile) {
            // Left tiles
            this.currentTile = null;
            
            // Visual feedback - pen stopped playing
            this.element.classList.remove('playing');
            
            // Use PenCore method
            this.deactivate();
            
            // Legacy callback
            this.onTileLeave();
        } else if (validTile && tile === this.currentTile) {
            // Still on same tile
            this.lastTileTime = now;
            this.sustain();
            
            if (tile && tile.dataset) {
                this.onTileStay(tile);
            }
        }
    }

    // Legacy callbacks for subclasses (DOM-specific pens)
    onTileEnter(tile) {}
    onTileLeave() {}
    onTileStay(tile) {}
    
    // Override destroy to clean up DOM
    destroy() {
        super.destroy();
        if (this.tileCheckInterval) {
            clearInterval(this.tileCheckInterval);
            this.tileCheckInterval = null;
        }
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
