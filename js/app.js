// All DOM, state, and interaction for the chess game. Wrapped in an IIFE so
// nothing leaks globally. A single `state` object holds the game; a single
// `render()` reconciles the 64 pre-built squares against `state`.
(function () {
  const Chess = window.Chess;
  const ChessAI = window.ChessAI;

  // Solid glyph set for BOTH colours; colour is conveyed via CSS classes.
  const GLYPH = {
    K: "♚", Q: "♛", R: "♜",
    B: "♝", N: "♞", P: "♟",
  };
  const VALUES = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

  // --- DOM refs ---
  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const modeSeg = document.getElementById("mode-seg");
  const levelEl = document.getElementById("level");
  const sideEl = document.getElementById("side");
  const levelControl = document.getElementById("level-control");
  const sideControl = document.getElementById("side-control");
  const newGameBtn = document.getElementById("new-game");
  const flipBtn = document.getElementById("flip");
  const undoBtn = document.getElementById("undo");
  const promotionEl = document.getElementById("promotion");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayNew = document.getElementById("overlay-new");
  const capturedWEl = document.getElementById("captured-w");
  const capturedBEl = document.getElementById("captured-b");
  const advWEl = document.getElementById("adv-w");
  const advBEl = document.getElementById("adv-b");
  const moveListEl = document.getElementById("move-list");
  const boardWrap = document.querySelector(".board-wrap");

  const ANIM_MS = 300; // piece-slide duration
  const AI_DELAY_MS = 1000; // pause before the computer replies (1P)

  // --- State (single source of truth) ---
  const state = {
    mode: "1p",
    level: 3,
    humanColor: "w",
    position: null,
    selected: null, // {r,c} in board coords
    legalTargets: [], // move objects from selected square
    positionKeys: [],
    history: [], // [{ san }]
    captured: { w: [], b: [] }, // captured[col] = pieces captured BY that colour
    flipped: false,
    lastMove: null, // { from, to }
    awaitingPromotion: null, // { from, to, options }
    aiThinking: false,
    animating: false,
    status: "ongoing",
    undoStack: [],
  };

  const squares = []; // squares[displayIndex] -> element (row-major display order)

  // --- Build the 64 squares once ---
  function buildBoard() {
    boardEl.innerHTML = "";
    squares.length = 0;
    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const sq = document.createElement("div");
        sq.className = "square";
        sq.dataset.dr = dr;
        sq.dataset.dc = dc;
        sq.addEventListener("click", () => onSquareClick(dr, dc));
        boardEl.appendChild(sq);
        squares.push(sq);
      }
    }
  }

  // Map a display cell to board coordinates given the current orientation.
  function toBoard(dr, dc) {
    return state.flipped ? { r: 7 - dr, c: 7 - dc } : { r: dr, c: dc };
  }

  function findKing(board, color) {
    const target = color + "K";
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c] === target) return { r, c };
    return null;
  }

  function isGameOver() {
    return (
      state.status === "checkmate" ||
      state.status === "stalemate" ||
      state.status.startsWith("draw")
    );
  }

  // --- Render: single source of UI truth ---
  function render() {
    const board = state.position.board;
    const checkColor =
      state.status === "checkmate" || state.status === "check"
        ? state.position.turn
        : null;
    const kingSq = checkColor ? findKing(board, checkColor) : null;

    for (let i = 0; i < 64; i++) {
      const dr = Math.floor(i / 8);
      const dc = i % 8;
      const { r, c } = toBoard(dr, dc);
      const el = squares[i];
      el.className = "square " + ((r + c) % 2 === 0 ? "light" : "dark");

      const piece = board[r][c];
      el.innerHTML = piece
        ? `<span class="piece ${
            Chess.colorOf(piece) === "w" ? "piece-white" : "piece-black"
          }">${GLYPH[Chess.typeOf(piece)]}</span>`
        : "";

      if (state.selected && state.selected.r === r && state.selected.c === c)
        el.classList.add("selected");

      if (
        state.lastMove &&
        ((state.lastMove.from.r === r && state.lastMove.from.c === c) ||
          (state.lastMove.to.r === r && state.lastMove.to.c === c))
      )
        el.classList.add("last-move");

      const target = state.legalTargets.find(
        (m) => m.to.r === r && m.to.c === c
      );
      if (target) {
        el.classList.add("legal");
        if (target.captured || (target.flags && target.flags.enPassant))
          el.classList.add("capture");
      }

      if (kingSq && kingSq.r === r && kingSq.c === c) el.classList.add("check");
    }

    renderStatus();
    renderCaptured();
    renderMoves();
    renderPromotion();
    renderOverlay();
    undoBtn.disabled = state.undoStack.length === 0 || state.aiThinking;
  }

  function renderStatus() {
    statusEl.classList.remove("is-check");
    if (state.aiThinking) {
      statusEl.textContent = "AI thinking…";
      return;
    }
    if (state.status === "checkmate") {
      const winner = state.position.turn === "w" ? "Black" : "White";
      statusEl.textContent = `Checkmate — ${winner} wins`;
      return;
    }
    if (state.status === "stalemate") {
      statusEl.textContent = "Stalemate — draw";
      return;
    }
    if (state.status.startsWith("draw")) {
      statusEl.textContent = "Draw — " + drawReason(state.status);
      return;
    }
    const turnName = state.position.turn === "w" ? "White" : "Black";
    if (state.status === "check") {
      statusEl.textContent = `${turnName} to move — check`;
      statusEl.classList.add("is-check");
    } else {
      statusEl.textContent = `${turnName} to move`;
    }
  }

  function drawReason(status) {
    if (status === "draw-fifty") return "50-move rule";
    if (status === "draw-material") return "insufficient material";
    if (status === "draw-repetition") return "threefold repetition";
    return "";
  }

  function renderCaptured() {
    const glyphs = (list) =>
      list
        .map(
          (p) =>
            `<span class="piece ${
              Chess.colorOf(p) === "w" ? "piece-white" : "piece-black"
            }">${GLYPH[Chess.typeOf(p)]}</span>`
        )
        .join("");
    capturedWEl.innerHTML = glyphs(state.captured.w);
    capturedBEl.innerHTML = glyphs(state.captured.b);

    const sum = (list) =>
      list.reduce((t, p) => t + VALUES[Chess.typeOf(p)], 0);
    const wScore = sum(state.captured.w);
    const bScore = sum(state.captured.b);
    const diff = wScore - bScore;
    advWEl.textContent = diff > 0 ? "+" + diff : "";
    advBEl.textContent = diff < 0 ? "+" + -diff : "";
  }

  function renderMoves() {
    let html = "";
    for (let i = 0; i < state.history.length; i += 2) {
      const w = state.history[i] ? state.history[i].san : "";
      const b = state.history[i + 1] ? state.history[i + 1].san : "";
      html += `<li><span class="ply">${w}</span><span class="ply">${b}</span></li>`;
    }
    moveListEl.innerHTML = html;
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  function renderPromotion() {
    if (!state.awaitingPromotion) {
      promotionEl.classList.add("hidden");
      promotionEl.innerHTML = "";
      return;
    }
    const color = state.position.turn; // side to move is the one promoting
    const cls = color === "w" ? "piece-white" : "piece-black";
    const inner = document.createElement("div");
    inner.className = "promotion__inner";
    for (const t of ["Q", "R", "B", "N"]) {
      const btn = document.createElement("button");
      btn.className = "promotion__btn";
      btn.innerHTML = `<span class="piece ${cls}">${GLYPH[t]}</span>`;
      btn.addEventListener("click", () => choosePromotion(t));
      inner.appendChild(btn);
    }
    promotionEl.innerHTML = "";
    promotionEl.appendChild(inner);
    promotionEl.classList.remove("hidden");
  }

  function renderOverlay() {
    if (!isGameOver()) {
      overlayEl.classList.add("hidden");
      return;
    }
    if (state.status === "checkmate") {
      const winner = state.position.turn === "w" ? "Black" : "White";
      overlayTitle.textContent = "Checkmate";
      overlayText.textContent = `${winner} wins.`;
    } else if (state.status === "stalemate") {
      overlayTitle.textContent = "Stalemate";
      overlayText.textContent = "The game is a draw.";
    } else {
      overlayTitle.textContent = "Draw";
      overlayText.textContent = "By " + drawReason(state.status) + ".";
    }
    overlayEl.classList.remove("hidden");
  }

  // --- Animation ---
  // Display index for a board coordinate under the current orientation.
  function dispIndex(sq) {
    const dr = state.flipped ? 7 - sq.r : sq.r;
    const dc = state.flipped ? 7 - sq.c : sq.c;
    return dr * 8 + dc;
  }

  function clearFloats() {
    boardWrap.querySelectorAll(".floating-piece").forEach((el) => el.remove());
  }

  // Slide the moved piece(s) from origin to destination. `render()` has already
  // drawn the final position, so we float a clone over the board from the source
  // square to the target and hide the static piece until it lands. Returns a
  // promise that resolves when the slide finishes. Castling slides the rook too.
  function animateMove(move) {
    clearFloats();
    const segments = [{ from: move.from, to: move.to }];
    if (move.flags && move.flags.castle === "K")
      segments.push({ from: { r: move.from.r, c: 7 }, to: { r: move.from.r, c: 5 } });
    else if (move.flags && move.flags.castle === "Q")
      segments.push({ from: { r: move.from.r, c: 0 }, to: { r: move.from.r, c: 3 } });

    const wrapRect = boardWrap.getBoundingClientRect();
    const parts = [];
    for (const seg of segments) {
      const fromEl = squares[dispIndex(seg.from)];
      const toEl = squares[dispIndex(seg.to)];
      const pieceEl = toEl ? toEl.querySelector(".piece") : null;
      if (!fromEl || !toEl || !pieceEl) continue;
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      const float = pieceEl.cloneNode(true);
      float.classList.add("floating-piece");
      float.style.left = fromRect.left - wrapRect.left + "px";
      float.style.top = fromRect.top - wrapRect.top + "px";
      float.style.width = fromRect.width + "px";
      float.style.height = fromRect.height + "px";
      float.style.fontSize = window.getComputedStyle(pieceEl).fontSize;
      float.style.transition = `transform ${ANIM_MS}ms ease`;
      boardWrap.appendChild(float);
      pieceEl.style.visibility = "hidden";
      parts.push({ float, pieceEl });

      const dx = toRect.left - fromRect.left;
      const dy = toRect.top - fromRect.top;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          float.style.transform = `translate(${dx}px, ${dy}px)`;
        })
      );
    }

    if (!parts.length) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        for (const p of parts) {
          p.float.remove();
          p.pieceEl.style.visibility = "";
        }
        resolve();
      };
      // Resolve a hair after the transition; setTimeout is the single source of
      // truth so we never wait on a missed transitionend.
      setTimeout(finish, ANIM_MS + 30);
    });
  }

  // Apply a human move, draw it, slide it, then hand off to the AI.
  function commitHumanMove(move) {
    applyMove(move);
    render();
    state.animating = true;
    animateMove(move).then(() => {
      state.animating = false;
      maybeAIMove();
    });
  }

  // --- Interaction ---
  function onSquareClick(dr, dc) {
    if (state.aiThinking || state.animating || state.awaitingPromotion || isGameOver())
      return;
    if (state.mode === "1p" && state.position.turn !== state.humanColor) return;

    const sq = toBoard(dr, dc);
    const piece = state.position.board[sq.r][sq.c];

    if (state.selected) {
      const matches = state.legalTargets.filter(
        (m) => m.to.r === sq.r && m.to.c === sq.c
      );
      if (matches.length) {
        if (matches[0].promotion) {
          state.awaitingPromotion = {
            from: state.selected,
            to: sq,
            options: matches,
          };
          render();
          return;
        }
        commitHumanMove(matches[0]);
        return;
      }
    }

    if (piece && Chess.colorOf(piece) === state.position.turn) {
      state.selected = sq;
      state.legalTargets = Chess.legalMovesFrom(state.position, sq);
    } else {
      clearSelection();
    }
    render();
  }

  function choosePromotion(type) {
    const ap = state.awaitingPromotion;
    if (!ap) return;
    const move = ap.options.find((m) => m.promotion === type);
    state.awaitingPromotion = null;
    if (move) {
      commitHumanMove(move);
    } else {
      render();
    }
  }

  function clearSelection() {
    state.selected = null;
    state.legalTargets = [];
  }

  function pushUndo() {
    state.undoStack.push({
      position: Chess.clonePosition(state.position),
      lastMove: state.lastMove
        ? { from: { ...state.lastMove.from }, to: { ...state.lastMove.to } }
        : null,
      captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
      historyLen: state.history.length,
      positionKeysLen: state.positionKeys.length,
      status: state.status,
    });
  }

  function applyMove(move) {
    pushUndo();
    const san = Chess.toSAN(state.position, move);
    if (move.captured) {
      const by = Chess.colorOf(move.piece);
      state.captured[by].push(move.captured);
    }
    state.position = Chess.makeMove(state.position, move);
    state.positionKeys.push(Chess.positionKey(state.position));
    state.history.push({ san });
    state.lastMove = { from: move.from, to: move.to };
    clearSelection();
    state.status = Chess.gameStatus(state.position, state.positionKeys);
  }

  function restore(snap) {
    state.position = snap.position;
    state.lastMove = snap.lastMove;
    state.captured = snap.captured;
    state.history.length = snap.historyLen;
    state.positionKeys.length = snap.positionKeysLen;
    state.status = snap.status;
    state.awaitingPromotion = null;
    clearSelection();
  }

  function undo() {
    if (state.aiThinking || state.animating || state.undoStack.length === 0) return;
    clearFloats();
    if (state.mode === "2p") {
      restore(state.undoStack.pop());
    } else {
      let snap = null;
      while (state.undoStack.length) {
        snap = state.undoStack.pop();
        if (snap.position.turn === state.humanColor) break;
      }
      if (snap) restore(snap);
    }
    render();
    // If the undo landed on the AI's turn (e.g. undoing the AI's opening move
    // when the human plays Black), let the AI move again rather than deadlock.
    maybeAIMove();
  }

  function maybeAIMove() {
    if (state.mode !== "1p") return;
    if (isGameOver()) return;
    if (state.position.turn === state.humanColor) return;
    state.aiThinking = true;
    render();
    // Pause ~1s before the computer replies (also lets the "AI thinking" paint
    // land before the blocking search runs).
    setTimeout(() => {
      const move = ChessAI.chooseMove(state.position, state.level);
      state.aiThinking = false;
      if (move) {
        applyMove(move);
        render();
        state.animating = true;
        animateMove(move).then(() => {
          state.animating = false;
          render();
        });
      } else {
        render();
      }
    }, AI_DELAY_MS);
  }

  // --- New game ---
  function newGame() {
    state.level = Number(levelEl.value);
    let side = sideEl.value;
    if (side === "random") side = Math.random() < 0.5 ? "w" : "b";
    state.humanColor = side;
    state.flipped = state.mode === "1p" && side === "b";

    state.position = Chess.initialPosition();
    clearSelection();
    state.positionKeys = [Chess.positionKey(state.position)];
    state.history = [];
    state.captured = { w: [], b: [] };
    state.lastMove = null;
    state.awaitingPromotion = null;
    state.aiThinking = false;
    state.animating = false;
    state.undoStack = [];
    state.status = "ongoing";

    clearFloats();
    render();
    maybeAIMove();
  }

  function setMode(mode) {
    state.mode = mode;
    for (const btn of modeSeg.querySelectorAll(".seg__btn")) {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    }
    const oneP = mode === "1p";
    levelControl.classList.toggle("hidden", !oneP);
    sideControl.classList.toggle("hidden", !oneP);
    newGame();
  }

  // --- Event wiring ---
  modeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg__btn");
    if (btn) setMode(btn.dataset.mode);
  });
  levelEl.addEventListener("change", () => {
    state.level = Number(levelEl.value); // applies to subsequent AI moves
  });
  sideEl.addEventListener("change", newGame);
  newGameBtn.addEventListener("click", newGame);
  overlayNew.addEventListener("click", newGame);
  flipBtn.addEventListener("click", () => {
    state.flipped = !state.flipped;
    render();
  });
  undoBtn.addEventListener("click", undo);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearSelection();
      state.awaitingPromotion = null;
      render();
    } else if (e.key === "f" || e.key === "F") {
      state.flipped = !state.flipped;
      render();
    } else if (e.key === "n" || e.key === "N") {
      newGame();
    }
  });

  // --- Boot ---
  buildBoard();
  newGame();
})();
