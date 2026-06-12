/* ================================================
GAME MODULE: 41 (EMPAT SATU)
File: empat1.js

ATURAN SINGKAT:
  - 1 deck 52 kartu (tanpa Joker), tiap pemain dapat 4 kartu
  - Sisa kartu menjadi tumpukan ambil (draw pile) + 1 kartu terbuka (discard pile)
  - Giliran berurut: ambil dari draw pile ATAU dari discard pile → buang 1 kartu
  - Nilai: As=11, K/Q/J/10=10, angka sesuai nilai
  - Skor = total nilai 1 jenis kartu terbesar yang dimiliki
  - Pemain bisa KETOK untuk memicu showdown di akhir putaran itu
  - Jika pemain mendapat 41 tepat → langsung menang putaran itu (Blackjack-style)
  - Pemain dengan skor terendah di akhir setiap putaran kalah (dapat poin penalti +1)
  - Maksimum putaran ditentukan host, pemain dengan total penalti terendah menang
================================================ */
"use strict";

const Empat1Game = {
    id: 'empat1',
    name: '41',

    // State lokal
    db: null,
    roomId: null,
    myUid: null,
    myHand: [],
    selectedCardId: null,      // kartu di tangan yang dipilih untuk dibuang
    pendingDrawSource: null,   // 'draw' | 'discard' | null — kartu yang sudah diambil tapi belum dibuang
    pendingCard: null,         // objek kartu yang sudah diambil (belum masuk tangan resmi)
    _lastHandCount: -1,
    _lastPhase: '',

    // ─── 1. INIT / CLEANUP ───────────────────────────────────────────────────

    init(db, roomId, myUid) {
        this.db       = db;
        this.roomId   = roomId;
        this.myUid    = myUid;
        this.myHand   = [];
        this.selectedCardId   = null;
        this.pendingDrawSource = null;
        this.pendingCard       = null;
        this._lastHandCount    = -1;
        this._lastPhase        = '';
        this.setupUI();
    },

    cleanup() {
        this.myHand   = [];
        this.selectedCardId   = null;
        this.pendingDrawSource = null;
        this.pendingCard       = null;
        this._lastHandCount    = -1;
        this._lastPhase        = '';
    },

    // ─── 2. UI SETUP ─────────────────────────────────────────────────────────

    setupUI() {
        const canvas = document.getElementById('game-canvas');
        canvas.innerHTML = `
        <div class="game-wrap">
            <!-- Lawan atas -->
            <div class="player-area top">
                <div id="lbl-top" class="player-label"></div>
                <div id="hand-top" class="opponent-hand"></div>
                <div id="score-top" class="e1-score-badge hidden"></div>
            </div>
            <!-- Lawan kiri -->
            <div class="player-area left">
                <div id="lbl-left" class="player-label"></div>
                <div id="hand-left" class="opponent-hand vertical"></div>
                <div id="score-left" class="e1-score-badge hidden"></div>
            </div>
            <!-- Lawan kanan -->
            <div class="player-area right">
                <div id="lbl-right" class="player-label"></div>
                <div id="hand-right" class="opponent-hand vertical"></div>
                <div id="score-right" class="e1-score-badge hidden"></div>
            </div>
            <!-- Meja tengah -->
            <div class="table-center">
                <div class="e1-table">
                    <!-- Draw pile -->
                    <div class="e1-pile-wrap">
                        <div id="e1-draw-pile" class="e1-pile e1-draw" title="Ambil dari tumpukan">
                            <div class="card face-down e1-pile-card"></div>
                            <div id="e1-draw-count" class="card-count-badge">0</div>
                        </div>
                        <div class="e1-pile-label">Ambil</div>
                    </div>
                    <!-- Discard pile -->
                    <div class="e1-pile-wrap">
                        <div id="e1-discard-pile" class="e1-pile e1-discard" title="Ambil kartu buangan">
                            <div id="e1-top-discard" class="e1-discard-card"></div>
                        </div>
                        <div class="e1-pile-label">Buangan</div>
                    </div>
                    <!-- Info putaran -->
                    <div class="e1-round-info">
                        <div id="e1-round-label" class="e1-round-label">Putaran 1</div>
                        <div id="e1-knock-label" class="e1-knock-label hidden">🔔 Ada yang Ketok!</div>
                    </div>
                </div>
            </div>
            <!-- Pemain sendiri -->
            <div class="player-area bottom">
                <div class="player-info-bar">
                    <div id="lbl-bottom" class="player-label self"></div>
                    <div id="turn-indicator" class="turn-indicator hidden">Giliran Anda!</div>
                    <div id="e1-myscore" class="e1-myscore-badge"></div>
                </div>
                <div class="self-hand-wrap">
                    <div id="hand-bottom" class="self-hand"></div>
                </div>
            </div>
        </div>

        <!-- Action bar -->
        <div class="action-bar">
            <div class="combo-preview" id="e1-status-bar">
                <span class="combo-preview-label" id="e1-hint">Menunggu giliran…</span>
            </div>
            <div class="action-buttons" id="e1-action-btns">
                <button id="e1-btn-discard" class="btn btn-primary" disabled>Buang</button>
                <button id="e1-btn-knock"   class="btn btn-secondary" disabled>🔔 Ketok</button>
                <button id="e1-btn-cancel"  class="btn btn-ghost" disabled>Batal</button>
            </div>
        </div>

        <div id="game-log" class="game-log"></div>
        `;

        // Event tombol
        document.getElementById('e1-btn-discard').addEventListener('click', () => this.doDiscard());
        document.getElementById('e1-btn-knock').addEventListener('click',   () => this.doKnock());
        document.getElementById('e1-btn-cancel').addEventListener('click',  () => this.doCancelDraw());

        // Klik draw pile
        document.getElementById('e1-draw-pile').addEventListener('click', () => this.doDrawFromPile('draw'));
        // Klik discard pile
        document.getElementById('e1-discard-pile').addEventListener('click', () => this.doDrawFromPile('discard'));
    },

    // ─── 3. GAME LOOP ─────────────────────────────────────────────────────────

    async onRoomUpdate(data) {
        const me = data.players?.[this.myUid];
        if (!me) return;

        const phase = data.phase || '';
        const handCount = me.handCount ?? 0;

        // Reload tangan jika jumlah berubah atau phase baru
        if (handCount !== this._lastHandCount || phase !== this._lastPhase) {
            this._lastHandCount = handCount;
            this._lastPhase = phase;
            await this.loadMyHand(data);
        }

        this.renderGame(data);
    },

    async loadMyHand(data) {
        // Jika fase showdown, tangan sudah direveal di Firestore (field revealedHands)
        // Saat bermain, baca dari subcollection hands
        try {
            const snap = await this.db.collection('rooms').doc(this.roomId)
                .collection('hands').doc(this.myUid).get();
            if (snap.exists) {
                this.myHand = snap.data().cards || [];
            }
        } catch (e) { console.error('[41] loadMyHand', e); }

        // Reset state ambil jika giliran bukan saya
        if (data.currentPlayer !== this.myUid) {
            this.pendingDrawSource = null;
            this.pendingCard = null;
            this.selectedCardId = null;
        }
    },

    // ─── 4. RENDER ────────────────────────────────────────────────────────────

    renderGame(data) {
        const me = data.players?.[this.myUid];
        if (!me) return;

        const allPlayers = Object.values(data.players || {});
        const mySeat     = me.seat;
        const relPos     = seat => ['bottom','left','top','right'][((seat - mySeat + 4) % 4)];
        const slots      = { bottom: null, left: null, top: null, right: null };
        allPlayers.forEach(p => { slots[relPos(p.seat)] = p; });

        // Render tiap slot
        ['bottom','left','top','right'].forEach(pos => this.renderSlot(pos, slots[pos], data));

        // Info meja tengah
        this.renderTable(data);

        // Skor sendiri
        const myScore = this.calcScore(this.myHand);
        const scoreEl = document.getElementById('e1-myscore');
        if (scoreEl) {
            scoreEl.textContent = `Skor: ${myScore}`;
            scoreEl.className = 'e1-myscore-badge' + (myScore >= 38 ? ' high' : '');
        }

        // Turn UI
        const isMyTurn  = data.currentPlayer === this.myUid;
        const knocked   = !!data.knockedBy;
        const phase     = data.phase || '';
        this.renderTurnUI(isMyTurn, knocked, phase, data);

        // Log
        if (data.lastAction && data.lastAction !== Core.lastLogAction) {
            Core.lastLogAction = data.lastAction;
            this.addLog(data.lastAction, data.lastActionPlayer);
        }

        // Putaran label
        const maxRounds  = data.maxRounds || 5;
        const curRound   = data.currentRound || 1;
        const roundEl    = document.getElementById('e1-round-label');
        if (roundEl) roundEl.textContent = `Putaran ${curRound} / ${maxRounds}`;

        // Ketok banner
        const knockEl = document.getElementById('e1-knock-label');
        if (knockEl) {
            if (knocked) {
                const knockerName = data.players?.[data.knockedBy]?.name || '?';
                knockEl.textContent = `🔔 ${knockerName} Ketok! Satu putaran lagi.`;
                knockEl.classList.remove('hidden');
            } else {
                knockEl.classList.add('hidden');
            }
        }

        // Showdown: tampilkan skor semua pemain
        if (phase === 'showdown') {
            this.renderShowdown(data);
        }
    },

    renderSlot(pos, player, data) {
        const lbl   = document.getElementById(`lbl-${pos}`);
        const hnd   = document.getElementById(`hand-${pos}`);
        const scr   = document.getElementById(`score-${pos}`);
        if (!lbl || !hnd) return;

        if (!player) {
            lbl.textContent = ''; hnd.innerHTML = '';
            if (scr) scr.classList.add('hidden');
            return;
        }

        const isActive  = data.currentPlayer === player.uid;
        const isMe      = player.uid === this.myUid;
        lbl.textContent = player.name + (player.eliminated ? ' ✗' : '');
        lbl.className   = `player-label${isMe ? ' self' : ''}${isActive ? ' active-turn' : ''}`;

        // Penalti badge
        const pen = data.penalties?.[player.uid] ?? 0;
        if (pen > 0) lbl.textContent += ` (${pen}✗)`;

        if (pos === 'bottom') {
            this.renderSelfHand(data);
            return;
        }

        // Lawan: tampilkan kartu terbalik
        hnd.innerHTML = '';
        const cnt = player.handCount ?? 0;

        // Fase showdown: tunjukkan kartu terbuka lawan
        if (data.phase === 'showdown' && data.revealedHands?.[player.uid]) {
            const cards = data.revealedHands[player.uid];
            cards.forEach(c => hnd.appendChild(this.createCardEl(c, false)));
            // Tampilkan skor
            if (scr) {
                const s = this.calcScore(cards);
                scr.textContent = `${s} poin`;
                scr.className = `e1-score-badge${s >= 38 ? ' high' : ''}`;
                scr.classList.remove('hidden');
            }
        } else {
            if (scr) scr.classList.add('hidden');
            if (cnt > 0) {
                const wrap = document.createElement('div');
                wrap.className = 'card-stack';
                const fd = this.createFaceDown();
                wrap.appendChild(fd);
                const badge = document.createElement('div');
                badge.className = 'card-count-badge';
                badge.textContent = cnt;
                wrap.appendChild(badge);
                hnd.appendChild(wrap);
            }
        }
    },

    renderSelfHand(data) {
        const hnd = document.getElementById('hand-bottom');
        if (!hnd) return;
        hnd.innerHTML = '';

        const phase      = data?.phase || '';
        const showdown   = phase === 'showdown';
        const isMyTurn   = data?.currentPlayer === this.myUid;

        // Kalau sudah ambil kartu tapi belum buang, tampilkan kartu pending juga
        const displayHand = [...this.myHand];
        if (this.pendingCard && this.pendingDrawSource) {
            // Cek belum ada di tangan
            if (!displayHand.find(c => c.id === this.pendingCard.id)) {
                displayHand.push({ ...this.pendingCard, _pending: true });
            }
        }

        displayHand.forEach(card => {
            const el = this.createCardEl(card, !showdown);
            if (card.id === this.selectedCardId) el.classList.add('selected');
            if (card._pending) el.classList.add('e1-pending-card');
            el.addEventListener('click', () => {
                if (!isMyTurn || showdown) return;
                this.selectCard(card.id);
            });
            hnd.appendChild(el);
        });

        // Hitung dan tampilkan skor saya
        const score = this.calcScore(displayHand);
        const scoreEl = document.getElementById('e1-myscore');
        if (scoreEl) {
            scoreEl.textContent = `Skor: ${score}`;
            scoreEl.className = `e1-myscore-badge${score >= 38 ? ' high' : ''}`;
        }
    },

    renderTable(data) {
        // Draw pile count
        const dcEl = document.getElementById('e1-draw-count');
        if (dcEl) dcEl.textContent = data.drawPileCount ?? 0;

        // Top discard card
        const tdEl = document.getElementById('e1-top-discard');
        if (tdEl) {
            tdEl.innerHTML = '';
            if (data.topDiscard) {
                const el = this.createCardEl(data.topDiscard, false);
                tdEl.appendChild(el);
            } else {
                tdEl.innerHTML = '<div style="color:var(--text-muted);font-size:.7rem;text-align:center;padding:.3rem;">Kosong</div>';
            }
        }

        // Warna-kan draw pile jika giliran saya dan belum ambil
        const drawPileEl    = document.getElementById('e1-draw-pile');
        const discardPileEl = document.getElementById('e1-discard-pile');
        const isMyTurn      = data.currentPlayer === this.myUid;
        const hasPending    = !!this.pendingDrawSource;
        const phase         = data.phase || '';

        if (drawPileEl) {
            drawPileEl.classList.toggle('e1-pile-active', isMyTurn && !hasPending && phase === 'playing');
        }
        if (discardPileEl) {
            discardPileEl.classList.toggle('e1-pile-active', isMyTurn && !hasPending && !!data.topDiscard && phase === 'playing');
        }
    },

    renderTurnUI(isMyTurn, knocked, phase, data) {
        const turnInd   = document.getElementById('turn-indicator');
        const hintEl    = document.getElementById('e1-hint');
        const btnDisc   = document.getElementById('e1-btn-discard');
        const btnKnock  = document.getElementById('e1-btn-knock');
        const btnCancel = document.getElementById('e1-btn-cancel');
        if (!turnInd || !hintEl) return;

        turnInd.classList.toggle('hidden', !isMyTurn);

        if (phase === 'showdown') {
            hintEl.textContent = 'Showdown! Menghitung skor…';
            [btnDisc, btnKnock, btnCancel].forEach(b => { if (b) b.disabled = true; });
            return;
        }

        if (!isMyTurn) {
            hintEl.textContent = `Giliran ${data.players?.[data.currentPlayer]?.name || '…'}`;
            [btnDisc, btnKnock, btnCancel].forEach(b => { if (b) b.disabled = true; });
            this.selectedCardId = null;
            return;
        }

        const hasPending = !!this.pendingDrawSource;
        const hasSelected = !!this.selectedCardId;

        if (!hasPending) {
            hintEl.textContent = knocked
                ? '🔔 Putaran terakhir! Ambil kartu dari tumpukan atau buangan.'
                : 'Ambil kartu dari tumpukan atau ambil buangan.';
            if (btnDisc)   btnDisc.disabled   = true;
            if (btnKnock)  btnKnock.disabled   = true;
            if (btnCancel) btnCancel.disabled  = true;
        } else {
            hintEl.textContent = hasSelected
                ? `Siap buang ${this.selectedCardId} — atau Ketok untuk showdown.`
                : 'Ketuk kartu di tangan untuk dipilih, lalu tekan Buang.';
            if (btnDisc)   btnDisc.disabled   = !hasSelected;
            if (btnKnock)  btnKnock.disabled   = knocked; // Tidak bisa ketok kalau sudah ada yang ketok
            if (btnCancel) btnCancel.disabled  = false;
        }
    },

    renderShowdown(data) {
        // Tampilan skor sudah di-render di renderSlot dan renderSelfHand
        // Hanya perlu disable semua aksi
        const btns = ['e1-btn-discard','e1-btn-knock','e1-btn-cancel'];
        btns.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = true;
        });
    },

    // ─── 5. AKSI PEMAIN ──────────────────────────────────────────────────────

    selectCard(cardId) {
        this.selectedCardId = this.selectedCardId === cardId ? null : cardId;
        this.renderSelfHand(Core.roomData);
        this.renderTurnUI(true, !!Core.roomData?.knockedBy, Core.roomData?.phase, Core.roomData);
    },

    async doDrawFromPile(source) {
        const data = Core.roomData;
        if (!data || data.currentPlayer !== this.myUid) return;
        if (data.phase !== 'playing') return;
        if (this.pendingDrawSource) return; // sudah ambil

        if (source === 'draw') {
            // Ambil dari draw pile via subcollection drawPile
            try {
                const roomRef = this.db.collection('rooms').doc(this.roomId);
                const pileSnap = await roomRef.collection('drawPile').doc('pile').get();
                if (!pileSnap.exists) return Core.showToast('Tumpukan habis!', 'error');
                const pile = pileSnap.data().cards || [];
                if (!pile.length) return Core.showToast('Tumpukan habis!', 'error');

                const drawn = pile[pile.length - 1];
                const newPile = pile.slice(0, -1);

                await roomRef.collection('drawPile').doc('pile').set({ cards: newPile });
                await roomRef.update({
                    drawPileCount: newPile.length,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                });

                this.pendingCard = drawn;
                this.pendingDrawSource = 'draw';
                this.selectedCardId = null;
                Core.showToast(`Ambil ${drawn.rank}${drawn.suit}`, '');
                this.renderSelfHand(Core.roomData);
                this.renderTurnUI(true, !!data.knockedBy, 'playing', data);
            } catch (e) {
                Core.showToast('Gagal ambil kartu.', 'error');
            }

        } else if (source === 'discard') {
            if (!data.topDiscard) return;
            const taken = data.topDiscard;

            try {
                const roomRef = this.db.collection('rooms').doc(this.roomId);
                // Ambil kartu kedua dari atas buangan untuk jadi top baru
                const discSnap = await roomRef.collection('discardPile').doc('pile').get();
                const discPile = discSnap.exists ? (discSnap.data().cards || []) : [];
                const newTop   = discPile.length ? discPile[discPile.length - 1] : null;
                const newDisc  = discPile.length ? discPile.slice(0, -1) : [];

                await roomRef.collection('discardPile').doc('pile').set({ cards: newDisc });
                await roomRef.update({
                    topDiscard: newTop || firebase.firestore.FieldValue.delete(),
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                });

                this.pendingCard = taken;
                this.pendingDrawSource = 'discard';
                this.selectedCardId = null;
                Core.showToast(`Ambil ${taken.rank}${taken.suit} dari buangan`, '');
                this.renderSelfHand(Core.roomData);
                this.renderTurnUI(true, !!data.knockedBy, 'playing', data);
            } catch (e) {
                Core.showToast('Gagal ambil buangan.', 'error');
            }
        }
    },

    async doDiscard() {
        if (!this.pendingDrawSource || !this.pendingCard) return Core.showToast('Ambil kartu dulu!', 'error');
        if (!this.selectedCardId) return Core.showToast('Pilih kartu yang ingin dibuang.', 'error');
        const data = Core.roomData;
        if (!data || data.currentPlayer !== this.myUid) return;

        const me = data.players[this.myUid];

        // Masukkan kartu pending ke tangan, lalu buang yang dipilih
        const fullHand   = [...this.myHand];
        if (!fullHand.find(c => c.id === this.pendingCard.id)) fullHand.push(this.pendingCard);
        const discarded  = fullHand.find(c => c.id === this.selectedCardId);
        if (!discarded) return Core.showToast('Kartu tidak ditemukan.', 'error');
        const newHand    = fullHand.filter(c => c.id !== this.selectedCardId);

        // Cek 41 setelah dapat kartu baru
        const newScore = this.calcScore(newHand);
        const got41    = newScore === 41;

        // Update Firestore
        try {
            const roomRef = this.db.collection('rooms').doc(this.roomId);
            const batch   = this.db.batch();

            // Simpan tangan baru
            batch.set(roomRef.collection('hands').doc(this.myUid), { cards: newHand });

            // Update discard pile
            const discSnap = await roomRef.collection('discardPile').doc('pile').get();
            const discPile = discSnap.exists ? (discSnap.data().cards || []) : [];
            const newDisc  = [...discPile, data.topDiscard].filter(Boolean);
            batch.set(roomRef.collection('discardPile').doc('pile'), { cards: newDisc });

            const active    = data.activePlayers || data.playerOrder || [];
            const nextUid   = this.nextPlayer(this.myUid, active, data.playerOrder);
            const knockedBy = data.knockedBy;

            let updates = {
                topDiscard: discarded,
                [`players.${this.myUid}.handCount`]: newHand.length,
                lastAction: `${me.name} buang ${discarded.rank}${discarded.suit}`,
                lastActionPlayer: this.myUid,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            };

            if (got41) {
                // Langsung showdown, pemain ini menang putaran
                updates = { ...updates, ...await this._buildShowdownUpdate(data, newHand, this.myUid, true) };
            } else if (knockedBy) {
                // Cek apakah sudah balik ke knocker → showdown
                const knockerIdx   = (data.playerOrder || []).indexOf(knockedBy);
                const myIdx        = (data.playerOrder || []).indexOf(this.myUid);
                const isLastBefore = nextUid === knockedBy || active.length <= 1;

                if (isLastBefore) {
                    updates = { ...updates, ...await this._buildShowdownUpdate(data, newHand, null, false) };
                } else {
                    updates.currentPlayer = nextUid;
                }
            } else {
                updates.currentPlayer = nextUid;
            }

            batch.update(roomRef, updates);
            await batch.commit();

            // Reset state lokal
            this.myHand            = newHand;
            this.pendingCard        = null;
            this.pendingDrawSource  = null;
            this.selectedCardId     = null;

            if (got41) Core.showToast('41! Menang putaran! 🎉', 'success');
        } catch (e) {
            console.error('[41] doDiscard', e);
            Core.showToast('Gagal buang kartu.', 'error');
        }
    },

    async doKnock() {
        const data = Core.roomData;
        if (!data || data.currentPlayer !== this.myUid) return;
        if (data.knockedBy) return Core.showToast('Sudah ada yang ketok!', 'error');
        if (!this.pendingDrawSource) return Core.showToast('Ambil kartu dulu sebelum ketok.', 'error');

        // Ketok = harus buang kartu dulu, lalu set knockedBy
        if (!this.selectedCardId) return Core.showToast('Pilih kartu yang ingin dibuang dulu.', 'error');
        await this._knockAndDiscard();
    },

    async _knockAndDiscard() {
        const data = Core.roomData;
        const me   = data.players[this.myUid];

        const fullHand  = [...this.myHand];
        if (!fullHand.find(c => c.id === this.pendingCard.id)) fullHand.push(this.pendingCard);
        const discarded = fullHand.find(c => c.id === this.selectedCardId);
        if (!discarded) return;
        const newHand   = fullHand.filter(c => c.id !== this.selectedCardId);

        try {
            const roomRef = this.db.collection('rooms').doc(this.roomId);
            const batch   = this.db.batch();

            batch.set(roomRef.collection('hands').doc(this.myUid), { cards: newHand });

            const discSnap = await roomRef.collection('discardPile').doc('pile').get();
            const discPile = discSnap.exists ? (discSnap.data().cards || []) : [];
            const newDisc  = [...discPile, data.topDiscard].filter(Boolean);
            batch.set(roomRef.collection('discardPile').doc('pile'), { cards: newDisc });

            const active  = data.activePlayers || data.playerOrder || [];
            const nextUid = this.nextPlayer(this.myUid, active, data.playerOrder);

            batch.update(roomRef, {
                topDiscard:    discarded,
                knockedBy:     this.myUid,
                currentPlayer: nextUid,
                [`players.${this.myUid}.handCount`]: newHand.length,
                lastAction:    `🔔 ${me.name} KETOK! Satu putaran terakhir.`,
                lastActionPlayer: this.myUid,
                lastUpdated:   firebase.firestore.FieldValue.serverTimestamp(),
            });
            await batch.commit();

            this.myHand            = newHand;
            this.pendingCard        = null;
            this.pendingDrawSource  = null;
            this.selectedCardId     = null;

            Core.showToast('Kamu Ketok! Putaran terakhir untuk semua.', 'success');
        } catch (e) {
            Core.showToast('Gagal ketok.', 'error');
        }
    },

    doCancelDraw() {
        // Kembalikan kartu pending ke draw/discard pile
        if (!this.pendingDrawSource || !this.pendingCard) return;
        const data = Core.roomData;

        // Kembalikan secara lokal (tidak tulis ke Firestore — cukup reset state)
        // Kartu pending sudah diambil dari Firestore, jadi kita kembalikan
        this._returnPendingCard().then(() => {
            this.pendingCard        = null;
            this.pendingDrawSource  = null;
            this.selectedCardId     = null;
            this.renderSelfHand(data);
            this.renderTurnUI(true, !!data?.knockedBy, 'playing', data);
        });
    },

    async _returnPendingCard() {
        const data = Core.roomData;
        if (!data || !this.pendingCard) return;
        const roomRef = this.db.collection('rooms').doc(this.roomId);

        try {
            if (this.pendingDrawSource === 'draw') {
                const snap    = await roomRef.collection('drawPile').doc('pile').get();
                const pile    = snap.exists ? (snap.data().cards || []) : [];
                const newPile = [...pile, this.pendingCard];
                await roomRef.collection('drawPile').doc('pile').set({ cards: newPile });
                await roomRef.update({
                    drawPileCount: newPile.length,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                // Kembalikan ke atas discard
                const snap    = await roomRef.collection('discardPile').doc('pile').get();
                const pile    = snap.exists ? (snap.data().cards || []) : [];
                const newPile = [...pile, data.topDiscard].filter(Boolean);
                await roomRef.collection('discardPile').doc('pile').set({ cards: newPile });
                await roomRef.update({
                    topDiscard: this.pendingCard,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                });
            }
        } catch (e) {
            console.error('[41] _returnPendingCard', e);
        }
    },

    // ─── 6. SHOWDOWN & PUTARAN BARU ─────────────────────────────────────────

    async _buildShowdownUpdate(data, myNewHand, winner41Uid, is41) {
        // Baca semua tangan pemain untuk showdown
        const allUids    = data.playerOrder || Object.keys(data.players || {});
        const revealed   = {};
        const scores     = {};

        for (const uid of allUids) {
            try {
                const snap = await this.db.collection('rooms').doc(this.roomId)
                    .collection('hands').doc(uid).get();
                const cards = snap.exists ? (snap.data().cards || []) : [];
                const hand  = uid === this.myUid ? myNewHand : cards;
                revealed[uid] = hand;
                scores[uid]   = this.calcScore(hand);
            } catch (e) {
                revealed[uid] = [];
                scores[uid]   = 0;
            }
        }

        return {
            phase:         'showdown',
            revealedHands: revealed,
            scores:        scores,
            lastAction:    is41
                ? `🎉 ${data.players[winner41Uid]?.name} dapat 41! Menang putaran!`
                : `🔔 Showdown! Menghitung skor…`,
            lastActionPlayer: this.myUid,
        };
    },

    // ─── 7. DECK & MATH ──────────────────────────────────────────────────────

    buildDeck() {
        const SUITS = ['♠','♥','♦','♣'];
        const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
        const deck  = [];
        for (const s of SUITS)
            for (const r of RANKS)
                deck.push({ rank: r, suit: s, id: `${r}${s}` });
        return deck; // 52 kartu
    },

    shuffleDeck(deck) {
        const d = [...deck];
        for (let i = d.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [d[i], d[j]] = [d[j], d[i]];
        }
        return d;
    },

    cardNumValue(card) {
        const map = { A: 11, K: 10, Q: 10, J: 10, '10': 10 };
        return map[card.rank] ?? parseInt(card.rank, 10);
    },

    calcScore(cards) {
        if (!cards || !cards.length) return 0;
        const bySuit = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
        cards.forEach(c => {
            if (bySuit[c.suit] !== undefined)
                bySuit[c.suit] += this.cardNumValue(c);
        });
        return Math.max(...Object.values(bySuit));
    },

    nextPlayer(curUid, active, order) {
        if (!active?.length) return null;
        const ord = (order || []).filter(u => active.includes(u));
        const idx = ord.indexOf(curUid);
        return ord[(idx + 1) % ord.length] || ord[0];
    },

    // ─── 8. UI HELPERS ──────────────────────────────────────────────────────

    createCardEl(card, clickable = true) {
        const el  = document.createElement('div');
        const red = ['♥','♦'].includes(card.suit);
        el.className    = `card ${red ? 'red' : 'black'}`;
        el.dataset.cardId = card.id;
        el.innerHTML    = `
            <div class="card-rank">${card.rank}</div>
            <div class="card-suit">${card.suit}</div>
            <div class="card-rank-bottom">${card.rank}</div>
        `;
        if (!clickable) el.style.cursor = 'default';
        return el;
    },

    createFaceDown() {
        const el = document.createElement('div');
        el.className = 'card face-down';
        return el;
    },

    addLog(msg, uid) {
        const log = document.getElementById('game-log');
        if (!log) return;
        const el = document.createElement('div');
        el.className = 'log-entry' + (uid === this.myUid ? ' highlight' : '');
        el.textContent = msg;
        log.prepend(el);
        while (log.children.length > 30) log.removeChild(log.lastChild);
    },

    // ─── 9. OVERRIDE doStartGame DI CORE ────────────────────────────────────
    // Core memanggil game.buildDeck / game.shuffleDeck, lalu menyimpan tangan ke subcollection hands.
    // Kita perlu juga menyimpan draw pile dan discard pile, dan mengatur maxRounds.
    // Caranya: override lewat hook afterDeal yang dipanggil oleh core.
    // Karena core tidak punya hook afterDeal, kita patch lewat onRoomUpdate pertama kali.

    _initDone: false,

    async _initRound(data) {
        // Dipanggil SATU KALI oleh host saat phase berubah ke 'playing' dan drawPileCount belum ada
        if (this._initDone) return;
        if (data.hostUid !== Core.myUid) return; // hanya host yang setup
        if (data.drawPileCount !== undefined && data.drawPileCount !== null) return;
        this._initDone = true;

        // Semua tangan sudah dibagi oleh Core (4 kartu per pemain).
        // Ambil kartu sisa dari deck baru (bukan dari subcollection hands)
        // — Core sudah menyimpan 4 kartu/pemain. Sisa = 52 - 4*n kartu.
        const players  = Object.values(data.players || {});
        const n        = players.length;
        const fullDeck = this.shuffleDeck(this.buildDeck());

        // Kita perlu tahu kartu yang sudah dibagikan. Baca dari Firestore.
        const dealtCards = new Set();
        for (const p of players) {
            try {
                const snap = await this.db.collection('rooms').doc(this.roomId)
                    .collection('hands').doc(p.uid).get();
                if (snap.exists) (snap.data().cards || []).forEach(c => dealtCards.add(c.id));
            } catch (e) {}
        }

        const remaining = fullDeck.filter(c => !dealtCards.has(c.id));
        // Ambil 1 kartu untuk discard terbuka, sisanya jadi draw pile
        const topDiscard = remaining[remaining.length - 1];
        const drawPile   = remaining.slice(0, -1);

        const roomRef = this.db.collection('rooms').doc(this.roomId);
        await roomRef.collection('drawPile').doc('pile').set({ cards: drawPile });
        await roomRef.collection('discardPile').doc('pile').set({ cards: [] });
        await roomRef.update({
            drawPileCount:  drawPile.length,
            topDiscard:     topDiscard,
            knockedBy:      null,
            scores:         null,
            revealedHands:  firebase.firestore.FieldValue.delete(),
            lastUpdated:    firebase.firestore.FieldValue.serverTimestamp(),
        });
    },

    // Patch onRoomUpdate untuk intercept init round
    _origOnRoomUpdate: null,
};

// Wrap onRoomUpdate untuk intercept _initRound
const _e1OrigUpdate = Empat1Game.onRoomUpdate.bind(Empat1Game);
Empat1Game.onRoomUpdate = async function(data) {
    if (data.phase === 'playing' && (data.drawPileCount === undefined || data.drawPileCount === null)) {
        await this._initRound(data);
    }
    if (data.phase === 'showdown') {
        // Host memproses hasil showdown
        if (data.hostUid === Core.myUid && !data._showdownProcessed) {
            await this._processShowdown(data);
        }
    }
    await _e1OrigUpdate(data);
};

// Tambahkan method _processShowdown
Empat1Game._processShowdown = async function(data) {
    if (data._showdownProcessed) return;
    const scores    = data.scores || {};
    const players   = data.players || {};
    const order     = data.playerOrder || Object.keys(players);

    // Cari skor minimum
    const minScore  = Math.min(...order.map(uid => scores[uid] ?? 0));
    const losers    = order.filter(uid => (scores[uid] ?? 0) === minScore);
    // Cek apakah ada pemenang 41 (skor == 41 — sudah dikecualikan dari penalti)
    // Pemenang 41 sudah menang putaran, jadi loser = skor minimum di antara yang tidak 41
    const nonWinners = order.filter(uid => (scores[uid] ?? 0) !== 41);
    const minNon     = nonWinners.length ? Math.min(...nonWinners.map(uid => scores[uid] ?? 0)) : minScore;
    const actualLosers = nonWinners.filter(uid => (scores[uid] ?? 0) === minNon);

    // Tambah penalti ke loser(s)
    const penUpdates = {};
    actualLosers.forEach(uid => {
        const prev = data.penalties?.[uid] ?? 0;
        penUpdates[`penalties.${uid}`] = prev + 1;
    });

    // Cek apakah game selesai
    const curRound  = data.currentRound || 1;
    const maxRounds = data.maxRounds || 5;
    const newPenalties = { ...(data.penalties || {}) };
    actualLosers.forEach(uid => { newPenalties[uid] = (newPenalties[uid] ?? 0) + 1; });

    // Cek apakah ada pemain yang sudah kalah total (penalti = maxPenalty) — opsional
    // Di sini: game berakhir setelah maxRounds putaran
    const gameOver  = curRound >= maxRounds;

    const loserNames = actualLosers.map(uid => players[uid]?.name || uid).join(', ');
    const logMsg     = `Putaran ${curRound}: ${loserNames} kalah (skor ${minNon})`;

    if (gameOver) {
        // Hitung ranking akhir: sedikit penalti = menang
        const sortedByPenalty = [...order].sort((a, b) =>
            (newPenalties[a] ?? 0) - (newPenalties[b] ?? 0)
        );
        const rankings = sortedByPenalty.map((uid, i) => ({
            uid,
            name:  players[uid]?.name || uid,
            note:  `${newPenalties[uid] ?? 0} penalti`,
            rank:  i + 1,
        }));

        await this.db.collection('rooms').doc(this.roomId).update({
            ...penUpdates,
            _showdownProcessed: true,
            status:  'ended',
            phase:   'ended',
            rankings,
            lastAction: `Game selesai! ${logMsg}`,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });
    } else {
        // Mulai putaran baru
        await this._startNewRound(data, penUpdates, curRound + 1, logMsg, newPenalties);
    }
};

Empat1Game._startNewRound = async function(data, penUpdates, newRound, logMsg, newPenalties) {
    const roomRef   = this.db.collection('rooms').doc(this.roomId);
    const players   = data.players || {};
    const order     = data.playerOrder || Object.keys(players);

    // Siapkan deck baru
    const fullDeck  = this.shuffleDeck(this.buildDeck());
    const n         = order.length;

    // Bagi 4 kartu per pemain
    const hands     = {};
    order.forEach((uid, i) => {
        hands[uid] = fullDeck.slice(i * 4, i * 4 + 4);
    });
    const dealt     = new Set(order.flatMap(uid => hands[uid].map(c => c.id)));
    const remaining = fullDeck.filter(c => !dealt.has(c.id));
    const topDiscard = remaining[remaining.length - 1];
    const drawPile   = remaining.slice(0, -1);

    const batch = this.db.batch();
    order.forEach(uid => {
        batch.set(roomRef.collection('hands').doc(uid), { cards: hands[uid] });
        batch.update(roomRef, { [`players.${uid}.handCount`]: 4 });
    });
    batch.set(roomRef.collection('drawPile').doc('pile'), { cards: drawPile });
    batch.set(roomRef.collection('discardPile').doc('pile'), { cards: [] });

    batch.update(roomRef, {
        ...penUpdates,
        _showdownProcessed: false,
        phase:          'playing',
        status:         'playing',
        currentRound:   newRound,
        currentPlayer:  order[0],
        drawPileCount:  drawPile.length,
        topDiscard:     topDiscard,
        knockedBy:      null,
        scores:         null,
        revealedHands:  firebase.firestore.FieldValue.delete(),
        lastAction:     `Putaran ${newRound} dimulai. ${logMsg}`,
        lastActionPlayer: Core.myUid,
        lastUpdated:    firebase.firestore.FieldValue.serverTimestamp(),
    });

    // Reset _initDone agar putaran berikutnya tidak tersangkut
    this._initDone = true; // kita yang inisialisasi, jadi skip _initRound

    await batch.commit();
};

// ─── 10. WAITING ROOM: HOST ATUR MAX ROUNDS ───────────────────────────────
// Override renderWaiting — tambahkan kontrol maxRounds untuk host
const _e1OrigRegister = Core.registerGame.bind(Core);

// Patch game module agar Core tahu perlu setting maxRounds
Empat1Game.waitingRoomExtra = function(data, isHost) {
    // Dipanggil dari renderWaiting — inject UI pengaturan putaran
    const wrap = document.getElementById('e1-round-setting');
    if (!wrap) return;
    const cur = data.maxRounds || 5;
    if (isHost) {
        wrap.innerHTML = `
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
                <span style="font-size:.75rem;color:var(--text-muted)">⚙ Maks Putaran:</span>
                ${[3,5,7,10].map(v => `
                    <button class="btn btn-sm e1-round-btn ${cur === v ? 'btn-accent' : 'btn-ghost'}"
                        data-rounds="${v}">${v}</button>
                `).join('')}
            </div>
        `;
        wrap.querySelectorAll('.e1-round-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                Core.db.collection('rooms').doc(Core.roomId).update({
                    maxRounds: parseInt(btn.dataset.rounds),
                }).then(() => Core.showToast(`Maks putaran: ${btn.dataset.rounds}`, 'success'));
            });
        });
    } else {
        wrap.innerHTML = `<span style="font-size:.75rem;color:var(--text-muted)">⚙ Maks Putaran: ${cur}</span>`;
    }
};

// ─── 11. PATCH CORE renderWaiting UNTUK INJECT EXTRA UI ──────────────────
const _origRenderWaiting = Core.renderWaiting.bind(Core);
Core.renderWaiting = function(data) {
    _origRenderWaiting(data);

    // Inject container extra setting jika game 41 yang aktif
    if (data.gameId !== 'empat1') {
        const ex = document.getElementById('e1-round-setting');
        if (ex) ex.remove();
        return;
    }

    const container = document.querySelector('.waiting-container');
    if (!container) return;
    let ex = document.getElementById('e1-round-setting');
    if (!ex) {
        ex = document.createElement('div');
        ex.id = 'e1-round-setting';
        ex.style.cssText = 'background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:.6rem .9rem;';
        // Sisipkan setelah game-selector-wrap
        const gsw = document.getElementById('game-selector-wrap');
        if (gsw && gsw.nextSibling) {
            container.insertBefore(ex, gsw.nextSibling);
        } else {
            container.appendChild(ex);
        }
    }
    const isHost = data.hostUid === Core.myUid;
    Empat1Game.waitingRoomExtra(data, isHost);
};

// ─── 12. OVERRIDE doStartGame untuk simpan currentRound & maxRounds ───────
const _origDoStart = Core.doStartGame.bind(Core);
Core.doStartGame = async function(data) {
    // Untuk game 41: simpan currentRound & reset penalties sebelum mulai
    if (data.gameId === 'empat1') {
        try {
            await this.db.collection('rooms').doc(this.roomId).update({
                currentRound: 1,
                maxRounds:    data.maxRounds || 5,
                penalties:    {},
                _showdownProcessed: false,
                knockedBy:    null,
            });
        } catch (e) {}
    }
    await _origDoStart(data);
};

// ─── CSS TAMBAHAN INLINE UNTUK GAME 41 ───────────────────────────────────
(function injectE1Styles() {
    if (document.getElementById('e1-styles')) return;
    const style = document.createElement('style');
    style.id = 'e1-styles';
    style.textContent = `
    /* Tabel tengah game 41 */
    .e1-table {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: .5rem;
    }
    .e1-pile-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: .25rem;
    }
    .e1-table {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: .8rem;
        flex-wrap: wrap;
        justify-content: center;
    }
    .e1-pile {
        position: relative;
        width: var(--card-w);
        height: var(--card-h);
        border-radius: 8px;
        cursor: pointer;
        transition: transform .15s ease, box-shadow .15s ease;
        display: flex; align-items: center; justify-content: center;
    }
    .e1-pile-card {
        width: 100%; height: 100%;
    }
    .e1-pile-active {
        transform: translateY(-4px);
        box-shadow: 0 0 0 2px var(--accent), 0 8px 20px rgba(0,0,0,.5);
    }
    .e1-pile-label {
        font-size: .6rem;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: .05em;
    }
    .e1-discard-card {
        min-width: var(--card-w);
        min-height: var(--card-h);
        display: flex; align-items: center; justify-content: center;
    }
    .e1-round-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: .2rem;
        align-self: center;
    }
    .e1-round-label {
        font-size: .72rem;
        font-weight: 700;
        color: var(--accent);
        text-align: center;
    }
    .e1-knock-label {
        font-size: .68rem;
        color: #ff9944;
        font-weight: 700;
        text-align: center;
        animation: pulse-scale 1s ease-in-out infinite;
    }
    /* Skor badge di sebelah lawan */
    .e1-score-badge {
        font-size: .62rem;
        font-weight: 700;
        color: var(--text-muted);
        background: rgba(0,0,0,.35);
        padding: .15rem .45rem;
        border-radius: 20px;
        margin-top: .15rem;
    }
    .e1-score-badge.high { color: var(--accent); }
    /* Skor milik sendiri */
    .e1-myscore-badge {
        font-size: .65rem;
        font-weight: 700;
        color: var(--text-muted);
        background: rgba(0,0,0,.35);
        padding: .12rem .4rem;
        border-radius: 20px;
    }
    .e1-myscore-badge.high { color: var(--accent); }
    /* Kartu pending (baru diambil, belum dibuang) */
    .e1-pending-card {
        box-shadow: 0 0 0 2px #4a9eff, 0 8px 18px rgba(0,0,0,.5) !important;
        transform: translateY(-10px) !important;
    }
    `;
    document.head.appendChild(style);
})();

// DAFTARKAN KE CORE
Core.registerGame(Empat1Game);