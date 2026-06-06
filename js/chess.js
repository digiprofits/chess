// Pure chess rules engine — no DOM access.
// Board is an 8x8 array of arrays. Empty square = null; piece = 2-char code:
// colour ('w'|'b') + type ('K','Q','R','B','N','P'), e.g. "wK", "bP".
// Row 0 = rank 8 (Black back rank), row 7 = rank 1 (White back rank).
// Display orientation (flipping) is handled entirely in app.js.

const FILES = "abcdefgh";

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function inside(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}
function colorOf(piece) {
  return piece[0];
}
function typeOf(piece) {
  return piece[1];
}
function opposite(color) {
  return color === "w" ? "b" : "w";
}

function initialBoard() {
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const board = [];
  for (let r = 0; r < 8; r++) board.push(new Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = "b" + back[c];
    board[1][c] = "bP";
    board[6][c] = "wP";
    board[7][c] = "w" + back[c];
  }
  return board;
}

function initialPosition() {
  return {
    board: initialBoard(),
    turn: "w",
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    ep: null,
    halfmove: 0,
    fullmove: 1,
  };
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function clonePosition(pos) {
  return {
    board: cloneBoard(pos.board),
    turn: pos.turn,
    castling: { ...pos.castling },
    ep: pos.ep ? { r: pos.ep.r, c: pos.ep.c } : null,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
}

function findKing(board, color) {
  const target = color + "K";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === target) return { r, c };
    }
  }
  return null;
}

// Is square {r,c} attacked by any piece of `byColor`?
function isAttacked(board, sq, byColor) {
  const { r, c } = sq;

  // Pawns: a byColor pawn attacks diagonally "forward".
  // White pawns move up (row -1) so they attack from row+1; black from row-1.
  const pawnRow = byColor === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    const pc = c + dc;
    if (inside(pawnRow, pc) && board[pawnRow][pc] === byColor + "P") return true;
  }

  // Knights
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inside(nr, nc) && board[nr][nc] === byColor + "N") return true;
  }

  // King
  for (const [dr, dc] of KING_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inside(nr, nc) && board[nr][nc] === byColor + "K") return true;
  }

  // Sliding: bishops/queens on diagonals
  for (const [dr, dc] of BISHOP_DIRS) {
    let nr = r + dr, nc = c + dc;
    while (inside(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === "B" || typeOf(p) === "Q"))
          return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }

  // Sliding: rooks/queens on ranks/files
  for (const [dr, dc] of ROOK_DIRS) {
    let nr = r + dr, nc = c + dc;
    while (inside(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === "R" || typeOf(p) === "Q"))
          return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }

  return false;
}

function inCheck(pos, color) {
  const king = findKing(pos.board, color);
  if (!king) return false;
  return isAttacked(pos.board, king, opposite(color));
}

function makeMoveObj(from, to, piece, extra) {
  return Object.assign(
    {
      from,
      to,
      piece,
      captured: null,
      promotion: null,
      flags: { castle: null, enPassant: false, doublePush: false },
    },
    extra || {}
  );
}

// Pseudo-legal moves from a single square (does not test self-check, except
// castling which is fully validated here because it depends on pass-through
// squares not being attacked).
function pseudoMovesFrom(pos, sq) {
  const { board, turn } = pos;
  const piece = board[sq.r][sq.c];
  if (!piece || colorOf(piece) !== turn) return [];
  const type = typeOf(piece);
  const moves = [];
  const enemy = opposite(turn);

  const addSliding = (dirs) => {
    for (const [dr, dc] of dirs) {
      let nr = sq.r + dr, nc = sq.c + dc;
      while (inside(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          moves.push(makeMoveObj(sq, { r: nr, c: nc }, piece));
        } else {
          if (colorOf(target) === enemy)
            moves.push(makeMoveObj(sq, { r: nr, c: nc }, piece, { captured: target }));
          break;
        }
        nr += dr; nc += dc;
      }
    }
  };

  const addStep = (offsets) => {
    for (const [dr, dc] of offsets) {
      const nr = sq.r + dr, nc = sq.c + dc;
      if (!inside(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target) moves.push(makeMoveObj(sq, { r: nr, c: nc }, piece));
      else if (colorOf(target) === enemy)
        moves.push(makeMoveObj(sq, { r: nr, c: nc }, piece, { captured: target }));
    }
  };

  if (type === "P") {
    const dir = turn === "w" ? -1 : 1;
    const startRow = turn === "w" ? 6 : 1;
    const promoRow = turn === "w" ? 0 : 7;
    const oneR = sq.r + dir;

    const pushPawn = (to, extra) => {
      if (to.r === promoRow) {
        for (const promo of ["Q", "R", "B", "N"]) {
          moves.push(makeMoveObj(sq, to, piece, Object.assign({ promotion: promo }, extra)));
        }
      } else {
        moves.push(makeMoveObj(sq, to, piece, extra));
      }
    };

    // forward one
    if (inside(oneR, sq.c) && !board[oneR][sq.c]) {
      pushPawn({ r: oneR, c: sq.c }, {});
      // forward two
      const twoR = sq.r + 2 * dir;
      if (sq.r === startRow && !board[twoR][sq.c]) {
        moves.push(
          makeMoveObj(sq, { r: twoR, c: sq.c }, piece, {
            flags: { castle: null, enPassant: false, doublePush: true },
          })
        );
      }
    }
    // captures
    for (const dc of [-1, 1]) {
      const nc = sq.c + dc;
      if (!inside(oneR, nc)) continue;
      const target = board[oneR][nc];
      if (target && colorOf(target) === enemy) {
        pushPawn({ r: oneR, c: nc }, { captured: target });
      } else if (pos.ep && pos.ep.r === oneR && pos.ep.c === nc) {
        // en passant — captured pawn sits on the moving pawn's row
        const capPawn = board[sq.r][nc];
        moves.push(
          makeMoveObj(sq, { r: oneR, c: nc }, piece, {
            captured: capPawn,
            flags: { castle: null, enPassant: true, doublePush: false },
          })
        );
      }
    }
  } else if (type === "N") {
    addStep(KNIGHT_OFFSETS);
  } else if (type === "B") {
    addSliding(BISHOP_DIRS);
  } else if (type === "R") {
    addSliding(ROOK_DIRS);
  } else if (type === "Q") {
    addSliding(BISHOP_DIRS);
    addSliding(ROOK_DIRS);
  } else if (type === "K") {
    addStep(KING_OFFSETS);
    // Castling
    const homeRow = turn === "w" ? 7 : 0;
    if (sq.r === homeRow && sq.c === 4 && !isAttacked(board, sq, enemy)) {
      const kSide = turn === "w" ? pos.castling.wK : pos.castling.bK;
      const qSide = turn === "w" ? pos.castling.wQ : pos.castling.bQ;
      // Kingside: squares (homeRow,5),(homeRow,6) empty; king path 4->5->6 safe
      if (
        kSide &&
        !board[homeRow][5] &&
        !board[homeRow][6] &&
        board[homeRow][7] === turn + "R" &&
        !isAttacked(board, { r: homeRow, c: 5 }, enemy) &&
        !isAttacked(board, { r: homeRow, c: 6 }, enemy)
      ) {
        moves.push(
          makeMoveObj(sq, { r: homeRow, c: 6 }, piece, {
            flags: { castle: "K", enPassant: false, doublePush: false },
          })
        );
      }
      // Queenside: squares (homeRow,1),(2),(3) empty; king path 4->3->2 safe
      if (
        qSide &&
        !board[homeRow][1] &&
        !board[homeRow][2] &&
        !board[homeRow][3] &&
        board[homeRow][0] === turn + "R" &&
        !isAttacked(board, { r: homeRow, c: 3 }, enemy) &&
        !isAttacked(board, { r: homeRow, c: 2 }, enemy)
      ) {
        moves.push(
          makeMoveObj(sq, { r: homeRow, c: 2 }, piece, {
            flags: { castle: "Q", enPassant: false, doublePush: false },
          })
        );
      }
    }
  }

  return moves;
}

// Apply a move, returning a NEW position (input is not mutated).
function makeMove(pos, move) {
  const next = clonePosition(pos);
  const { board } = next;
  const mover = pos.turn;
  const piece = move.piece || board[move.from.r][move.from.c];

  board[move.from.r][move.from.c] = null;

  // En passant: remove the captured pawn (on the moving pawn's row).
  if (move.flags && move.flags.enPassant) {
    board[move.from.r][move.to.c] = null;
  }

  // Place the piece (promotion swaps the type).
  if (move.promotion) {
    board[move.to.r][move.to.c] = mover + move.promotion;
  } else {
    board[move.to.r][move.to.c] = piece;
  }

  // Castling: move the rook too.
  if (move.flags && move.flags.castle === "K") {
    board[move.from.r][5] = board[move.from.r][7];
    board[move.from.r][7] = null;
  } else if (move.flags && move.flags.castle === "Q") {
    board[move.from.r][3] = board[move.from.r][0];
    board[move.from.r][0] = null;
  }

  // Update castling rights.
  if (typeOf(piece) === "K") {
    if (mover === "w") { next.castling.wK = false; next.castling.wQ = false; }
    else { next.castling.bK = false; next.castling.bQ = false; }
  }
  // Rook leaving a home square.
  const clearRookRight = (r, c) => {
    if (r === 7 && c === 0) next.castling.wQ = false;
    else if (r === 7 && c === 7) next.castling.wK = false;
    else if (r === 0 && c === 0) next.castling.bQ = false;
    else if (r === 0 && c === 7) next.castling.bK = false;
  };
  if (typeOf(piece) === "R") clearRookRight(move.from.r, move.from.c);
  // Rook captured on a home square.
  if (move.captured && typeOf(move.captured) === "R" && !(move.flags && move.flags.enPassant)) {
    clearRookRight(move.to.r, move.to.c);
  }

  // En passant target.
  next.ep =
    move.flags && move.flags.doublePush
      ? { r: (move.from.r + move.to.r) / 2, c: move.from.c }
      : null;

  // Clocks.
  if (typeOf(piece) === "P" || move.captured) next.halfmove = 0;
  else next.halfmove = pos.halfmove + 1;
  if (mover === "b") next.fullmove = pos.fullmove + 1;

  next.turn = opposite(mover);
  return next;
}

// All pseudo-legal moves for the side to move (no self-check filtering). Used by
// the search, which makes each move once and discards those leaving the king in
// check — avoiding the double make/unmake that legalMoves would incur.
function pseudoMoves(pos) {
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = pos.board[r][c];
      if (p && colorOf(p) === pos.turn) {
        const ms = pseudoMovesFrom(pos, { r, c });
        for (const m of ms) out.push(m);
      }
    }
  }
  return out;
}

function legalMovesFrom(pos, sq) {
  const mover = pos.turn;
  return pseudoMovesFrom(pos, sq).filter((m) => {
    const after = makeMove(pos, m);
    return !inCheck(after, mover);
  });
}

function legalMoves(pos) {
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = pos.board[r][c];
      if (p && colorOf(p) === pos.turn) {
        const ms = legalMovesFrom(pos, { r, c });
        for (const m of ms) out.push(m);
      }
    }
  }
  return out;
}

function isInsufficientMaterial(board) {
  const minors = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const t = typeOf(p);
      if (t === "K") continue;
      if (t === "P" || t === "R" || t === "Q") return false;
      // Bishop or knight
      minors.push({ type: t, squareColor: (r + c) % 2 });
    }
  }
  if (minors.length === 0) return true; // K vs K
  if (minors.length === 1) return true; // K + single minor vs K
  if (minors.length === 2 && minors[0].type === "B" && minors[1].type === "B" &&
      minors[0].squareColor === minors[1].squareColor) {
    return true; // K+B vs K+B, bishops on same colour
  }
  return false;
}

function positionKey(pos) {
  let s = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) s += pos.board[r][c] || ".";
  }
  s += "|" + pos.turn;
  s += "|" + (pos.castling.wK ? "K" : "") + (pos.castling.wQ ? "Q" : "") +
       (pos.castling.bK ? "k" : "") + (pos.castling.bQ ? "q" : "");
  s += "|" + (pos.ep ? pos.ep.r + "," + pos.ep.c : "-");
  return s;
}

function squareName(sq) {
  return FILES[sq.c] + (8 - sq.r);
}

// status, given the running list of position keys (for threefold repetition).
function gameStatus(pos, positionKeys) {
  const moves = legalMoves(pos);
  const checked = inCheck(pos, pos.turn);
  if (moves.length === 0) return checked ? "checkmate" : "stalemate";
  if (isInsufficientMaterial(pos.board)) return "draw-material";
  if (pos.halfmove >= 100) return "draw-fifty";
  if (positionKeys && positionKeys.length) {
    const key = positionKey(pos);
    let count = 0;
    for (const k of positionKeys) if (k === key) count++;
    if (count >= 3) return "draw-repetition";
  }
  return checked ? "check" : "ongoing";
}

// Standard Algebraic Notation for a move played from `pos`.
function toSAN(pos, move) {
  if (move.flags && move.flags.castle === "K") return withCheckSuffix(pos, move, "O-O");
  if (move.flags && move.flags.castle === "Q") return withCheckSuffix(pos, move, "O-O-O");

  const type = typeOf(move.piece);
  const dest = squareName(move.to);
  const isCapture = !!move.captured || (move.flags && move.flags.enPassant);
  let san = "";

  if (type === "P") {
    if (isCapture) san += FILES[move.from.c] + "x";
    san += dest;
    if (move.promotion) san += "=" + move.promotion;
  } else {
    san += type;
    san += disambiguation(pos, move);
    if (isCapture) san += "x";
    san += dest;
  }
  return withCheckSuffix(pos, move, san);
}

function disambiguation(pos, move) {
  const type = typeOf(move.piece);
  const others = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (r === move.from.r && c === move.from.c) continue;
      const p = pos.board[r][c];
      if (p && p === move.piece) {
        const ms = legalMovesFrom(pos, { r, c });
        if (ms.some((m) => m.to.r === move.to.r && m.to.c === move.to.c)) {
          others.push({ r, c });
        }
      }
    }
  }
  if (others.length === 0) return "";
  const sameFile = others.some((o) => o.c === move.from.c);
  const sameRank = others.some((o) => o.r === move.from.r);
  if (!sameFile) return FILES[move.from.c];
  if (!sameRank) return String(8 - move.from.r);
  return FILES[move.from.c] + (8 - move.from.r);
}

function withCheckSuffix(pos, move, san) {
  const after = makeMove(pos, move);
  if (inCheck(after, after.turn)) {
    const noMoves = legalMoves(after).length === 0;
    return san + (noMoves ? "#" : "+");
  }
  return san;
}

// Verification helper — node count of the legal move tree to `depth`.
function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) nodes += perft(makeMove(pos, m), depth - 1);
  return nodes;
}

window.Chess = {
  FILES,
  initialPosition,
  clonePosition,
  pseudoMovesFrom,
  pseudoMoves,
  legalMovesFrom,
  legalMoves,
  isAttacked,
  inCheck,
  makeMove,
  gameStatus,
  isInsufficientMaterial,
  positionKey,
  squareName,
  toSAN,
  perft,
  colorOf,
  typeOf,
};
