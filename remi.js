/* ================================================
GAME MODULE: REMI BIASA
File: remi.js
Aturan: Giliran berurut, tiap giliran buang 1 kartu bebas.
Tidak ada aturan beat — kartu dibuang ke tumpukan meja.
Siapa paling cepat habis kartu = menang.
================================================ */
"use strict";

const RemiGame = {
    id: 'remi',
    name: 'Remi Biasa',
    db: null,
    roomId: null,
    myUid: null,
    myHand: [],
    selected: null, // hanya 1 kartu bisa dipilih

    // --- 1. INISIALISASI ---
    init(db, roomId, myUid) {
        this.db = db;
        this.roomId = roomId;
        this.myUid = myUid;
        this.myHand = [];
        this.selected = null;
        this.setupUI();
    },

    cleanup() {
        this.myHand = [];
        this.selected = null;
    },

    // --- 2. SETUP UI ---
    setupUI() {
        const canvas = document.getElementById('game-canvas');
        canvas.innerHTML = `
            <div class="game-wrap">
                <div class="player-area top"><div id="label-top" class="player-label"></div><div id="hand-top" class="opponent-hand vertical"></div></div>
                <div class="player-area left"><div id="label-left" class="player-label"></div><div id="hand-left" class="opponent-hand vertical"></div></div>
                <div class="player-area right"><div id="label-right" class="player-label"></div><div id="hand-right" class="opponent-hand vertical"></div></div>
                <div class="table-center">
                    <div class="pot-area">
                        <div class="pot-label">Tumpukan Buang</div>
                        <div id="pot-cards" class="pot-cards"></div>
                        <div id="combo-type-label" class="combo-type-label"></div>
                    </div>
                </div>
                <div class="player-area bottom">
                    <div class="player-info-bar">
                        <div id="label-bottom" class="player-label self"></div>
                        <div id="turn-indicator" class="turn-indicator hidden">Giliran Anda!</div>
                    </div>
                    <div class="self-hand-wrap">
                        <div id="hand-bottom" class="self-hand"></div>
                    </div>
                </div>
            </div>
            <div class="action-bar">
                <div class="combo-preview">
                    <span class="combo-preview-label">Ketuk 1 kartu untuk pilih…</span>
                    <div id="combo-cards-preview"></div>
                </div>
                <div class="action-buttons">
                    <button id="btn-cancel" class="btn btn-ghost">Batal</button>
                    <button id="btn-pass" class="btn btn-secondary">Pass</button>
                    <button id="btn-play" class="btn btn-primary" disabled>Buang!</button>
                </div>
            </div>
            <div id="game-log" class="game-log"></div>
        `;

        document.getElementById('btn-play').addEventListener('click', () => this.playCard());
        document.getElementById('btn-pass').addEventListener('click', () => this.passPlay());
        document.getElementById('btn-cancel').addEventListener('click', () => this.cancelSelect());
    },

    // --- 3. GAME LOOP & RENDER ---
    async onRoomUpdate(data) {
        const me = data.players?.[this.myUid];
        if (!me) return;

        if (this.myHand.length !== me.handCount || this.myHand.length === 0) {
            await this.loadMyHand();
        }
        this.renderGame(data);
    },

    async loadMyHand() {
        try {
            const doc = await this.db.collection('rooms').doc(this.roomId)
                .collection('hands').doc(this.myUid).get();
            if (doc.exists) {
                this.myHand = this.sortHand(doc.data().cards || []);
            }
        } catch (e) { console.error('loadMyHand remi', e); }
    },

    renderGame(data) {
        const me = data.players?.[this.myUid];
        if (!me) return;
        const allPlayers = Object.values(data.players || {});
        const mySeat = me.seat;
        const relPos = seat => (['bottom', 'left', 'top', 'right'])[((seat - mySeat) + 4) % 4];
        const slots = { bottom: null, left: null, top: null, right: null };
        allPlayers.forEach(p => { slots[relPos(p.seat)] = p; });

        for (const pos of ['bottom', 'left', 'top', 'right']) {
            this.renderSlot(pos, slots[pos], data);
        }
        for (let seat = 0; seat < 4; seat++) {
            if (!allPlayers.find(p => p.seat === seat)) {
                this.renderGhost(relPos(seat), data.ghostHands?.[`seat${seat}`] ?? 0);
            }
        }

        // Tampilkan kartu terakhir yang dibuang di meja
        this.renderPot(data.lastPlayedCard);

        const isMyTurn = data.currentPlayer === this.myUid && !me.finished;
        this.setTurnUI(isMyTurn);

        if (data.lastAction && data.lastAction !== Core.lastLogAction) {
            Core.lastLogAction = data.lastAction;
            this.addLog(data.lastAction, data.lastActionPlayer);
        }
    },

    renderSlot(pos, player, data) {
        const lbl = document.getElementById(`label-${pos}`);
        const hnd = document.getElementById(`hand-${pos}`);
        if (pos === 'bottom') {
            if (!player) { lbl.textContent = ''; hnd.innerHTML = ''; return; }
            lbl.textContent = player.name + (player.finished ? ' ✓' : '');
            lbl.className = 'player-label self' + (data.currentPlayer === player.uid ? ' active-turn' : '');
            this.renderSelfHand();
            return;
        }
        if (!player) { lbl.textContent = ''; hnd.innerHTML = ''; return; }
        lbl.textContent = player.name + (player.finished ? ' ✓' : '');
        lbl.className = 'player-label' + (data.currentPlayer === player.uid ? ' active-turn' : '');
        hnd.innerHTML = '';
        const cnt = player.handCount ?? 0;
        if (cnt > 0) {
            const isDesktop = window.innerWidth >= 1024;
            const visible = isDesktop ? Math.min(cnt, 5) : 1;
            const wrap = document.createElement('div');
            wrap.className = 'card-stack';
            for (let i = 0; i < visible; i++) {
                const fd = this.createFaceDown();
                if (isDesktop && visible > 1) {
                    fd.style.position = 'absolute';
                    fd.style.top = `${-i * 3}px`;
                    fd.style.left = `${i * 4}px`;
                    fd.style.zIndex = i;
                }
                wrap.appendChild(fd);
            }
            const b = document.createElement('div');
            b.className = 'card-count-badge';
            b.textContent = cnt;
            wrap.appendChild(b);
            hnd.appendChild(wrap);
        }
    },

    renderGhost(pos, count) {
        if (pos === 'bottom') return;
        const lbl = document.getElementById(`label-${pos}`);
        const hnd = document.getElementById(`hand-${pos}`);
        if (lbl.textContent) return;
        lbl.textContent = '—';
        lbl.className = 'player-label ghost-label';
        hnd.innerHTML = '';
        if (count > 0) {
            const st = document.createElement('div');
            st.className = 'card-stack';
            st.appendChild(this.createFaceDown());
            const b = document.createElement('div');
            b.className = 'card-count-badge';
            b.style.background = '#444';
            b.textContent = count;
            st.appendChild(b);
            hnd.appendChild(st);
        }
    },

    renderSelfHand() {
        const hnd = document.getElementById('hand-bottom');
        hnd.innerHTML = '';
        this.myHand.forEach((card) => {
            const el = this.createCardEl(card);
            el.addEventListener('click', () => this.toggleSelect(card.id));
            hnd.appendChild(el);
        });
        if (this.myHand.length > 0 && this.myHand.length <= 13) {
            const overlap = Math.max(0, (this.myHand.length - 7) * 3);
            hnd.querySelectorAll('.card').forEach((c, i) => {
                c.style.marginLeft = i === 0 ? '0' : `-${overlap}px`;
            });
        }
        this.renderPreview();
    },

    renderPot(card) {
        const pot = document.getElementById('pot-cards');
        const lbl = document.getElementById('combo-type-label');
        pot.innerHTML = '';
        if (!card) { lbl.textContent = ''; return; }
        pot.appendChild(this.createCardEl(card, false));
        lbl.textContent = `${card.rank}${card.suit}`;
    },

    renderPreview() {
        const prev = document.getElementById('combo-cards-preview');
        const lbl = document.querySelector('.combo-preview-label');
        prev.innerHTML = '';
        if (!this.selected) {
            lbl.textContent = 'Ketuk 1 kartu untuk pilih…';
            lbl.style.display = '';
            document.getElementById('btn-play').disabled = true;
            return;
        }
        const card = this.myHand.find(c => c.id === this.selected);
        if (!card) return;
        lbl.style.display = 'none';
        prev.appendChild(this.createCardEl(card, false));
        document.getElementById('btn-play').disabled = false;
    },

    // --- 4. CARD FACTORIES ---
    createCardEl(card, clickable = true) {
        const el = document.createElement('div');
        const red = ['♥', '♦'].includes(card.suit);
        el.className = `card ${red ? 'red' : 'black'}`;
        el.dataset.cardId = card.id;
        if (this.selected === card.id) el.classList.add('selected');
        el.innerHTML = `<div class="card-rank">${card.rank}</div><div class="card-suit">${card.suit}</div><div class="card-rank-bottom">${card.rank}</div>`;
        if (!clickable) el.style.cursor = 'default';
        return el;
    },

    createFaceDown() {
        const el = document.createElement('div');
        el.className = 'card face-down';
        return el;
    },

    // --- 5. GAME ACTIONS ---
    toggleSelect(cardId) {
        this.selected = this.selected === cardId ? null : cardId;
        this.renderSelfHand();
    },

    cancelSelect() {
        this.selected = null;
        this.renderSelfHand();
    },

    async playCard() {
        if (!this.selected) return;
        const card = this.myHand.find(c => c.id === this.selected);
        if (!card) return;

        document.getElementById('btn-play').disabled = true;
        document.getElementById('btn-pass').disabled = true;

        const me = Core.roomData.players[this.myUid];
        const newHand = this.myHand.filter(c => c.id !== this.selected);
        let active = [...(Core.roomData.activePlayers || [])];
        let rankings = [...(Core.roomData.rankings || [])];
        const rankPos = rankings.length + 1;
        const done = newHand.length === 0;
        let newStatus = 'playing';
        let note = `${me.name} buang ${card.rank}${card.suit}`;

        const roomRef = this.db.collection('rooms').doc(this.roomId);
        const batch = this.db.batch();
        batch.set(roomRef.collection('hands').doc(this.myUid), { cards: newHand });

        if (done) {
            rankings.push({ uid: this.myUid, name: me.name, note: `Peringkat ${rankPos}` });
            active = active.filter(u => u !== this.myUid);
            note = `${me.name} habis kartu! Peringkat ${rankPos}`;
            batch.update(roomRef, {
                [`players.${this.myUid}.finished`]: true,
                [`players.${this.myUid}.rank`]: rankPos,
            });
        }

        const next = this.nextPlayer(this.myUid, active, Core.roomData.playerOrder);

        if (active.length === 1) {
            const lu = active[0];
            const lastPos = rankings.length + 1;
            rankings.push({ uid: lu, name: Core.roomData.players[lu]?.name || 'Pemain', note: `Peringkat ${lastPos} — Terakhir 😅` });
            batch.update(roomRef, { [`players.${lu}.finished`]: true, [`players.${lu}.rank`]: lastPos });
            active = [];
            newStatus = 'ended';
        } else if (active.length === 0) {
            newStatus = 'ended';
        }

        batch.update(roomRef, {
            lastPlayedCard: card,
            currentPlayer: next,
            activePlayers: active,
            rankings,
            status: newStatus,
            phase: newStatus === 'ended' ? 'ended' : 'playing',
            lastAction: note,
            lastActionPlayer: this.myUid,
            [`players.${this.myUid}.handCount`]: newHand.length,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });

        await batch.commit();
        this.myHand = newHand;
        this.selected = null;
    },

    async passPlay() {
        const data = Core.roomData;
        const me = data.players[this.myUid];
        const active = data.activePlayers || [];
        const next = this.nextPlayer(this.myUid, active, data.playerOrder);
        await this.db.collection('rooms').doc(this.roomId).update({
            currentPlayer: next,
            lastAction: `${me.name} pass`,
            lastActionPlayer: this.myUid,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });
    },

    nextPlayer(curUid, active, order) {
        if (!active || !active.length) return null;
        const ord = (order || []).filter(u => active.includes(u));
        const idx = ord.indexOf(curUid);
        return ord[(idx + 1) % ord.length] || ord[0];
    },

    // --- 6. UI HELPERS ---
    setTurnUI(isMyTurn) {
        document.getElementById('turn-indicator').classList.toggle('hidden', !isMyTurn);
        document.getElementById('btn-pass').disabled = !isMyTurn;
        document.getElementById('btn-cancel').disabled = !isMyTurn;
        if (!isMyTurn) {
            this.selected = null;
            this.renderSelfHand();
            document.getElementById('btn-play').disabled = true;
        }
    },

    addLog(msg, uid) {
        const log = document.getElementById('game-log');
        const el = document.createElement('div');
        el.className = 'log-entry' + (uid === this.myUid ? ' highlight' : '');
        el.textContent = msg;
        log.prepend(el);
        while (log.children.length > 30) log.removeChild(log.lastChild);
    },

    // --- 7. CARD ENGINE ---
    buildDeck() {
        const SUITS = ['♠', '♥', '♦', '♣'];
        const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const d = [];
        for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s, id: `${r}${s}` });
        return d;
    },

    shuffleDeck(deck) {
        const d = [...deck];
        for (let i = d.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [d[i], d[j]] = [d[j], d[i]];
        }
        return d;
    },

    cardValue(c) {
        const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const SUIT_VAL = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
        return RANKS.indexOf(c.rank) * 4 + (SUIT_VAL[c.suit] ?? 0);
    },

    sortHand(cards) {
        return [...cards].sort((a, b) => this.cardValue(a) - this.cardValue(b));
    },
};

// DAFTARKAN GAME INI KE CORE SYSTEM
Core.registerGame(RemiGame);