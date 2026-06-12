/* ================================================
CORE SYSTEM - JENDERAL ONLINE
File: core.js
Mengurus: Firebase, Lobby, Room Management, Animasi, Routing Game
================================================ */
"use strict";

const Core = {
    // --- STATE ---
    db: null,
    auth: null,
    myUid: null,
    myName: null,
    roomId: null,
    roomData: null,
    unsubRoom: null,
    isHost: false,
    
    // --- MODULAR GAME STATE ---
    activeGame: null,
    gameRegistry: {},
    
    // --- ANIMATION & UI TRACKERS ---
    _lastDealAt: '',
    _winnerShown: false,
    lastLogAction: '',

    // --- 1. REGISTRASI GAME ---
    registerGame(gameModule) {
        this.gameRegistry[gameModule.id] = gameModule;
        console.log(`[Core] Game terdaftar: ${gameModule.name}`);
    },

    // --- 2. FIREBASE INIT ---
    initFirebase() {
        const firebaseConfig = {
            apiKey: "AIzaSyDmvjWxdrpjsX6KXoV6ICVySjqiEiJEuDM",
            authDomain: "jendral-a50ff.firebaseapp.com",
            projectId: "jendral-a50ff",
            storageBucket: "jendral-a50ff.firebasestorage.app",
            messagingSenderId: "159159752383",
            appId: "1:159159752383:web:62163996db10f5ce73580a",
            measurementId: "G-YTHVQV1L47"
        };
        
        try {
            if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
            this.db = firebase.firestore();
            this.auth = firebase.auth();
            
            this.auth.onAuthStateChanged(user => {
                if (user) {
                    this.myUid = user.uid;
                    this.setAuthUI('ready');
                } else {
                    this.setAuthUI('loading');
                    this.auth.signInAnonymously().catch(e => this.setAuthUI('error', e.message));
                }
            });
        } catch (e) {
            this.setAuthUI('error', 'Konfigurasi Firebase salah: ' + e.message);
        }
    },

    setAuthUI(state, msg) {
        const bc = document.getElementById('btn-create');
        const bj = document.getElementById('btn-join-toggle');
        const er = document.getElementById('lobby-error');
        
        if (state === 'loading') {
            bc.disabled = bj.disabled = true;
            bc.textContent = bj.textContent = '⏳ Menghubungkan…';
        } else if (state === 'ready') {
            bc.disabled = bj.disabled = false;
            bc.innerHTML = '<span class="btn-icon">⊕</span> Buat Room';
            bj.innerHTML = '<span class="btn-icon">⊞</span> Gabung Room';
            er.classList.add('hidden');
        } else {
            bc.disabled = bj.disabled = false;
            bc.innerHTML = '<span class="btn-icon">⊕</span> Buat Room';
            bj.innerHTML = '<span class="btn-icon">⊞</span> Gabung Room';
            er.textContent = '⚠ ' + msg;
            er.classList.remove('hidden');
        }
    },

    // --- 3. ROOM MANAGEMENT ---
    genCode() {
        const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = ''; 
        for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
        return s;
    },

    makePlayer(uid, name, seat) {
        return { uid, name, seat, ready: false, handCount: 0, finished: false, rank: null };
    },

    async createRoom(name) {
        const gameId = 'jenderal'; // default, bisa diubah host di waiting room
        const game = this.gameRegistry[gameId];
        if (!game) return this.showToast('Game tidak ditemukan!', 'error');

        const code = this.genCode();
        const player = this.makePlayer(this.myUid, name, 0);
        const doc = {
            code, 
            gameId, // PENTING: Menyimpan ID game yang dipilih
            status: 'waiting', 
            phase: 'ready',
            players: { [this.myUid]: player }, 
            playerOrder: [this.myUid],
            hostUid: this.myUid, 
            currentCombo: null, 
            currentPlayer: null,
            passCount: 0, 
            rankings: [], 
            activePlayers: [],
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        };
        
        try {
            const ref = await this.db.collection('rooms').add(doc);
            this.roomId = ref.id; 
            this.myName = name; 
            this.isHost = true;
            this.enterWaiting(); 
            this.subscribeRoom();
        } catch (e) { 
            this.showToast('Gagal buat room: ' + e.message, 'error'); 
        }
    },

    async joinRoom(name, code) {
        if (code.length < 4) return this.showError('Kode room tidak valid.');
        
        try {
            const snap = await this.db.collection('rooms')
                .where('code', '==', code)
                .where('status', '==', 'waiting')
                .limit(1).get();
                
            if (snap.empty) return this.showError('Room tidak ditemukan atau sudah mulai.');
            
            const ref = snap.docs[0].ref;
            const data = snap.docs[0].data();
            const count = Object.keys(data.players || {}).length;
            
            if (count >= 4) return this.showError('Room sudah penuh.');
            
            const player = this.makePlayer(this.myUid, name, count);
            await ref.update({
                [`players.${this.myUid}`]: player,
                playerOrder: firebase.firestore.FieldValue.arrayUnion(this.myUid),
            });
            
            this.roomId = snap.docs[0].id; 
            this.myName = name; 
            this.isHost = false;
            this.enterWaiting(); 
            this.subscribeRoom();
        } catch (e) { 
            this.showError('Gagal gabung: ' + e.message); 
        }
    },

    async leaveRoom() {
        if (this.unsubRoom) this.unsubRoom();
        
        if (this.roomId && this.myUid) {
            try {
                await this.db.collection('rooms').doc(this.roomId).update({
                    [`players.${this.myUid}`]: firebase.firestore.FieldValue.delete(),
                    playerOrder: firebase.firestore.FieldValue.arrayRemove(this.myUid),
                });
            } catch (e) {}
        }
        
        // Bersihkan state game aktif
        if (this.activeGame && this.activeGame.cleanup) {
            this.activeGame.cleanup();
        }
        
        this.activeGame = null;
        this.roomId = null; 
        this.roomData = null; 
        this.isHost = false;
        this._winnerShown = false; 
        this._lastDealAt = '';
        this.chatUnsubscribe();
        this.showScreen('lobby');
    },

    // --- 4. REALTIME LISTENER & ROUTING ---
    subscribeRoom() {
        if (this.unsubRoom) this.unsubRoom();
        this.unsubRoom = this.db.collection('rooms').doc(this.roomId).onSnapshot(snap => {
            if (!snap.exists) {
                this.showToast('Room dihapus.', 'error');
                this.showScreen('lobby');
                return;
            }
            this.roomData = snap.data();
            this.onRoomUpdate(this.roomData);
        }, e => console.error('snapshot err', e));
    },

    onRoomUpdate(data) {
        if (data.status === 'waiting') {
            this._winnerShown = false;
            const curScreen = document.querySelector('.screen.active');
            if (!curScreen || curScreen.id !== 'screen-waiting') this.showScreen('waiting');
            this.renderWaiting(data);
            
            // Auto start: semua ready & >= 2 pemain & kita host
            const players = Object.values(data.players || {});
            if (players.length >= 2 && players.every(p => p.ready) && data.hostUid === this.myUid) {
                this.doStartGame(data);
            }
        } 
        else if (data.phase === 'dealing') {
            // Non-host: tampilkan animasi saat host mengatur fase ke 'dealing'
            if (data.hostUid !== this.myUid) {
                const dealAt = data.dealStartAt?.toMillis?.() + '';
                if (dealAt !== this._lastDealAt) {
                    this._lastDealAt = dealAt;
                    const pCount = Object.keys(data.players || {}).length;
                    this.playDealAnimation(pCount);
                }
            }
        } 
        else if (data.status === 'ended') {
            if (!this._winnerShown) {
                this._winnerShown = true;
                this.showWinnerAnimation(data, () => {
                    // Jika game module punya fungsi showWinner khusus, panggil itu dulu
                    if (this.activeGame && this.activeGame.showWinner) {
                        this.activeGame.showWinner(data, () => this.showRankingAndScreen(data));
                    } else {
                        this.showRankingAndScreen(data);
                    }
                });
            }
        }
        else if (data.status === 'playing' || data.phase === 'playing') {
            const cur = document.querySelector('.screen.active');
            if (!cur || cur.id !== 'screen-game') this.showScreen('game');
            
            // ROUTING: Pastikan game module yang benar aktif
            if (!this.activeGame || this.activeGame.id !== data.gameId) {
                this.activeGame = this.gameRegistry[data.gameId];
                if (this.activeGame) {
                    this.activeGame.init(this.db, this.roomId, this.myUid);
                }
            }
            
            // Delegasikan rendering dan logika ke game module
            if (this.activeGame) {
                this.activeGame.onRoomUpdate(data);
            }
        }
    },

    showRankingAndScreen(data) {
        if (this.activeGame && this.activeGame.renderRanking) {
            this.activeGame.renderRanking(data.rankings || []);
        } else {
            this.renderRanking(data.rankings || []);
        }
        this.showScreen('ranking');
    },

    // --- 5. WAITING ROOM UI ---
    enterWaiting() {
        this.showScreen('waiting');
        document.getElementById('display-room-code').textContent = '…';
    },

    renderWaiting(data) {
        document.getElementById('display-room-code').textContent = data.code || '…';
        const players = data.players || {};
        const isHost = data.hostUid === this.myUid;

        // --- Game selector ---
        const selectorWrap = document.getElementById('game-selector-wrap');
        const games = Object.values(this.gameRegistry);
        if (games.length > 1) {
            selectorWrap.innerHTML = `
                <div class="game-selector-bar">
                    <span class="game-selector-label">🎮 Permainan:</span>
                    ${games.map(g => `
                        <button class="btn btn-sm game-pick-btn ${data.gameId === g.id ? 'btn-accent' : 'btn-ghost'}"
                            data-gameid="${g.id}"
                            ${!isHost ? 'disabled' : ''}>
                            ${g.name}
                        </button>
                    `).join('')}
                </div>
            `;
            if (isHost) {
                selectorWrap.querySelectorAll('.game-pick-btn').forEach(btn => {
                    btn.addEventListener('click', () => Core.changeGame(btn.dataset.gameid));
                });
            }
        } else {
            selectorWrap.innerHTML = '';
        }
        const grid = document.getElementById('seats-grid');
        grid.innerHTML = '';
        
        for (let i = 0; i < 4; i++) {
            const p = Object.values(players).find(x => x.seat === i);
            const card = document.createElement('div');
            card.className = 'seat-card' + (p ? ' occupied' : '') + (p && p.uid === this.myUid ? ' self' : '');
            
            if (p) {
                const init = p.name.substring(0, 2).toUpperCase();
                card.innerHTML = `
                    <div class="seat-avatar filled">${init}</div>
                    <div class="seat-info">
                        <div class="seat-name">${this.esc(p.name)}</div>
                        <div class="seat-status ${p.ready ? 'ready' : 'waiting'}">${p.ready ? 'Siap ✓' : 'Menunggu…'}</div>
                    </div>
                    ${p.ready ? '<span class="seat-ready-badge">SIAP</span>' : ''}
                `;
            } else {
                card.innerHTML = `
                    <div class="seat-avatar empty">+</div>
                    <div class="seat-info">
                        <div class="seat-name" style="color:var(--text-muted)">Kursi ${i + 1}</div>
                        <div class="seat-status empty">Kosong</div>
                    </div>
                `;
            }
            grid.appendChild(card);
        }
        
        // Ready button
        const me = players[this.myUid];
        const readyBtn = document.getElementById('btn-ready');
        if (me) {
            readyBtn.textContent = me.ready ? '✓ Sudah Siap' : 'Siap!';
            readyBtn.className = me.ready ? 'btn btn-ghost' : 'btn btn-primary';
        }
        
        // Host start button
        const count = Object.keys(players).length;
        const startBtn = document.getElementById('btn-start-host');
        startBtn.classList.toggle('hidden', !(isHost && count >= 2));
        
        // Status text
        const allRdy = Object.values(players).every(p => p.ready);
        document.getElementById('waiting-status').textContent = 
            count < 2 ? `Menunggu pemain… (${count}/4)` :
            allRdy ? 'Semua siap! Memulai permainan…' : `${count} pemain · Menunggu semua siap…`;
    },

    async toggleReady() {
        if (!this.roomId || !this.myUid) return;
        const me = this.roomData?.players?.[this.myUid];
        if (!me) return;
        await this.db.collection('rooms').doc(this.roomId).update({
            [`players.${this.myUid}.ready`]: !me.ready,
        });
    },

    async hostForceStart() {
        const data = this.roomData;
        if (!data || data.hostUid !== this.myUid) return;
        const count = Object.keys(data.players || {}).length;
        if (count < 2) return this.showToast('Minimal 2 pemain.', 'error');
        await this.doStartGame(data);
    },

    async changeGame(gameId) {
        if (!this.roomId || !this.isHost) return;
        if (!this.gameRegistry[gameId]) return;
        if (this.roomData?.gameId === gameId) return;
        await this.db.collection('rooms').doc(this.roomId).update({ gameId });
        this.showToast(`Game diganti ke ${this.gameRegistry[gameId].name}`, 'success');
    },

    // --- 6. GAME START & ANIMATIONS ---
    // Helper deck (bisa di-override oleh game module jika perlu)
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

    async doStartGame(data) {
        if (data.phase === 'playing' || data.phase === 'dealing') return;
        
        // Signal ALL clients to show deal animation
        await this.db.collection('rooms').doc(this.roomId).update({
            phase: 'dealing',
            dealStartAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
        
        // Gunakan logika deck dari game module jika ada, fallback ke core
        const game = this.activeGame || this.gameRegistry[data.gameId];
        const deck = game && game.buildDeck ? game.buildDeck() : this.buildDeck();
        const shuffled = game && game.shuffleDeck ? game.shuffleDeck(deck) : this.shuffleDeck(deck);
        
        const players = Object.values(data.players);
        const hands = [[], [], [], []];
        shuffled.forEach((c, i) => hands[i % 4].push(c));
        
        const seatToUid = {};
        players.forEach(p => { seatToUid[p.seat] = p.uid; });
        
        const handData = {};
        const activePlayers = [];
        for (let seat = 0; seat < 4; seat++) {
            const uid = seatToUid[seat];
            if (uid) { 
                handData[uid] = hands[seat]; 
                activePlayers.push(uid); 
            }
        }
        
        // Tentukan pemain pertama (pemilik 3 sekop, atau pertama di array)
        let startPlayer = activePlayers[0];
        for (const uid of activePlayers) {
            if (handData[uid].some(c => c.rank === '3' && c.suit === '♠')) {
                startPlayer = uid;
                break;
            }
        }
        
        const playerOrder = [...activePlayers].sort((a, b) => 
            (data.players[a]?.seat ?? 99) - (data.players[b]?.seat ?? 99)
        );
        
        // Write hands to subcollection
        const batch = this.db.batch();
        const roomRef = this.db.collection('rooms').doc(this.roomId);
        
        for (const uid of activePlayers) {
            batch.set(roomRef.collection('hands').doc(uid), { cards: handData[uid] });
            batch.update(roomRef, { [`players.${uid}.handCount`]: handData[uid].length });
        }
        for (let seat = 0; seat < 4; seat++) {
            if (!seatToUid[seat]) batch.update(roomRef, { [`ghostHands.seat${seat}`]: hands[seat].length });
        }
        
        // Tunggu animasi selesai
        await this.playDealAnimation(players.length);
        
        batch.update(roomRef, {
            status: 'playing', phase: 'playing',
            currentPlayer: startPlayer, playerOrder, activePlayers,
            currentCombo: null, passCount: 0, rankings: [],
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
    },

    playDealAnimation(playerCount) {
        return new Promise(resolve => {
            const overlay = document.getElementById('deal-overlay');
            const deckEl = document.getElementById('deal-deck');
            const textEl = document.getElementById('deal-text');
            overlay.classList.remove('hidden');
            deckEl.innerHTML = '';
            
            const N = 8;
            const cards = [];
            for (let i = 0; i < N; i++) {
                const c = document.createElement('div');
                c.className = 'deal-card';
                c.textContent = '♠';
                c.style.zIndex = N - i;
                c.style.transform = `translateY(${-i * 1.5}px)`;
                deckEl.appendChild(c);
                cards.push(c);
            }
            
            textEl.textContent = 'Mengocok kartu…';
            let pass = 0;
            
            const shufflePass = () => {
                if (pass >= 3) { startDeal(); return; }
                pass++;
                cards.forEach((c, i) => {
                    const goRight = i % 2 === 0;
                    c.style.transition = 'transform .25s ease';
                    c.style.animation = `${goRight ? 'shuffle-right' : 'shuffle-left'} .35s ease`;
                    c.style.animationDelay = `${i * 18}ms`;
                });
                setTimeout(() => {
                    cards.forEach(c => c.style.animation = '');
                    shufflePass();
                }, 500);
            };
            
            const startDeal = () => {
                textEl.textContent = 'Membagikan kartu…';
                const dirs = ['translateY(200px)', 'translateX(-200px)', 'translateY(-200px)', 'translateX(200px)'];
                const total = playerCount * 3;
                let done = 0;
                
                for (let i = 0; i < total; i++) {
                    const dir = dirs[i % 4];
                    const rot = `${(Math.random() * 40 - 20).toFixed(0)}deg`;
                    const c = document.createElement('div');
                    c.className = 'deal-card';
                    c.textContent = '♠';
                    c.style.zIndex = 200 + i;
                    c.style.setProperty('--deal-target', dir);
                    c.style.setProperty('--deal-rot', rot);
                    deckEl.appendChild(c);
                    
                    setTimeout(() => {
                        c.style.transition = 'none';
                        c.style.animation = `deal-fly .45s ease forwards`;
                        c.addEventListener('animationend', () => {
                            c.remove(); 
                            done++;
                            if (done >= total) finish();
                        }, { once: true });
                    }, i * 60);
                }
            };
            
            const finish = () => {
                setTimeout(() => {
                    overlay.classList.add('hidden');
                    resolve();
                }, 300);
            };
            
            setTimeout(shufflePass, 200);
        });
    },

    showWinnerAnimation(data, onDone) {
        const winner = data.rankings?.[0];
        const winnerName = winner?.name || 'Pemain';
        this.showScreen('game');
        
        const banner = document.createElement('div');
        banner.id = 'winner-banner';
        banner.style.cssText = `position:fixed;inset:0;z-index:600; display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem; background:rgba(0,0,0,.72); animation:winner-fade-in .4s ease forwards;`;
        banner.innerHTML = `
            <div style="font-size:3.5rem;animation:winner-bounce .6s ease infinite alternate;">🏆</div>
            <div style="font-family:Georgia,serif;font-size:1.6rem;color:#f5c518;text-align:center;padding:0 1.5rem;">
                ${winnerName}<br>
                <span style="font-size:1rem;color:#fff;font-family:sans-serif;">Keluar sebagai pemenang!</span>
            </div>
            <div style="color:rgba(255,255,255,.55);font-size:.8rem;margin-top:.5rem;">Layar ranking dalam 4 detik…</div>
        `;
        document.body.appendChild(banner);
        
        setTimeout(() => {
            banner.style.animation = 'winner-fade-out .5s ease forwards';
            banner.addEventListener('animationend', () => { banner.remove(); onDone(); }, { once: true });
        }, 4000);
    },

    // --- 7. HELPERS ---
    showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => {
            s.classList.toggle('active', s.id === `screen-${name}`);
        });
    },

    showToast(msg, type = '') {
        const el = document.getElementById('toast');
        el.textContent = msg; 
        el.className = `toast ${type}`;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 3000);
    },

    showError(msg) {
        const el = document.getElementById('lobby-error');
        el.textContent = msg; 
        el.classList.remove('hidden');
    },

    getPlayerName() {
        const n = document.getElementById('input-name').value.trim();
        if (!n) { this.showError('Masukkan nama pemain terlebih dahulu.'); return null; }
        return n;
    },

    esc(s) { 
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); 
    },

    renderRanking(rankings) {
        const list = document.getElementById('ranking-list');
        list.innerHTML = '';
        rankings.forEach((r, i) => {
            const cls = ['p1', 'p2', 'p3', 'p4'][i] || 'p4';
            const medals = ['🥇', '🥈', '🥉', '4'];
            const row = document.createElement('div');
            row.className = 'rank-row';
            row.innerHTML = `
                <div class="rank-pos ${cls}">${medals[i] || (i + 1)}</div>
                <div class="rank-name">${this.esc(r.name)}</div>
                <div class="rank-note">${r.note || ''}</div>
            `;
            list.appendChild(row);
        });
    },

    async returnToWaitingRoom() {
        if (!this.roomId || !this.myUid) { this.showScreen('lobby'); return; }
        this._winnerShown = false; 
        this._lastDealAt = '';
        
        if (this.activeGame && this.activeGame.cleanup) this.activeGame.cleanup();
        this.activeGame = null;
        
        try {
            const roomRef = this.db.collection('rooms').doc(this.roomId);
            const snap = await roomRef.get();
            if (!snap.exists) { this.showScreen('lobby'); return; }
            
            const d = snap.data();
            const updates = {
                status: 'waiting', phase: 'ready', currentCombo: null, currentPlayer: null,
                passCount: 0, rankings: [], activePlayers: [],
                ghostHands: firebase.firestore.FieldValue.delete(),
                lastPlayedCard: firebase.firestore.FieldValue.delete(),
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            Object.keys(d.players || {}).forEach(uid => {
                updates[`players.${uid}.ready`] = false;
                updates[`players.${uid}.finished`] = false;
                updates[`players.${uid}.rank`] = firebase.firestore.FieldValue.delete();
                updates[`players.${uid}.handCount`] = 0;
            });
            
            await roomRef.update(updates);
            this.showScreen('waiting');
        } catch (e) {
            this.showToast('Gagal kembali ke room: ' + e.message, 'error');
            this.showScreen('lobby');
        }
    },

    // ================================================
    // CHAT SYSTEM
    // ================================================
    _chatUnsub: null,
    _chatUnread: 0,
    _chatOpen: false,
    _chatVisible: false, // apakah widget ditampilkan (hanya saat di room)

    chatShow() {
        const w = document.getElementById('chat-widget');
        if (w) { w.classList.remove('hidden'); this._chatVisible = true; }
    },

    chatHide() {
        const w = document.getElementById('chat-widget');
        if (w) { w.classList.add('hidden'); this._chatVisible = false; }
        this.chatClosePanel();
        this._chatUnread = 0;
        this._updateChatBadge();
    },

    chatOpenPanel() {
        const panel = document.getElementById('chat-panel');
        const btn   = document.getElementById('chat-toggle');
        if (!panel) return;
        panel.classList.remove('hidden');
        btn?.classList.add('open');
        this._chatOpen = true;
        this._chatUnread = 0;
        this._updateChatBadge();
        // Scroll ke bawah
        setTimeout(() => {
            const msgs = document.getElementById('chat-messages');
            if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }, 30);
        // Fokus input
        setTimeout(() => document.getElementById('chat-input')?.focus(), 60);
    },

    chatClosePanel() {
        const panel = document.getElementById('chat-panel');
        const btn   = document.getElementById('chat-toggle');
        panel?.classList.add('hidden');
        btn?.classList.remove('open');
        this._chatOpen = false;
    },

    chatToggle() {
        if (this._chatOpen) this.chatClosePanel();
        else this.chatOpenPanel();
    },

    _updateChatBadge() {
        const badge = document.getElementById('chat-badge');
        if (!badge) return;
        if (this._chatUnread > 0 && !this._chatOpen) {
            badge.textContent = this._chatUnread > 9 ? '9+' : this._chatUnread;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    },

    // Subscribe ke subcollection chat Firestore
    chatSubscribe() {
        if (this._chatUnsub) { this._chatUnsub(); this._chatUnsub = null; }
        if (!this.roomId || !this.db) return;

        const msgEl = document.getElementById('chat-messages');
        if (msgEl) msgEl.innerHTML = '';

        this._chatUnsub = this.db
            .collection('rooms').doc(this.roomId)
            .collection('chat')
            .orderBy('ts', 'asc')
            .limitToLast(80)
            .onSnapshot(snap => {
                snap.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        this._renderChatMsg(change.doc.data());
                    }
                });
            }, () => {}); // silence permission errors
    },

    chatUnsubscribe() {
        if (this._chatUnsub) { this._chatUnsub(); this._chatUnsub = null; }
    },

    _renderChatMsg(msg) {
        const msgEl = document.getElementById('chat-messages');
        if (!msgEl) return;

        const isMe = msg.uid === this.myUid;
        const isSystem = msg.type === 'system';
        const cls = isSystem ? 'system' : (isMe ? 'mine' : 'theirs');

        const wrap = document.createElement('div');
        wrap.className = `chat-msg ${cls}`;

        if (!isSystem && !isMe) {
            const sender = document.createElement('div');
            sender.className = 'chat-msg-sender';
            sender.textContent = this.esc(msg.name || 'Pemain');
            wrap.appendChild(sender);
        }

        const bubble = document.createElement('div');
        bubble.className = 'chat-msg-bubble';
        bubble.textContent = msg.text || '';
        wrap.appendChild(bubble);

        msgEl.appendChild(wrap);

        // Auto scroll hanya jika sudah di bawah
        const atBottom = msgEl.scrollHeight - msgEl.clientHeight - msgEl.scrollTop < 60;
        if (atBottom) msgEl.scrollTop = msgEl.scrollHeight;

        // Badge unread
        if (!this._chatOpen && !isSystem) {
            this._chatUnread++;
            this._updateChatBadge();
        }
    },

    async chatSend() {
        const input = document.getElementById('chat-input');
        const text = input?.value.trim();
        if (!text || !this.roomId || !this.myUid) return;
        input.value = '';
        document.getElementById('chat-send').disabled = true;
        setTimeout(() => { document.getElementById('chat-send').disabled = false; }, 600);

        try {
            await this.db.collection('rooms').doc(this.roomId)
                .collection('chat').add({
                    uid: this.myUid,
                    name: this.myName || 'Pemain',
                    text: text.substring(0, 120),
                    ts: firebase.firestore.FieldValue.serverTimestamp(),
                    type: 'chat',
                });
        } catch (e) {
            this.showToast('Gagal kirim pesan.', 'error');
        }
    },

    async chatSendSystem(text) {
        if (!this.roomId || !this.db) return;
        try {
            await this.db.collection('rooms').doc(this.roomId)
                .collection('chat').add({
                    uid: 'system',
                    name: 'Sistem',
                    text,
                    ts: firebase.firestore.FieldValue.serverTimestamp(),
                    type: 'system',
                });
        } catch (e) {}
    },

    // Dipanggil dari showScreen agar widget muncul/hilang sesuai layar
    _onScreenChange(name) {
        if (name === 'waiting' || name === 'game') {
            this.chatShow();
            this.chatSubscribe();
        } else {
            this.chatHide();
            this.chatUnsubscribe();
        }
    }
};

// Patch showScreen agar chat ikut reaksi perpindahan layar
const _origShowScreen = Core.showScreen.bind(Core);
Core.showScreen = function(name) {
    _origShowScreen(name);
    Core._onScreenChange(name);
};

// --- 8. EVENT LISTENERS GLOBAL ---
document.addEventListener('DOMContentLoaded', () => {
    Core.initFirebase();
    
    // Lobby
    document.getElementById('btn-create').addEventListener('click', () => {
        const name = Core.getPlayerName();
        if (!name) return;
        Core.createRoom(name);
    });
    
    document.getElementById('btn-join-toggle').addEventListener('click', () => {
        document.getElementById('join-section').classList.toggle('hidden');
    });
    
    document.getElementById('btn-join-confirm').addEventListener('click', () => {
        const name = Core.getPlayerName();
        if (!name) return;
        const code = document.getElementById('input-room-code').value.trim().toUpperCase();
        Core.joinRoom(name, code);
    });
    
    document.getElementById('input-room-code').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const name = Core.getPlayerName();
            if (!name) return;
            const code = document.getElementById('input-room-code').value.trim().toUpperCase();
            Core.joinRoom(name, code);
        }
    });
    
    // Waiting room
    document.getElementById('btn-ready').addEventListener('click', () => Core.toggleReady());
    document.getElementById('btn-start-host').addEventListener('click', () => Core.hostForceStart());
    document.getElementById('btn-leave').addEventListener('click', () => Core.leaveRoom());
    document.getElementById('btn-copy-code').addEventListener('click', () => {
        const code = document.getElementById('display-room-code').textContent;
        navigator.clipboard?.writeText(code).then(() => Core.showToast('Kode disalin!', 'success'));
    });
    
    // Leave game button (di dalam screen game)
    document.getElementById('btn-leave-game').addEventListener('click', () => Core.leaveRoom());

    // ── CHAT ──
    document.getElementById('chat-toggle').addEventListener('click', () => Core.chatToggle());
    document.getElementById('chat-close').addEventListener('click', () => Core.chatClosePanel());
    document.getElementById('chat-send').addEventListener('click', () => Core.chatSend());
    document.getElementById('chat-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Core.chatSend(); }
    });
    // Tutup panel saat klik di luar (di layar game supaya tidak ganggu)
    document.addEventListener('pointerdown', e => {
        if (!Core._chatOpen) return;
        const widget = document.getElementById('chat-widget');
        if (widget && !widget.contains(e.target)) Core.chatClosePanel();
    }, { passive: true });

    // Ranking
    document.getElementById('btn-back-lobby').addEventListener('click', () => {
        Core.returnToWaitingRoom();
    });
    
    // Hide error on input
    ['input-name', 'input-room-code'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            document.getElementById('lobby-error')?.classList.add('hidden');
        });
    });
});