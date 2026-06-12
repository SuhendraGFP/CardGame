/* ================================================
GAME MODULE: JENDERAL ONLINE
File: games/jenderal.js
================================================ */
"use strict";

const JenderalGame = {
    id: 'jenderal',
    name: 'Jenderal Online',
    db: null,
    roomId: null,
    myUid: null,
    myHand: [],
    selected: new Set(),
    dragSrcIdx: null,

    // --- 1. INISIALISASI ---
    init(db, roomId, myUid) {
        this.db = db;
        this.roomId = roomId;
        this.myUid = myUid;
        this.myHand = [];
        this.selected = new Set();
        this.dragSrcIdx = null;
        this.setupUI();
    },

    cleanup() {
        this.myHand = [];
        this.selected.clear();
        this.dragSrcIdx = null;
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
                        <div class="pot-label">Meja</div>
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
                    <span class="combo-preview-label">Ketuk kartu untuk pilih…</span>
                    <div id="combo-cards-preview"></div>
                </div>
                <div class="action-buttons">
                    <button id="btn-cancel" class="btn btn-ghost">Batal</button>
                    <button id="btn-pass" class="btn btn-secondary">Pass</button>
                    <button id="btn-play" class="btn btn-primary" disabled>Main!</button>
                </div>
            </div>
            <div id="game-log" class="game-log"></div>
        `;
        
        document.getElementById('btn-play').addEventListener('click', () => this.playCards());
        document.getElementById('btn-pass').addEventListener('click', () => this.passPlay());
        document.getElementById('btn-cancel').addEventListener('click', () => this.cancelCombo());
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
            const doc = await this.db.collection('rooms').doc(this.roomId).collection('hands').doc(this.myUid).get();
            if (doc.exists) {
                const cards = this.sortHand(doc.data().cards || []);
                if (this.myHand.length === cards.length && this.myHand.every(c => cards.find(x => x.id === c.id))) {
                    // keep local order
                } else {
                    this.myHand = cards;
                }
            }
        } catch (e) { console.error('loadMyHand', e); }
    },

    renderGame(data) {
        const me = data.players?.[this.myUid];
        if (!me) return;
        const allPlayers = Object.values(data.players || {});
        const mySeat = me.seat;
        const relPos = seat => {
            const diff = ((seat - mySeat) + 4) % 4;
            return ['bottom', 'left', 'top', 'right'][diff];
        };
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
        this.renderPot(data.currentCombo);
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
        this.myHand.forEach((card, idx) => {
            const el = this.createCardEl(card);
            el.addEventListener('click', () => this.toggleSelect(card.id));
            this.attachDrag(el, idx);
            hnd.appendChild(el);
        });
        if (this.myHand.length > 0 && this.myHand.length <= 13) {
            const overlap = Math.max(0, (this.myHand.length - 7) * 3);
            hnd.querySelectorAll('.card').forEach((c, i) => {
                c.style.marginLeft = i === 0 ? '0' : `-${overlap}px`;
            });
        }
        this.renderComboPreview();
    },

    attachDrag(el, idx) {
        el.draggable = true;
        el.addEventListener('dragstart', e => {
            this.dragSrcIdx = idx;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
        el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
        el.addEventListener('drop', e => {
            e.preventDefault();
            el.classList.remove('drag-over');
            this.reorderHand(this.dragSrcIdx, idx);
        });

        let touchDragActive = false;
        let touchTimer;
        el.addEventListener('touchstart', e => {
            touchTimer = setTimeout(() => {
                touchDragActive = true;
                el.classList.add('dragging');
            }, 300);
        }, { passive: true });

        el.addEventListener('touchmove', e => {
            if (!touchDragActive) { clearTimeout(touchTimer); return; }
            e.preventDefault();
            const t = e.touches[0];
            document.querySelectorAll('.card.drag-over').forEach(c => c.classList.remove('drag-over'));
            const targetCard = document.elementFromPoint(t.clientX, t.clientY)?.closest('.card');
            if (targetCard && targetCard !== el) targetCard.classList.add('drag-over');
        }, { passive: false });

        el.addEventListener('touchend', e => {
            clearTimeout(touchTimer);
            if (!touchDragActive) return;
            touchDragActive = false;
            el.classList.remove('dragging');
            const t = e.changedTouches[0];
            const targetCard = document.elementFromPoint(t.clientX, t.clientY)?.closest('.card[data-idx]');
            document.querySelectorAll('.card.drag-over').forEach(c => c.classList.remove('drag-over'));
            if (targetCard) {
                const targetIdx = parseInt(targetCard.dataset.idx);
                this.reorderHand(idx, targetIdx);
            }
        });
        el.dataset.idx = idx;
    },

    reorderHand(fromIdx, toIdx) {
        if (fromIdx === toIdx || fromIdx == null || toIdx == null) return;
        const h = [...this.myHand];
        const [moved] = h.splice(fromIdx, 1);
        h.splice(toIdx, 0, moved);
        this.myHand = h;
        this.renderSelfHand();
    },

    renderPot(combo) {
        const pot = document.getElementById('pot-cards');
        const lbl = document.getElementById('combo-type-label');
        pot.innerHTML = '';
        if (!combo || !combo.cards?.length) { lbl.textContent = ''; return; }
        combo.cards.forEach(c => pot.appendChild(this.createCardEl(c, false)));
        lbl.textContent = this.comboLabel(combo.type, combo.len);
    },

    renderComboPreview() {
        const prev = document.getElementById('combo-cards-preview');
        const lbl = document.querySelector('.combo-preview-label');
        prev.innerHTML = '';
        const sel = this.myHand.filter(c => this.selected.has(c.id));
        if (!sel.length) {
            lbl.textContent = 'Ketuk kartu untuk pilih…';
            lbl.style.display = '';
            this.enablePlay(false);
            return;
        }
        lbl.style.display = 'none';
        sel.forEach(c => prev.appendChild(this.createCardEl(c, false)));
        const combo = this.detectCombo(sel);
        this.enablePlay(!!combo);
        if (combo) document.querySelector('.combo-preview-label').textContent = this.comboLabel(combo.type, combo.len);
    },

    // --- 4. CARD FACTORIES ---
    createCardEl(card, clickable = true) {
        const el = document.createElement('div');
        const red = ['♥', '♦'].includes(card.suit);
        el.className = `card ${red ? 'red' : 'black'}`;
        el.dataset.cardId = card.id;
        if (this.selected.has(card.id)) el.classList.add('selected');
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
        if (this.selected.has(cardId)) this.selected.delete(cardId);
        else this.selected.add(cardId);
        this.renderSelfHand();
    },

    cancelCombo() {
        this.selected.clear();
        this.renderSelfHand();
    },

    async playCards() {
        const sel = this.myHand.filter(c => this.selected.has(c.id));
        if (!sel.length) return;
        const attempt = this.detectCombo(sel);
        if (!attempt) return Core.showToast('Kombinasi tidak valid!', 'error');
        
        const current = Core.roomData?.currentCombo;
        if (!this.canBeat(current, attempt)) return Core.showToast('Tidak cukup tinggi!', 'error');

        document.getElementById('btn-play').disabled = true;
        document.getElementById('btn-pass').disabled = true;

        const newHand = this.myHand.filter(c => !this.selected.has(c.id));
        const isFour = attempt.type === 'four';
        const done = newHand.length === 0;
        const roomRef = this.db.collection('rooms').doc(this.roomId);
        const batch = this.db.batch();
        
        batch.set(roomRef.collection('hands').doc(this.myUid), { cards: newHand });
        const me = Core.roomData.players[this.myUid];
        let active = [...(Core.roomData.activePlayers || [])];
        let rankings = [...(Core.roomData.rankings || [])];
        let newStatus = 'playing';
        let note = '';
        const comboWithOwner = { ...attempt, playedBy: this.myUid };
        const rankPos = rankings.length + 1;

        if (isFour) {
            rankings.push({ uid: this.myUid, name: me.name, note: `Peringkat ${rankPos} — Four of a Kind! 🎉` });
            active = active.filter(u => u !== this.myUid);
            note = `${me.name} FOUR OF A KIND! Peringkat ${rankPos}`;
            batch.update(roomRef, { [`players.${this.myUid}.finished`]: true, [`players.${this.myUid}.rank`]: rankPos });
        } else if (done) {
            rankings.push({ uid: this.myUid, name: me.name, note: `Peringkat ${rankPos}` });
            active = active.filter(u => u !== this.myUid);
            note = `${me.name} menghabiskan kartu! Peringkat ${rankPos}`;
            batch.update(roomRef, { [`players.${this.myUid}.finished`]: true, [`players.${this.myUid}.rank`]: rankPos });
        } else {
            note = `${me.name}: ${this.comboLabel(attempt.type, attempt.len)} (${sel.map(c => c.rank + c.suit).join(' ')})`;
        }

        // Hitung next SETELAH active difilter, supaya giliran tidak balik ke pemain yang sudah selesai
        let next = this.nextPlayer(this.myUid, active, Core.roomData.playerOrder);

        if (active.length === 1) {
            const lu = active[0];
            const lastPos = rankings.length + 1;
            rankings.push({ uid: lu, name: Core.roomData.players[lu]?.name || 'Pemain', note: `Peringkat ${lastPos} — Jenderal Terakhir 😈` });
            batch.update(roomRef, { [`players.${lu}.finished`]: true, [`players.${lu}.rank`]: lastPos });
            active = []; newStatus = 'ended';
        } else if (active.length === 0) {
            newStatus = 'ended';
        }

        batch.update(roomRef, {
            currentCombo: comboWithOwner, currentPlayer: next, passCount: 0, activePlayers: active, rankings,
            status: newStatus, phase: newStatus === 'ended' ? 'ended' : 'playing',
            lastAction: note, lastActionPlayer: this.myUid, [`players.${this.myUid}.handCount`]: newHand.length,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        this.myHand = newHand;
        this.selected.clear();
    },

    async passPlay() {
        const data = Core.roomData;
        const active = data.activePlayers || [];
        const me = data.players[this.myUid];
        const newPass = (data.passCount || 0) + 1;
        const next = this.nextPlayer(this.myUid, active, data.playerOrder);

        if (newPass >= active.length - 1) {
            const lastPlayer = data.currentCombo?.playedBy || this.myUid;
            const newCurrent = active.includes(lastPlayer) ? lastPlayer : this.nextPlayer(lastPlayer, active, data.playerOrder);
            await this.db.collection('rooms').doc(this.roomId).update({
                currentCombo: null, passCount: 0, currentPlayer: newCurrent,
                lastAction: `${me.name} pass — Putaran baru!`, lastActionPlayer: this.myUid,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            });
            return;
        }
        await this.db.collection('rooms').doc(this.roomId).update({
            currentPlayer: next, passCount: newPass,
            lastAction: `${me.name} pass`, lastActionPlayer: this.myUid,
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
            this.selected.clear();
            this.renderSelfHand();
            this.enablePlay(false);
        }
    },

    enablePlay(v) {
        const isMyTurn = !document.getElementById('btn-pass').disabled;
        document.getElementById('btn-play').disabled = !v || !isMyTurn;
    },

    addLog(msg, uid) {
        const log = document.getElementById('game-log');
        const el = document.createElement('div');
        el.className = 'log-entry' + (uid === this.myUid ? ' highlight' : '');
        el.textContent = msg;
        log.prepend(el);
        while (log.children.length > 30) log.removeChild(log.lastChild);
    },

    // --- 7. CARD ENGINE (ATURAN PERMAINAN) ---
    buildDeck() {
        const SUITS = ['♠', '♥', '♦', '♣'];
        const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
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
        const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
        const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i]));
        const SUIT_VAL = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
        return RANK_VAL[c.rank] * 4 + SUIT_VAL[c.suit];
    },

    compareCards(a, b) {
        return this.cardValue(a) - this.cardValue(b);
    },

    sortHand(cards) {
        return [...cards].sort((a, b) => this.compareCards(a, b));
    },

    detectCombo(cards) {
        if (!cards || !cards.length) return null;
        const n = cards.length, s = this.sortHand(cards);
        const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
        const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i]));
        const ComboType = { SINGLE: 'single', TRIPLE: 'triple', FULLHOUSE: 'fullhouse', STRAIGHT: 'straight', DBLSTRAIGHT: 'dblstraight', FOUR: 'four' };

        if (n === 1) return { type: ComboType.SINGLE, cards: s, high: this.cardValue(s[0]) };

        // n === 2: pair tidak boleh dimainkan sendiri
        if (n === 2) return null;

        if (n === 3) {
            const r = s.map(c => c.rank);
            // Triple
            if (r.every(x => x === r[0])) return { type: ComboType.TRIPLE, cards: s, high: this.cardValue(s[2]) };
            // Straight 3 kartu (min 3 berurut, tidak boleh ada angka 2)
            if (!s.some(c => c.rank === '2')) {
                const ri = s.map(c => RANK_VAL[c.rank]);
                const ok = ri.every((v, i) => i === 0 || v === ri[i - 1] + 1);
                if (ok && new Set(r).size === 3) return { type: ComboType.STRAIGHT, cards: s, high: this.cardValue(s[2]), len: 3 };
            }
            return null;
        }
        if (n === 4) {
            const r = s.map(c => c.rank);
            if (r.every(x => x === r[0])) return { type: ComboType.FOUR, cards: s, high: this.cardValue(s[3]) };
            // Double straight (2 pasang berurut) — tetap ada
            const freq4 = {};
            s.forEach(c => { freq4[c.rank] = (freq4[c.rank] || 0) + 1; });
            const ranks4 = Object.keys(freq4);
            if (ranks4.length === 2 && Object.values(freq4).every(v => v === 2) && !s.some(c => c.rank === '2')) {
                const rv = ranks4.map(r => RANK_VAL[r]).sort((a, b) => a - b);
                if (rv[1] - rv[0] === 1) return { type: ComboType.DBLSTRAIGHT, cards: s, high: this.cardValue(s[s.length - 1]), len: 2 };
            }
            // Straight 4 kartu
            if (!s.some(c => c.rank === '2')) {
                const ri = s.map(c => RANK_VAL[c.rank]);
                const ok = ri.every((v, i) => i === 0 || v === ri[i - 1] + 1);
                if (ok && new Set(r).size === 4) return { type: ComboType.STRAIGHT, cards: s, high: this.cardValue(s[3]), len: 4 };
            }
            return null;
        }
        if (n === 5) {
            const freq5 = {};
            s.forEach(c => { freq5[c.rank] = (freq5[c.rank] || 0) + 1; });
            const counts5 = Object.values(freq5).sort((a, b) => b - a);
            if (counts5[0] === 3 && counts5[1] === 2) {
                const tripleRank = Object.entries(freq5).find(([, v]) => v === 3)[0];
                const tripleCards = s.filter(c => c.rank === tripleRank);
                return { type: ComboType.FULLHOUSE, cards: s, high: this.cardValue(tripleCards[tripleCards.length - 1]) };
            }
            if (!s.some(c => c.rank === '2')) {
                const ri = s.map(c => RANK_VAL[c.rank]);
                const ok = ri.every((v, i) => i === 0 || v === ri[i - 1] + 1);
                if (ok && new Set(s.map(c => c.rank)).size === 5) return { type: ComboType.STRAIGHT, cards: s, high: this.cardValue(s[4]), len: 5 };
            }
            return null;
        }
        if (n === 6) {
            const freq6 = {};
            s.forEach(c => { freq6[c.rank] = (freq6[c.rank] || 0) + 1; });
            const ranks6 = Object.keys(freq6);
            if (ranks6.length === 3 && Object.values(freq6).every(v => v === 2) && !s.some(c => c.rank === '2')) {
                const rv = ranks6.map(r => RANK_VAL[r]).sort((a, b) => a - b);
                if (rv[1] - rv[0] === 1 && rv[2] - rv[1] === 1) return { type: ComboType.DBLSTRAIGHT, cards: s, high: this.cardValue(s[s.length - 1]), len: 3 };
            }
            if (!s.some(c => c.rank === '2')) {
                const ri = s.map(c => RANK_VAL[c.rank]);
                const ok = ri.every((v, i) => i === 0 || v === ri[i - 1] + 1);
                if (ok && new Set(s.map(c => c.rank)).size === 6) return { type: ComboType.STRAIGHT, cards: s, high: this.cardValue(s[5]), len: 6 };
            }
            return null;
        }
        if (n === 8) {
            const freq8 = {};
            s.forEach(c => { freq8[c.rank] = (freq8[c.rank] || 0) + 1; });
            const ranks8 = Object.keys(freq8);
            if (ranks8.length === 4 && Object.values(freq8).every(v => v === 2) && !s.some(c => c.rank === '2')) {
                const rv = ranks8.map(r => RANK_VAL[r]).sort((a, b) => a - b);
                if (rv[1] - rv[0] === 1 && rv[2] - rv[1] === 1 && rv[3] - rv[2] === 1) return { type: ComboType.DBLSTRAIGHT, cards: s, high: this.cardValue(s[s.length - 1]), len: 4 };
            }
        }
        if (n >= 7) {
            if (s.some(c => c.rank === '2')) return null;
            const ri = s.map(c => RANK_VAL[c.rank]);
            const ok = ri.every((v, i) => i === 0 || v === ri[i - 1] + 1);
            if (ok && new Set(s.map(c => c.rank)).size === n) return { type: ComboType.STRAIGHT, cards: s, high: this.cardValue(s[n - 1]), len: n };
        }
        return null;
    },

    canBeat(cur, att) {
        if (!cur) return true;
        if (att.type === 'four') return true;
        if (cur.type === 'four') return false;
        if (cur.type !== att.type) return false;
        if ((cur.type === 'straight' || cur.type === 'dblstraight') && cur.len !== att.len) return false;
        return att.high > cur.high;
    },

    comboLabel(type, len) {
        const base = { single: 'Single', triple: 'Triple', fullhouse: 'Full House', straight: 'Straight', dblstraight: 'Double Straight', four: 'FOUR OF A KIND! 🎉' }[type] || '';
        if ((type === 'straight' || type === 'dblstraight') && len) return `${base} (${len})`;
        return base;
    }
};

// DAFTARKAN GAME INI KE CORE SYSTEM
Core.registerGame(JenderalGame);