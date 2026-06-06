// Chess search/evaluation engine — no DOM access. Depends on window.Chess.
// Exposes window.ChessAI = { chooseMove, evaluate, LEVELS }.

(function () {
  const { legalMoves, pseudoMoves, makeMove, inCheck, typeOf, colorOf } =
    window.Chess;

  const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  // Time-budget plumbing for iterative deepening. `deadline` is an absolute ms
  // timestamp; when exceeded, deep nodes throw ABORT and the root keeps the best
  // move from the last fully completed depth.
  const ABORT = {};
  let deadline = Infinity;
  function timeUp() {
    return deadline !== Infinity && Date.now() >= deadline;
  }

  // Piece-square tables (White's perspective, row 0 = rank 8). Added to material
  // for White; mirrored vertically for Black.
  const PST = {
    P: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [50, 50, 50, 50, 50, 50, 50, 50],
      [10, 10, 20, 30, 30, 20, 10, 10],
      [5, 5, 10, 25, 25, 10, 5, 5],
      [0, 0, 0, 20, 20, 0, 0, 0],
      [5, -5, -10, 0, 0, -10, -5, 5],
      [5, 10, 10, -20, -20, 10, 10, 5],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
    N: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20, 0, 0, 0, 0, -20, -40],
      [-30, 0, 10, 15, 15, 10, 0, -30],
      [-30, 5, 15, 20, 20, 15, 5, -30],
      [-30, 0, 15, 20, 20, 15, 0, -30],
      [-30, 5, 10, 15, 15, 10, 5, -30],
      [-40, -20, 0, 5, 5, 0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50],
    ],
    B: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 10, 10, 5, 0, -10],
      [-10, 5, 5, 10, 10, 5, 5, -10],
      [-10, 0, 10, 10, 10, 10, 0, -10],
      [-10, 10, 10, 10, 10, 10, 10, -10],
      [-10, 5, 0, 0, 0, 0, 5, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20],
    ],
    R: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [5, 10, 10, 10, 10, 10, 10, 5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [0, 0, 0, 5, 5, 0, 0, 0],
    ],
    Q: [
      [-20, -10, -10, -5, -5, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 5, 5, 5, 0, -10],
      [-5, 0, 5, 5, 5, 5, 0, -5],
      [0, 0, 5, 5, 5, 5, 0, -5],
      [-10, 5, 5, 5, 5, 5, 0, -10],
      [-10, 0, 5, 0, 0, 0, 0, -10],
      [-20, -10, -10, -5, -5, -10, -10, -20],
    ],
    K: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [20, 20, 0, 0, 0, 0, 20, 20],
      [20, 30, 10, 0, 0, 10, 30, 20],
    ],
  };

  // Absolute evaluation: positive favours White, negative favours Black.
  function evaluate(pos) {
    const board = pos.board;
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        const t = typeOf(p);
        if (colorOf(p) === "w") {
          score += VALUES[t] + PST[t][r][c];
        } else {
          score -= VALUES[t] + PST[t][7 - r][c];
        }
      }
    }
    return score;
  }

  // MVV-LVA ordering: captures first (most valuable victim, least valuable
  // attacker), then quiet moves.
  function orderMoves(moves) {
    return moves
      .map((m) => {
        let s = 0;
        if (m.captured) s += 10 * VALUES[typeOf(m.captured)] - VALUES[typeOf(m.piece)];
        if (m.promotion) s += VALUES[m.promotion];
        return { m, s };
      })
      .sort((a, b) => b.s - a.s)
      .map((x) => x.m);
  }

  // Negamax from the side-to-move perspective. Returns a score where higher is
  // better for the side to move in `pos`. Iterates pseudo-legal moves and makes
  // each once, skipping those that leave the mover in check — so a move is never
  // generated twice (no separate legalMoves() pass).
  function negamax(pos, depth, alpha, beta, useQuiescence) {
    // Cheap deadline check at deeper nodes only (depth-1 subtrees are quick).
    if (depth >= 2 && timeUp()) throw ABORT;
    if (depth === 0) {
      return useQuiescence ? quiescence(pos, alpha, beta) : signed(pos);
    }
    const mover = pos.turn;
    let best = -Infinity;
    let anyLegal = false;
    for (const m of orderMoves(pseudoMoves(pos))) {
      const child = makeMove(pos, m);
      if (inCheck(child, mover)) continue; // illegal — discard
      anyLegal = true;
      const score = -negamax(child, depth - 1, -beta, -alpha, useQuiescence);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (!anyLegal) {
      // Checkmate (bad for side to move) or stalemate (neutral).
      return inCheck(pos, mover) ? -100000 - depth : 0;
    }
    return best;
  }

  // Captures-only search to soften the horizon effect. Generates only capture /
  // promotion pseudo-moves, so quiescence nodes stay cheap.
  function quiescence(pos, alpha, beta) {
    const standPat = signed(pos);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    const mover = pos.turn;
    const caps = orderMoves(
      pseudoMoves(pos).filter((m) => m.captured || m.promotion)
    );
    for (const m of caps) {
      const child = makeMove(pos, m);
      if (inCheck(child, mover)) continue; // illegal — discard
      const score = -quiescence(child, -beta, -alpha);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  // evaluate() is absolute (White +). Convert to side-to-move perspective.
  function signed(pos) {
    return pos.turn === "w" ? evaluate(pos) : -evaluate(pos);
  }

  // Difficulty 1..5 → search depth + eval jitter + blunder probability.
  // Level 5 uses iterative deepening up to `depth`, capped at `timeBudget` ms.
  const LEVELS = {
    1: { depth: 0, jitter: 0, randomMove: true },     // Beginner — mostly random
    2: { depth: 1, jitter: 90, randomMove: false },   // Easy — greedy, blunders
    3: { depth: 2, jitter: 40, randomMove: false },   // Medium
    4: { depth: 3, jitter: 15, randomMove: false },   // Hard
    5: { depth: 5, jitter: 0, randomMove: false, quiescence: true, timeBudget: 900 }, // Expert
  };

  // Iterative deepening with a wall-clock cap. Searches depth 1, 2, … keeping the
  // best move from the last fully completed depth; aborts cleanly when the budget
  // is hit so a move never blows past ~timeBudget ms.
  function chooseBestTimed(pos, cfg) {
    let legal = orderMoves(window.Chess.legalMoves(pos));
    if (!legal.length) return null;
    let best = legal[0];
    deadline = Date.now() + cfg.timeBudget;
    try {
      for (let d = 1; d <= cfg.depth; d++) {
        let localBest = null;
        let localScore = -Infinity;
        let alpha = -Infinity;
        for (const m of legal) {
          const score = -negamax(makeMove(pos, m), d - 1, -Infinity, -alpha, !!cfg.quiescence);
          if (score > localScore) { localScore = score; localBest = m; }
          if (score > alpha) alpha = score;
        }
        // Depth fully completed — adopt its best and search it first next time.
        best = localBest;
        legal = legal.filter((m) => m !== best);
        legal.unshift(best);
        if (timeUp()) break;
      }
    } catch (e) {
      if (e !== ABORT) throw e; // real error — surface it
    }
    deadline = Infinity;
    return best;
  }

  // Deterministic-ish jitter without Math.random gating correctness: we still
  // use Math.random for variety, but only to add small noise / pick among
  // near-equal moves so weak levels feel human.
  function chooseMove(pos, level) {
    const cfg = LEVELS[level] || LEVELS[3];
    const moves = legalMoves(pos);
    if (moves.length === 0) return null;

    // Level 1: random, but grab a clearly free capture some of the time.
    if (cfg.randomMove) {
      const goodCaptures = moves.filter((m) => m.captured && VALUES[typeOf(m.captured)] >= 300);
      if (goodCaptures.length && Math.random() < 0.6) {
        return goodCaptures[Math.floor(Math.random() * goodCaptures.length)];
      }
      return moves[Math.floor(Math.random() * moves.length)];
    }

    // Top level: iterative deepening within a time budget.
    if (cfg.timeBudget) {
      return chooseBestTimed(pos, cfg);
    }

    const ordered = orderMoves(moves);
    let bestScore = -Infinity;
    let scored = [];
    for (const m of ordered) {
      let score = -negamax(
        makeMove(pos, m),
        cfg.depth - 1,
        -Infinity,
        Infinity,
        !!cfg.quiescence
      );
      if (cfg.jitter) score += (Math.random() * 2 - 1) * cfg.jitter;
      scored.push({ m, score });
      if (score > bestScore) bestScore = score;
    }
    // Pick randomly among moves within a small window of the best (more spread
    // at lower levels via larger jitter already baked into score).
    const window = cfg.jitter ? cfg.jitter : 1;
    const contenders = scored.filter((x) => x.score >= bestScore - window);
    const pick = contenders[Math.floor(Math.random() * contenders.length)] ||
      scored.find((x) => x.score === bestScore);
    return pick.m;
  }

  window.ChessAI = { chooseMove, evaluate, LEVELS };
})();
